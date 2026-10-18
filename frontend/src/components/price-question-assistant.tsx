"use client";
import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, Textarea } from "flowbite-react";
import { ArrowLeft, LoaderCircle, MessageCircle, Send } from "lucide-react";
import { formatVnd } from "@/features/pricing/validation";
import { formatMinimumPackageQuantity, formatPackageContents } from "@/features/pricing/package-display";
import { DemoPriceLabel } from "@/components/demo-price-label";
import { requestApi, requestPublicApi, ApiRequestError } from "@/lib/api/client";
import type { ApiResponse } from "@/lib/api/generated/api-types";
import { createRagConversation, readRagConversation } from "@/lib/api/rag-conversations";

type Answer = ApiResponse<"/api/v1/rag/query", "post">;
const examples = ["Bulong 8 ly x 3F có quy cách gì?", "Trang nào có thông tin về vít tole?", "Giá sỉ tắc kê sắt 8 ly là bao nhiêu?"];
const priceTypeLabel = (value: string) => value === "wholesale" ? "Giá sỉ" : value === "dealer" ? "Giá đại lý" : "Giá lẻ";

type PriceQuestionAssistantProps = {
  audience?: "employee" | "customer";
  onChoosePrice?: (item: Answer["items"][number], price: Answer["items"][number]["prices"][number]) => void;
  choosingPrice?: boolean;
};

export function PriceQuestionAssistant({ audience = "employee", onChoosePrice, choosingPrice = false }: PriceQuestionAssistantProps) {
  const customerPreviousQuestion = useRef<string | null>(null);
  const customerPreviousVariantIds = useRef<number[]>([]);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Answer | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;

    if (event.altKey) {
      event.preventDefault();
      const input = event.currentTarget;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      setQuestion((current) => `${current.slice(0, start)}\n${current.slice(end)}`);
      requestAnimationFrame(() => input.setSelectionRange(start + 1, start + 1));
      return;
    }

    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (searching || !question.trim()) return;
    event.currentTarget.form?.requestSubmit();
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) return;
    setSearching(true); setError(""); setResult(null);
    try {
      let activeConversationId = conversationId;
      if (audience === "customer") {
        const askedQuestion = question.trim();
        const body = await requestPublicApi<Answer>("/api/v1/public/rag/query", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: askedQuestion,
            ...(customerPreviousQuestion.current ? { previousQuestion: customerPreviousQuestion.current } : {}),
            ...(customerPreviousVariantIds.current.length ? { previousVariantIds: customerPreviousVariantIds.current } : {}),
          }),
        });
        customerPreviousQuestion.current = askedQuestion;
        const returnedVariantIds = body.retrieval.trace?.variantIds ?? body.items.map((item) => item.id);
        if (returnedVariantIds.length) customerPreviousVariantIds.current = returnedVariantIds.slice(0, 40);
        else if (body.status !== "clarify") customerPreviousVariantIds.current = [];
        setResult(body);
        return;
      }
      if (!activeConversationId) {
        const savedId = sessionStorage.getItem("priceapp-rag-conversation");
        if (savedId) {
          try { await readRagConversation(savedId); activeConversationId = savedId; }
          catch (cause) {
            if (!(cause instanceof ApiRequestError) || cause.status !== 404) throw cause;
            sessionStorage.removeItem("priceapp-rag-conversation");
          }
        }
        if (!activeConversationId) activeConversationId = (await createRagConversation()).id;
      }
      const body = await requestApi<Answer>("/api/v1/rag/query", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), conversationId: activeConversationId }),
      });
      const persistedId = body.conversationId ?? activeConversationId;
      setConversationId(persistedId);
      sessionStorage.setItem("priceapp-rag-conversation", persistedId);
      setResult(body);
    } catch (cause) {
      setError(cause instanceof ApiRequestError && cause.status === 401 && audience === "employee"
        ? "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại."
        : cause instanceof ApiRequestError && cause.status === 429
          ? cause.message
          : "Chưa truy xuất được thông tin. Hãy thử lại sau ít phút.");
    }
    finally { setSearching(false); }
  }

  const Container = audience === "customer" ? "section" : "main";
  const showAnswer = result && (audience === "employee" || result.status !== "answered" || result.items.length !== 1 || Boolean(result.answerBlocks?.length) || Boolean(result.catalogPage) || !result.items.some(item => item.prices.length));
  return <Container aria-label={audience === "customer" ? "Hỏi đáp với AI" : undefined} className={`mx-auto ${audience === "customer" ? "max-w-7xl px-4 py-5 lg:px-6" : "min-h-screen max-w-4xl px-5 py-8 sm:py-12"}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">{audience === "employee" && <Link href="/staff" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--green)]"><ArrowLeft size={17}/> Về bán hàng</Link>}<div className="ml-auto flex items-center gap-4"><Button type="button" className="rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] underline dark:text-slate-700" onClick={() => { setConversationId(null); setQuestion(""); setResult(null); customerPreviousQuestion.current = null; customerPreviousVariantIds.current = []; if (audience === "employee") sessionStorage.removeItem("priceapp-rag-conversation"); }}>Cuộc trao đổi mới</Button>{audience === "employee" && <Link href="/rag-admin" className="text-sm font-bold text-[var(--muted)] underline">Quản trị catalog RAG</Link>}</div></div>
    <div className="mt-5 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[var(--green)] text-white"><MessageCircle size={20}/></span><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[var(--green)]">TRỢ LÝ VẬT TƯ</p><h2 className="text-xl font-bold sm:text-2xl">Hỏi đáp với AI</h2></div></div>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Hỏi về sản phẩm, quy cách, đóng gói hoặc giá hiện hành trong danh mục Supabase. Câu trả lời sẽ kèm nguồn khi tìm thấy căn cứ.</p>
    <form onSubmit={ask} className="mt-4 space-y-3 text-slate-900 dark:text-slate-900"><label htmlFor="price-question" className="sr-only">Câu hỏi cho trợ lý AI</label><Textarea id="price-question" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={handleQuestionKeyDown} placeholder="Ví dụ: Tắc kê sắt có những quy cách gì?" rows={2} maxLength={1000} className="block w-full resize-y rounded-xl border border-gray-300 bg-white p-4 text-base text-slate-900 shadow-sm placeholder:text-slate-500 outline-none dark:border-gray-300 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-500"/><div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-slate-600 dark:text-slate-600">Giá lấy từ bảng hiện hành; AI chỉ trả lời theo dữ liệu có căn cứ.</span><Button type="submit" disabled={searching || !question.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-100 px-4 py-3 font-bold text-blue-950 shadow-sm hover:bg-blue-200 disabled:opacity-60 dark:border-blue-200 dark:bg-blue-100 dark:text-blue-950 dark:hover:bg-blue-200">{searching ? <LoaderCircle className="animate-spin" size={18}/> : <Send size={18}/>} Gửi câu hỏi</Button></div></form>
    {searching && <p role="status" className="mt-3 text-sm text-slate-600">Đang tìm câu trả lời trong dữ liệu đã xác minh…</p>}
    {!question && <div className="mt-5 flex flex-wrap gap-2">{examples.map((example) => <Button key={example} onClick={() => setQuestion(example)} className="rounded-full border border-[var(--line)] bg-white px-3 py-2 text-left text-sm">{example}</Button>)}</div>}
    {error && <Alert color="failure" className="mt-5">{error}</Alert>}
    {result && <section aria-live="polite" className="mt-5 space-y-3">{showAnswer && <Card className="max-w-none rounded-xl border border-slate-700 bg-slate-800 p-4 text-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"><div className="mb-1 text-sm font-bold text-sky-300">{result.status === "clarify" ? "Cần làm rõ quy cách" : result.status === "insufficient_evidence" ? "Chưa đủ dữ liệu" : "Kết quả tra cứu"}</div>{result.catalogPage && <div className="text-sm leading-6"><p>Đang hiển thị {result.items.length} / {result.catalogPage.total} quy cách đã xác minh.</p>{!result.catalogPage.complete && <p className="text-amber-200">Danh sách chưa đầy đủ. Hãy thêm quy cách hoặc nhóm hàng để thu hẹp kết quả.</p>}</div>}{result.answerBlocks?.length ? <div className="space-y-3">{result.answerBlocks.map((block,index) => <div key={block.kind + "-" + index} className="rounded-lg bg-slate-700 p-3">{block.kind !== "narrative" && <p className="mb-1 text-sm font-bold text-sky-300">{block.kind === "comparison" ? "So sánh có căn cứ" : block.kind === "recommendation" ? "Tư vấn theo tài liệu" : "Cần làm rõ"}</p>}<p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-white">{block.text}</p></div>)}</div> : !result.catalogPage && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-white">{result.answer}</p>}</Card>}
      {result.items.map((item) => {
        const canQuote = result.status === "answered" && item.verificationStatus === "verified";
        const currentPrices = canQuote ? item.prices.filter(price => price.verificationStatus === "verified") : [];
        return <Card key={item.id} className="max-w-none rounded-xl border border-gray-200 bg-white p-4 text-slate-900 shadow-sm dark:border-gray-200 dark:bg-white dark:text-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-600">{item.category}</p><h3 className="mt-1 break-words [overflow-wrap:anywhere] text-base font-bold">{item.productName} <span className="font-normal">· {item.variant}</span></h3></div>{item.verificationStatus === "verified" && <Badge color="success" className="dark:bg-emerald-100 dark:text-emerald-900">Đã xác minh</Badge>}</div>
          {currentPrices.length ? <div className="mt-3 divide-y divide-gray-200">{currentPrices.map(price => <div key={price.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]"><b className="text-sm">{priceTypeLabel(price.priceType)}</b><p className="text-sm text-slate-600">{formatPackageContents(price.packageQuantity, price.unit)} / {price.packagingName}</p>{price.minimumQuantity > 1 && <p className="text-sm text-slate-600">{formatMinimumPackageQuantity(price.minimumQuantity, price.packagingName, price.packageQuantity, price.unit)}</p>}{(price.priceList || price.supplier) && <p className="mt-1 text-sm text-slate-600">Nguồn giá: {[...new Set([price.priceList, price.supplier].filter(Boolean))].join(" · ")}</p>}</div>
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">{price.isDemo && <DemoPriceLabel/>}<strong className="break-words [overflow-wrap:anywhere] text-base tabular-nums text-[var(--green)]">{formatVnd(price.amount)} / {price.packagingName}</strong>{price.isDemo && <span className="text-sm text-amber-800">Giá giả lập, chưa phải giá bán chính thức.</span>}{audience === "customer" && onChoosePrice && price.purchasable && !price.isDemo && <Button type="button" disabled={choosingPrice} onClick={() => onChoosePrice(item, price)} className="min-h-11 rounded-lg border border-blue-200 bg-blue-100 px-3 py-2 text-sm font-bold text-blue-950 shadow-sm hover:bg-blue-200 dark:border-blue-200 dark:bg-blue-100 dark:text-blue-950 dark:hover:bg-blue-200">{choosingPrice ? "Đang kiểm tra giá…" : "Thêm vào đơn"}</Button>}{audience === "employee" && price.purchasable && !price.isDemo && <Link href={`/staff?variantId=${item.id}&priceId=${price.id}&priceVersion=${price.version}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--green)] underline">Chọn mức này</Link>}</div>
          </div>)}</div> : <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-50 dark:text-amber-900">{result.status === "clarify" ? "Hãy làm rõ quy cách trước khi chọn giá." : "Không có mức giá phù hợp với câu hỏi này."}</p>}
          {audience === "employee" && canQuote && <Link href={`/staff?variantId=${item.id}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-[var(--green)] underline">Chọn quy cách để lập báo giá</Link>}
          {item.sourcePages.length > 0 && <p className="mt-3 border-t border-gray-200 pt-2 text-sm font-medium text-slate-600">Nguồn sổ: {item.sourcePages.map(page => audience === "employee" ? <a key={page} className="ml-2 font-bold text-[var(--green)] underline" href={`/source-pages/page-${String(page).padStart(2, "0")}.jpg`} target="_blank" rel="noreferrer">Trang {page}</a> : <span key={page} className="ml-2">Trang {page}</span>)}</p>}
        </Card>;
      })}
      <section aria-label="Các đoạn dữ liệu tìm thấy" className="rounded-xl border border-gray-200 bg-white p-4 text-slate-900 shadow-sm dark:border-gray-200 dark:bg-white dark:text-slate-900">
        <h3 className="text-sm font-bold">Các đoạn dữ liệu tìm thấy</h3>
        {result.sources.length ? <><p className="mt-1 text-sm text-slate-600">{Math.min(result.sources.length, 4)} / {result.sources.length} đoạn nguồn, theo thứ tự truy xuất.</p><ol className="mt-3 space-y-3">{result.sources.slice(0, 4).map((source, index) => <li key={source.chunkKey + ":" + source.chunkId + ":" + index} className="rounded-lg border border-gray-200 bg-slate-50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Badge color="info">#{index + 1}</Badge>{source.pageNumber != null ? <a className="font-semibold text-blue-700 underline" href={`/source-pages/page-${String(source.pageNumber).padStart(2, "0")}.jpg`} target="_blank" rel="noreferrer">Trang {source.pageNumber}</a> : <span className="font-semibold">Danh mục Supabase{source.verifiedVariantId != null ? ` · Quy cách #${source.verifiedVariantId}` : ""}</span>}</div>
          <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-6 text-slate-700">{source.excerpt}</p>
        </li>)}</ol></> : <p className="mt-2 text-sm text-slate-600">{result.retrieval.embeddingModel === "not_used" ? "Câu hỏi này tra trực tiếp danh mục, không truy xuất chunk vector. Thông tin mặt hàng và nguồn nằm ở kết quả phía trên." : "Không có đoạn nguồn được trả về cho câu hỏi này."}</p>}
      </section>
      {audience === "employee" && <details className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-slate-900 dark:bg-white dark:text-slate-900"><summary className="cursor-pointer text-sm font-bold text-slate-600">Thông tin kỹ thuật</summary><p className="mt-2 text-xs text-slate-600">{result.retrieval.vectorChunks} chunk catalog · {result.retrieval.lexicalProducts} kết quả catalog · model {result.retrieval.embeddingModel}</p></details>}
    </section>}
  </Container>;
}
