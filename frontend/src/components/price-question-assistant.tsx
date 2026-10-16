"use client";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, Select, Textarea } from "flowbite-react";
import { ArrowLeft, LoaderCircle, MessageCircle, Search } from "lucide-react";
import { formatVnd } from "@/features/pricing/validation";
import { requestApi, ApiRequestError } from "@/lib/api/client";
import type { ApiResponse } from "@/lib/api/generated/api-types";
import { createRagConversation, readRagConversation, submitRagFeedback } from "@/lib/api/rag-conversations";

type Answer = ApiResponse<"/api/v1/rag/query", "post">;
const examples = ["Giá sỉ tắc kê sắt 8 ly là bao nhiêu?", "Bulong 8 ly x 3F có những mức giá nào?", "Trang nào có thông tin về vít tole?"];
const priceTypeLabel = (value: string) => value === "wholesale" ? "Giá sỉ" : value === "dealer" ? "Giá đại lý" : "Giá lẻ";

export function PriceQuestionAssistant() {
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
    } catch (cause) { setError(cause instanceof ApiRequestError && cause.status === 401 ? "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại." : "Không thể truy xuất dữ liệu. Hãy thử lại sau."); }
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

  return <main className="mx-auto min-h-screen max-w-4xl px-5 py-8 sm:py-12">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--green)]"><ArrowLeft size={17}/> Về tra giá</Link><div className="flex items-center gap-4"><Button type="button" className="text-sm font-bold text-[var(--muted)] underline" onClick={() => { setConversationId(null); setQuestion(""); setResult(null); sessionStorage.removeItem("priceapp-rag-conversation"); }}>Cuộc trao đổi mới</Button><Link href="/rag-admin" className="text-sm font-bold text-[var(--muted)] underline">Quản trị tài liệu RAG</Link></div></div>
    <div className="mt-8 flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-[var(--green)] text-white"><MessageCircle/></span><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[var(--green)]">TRA CỨU GIÁ VẬT TƯ</p><h1 className="text-3xl font-black sm:text-4xl">Bạn cần tra món nào?</h1></div></div>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">Hỏi theo tên thường gọi hoặc quy cách. Kết quả hiển thị giá hiện hành cùng trang sổ để bạn đối chiếu.</p>
    <form onSubmit={ask} className="mt-7 rounded-xl border border-[var(--line)] bg-white p-3"><label htmlFor="price-question" className="sr-only">Nhập câu hỏi về giá</label><Textarea id="price-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ví dụ: Giá sỉ tắc kê sắt 8 ly là bao nhiêu?" rows={3} maxLength={1000} className="w-full resize-y rounded-lg p-3 text-base outline-none"/><div className="flex flex-wrap items-center justify-between gap-3"><span className="px-3 text-xs text-[var(--muted)]">Giá lấy từ bảng hiện hành.</span><Button disabled={searching || !question.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--green)] px-4 py-3 font-bold text-white disabled:opacity-50">{searching ? <LoaderCircle className="animate-spin" size={18}/> : <Search size={18}/>} Hỏi giá</Button></div></form>
    {!question && <div className="mt-5 flex flex-wrap gap-2">{examples.map((example) => <Button key={example} onClick={() => setQuestion(example)} className="rounded-full border border-[var(--line)] bg-white px-3 py-2 text-left text-sm">{example}</Button>)}</div>}
    {error && <Alert color="failure" className="mt-5">{error}</Alert>}
    {result && <section aria-live="polite" className="mt-8 space-y-5"><Card className="max-w-none rounded-xl border border-[var(--line)] bg-white p-5 shadow-none"><div className="mb-2 text-sm font-bold text-[var(--green)]">Kết quả tra cứu</div><p className="whitespace-pre-wrap text-base leading-7 text-slate-900">{result.answer}</p></Card>
      {result.feedbackMessageId && <div className="rounded-xl border border-[var(--line)] bg-white p-4"><p className="text-sm font-bold">Câu trả lời này có hữu ích không?</p>{feedbackSent ? <p role="status" className="mt-2 text-sm text-emerald-800">Đã ghi nhận phản hồi.</p> : <><div className="mt-2 flex gap-2"><Button type="button" aria-pressed={feedbackChoice === "helpful"} onClick={() => { setFeedbackChoice("helpful"); setFeedbackReason(""); }} className="rounded-lg border px-3 py-2 text-sm aria-pressed:bg-emerald-100">Hữu ích</Button><Button type="button" aria-pressed={feedbackChoice === "not_helpful"} onClick={() => setFeedbackChoice("not_helpful")} className="rounded-lg border px-3 py-2 text-sm aria-pressed:bg-amber-100">Chưa đúng</Button></div>{feedbackChoice === "not_helpful" && <label className="mt-3 block text-sm">Lý do<Select value={feedbackReason} onChange={(event) => setFeedbackReason(event.target.value as typeof feedbackReason)} className="mt-1 block w-full rounded-lg border border-[var(--line)] bg-white p-2"><option value="">Chọn lý do</option><option value="missing_data">Thiếu dữ liệu</option><option value="retrieval_error">Tìm sai mặt hàng/quy cách</option><option value="answer_error">Câu trả lời sai</option><option value="other">Lý do khác</option></Select></label>}<Button type="button" disabled={!feedbackChoice || (feedbackChoice === "not_helpful" && !feedbackReason) || feedbackSending} onClick={sendFeedback} className="mt-3 rounded-lg bg-[var(--green)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{feedbackSending ? "Đang gửi…" : "Gửi phản hồi"}</Button></>}</div>}
      {result.items.map((item) => <Card key={item.id} className="max-w-none rounded-2xl border border-[var(--line)] bg-white p-5 shadow-none"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase text-[var(--muted)]">{item.category}</p><h2 className="mt-1 text-xl font-black">{item.productName}</h2><p className="mt-1 text-sm">Quy cách: {item.variant}</p></div><Badge color={item.verificationStatus === "verified" ? "success" : "warning"}>{item.verificationStatus === "verified" ? "Đã xác minh" : "Cần đối chiếu"}</Badge></div>
        {item.prices.length ? <div className="mt-4 space-y-2">{item.prices.map((price) => <div key={price.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f3f5ef] px-4 py-3"><div><b>{priceTypeLabel(price.priceType)}</b><span className="ml-2 text-sm text-[var(--muted)]">{price.packagingName} · {price.priceType === "wholesale" && price.packageNote?.includes("Chưa rõ số lượng tối thiểu") ? "Chưa xác nhận ngưỡng giá sỉ" : `tối thiểu ${price.minimumQuantity} gói`}</span></div><div className="flex items-center gap-3"><strong className="text-lg text-[var(--green)]">{formatVnd(price.amount)}</strong><Link href={`/?variantId=${item.id}&priceId=${price.id}&priceVersion=${price.version}`} className="text-sm font-bold text-[var(--green)] underline">Chọn mức này</Link></div></div>)}</div> : <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Tìm thấy quy cách nhưng chưa có giá hiện hành trong catalog.</p>}
        <Link href={`/?variantId=${item.id}`} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[var(--green)] px-4 py-2 text-sm font-bold text-white">Chọn quy cách để lập báo giá</Link><div className="mt-4 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">Nguồn: {item.sourcePages.length ? item.sourcePages.map((page) => <a key={page} className="ml-2 font-bold underline" href={`/source-pages/page-${String(page).padStart(2, "0")}.jpg`} target="_blank" rel="noreferrer">Trang {page}</a>) : "chưa gắn trang nguồn"}</div></Card>)}
      {result.sources.length > 0 && <details className="rounded-2xl border border-[var(--line)] bg-white p-5"><summary className="cursor-pointer font-bold">Đoạn tài liệu đã truy xuất ({result.sources.length})</summary><div className="mt-4 space-y-3">{result.sources.map((source) => <div key={source.chunkId} className="rounded-xl bg-[#f3f5ef] p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><a className="font-bold text-[var(--green)] underline" href={`/source-pages/page-${String(source.pageNumber).padStart(2, "0")}.jpg`} target="_blank" rel="noreferrer">Trang {source.pageNumber}</a><span className="text-xs text-[var(--muted)]">Đoạn {source.chunkId} · bản {source.sourceRevision} · ký tự {source.sourceSpan.start}–{source.sourceSpan.end}</span></div><p className="mt-2 whitespace-pre-wrap leading-6">{source.excerpt}</p></div>)}</div></details>}
      <details className="rounded-lg border border-[var(--line)] bg-white px-4 py-3"><summary className="cursor-pointer text-sm font-bold text-[var(--muted)]">Thông tin kỹ thuật</summary><p className="mt-2 text-xs text-[var(--muted)]">{result.retrieval.vectorChunks} đoạn tài liệu · {result.retrieval.lexicalProducts} kết quả catalog · model {result.retrieval.embeddingModel}</p></details>
    </section>}
  </main>;
}
