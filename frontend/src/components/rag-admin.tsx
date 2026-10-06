"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Activity, ArrowLeft, BookOpenCheck, LoaderCircle, Save, Sparkles } from "lucide-react";
import { requestApi, ApiRequestError } from "@/lib/api/client";
import { isRagHealthDiagnostics, type RagHealthDiagnostics } from "@/lib/api/rag-health";

type Page = { sourcePageId: number; pageNumber: number | null; title: string; extractedText: string; reviewStatus: "draft" | "approved" | "rejected"; revision: number };
type IndexProgress = { runId: number; status: "running" | "failed" | "completed"; checkpoint: number; chunks: number; indexed: number; reused: number; removed: number; embeddingModel: string; contentHash: string };
type PreviewChunk = { index: number; content: string; start: number; end: number };
function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof ApiRequestError && cause.status === 401) return "Vui lòng đăng nhập lại.";
  if (cause instanceof ApiRequestError && cause.status === 403) return "Bạn không có quyền quản trị RAG.";
  return fallback;
}
export function RagAdmin() {
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [indexed, setIndexed] = useState<number | null>(null);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);
  const [health, setHealth] = useState<RagHealthDiagnostics | null>(null);
  const selected = pages.find((page) => page.sourcePageId === selectedId) ?? null;
  const approvedCount = useMemo(() => pages.filter((page) => page.reviewStatus === "approved").length, [pages]);
  const [preview, setPreview] = useState<{ text: string; chunks: PreviewChunk[] }>({ text: "", chunks: [] });
  const previewText = selected?.extractedText ?? "";
  const chunkPreview = preview.text === previewText ? preview.chunks : [];
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      if (!previewText.trim()) { setPreview({ text: previewText, chunks: [] }); return; }
      void requestApi<{ source: string; chunks: PreviewChunk[] }>("/api/v1/admin/rag/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extractedText: previewText }), signal: controller.signal,
      }).then(body => { if (active) setPreview({ text: previewText, chunks: body.chunks }); })
        .catch(cause => { if (active) setError(errorMessage(cause, "Không xem trước được đoạn tìm kiếm. Hãy thử lại sau.")); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [previewText]);

  const loadPages = useCallback(async () => {
    const body = await requestApi<{ pages: Page[] }>("/api/v1/admin/rag/pages");
    setPages(body.pages);
    setSelectedId((current) => current ?? body.pages?.[0]?.sourcePageId ?? null);
    const runBody = await requestApi<{ run: IndexProgress | null }>("/api/v1/admin/rag/index");
    setIndexProgress(runBody.run);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void loadPages().catch((cause) => setError(errorMessage(cause, "Không tải được trang nguồn."))); }, 0); return () => window.clearTimeout(timer); }, [loadPages]);
  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty]);

  function selectPage(pageId: number) {
    if (pageId === selectedId) return;
    if (dirty && !window.confirm("Bạn có thay đổi chưa lưu. Bỏ thay đổi và chuyển trang?")) return;
    setDirty(false);
    setSelectedId(pageId);
  }

  function updateSelected(patch: Partial<Page>) {
    if (!selected) return;
    setDirty(true);
    setPages((items) => items.map((page) => page.sourcePageId === selected.sourcePageId ? { ...page, ...patch } : page));
  }
  async function save(reviewStatus: "draft" | "approved" | "rejected") {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = await requestApi<{ revision: number }>("/api/v1/admin/rag/pages", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...selected, reviewStatus }) });
      updateSelected({ reviewStatus, revision: body.revision }); setDirty(false); setNotice(reviewStatus === "approved" ? "Bản chép đã được duyệt. Hãy tạo lại embedding cho revision mới." : reviewStatus === "rejected" ? "Đã thu hồi cả trang nguồn; mọi chunk gắn trang này không còn được truy xuất." : "Bản nháp đã lưu; chunk OCR cũ không còn được truy xuất.");
    } catch (cause) { setError(errorMessage(cause, "Không lưu được nội dung. Hãy kiểm tra dữ liệu và thử lại.")); }
    finally { setBusy(false); }
  }
  async function buildIndex() {
    if (dirty) { setError("Hãy lưu hoặc bỏ thay đổi trước khi tạo embedding."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      let progress: IndexProgress;
      do {
        progress = await requestApi<IndexProgress>("/api/v1/admin/rag/index", { method: "POST" });
        setIndexProgress(progress);
      } while (progress.status === "running");
      setIndexed(progress.chunks);
      setNotice(`${progress.indexed} chunk mới, ${progress.reused} giữ lại, ${progress.removed} đã xóa. Model: ${progress.embeddingModel}. Hash: ${progress.contentHash.slice(0, 16)}.`);
    } catch (cause) { setError(errorMessage(cause, "Tạo embedding thất bại. Hãy kiểm tra cấu hình và thử lại.")); }
    finally { setBusy(false); }
  }

  async function checkHealth() {
    setBusy(true); setError(""); setHealth(null);
    try {
      const body = await requestApi<RagHealthDiagnostics>("/api/v1/admin/rag/health", {}, {
        acceptedStatuses: [503], validateAcceptedResponse: isRagHealthDiagnostics,
      });
      if (!isRagHealthDiagnostics(body)) throw new ApiRequestError(502, "INVALID_API_RESPONSE");
      setHealth(body);
    } catch (cause) { setError(errorMessage(cause, "Không kiểm tra được RAG. Hãy thử lại sau.")); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:py-12">
    <Link href="/questions" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--green)]"><ArrowLeft size={17}/> Về hỏi giá</Link>
    <div className="mt-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-[.16em] text-[var(--green)]">QUẢN TRỊ RAG</p><h1 className="mt-1 text-3xl font-black sm:text-4xl">Duyệt tài liệu & tạo embedding</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Đối chiếu bản chép với ảnh sổ trước khi duyệt. Chỉ văn bản được duyệt và biến thể đã xác minh mới được chia chunk, embedding và đưa vào truy xuất.</p></div><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void checkHealth()} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-5 py-3 font-bold disabled:opacity-50"><Activity size={18}/> Kiểm tra kết nối</button><button disabled={busy || dirty} onClick={() => void buildIndex()} className="inline-flex items-center gap-2 rounded-xl bg-[var(--green)] px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={18}/> : <Sparkles size={18}/>} Tạo lại embedding</button></div></div>
    <div className="mt-5 flex flex-wrap gap-3 text-sm"><span className="rounded-full bg-white px-4 py-2">{pages.length} trang nguồn</span><span className="rounded-full bg-emerald-50 px-4 py-2 text-emerald-800">{approvedCount} trang đã duyệt</span>{indexed !== null && <span className="rounded-full bg-blue-50 px-4 py-2 text-blue-800">{indexed} chunk đã lập chỉ mục</span>}</div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
    {indexProgress && <section aria-label="Tiến độ lập chỉ mục" className="mt-4 rounded-xl border border-[var(--line)] bg-white p-4 text-sm"><p className="font-bold">Run #{indexProgress.runId}: {indexProgress.status === "completed" ? "Đã hoàn tất" : indexProgress.status === "failed" ? "Bị gián đoạn" : "Đang lập chỉ mục"}</p><progress className="mt-2 w-full" value={indexProgress.checkpoint} max={Math.max(indexProgress.chunks, 1)} /><p>{indexProgress.checkpoint}/{indexProgress.chunks} chunk · {indexProgress.indexed} mới · {indexProgress.reused} tái sử dụng · {indexProgress.removed} đã bỏ</p>{indexProgress.status !== "completed" && !busy && <button onClick={() => void buildIndex()} className="mt-2 rounded-lg border border-[var(--line)] px-3 py-2 font-bold">Chạy tiếp</button>}</section>}
    {health && <section aria-label="Trạng thái RAG" className="mt-4 grid gap-2 rounded-xl border border-[var(--line)] bg-white p-4 text-sm sm:grid-cols-3">{(["database", "embedding", "chat"] as const).map((key) => {
      const check = health[key];
      const model = "model" in check ? check.model : undefined;
      const dimensions = "dimensions" in check ? check.dimensions : undefined;
      const fingerprint = "fingerprint" in check ? check.fingerprint : undefined;
      return <div key={key} className="rounded-lg bg-[#f3f5ef] p-3"><b>{key === "database" ? "Supabase" : key === "embedding" ? "Embedding" : "Chat"}: {check.ok ? "Sẵn sàng" : "Lỗi"}</b><p className="mt-1 break-words">{check.detail}</p>{model && <p className="mt-1 text-xs">Model: {model}{dimensions ? ` · ${dimensions} chiều` : ""}{fingerprint ? ` · ${fingerprint}` : ""}</p>}</div>;
    })}</section>}
    <div className="mt-6 grid gap-5 lg:grid-cols-[250px_1fr]">
      <nav aria-label="Trang sổ giá" className="grid content-start grid-cols-2 gap-2 lg:grid-cols-1">{pages.map((page) => <button key={page.sourcePageId} onClick={() => selectPage(page.sourcePageId)} className={`flex items-center justify-between rounded-xl border p-3 text-left ${selectedId === page.sourcePageId ? "border-[var(--green)] bg-emerald-50" : "border-[var(--line)] bg-white"}`}><span className="font-bold">Trang {String(page.pageNumber ?? page.sourcePageId).padStart(2, "0")}</span><span className={`text-xs ${page.reviewStatus === "approved" ? "text-emerald-700" : "text-amber-800"}`}>{page.reviewStatus === "approved" ? "Đã duyệt" : page.reviewStatus === "rejected" ? "Đã thu hồi" : "Bản nháp"}</span></button>)}</nav>
      {selected ? <section className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">Trang {String(selected.pageNumber ?? selected.sourcePageId).padStart(2, "0")}</h2><a className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[var(--green)] underline" href={`/source-pages/page-${String(selected.pageNumber ?? selected.sourcePageId).padStart(2, "0")}.jpg`} target="_blank" rel="noreferrer"><BookOpenCheck size={16}/> Mở ảnh riêng</a></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">Giá trong SQL không được embedding</span></div><div className="mt-4 grid gap-5 xl:grid-cols-[minmax(280px,.85fr)_minmax(380px,1.15fr)]"><figure className="min-w-0"><figcaption className="mb-2 text-sm font-bold">Ảnh sổ gốc · Trang {String(selected.pageNumber ?? selected.sourcePageId).padStart(2, "0")}</figcaption><div className="relative h-[55vh] min-h-80 overflow-auto rounded-xl border border-[var(--line)] bg-[#f3f1e9] xl:sticky xl:top-4 xl:h-[calc(100vh-9rem)]"><Image src={`/source-pages/page-${String(selected.pageNumber ?? selected.sourcePageId).padStart(2, "0")}.jpg`} alt={`Ảnh sổ giá trang ${selected.pageNumber ?? selected.sourcePageId}`} width={1200} height={2000} unoptimized className="h-full w-full object-contain"/></div></figure><div className="min-w-0"><label className="block text-sm font-bold">Tên tài liệu<input value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} className="mt-2 h-11 w-full rounded-lg border border-[var(--line)] px-3 font-normal" maxLength={200}/></label><label className="mt-4 block text-sm font-bold">Bản chép/OCR đã đối chiếu<textarea value={selected.extractedText} onChange={(event) => updateSelected({ extractedText: event.target.value, reviewStatus: selected.reviewStatus === "approved" ? "draft" : selected.reviewStatus })} rows={18} maxLength={100000} placeholder="Nhập nội dung đọc được từ trang sổ. Ghi mỗi mặt hàng/nhóm giá thành một dòng; giữ tên, quy cách, ghi chú và đơn vị. Không chép số tiền; giá sẽ được lấy riêng từ bảng prices." className="mt-2 w-full rounded-xl border border-[var(--line)] p-3 font-mono text-sm leading-6"/><span className="mt-1 block text-right text-xs text-[var(--muted)]">{selected.extractedText.length.toLocaleString("vi-VN")} / 100.000 ký tự</span></label><div className="mt-4 flex flex-wrap gap-2"><button disabled={busy} onClick={() => void save("draft")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--line)] px-4 py-2 font-bold"><Save size={16}/> Lưu bản nháp</button><button disabled={busy || !selected.extractedText.trim()} onClick={() => void save("approved")} className="min-h-11 rounded-lg bg-[var(--green)] px-4 py-2 font-bold text-white disabled:opacity-50">Duyệt bản chép</button><button disabled={busy || selected.reviewStatus === "rejected"} onClick={() => void save("rejected")} className="min-h-11 rounded-lg border border-red-200 px-4 py-2 font-bold text-red-800">Thu hồi cả trang</button></div></div></div></section> : <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-[var(--line)] bg-white p-6 text-center text-sm text-[var(--muted)]">Đang tải các trang nguồn…</div>}
      {selected && <section aria-label="Xem trước đoạn tìm kiếm" className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-black">Xem trước đoạn tìm kiếm</h3><span className="text-xs text-[var(--muted)]">{chunkPreview.length} đoạn · văn bản chuẩn hóa</span></div>{chunkPreview.length ? <ol className="mt-3 grid gap-3">{chunkPreview.map((chunk) => <li key={chunk.index} className="rounded-lg border border-[var(--line)] bg-[#f8f9f6] p-3"><p className="text-xs font-bold text-[var(--muted)]">Đoạn {chunk.index + 1} · ký tự {chunk.start}–{chunk.end}</p><pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-6">{chunk.content}</pre></li>)}</ol> : <p className="mt-2 text-sm text-[var(--muted)]">Chưa có nội dung để chia đoạn. Nhập và đối chiếu bản chép với ảnh.</p>}</section>}
    </div>
    <p className="mt-5 text-xs leading-5 text-[var(--muted)]">Chunking chia văn bản theo dòng/ngữ nghĩa, giới hạn khoảng 1.100 ký tự mỗi chunk và chồng lấn 160 ký tự để giữ ngữ cảnh. Giá hiện hành luôn được đọc riêng từ PostgreSQL khi người dùng hỏi.</p>
  </main>;
}




