"use client";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LoaderCircle, MessageCircle, Search, Sparkles } from "lucide-react";
import { formatVnd } from "@/features/pricing/validation";
import { requestApi, ApiRequestError } from "@/lib/api/client";

type Price = { id: number; amount: number; priceType: string; minimumQuantity: number; packagingName: string; packageQuantity: number; packageNote: string; unit: string; priceList: string | null; supplier: string | null; verificationStatus: string };
type Item = { id: number; productName: string; category: string; variant: string; verificationStatus: string; sourcePages: number[]; prices: Price[] };
type Answer = { answer: string; items: Item[]; sources: { pageNumber: number; excerpt: string }[]; retrieval: { vectorChunks: number; lexicalProducts: number; embeddingModel: string } };
const examples = ["Giá sỉ tắc kê sắt 8 ly là bao nhiêu?", "Bulong 8 ly x 3F có những mức giá nào?", "Trang nào có thông tin về vít tole?"];
const priceTypeLabel = (value: string) => value === "wholesale" ? "Giá sỉ" : value === "dealer" ? "Giá đại lý" : "Giá lẻ";

export function PriceQuestionAssistant() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Answer | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) return;
    setSearching(true); setError(""); setResult(null);
    try {
      const body = await requestApi<Answer>("/api/v1/rag/query", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      setResult(body);
    } catch (cause) { setError(cause instanceof ApiRequestError && cause.status === 401 ? "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại." : "Không thể truy xuất dữ liệu. Hãy thử lại sau."); }
    finally { setSearching(false); }
  }

  return <main className="mx-auto min-h-screen max-w-4xl px-5 py-8 sm:py-12">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--green)]"><ArrowLeft size={17}/> Về tra giá</Link><Link href="/rag-admin" className="text-sm font-bold text-[var(--muted)] underline">Quản trị tài liệu RAG</Link></div>
    <div className="mt-8 flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-[var(--green)] text-white"><MessageCircle/></span><div><p className="text-sm font-bold uppercase tracking-[.16em] text-[var(--green)]">HỎI ĐÁP RAG · DỮ LIỆU GIÁ CÓ NGUỒN</p><h1 className="text-3xl font-black sm:text-4xl">Bạn cần tra món nào?</h1></div></div>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">Tìm kiếm kết hợp ngữ nghĩa và tên/quy cách. Giá được lấy trực tiếp từ PostgreSQL sau khi tìm đúng mặt hàng; câu trả lời có trích dẫn trang sổ giá.</p>
    <form onSubmit={ask} className="mt-7 rounded-2xl border-2 border-[var(--green)] bg-white p-3 shadow-[0_8px_0_#d9e2d8]"><label htmlFor="price-question" className="sr-only">Nhập câu hỏi về giá</label><textarea id="price-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ví dụ: Giá sỉ tắc kê sắt 8 ly là bao nhiêu?" rows={3} maxLength={1000} className="w-full resize-y rounded-xl p-3 text-base outline-none"/><div className="flex items-center justify-between gap-3"><span className="px-3 text-xs text-[var(--muted)]">Giá không được embedding; luôn truy vấn từ bảng giá hiện hành.</span><button disabled={searching || !question.trim()} className="inline-flex items-center gap-2 rounded-xl bg-[var(--green)] px-4 py-3 font-bold text-white disabled:opacity-50">{searching ? <LoaderCircle className="animate-spin" size={18}/> : <Search size={18}/>} Hỏi giá</button></div></form>
    {!question && <div className="mt-5 flex flex-wrap gap-2">{examples.map((example) => <button key={example} onClick={() => setQuestion(example)} className="rounded-full border border-[var(--line)] bg-white px-3 py-2 text-left text-sm">{example}</button>)}</div>}
    {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {result && <section aria-live="polite" className="mt-8 space-y-5"><article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-emerald-900"><Sparkles size={15}/> Câu trả lời dựa trên dữ liệu truy xuất</div><p className="whitespace-pre-wrap text-base leading-7 text-slate-900">{result.answer}</p></article>
      {result.items.map((item) => <article key={item.id} className="rounded-2xl border border-[var(--line)] bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase text-[var(--muted)]">{item.category}</p><h2 className="mt-1 text-xl font-black">{item.productName}</h2><p className="mt-1 text-sm">Quy cách: {item.variant}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${item.verificationStatus === "verified" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{item.verificationStatus === "verified" ? "Đã xác minh" : "Cần đối chiếu"}</span></div>
        {item.prices.length ? <div className="mt-4 space-y-2">{item.prices.map((price) => <div key={price.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f3f5ef] px-4 py-3"><div><b>{priceTypeLabel(price.priceType)}</b><span className="ml-2 text-sm text-[var(--muted)]">{price.packagingName} · {price.priceType === "wholesale" && price.packageNote?.includes("Chưa rõ số lượng tối thiểu") ? "Chưa xác nhận ngưỡng giá sỉ" : `tối thiểu ${price.minimumQuantity} gói`}</span></div><strong className="text-lg text-[var(--green)]">{formatVnd(price.amount)}</strong></div>)}</div> : <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Tìm thấy quy cách nhưng chưa có giá hiện hành trong catalog.</p>}
        <Link href={`/?variantId=${item.id}`} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[var(--green)] px-4 py-2 text-sm font-bold text-white">Chọn quy cách để lập báo giá</Link><div className="mt-4 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">Nguồn: {item.sourcePages.length ? item.sourcePages.map((page) => <a key={page} className="ml-2 font-bold underline" href={`/source-pages/page-${String(page).padStart(2, "0")}.jpg`} target="_blank" rel="noreferrer">Trang {page}</a>) : "chưa gắn trang nguồn"}</div></article>)}
      {result.sources.length > 0 && <details className="rounded-2xl border border-[var(--line)] bg-white p-5"><summary className="cursor-pointer font-bold">Đoạn tài liệu đã truy xuất ({result.sources.length})</summary><div className="mt-4 space-y-3">{result.sources.map((source) => <div key={`${source.pageNumber}-${source.excerpt}`} className="rounded-xl bg-[#f3f5ef] p-4 text-sm"><a className="font-bold text-[var(--green)] underline" href={`/source-pages/page-${String(source.pageNumber).padStart(2, "0")}.jpg`} target="_blank" rel="noreferrer">Trang {source.pageNumber}</a><p className="mt-2 whitespace-pre-wrap leading-6">{source.excerpt}</p></div>)}</div></details>}
      <p className="text-xs text-[var(--muted)]">Truy xuất: {result.retrieval.vectorChunks} chunk vector · {result.retrieval.lexicalProducts} kết quả catalog · embedding {result.retrieval.embeddingModel}</p>
    </section>}
  </main>;
}
