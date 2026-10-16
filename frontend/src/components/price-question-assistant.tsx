"use client";
import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, Select, Textarea } from "flowbite-react";
import { ArrowLeft, LoaderCircle, MessageCircle, Send } from "lucide-react";
import { formatVnd } from "@/features/pricing/validation";
import { requestApi, requestPublicApi, ApiRequestError } from "@/lib/api/client";
import type { ApiResponse } from "@/lib/api/generated/api-types";
import { createRagConversation, readRagConversation, submitRagFeedback } from "@/lib/api/rag-conversations";

type Answer = ApiResponse<"/api/v1/rag/query", "post">;
const examples = ["Bulong 8 ly x 3F có quy cách gì?", "Trang nào có thông tin về vít tole?", "Giá sỉ tắc kê sắt 8 ly là bao nhiêu?"];
const priceTypeLabel = (value: string) => value === "wholesale" ? "Giá sỉ" : value === "dealer" ? "Giá đại lý" : "Giá lẻ";

type PriceQuestionAssistantProps = {
  audience?: "employee" | "customer";
  onChoosePrice?: (item: Answer["items"][number], price: Answer["items"][number]["prices"][number]) => void;
};

export function PriceQuestionAssistant({ audience = "employee", onChoosePrice }: PriceQuestionAssistantProps) {
  const customerPreviousQuestion = useRef<string | null>(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Answer | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [feedbackChoice, setFeedbackChoice] = useState<"helpful" | "not_helpful" | null>(null);
  const [feedbackReason, setFeedbackReason] = useState<"missing_data" | "retrieval_error" | "answer_error" | "other" | "">("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [error, setError] = useState("");

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) return;
    setSearching(true); setError(""); setResult(null); setFeedbackChoice(null); setFeedbackReason(""); setFeedbackSent(false);
    try {
      let activeConversationId = conversationId;
      if (audience === "customer") {
        const askedQuestion = question.trim();
        const body = await requestPublicApi<Answer>("/api/v1/public/rag/query", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: askedQuestion, ...(customerPreviousQuestion.current ? { previousQuestion: customerPreviousQuestion.current } : {}) }),
        });
        customerPreviousQuestion.current = body.status === "clarify" ? askedQuestion : null;
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

  async function sendFeedback() {
    if (!conversationId || !result?.feedbackMessageId || !feedbackChoice || (feedbackChoice === "not_helpful" && !feedbackReason)) return;
    setFeedbackSending(true);
    try {
      const feedback = feedbackChoice === "helpful"
        ? { assistantMessageId: result.feedbackMessageId, helpful: true as const }
        : { assistantMessageId: result.feedbackMessageId, helpful: false as const, reason: feedbackReason as Exclude<typeof feedbackReason, ""> };
      await submitRagFeedback(conversationId, feedback);
      setFeedbackSent(true);
    } catch { setError("Không lưu được phản hồi. Hãy thử lại sau."); }
    finally { setFeedbackSending(false); }
  }

  const Container = audience === "customer" ? "section" : "main";
  return <Container aria-label={audience === "customer" ? "Hỏi đáp với AI" : undefined} className={`mx-auto ${audience === "customer" ? "max-w-7xl px-4 py-5 lg:px-6" : "min-h-screen max-w-4xl px-5 py-8 sm:py-12"}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">{audience === "employee" && <Link href="/staff" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--green)]"><ArrowLeft size={17}/> Về bán hàng</Link>}<div className="ml-auto flex items-center gap-4"><Button type="button" className="rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] underline dark:text-slate-700" onClick={() => { setConversationId(null); setQuestion(""); setResult(null); customerPreviousQuestion.current = null; if (audience === "employee") sessionStorage.removeItem("priceapp-rag-conversation"); }}>Cuộc trao đổi mới</Button>{audience === "employee" && <Link href="/rag-admin" className="text-sm font-bold text-[var(--muted)] underline">Quản trị tài liệu RAG</Link>}</div></div>
    <div className="mt-5 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[var(--green)] text-white"><MessageCircle size={20}/></span><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[var(--green)]">TRỢ LÝ VẬT TƯ</p><h2 className="text-xl font-bold sm:text-2xl">Hỏi đáp với AI</h2></div></div>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Hỏi về sản phẩm, quy cách, trang sổ hoặc giá hiện hành. Câu trả lời sẽ kèm nguồn khi tìm thấy căn cứ.</p>
    <form onSubmit={ask} className="mt-4 rounded-xl border border-gray-300 bg-white p-3 text-slate-900 shadow-sm dark:border-gray-300 dark:bg-white dark:text-slate-900"><label htmlFor="price-question" className="sr-only">Câu hỏi cho trợ lý AI</label><Textarea id="price-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ví dụ: Trang nào có thông tin về vít tole?" rows={2} maxLength={1000} className="w-full resize-y rounded-lg border-gray-300 bg-white p-3 text-base text-slate-900 placeholder:text-slate-500 outline-none dark:border-gray-300 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-500"/><div className="flex flex-wrap items-center justify-between gap-3"><span className="px-3 text-xs text-slate-600 dark:text-slate-600">Giá lấy từ bảng hiện hành; AI chỉ trả lời theo dữ liệu có căn cứ.</span><Button type="submit" disabled={searching || !question.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--green)] px-4 py-3 font-bold text-white hover:bg-emerald-900 disabled:opacity-50 dark:bg-[var(--green)] dark:text-white">{searching ? <LoaderCircle className="animate-spin" size={18}/> : <Send size={18}/>} Gửi câu hỏi</Button></div></form>
    {searching && <p role="status" className="mt-3 text-sm text-slate-600">Đang tìm câu trả lời trong dữ liệu đã xác minh…</p>}
    {!question && <div className="mt-5 flex flex-wrap gap-2">{examples.map((example) => <Button key={example} onClick={() => setQuestion(example)} className="rounded-full border border-[var(--line)] bg-white px-3 py-2 text-left text-sm">{example}</Button>)}</div>}
    {error && <Alert color="failure" className="mt-5">{error}</Alert>}
    {result && <section aria-live="polite" className="mt-5 space-y-3">{!(audience === "customer" && result.status === "answered" && result.items.length > 0) && <Card className="max-w-none rounded-xl border border-gray-200 bg-white p-4 text-slate-900 shadow-sm dark:border-gray-200 dark:bg-white dark:text-slate-900"><div className="mb-1 text-sm font-bold text-[var(--green)]">{result.status === "clarify" ? "Cần làm rõ quy cách" : result.status === "insufficient_evidence" ? "Chưa đủ dữ liệu" : "Kết quả tra cứu"}</div><p className="whitespace-pre-wrap text-sm leading-6 text-slate-900 dark:text-slate-900">{result.answer}</p></Card>}
      {audience === "employee" && result.feedbackMessageId && <div className="rounded-xl border border-gray-200 bg-white p-4 text-slate-900 dark:border-gray-200 dark:bg-white dark:text-slate-900"><p className="text-sm font-bold">Câu trả lời này có hữu ích không?</p>{feedbackSent ? <p role="status" className="mt-2 text-sm text-emerald-800">Đã ghi nhận phản hồi.</p> : <><div className="mt-2 flex gap-2"><Button type="button" aria-pressed={feedbackChoice === "helpful"} onClick={() => { setFeedbackChoice("helpful"); setFeedbackReason(""); }} className="rounded-lg border px-3 py-2 text-sm aria-pressed:bg-emerald-100">Hữu ích</Button><Button type="button" aria-pressed={feedbackChoice === "not_helpful"} onClick={() => setFeedbackChoice("not_helpful")} className="rounded-lg border px-3 py-2 text-sm aria-pressed:bg-amber-100">Chưa đúng</Button></div>{feedbackChoice === "not_helpful" && <label className="mt-3 block text-sm">Lý do<Select value={feedbackReason} onChange={(event) => setFeedbackReason(event.target.value as typeof feedbackReason)} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2 text-slate-900 dark:bg-white dark:text-slate-900"><option value="">Chọn lý do</option><option value="missing_data">Thiếu dữ liệu</option><option value="retrieval_error">Tìm sai mặt hàng/quy cách</option><option value="answer_error">Câu trả lời sai</option><option value="other">Lý do khác</option></Select></label>}<Button type="button" disabled={!feedbackChoice || (feedbackChoice === "not_helpful" && !feedbackReason) || feedbackSending} onClick={sendFeedback} className="mt-3 rounded-lg bg-[var(--green)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{feedbackSending ? "Đang gửi…" : "Gửi phản hồi"}</Button></>}</div>}
      {result.items.map((item) => <Card key={item.id} className="max-w-none rounded-xl border border-gray-200 bg-white p-4 text-slate-900 shadow-sm dark:border-gray-200 dark:bg-white dark:text-slate-900"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold text-slate-600">{item.category}</p><h3 className="mt-1 text-base font-bold">{item.productName} <span className="font-normal">· {item.variant}</span></h3></div>{item.verificationStatus === "verified" && <Badge color="success" className="dark:bg-emerald-100 dark:text-emerald-900">Đã xác minh</Badge>}</div>
        {item.prices.length ? <div className="mt-3 divide-y divide-gray-200">{item.prices.map((price) => <div key={price.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"><div><b className="text-sm">{priceTypeLabel(price.priceType)}</b><p className="text-xs text-slate-600">{price.packagingName} · {new Intl.NumberFormat("vi-VN").format(price.packageQuantity)} {price.unit}{price.minimumQuantity > 1 ? ` · tối thiểu ${price.minimumQuantity} ${price.packagingName}` : ""}</p></div><div className="flex items-center gap-3"><strong className="text-base tabular-nums text-[var(--green)]">{formatVnd(price.amount)} / {price.packagingName}</strong>{audience === "customer" && onChoosePrice && <Button type="button" onClick={() => onChoosePrice(item, price)} className="min-h-10 rounded-lg bg-[var(--green)] px-3 py-2 text-sm font-bold text-white dark:bg-[var(--green)] dark:text-white">Thêm vào đơn</Button>}{audience === "employee" && <Link href={`/?variantId=${item.id}&priceId=${price.id}&priceVersion=${price.version}`} className="text-sm font-semibold text-[var(--green)] underline">Chọn mức này</Link>}</div></div>)}</div> : <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-50 dark:text-amber-900">Tìm thấy quy cách nhưng chưa có giá hiện hành trong catalog.</p>}
        {audience === "employee" && <Link href={`/?variantId=${item.id}`} className="mt-3 inline-flex min-h-10 items-center text-sm font-bold text-[var(--green)] underline">Chọn quy cách để lập báo giá</Link>}
        {item.sourcePages.length > 0 && <p className="mt-3 border-t border-gray-200 pt-2 text-xs font-medium text-slate-600">Nguồn sổ: {item.sourcePages.map((page) => audience === "employee" ? <a key={page} className="ml-2 font-bold text-[var(--green)] underline" href={`/source-pages/page-${String(page).padStart(2, "0")}.jpg`} target="_blank" rel="noreferrer">Trang {page}</a> : <span key={page} className="ml-2">Trang {page}</span>)}</p>}</Card>)}
      {audience === "customer" && result.sources.length > 0 && <section aria-label="Nguồn tham khảo" className="rounded-xl border border-gray-200 bg-white p-4 text-slate-900 shadow-sm"><h3 className="text-sm font-bold">Nguồn tham khảo</h3><ul className="mt-3 space-y-3">{result.sources.map((source) => <li key={source.chunkId} className="rounded-lg bg-slate-50 p-3 text-sm"><div>{source.pageNumber ? <a className="font-semibold text-[var(--green)] underline" href={`/source-pages/page-${String(source.pageNumber).padStart(2, "0")}.jpg`} target="_blank" rel="noreferrer">Trang {source.pageNumber}</a> : <span className="font-semibold">Tài liệu đã xác minh</span>}</div><p className="mt-1 whitespace-pre-wrap leading-6 text-slate-700">{source.excerpt}</p></li>)}</ul></section>}
      {audience === "employee" && result.sources.length > 0 && <details className="rounded-xl border border-gray-200 bg-white p-4 text-slate-900 dark:border-gray-200 dark:bg-white dark:text-slate-900"><summary className="cursor-pointer font-bold">Đoạn tài liệu đã truy xuất ({result.sources.length})</summary><div className="mt-4 space-y-3">{result.sources.map((source) => <div key={source.chunkId} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-50"><div className="flex flex-wrap items-center justify-between gap-2"><a className="font-bold text-[var(--green)] underline" href={`/source-pages/page-${String(source.pageNumber).padStart(2, "0")}.jpg`} target="_blank" rel="noreferrer">Trang {source.pageNumber}</a><span className="text-xs text-slate-600">{source.evidenceKind === "verified_catalog" ? "Thông tin catalog đã xác minh" : `Đoạn ${source.chunkId} · bản ${source.sourceRevision} · ký tự ${source.sourceSpan?.start}–${source.sourceSpan?.end}`}</span></div><p className="mt-2 whitespace-pre-wrap leading-6">{source.excerpt}</p></div>)}</div></details>}
      {audience === "employee" && <details className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-slate-900 dark:bg-white dark:text-slate-900"><summary className="cursor-pointer text-sm font-bold text-slate-600">Thông tin kỹ thuật</summary><p className="mt-2 text-xs text-slate-600">{result.retrieval.vectorChunks} đoạn tài liệu · {result.retrieval.lexicalProducts} kết quả catalog · model {result.retrieval.embeddingModel}</p></details>}
    </section>}
  </Container>;
}
