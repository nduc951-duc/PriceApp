"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Alert, Badge, Button, Select, TextInput, Textarea } from "flowbite-react";
import { Activity, ArrowLeft, BookOpenCheck, Check, LoaderCircle, LogOut, Save, ScanLine, Sparkles, X } from "lucide-react";
import { useAuthLogout } from "@/components/auth-actions-context";
import { requestApi, ApiRequestError } from "@/lib/api/client";
import { isRagHealthDiagnostics, type RagHealthDiagnostics } from "@/lib/api/rag-health";
import type { ApiRequestBody, ApiResponse } from "@/lib/api/generated/api-types";
import { fetchRagFeedbackSummary, type RagFeedbackSummary } from "@/lib/api/rag-conversations";
import { fetchSourceSignedUrl } from "@/lib/api/source-files";
import { runSequentialOcrBatch, selectOcrBatchPages, type OcrBatchResult } from "@/features/rag/ocr-batch";
import { useModalFocus } from "@/hooks/use-modal-focus";

type Page = ApiResponse<"/api/v1/admin/rag/pages", "get">["pages"][number];
type IndexProgress = NonNullable<ApiResponse<"/api/v1/admin/rag/index", "get">["run"]>;
type PreviewChunk = ApiResponse<"/api/v1/admin/rag/preview", "post">["chunks"][number];
type OcrDraftChunk = { index: number; heading: string | null; text: string; imported: boolean };
type SavePageInput = ApiRequestBody<"/api/v1/admin/rag/pages", "put">;
type SavePageResponse = ApiResponse<"/api/v1/admin/rag/pages", "put">;
type OcrQueueState = OcrBatchResult | { sourcePageId: number; status: "queued" | "processing" };
function sourceStatusLabel(status: string) { return ({ approved: "Đã duyệt", needs_review: "Cần đối chiếu", unreadable: "Khó đọc" } as Record<string, string>)[status] ?? "Đang cập nhật"; }
function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof ApiRequestError && cause.status === 401) return "Vui lòng đăng nhập lại.";
  if (cause instanceof ApiRequestError && cause.status === 403) return "Bạn không có quyền quản trị RAG.";
  return fallback;
}
export function RagAdmin() {
  const logout = useAuthLogout();
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [indexed, setIndexed] = useState<number | null>(null);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);
  const [health, setHealth] = useState<RagHealthDiagnostics | null>(null);
  const [feedback, setFeedback] = useState<RagFeedbackSummary | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [pagesLoadState, setPagesLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [zoomOpen, setZoomOpen] = useState(false);
  const [mobileWorkspaceTab, setMobileWorkspaceTab] = useState<"image" | "transcript" | "chunks">("image");
  const zoomDialogRef = useModalFocus<HTMLDivElement>(zoomOpen, () => setZoomOpen(false));
  const [sourceImageFallback, setSourceImageFallback] = useState<{ sourcePageId: number; url: string } | null>(null);
  const [sourceImageErrorPageId, setSourceImageErrorPageId] = useState<number | null>(null);
  const [focusedChunk, setFocusedChunk] = useState<number | null>(null);
  const [ocrDraft, setOcrDraft] = useState<OcrDraftChunk[]>([]);
  const [ocrPageId, setOcrPageId] = useState<number | null>(null);
  const [ocrRecognizedText, setOcrRecognizedText] = useState("");
  const [ocrQueue, setOcrQueue] = useState<Record<number, OcrQueueState>>({});
  const selected = pages.find((page) => page.sourcePageId === selectedId) ?? null;
  const ocrSelection = selectOcrBatchPages(pages);
  const queuedResults = Object.values(ocrQueue);
  const completedOcrCount = queuedResults.filter((result) => result.status === "saved" || result.status === "failed" || result.status === "skipped").length;
  const approvedCount = useMemo(() => pages.filter((page) => page.reviewStatus === "approved").length, [pages]);
  const [preview, setPreview] = useState<{ text: string; source: string; chunks: PreviewChunk[] }>({ text: "", source: "", chunks: [] });
  const previewText = selected?.extractedText ?? "";
  const chunkPreview = preview.text === previewText ? preview.chunks : [];
  const localSourceImageUrl = selected ? `/source-pages/page-${String(selected.pageNumber ?? selected.sourcePageId).padStart(2, "0")}.jpg` : "";
  const sourceImageUrl = sourceImageFallback && sourceImageFallback.sourcePageId === selected?.sourcePageId ? sourceImageFallback.url : localSourceImageUrl;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      if (!previewText.trim()) { setPreview({ text: previewText, source: "", chunks: [] }); return; }
      void requestApi<ApiResponse<"/api/v1/admin/rag/preview", "post">>("/api/v1/admin/rag/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extractedText: previewText, chunkSettings: selected?.chunkSettings }), signal: controller.signal,
      }).then(body => { if (active) setPreview({ text: previewText, source: body.source, chunks: body.chunks }); })
        .catch(cause => { if (active) setError(errorMessage(cause, "Không xem trước được đoạn tìm kiếm. Hãy thử lại sau.")); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [previewText, selected?.chunkSettings]);

  const loadPages = useCallback(async () => {
    setPagesLoadState("loading");
    let owner = false;
    try {
      const me = await requestApi<ApiResponse<"/api/v1/me", "get">>("/api/v1/me");
      owner = me.role === "owner";
      setCanManage(owner);
      const body = await requestApi<ApiResponse<"/api/v1/admin/rag/pages", "get">>("/api/v1/admin/rag/pages");
      setPages(body.pages);
      setSelectedId((current) => current ?? body.pages?.[0]?.sourcePageId ?? null);
      setPagesLoadState("loaded");
    } catch (cause) {
      setPagesLoadState("error");
      throw cause;
    }
    if (!owner) return;
    try {
      const runBody = await requestApi<ApiResponse<"/api/v1/admin/rag/index", "get">>("/api/v1/admin/rag/index");
      setIndexProgress(runBody.run);
    } catch (cause) { setError(errorMessage(cause, "Không tải được tiến độ lập chỉ mục.")); }
    try { setFeedback(await fetchRagFeedbackSummary()); }
    catch (cause) { setError(errorMessage(cause, "Không tải được tổng hợp phản hồi.")); }
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
      const saveInput: SavePageInput = { sourcePageId: selected.sourcePageId, title: selected.title, extractedText: selected.extractedText, reviewStatus, chunkSettings: selected.chunkSettings, chunkLinks: selected.chunkLinks };
      const body = await requestApi<SavePageResponse>("/api/v1/admin/rag/pages", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saveInput) });
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
        progress = await requestApi<ApiResponse<"/api/v1/admin/rag/index", "post">>("/api/v1/admin/rag/index", { method: "POST" });
        setIndexProgress(progress);
      } while (progress.status === "running");
      setIndexed(progress.chunks);
      setNotice(`${progress.indexed} chunk mới, ${progress.reused} giữ lại, ${progress.removed} đã xóa. Model: ${progress.embeddingModel}. Hash: ${progress.contentHash.slice(0, 16)}.`);
    } catch (cause) { setError(errorMessage(cause, "Tạo embedding thất bại. Hãy kiểm tra cấu hình và thử lại.")); }
    finally { setBusy(false); }
  }
  function exportFeedbackCsv() {
    if (!feedback) return;
    const lines = [
      "metric,count",
      `total,${feedback.total}`,
      `helpful,${feedback.helpful}`,
      `not_helpful,${feedback.notHelpful}`,
      ...feedback.reasons.map((item) => `${item.reason},${item.count}`),
    ];
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rag-feedback-summary.csv";
    link.click();
    URL.revokeObjectURL(url);
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

  async function recognizePage(page: Page) {
    const pageNumber = page.pageNumber ?? page.sourcePageId;
    const localImageUrl = `/source-pages/page-${String(pageNumber).padStart(2, "0")}.jpg`;
    let imageResponse: Response | null = null;
    try { imageResponse = await fetch(localImageUrl); } catch { /* Try the signed Supabase copy when the bundled image is unavailable. */ }
    if (!imageResponse?.ok) {
      const { signedUrl } = await fetchSourceSignedUrl(page.storagePath);
      if (selectedId === page.sourcePageId) setSourceImageFallback({ sourcePageId: page.sourcePageId, url: signedUrl });
      imageResponse = await fetch(signedUrl);
    }
    if (!imageResponse?.ok) throw new Error(`Không tải được ảnh nguồn trang ${String(pageNumber).padStart(2, "0")}.`);
    const image = new Uint8Array(await imageResponse.arrayBuffer());
    let binary = "";
    for (const byte of image) binary += String.fromCharCode(byte);
    const result = await requestApi<ApiResponse<"/api/v1/admin/rag/ocr", "post">>("/api/v1/admin/rag/ocr", {
      method: "POST", body: JSON.stringify({ imageBase64: btoa(binary), mimeType: "image/jpeg" }),
    });
    const previewBody = await requestApi<ApiResponse<"/api/v1/admin/rag/preview", "post">>("/api/v1/admin/rag/preview", {
      method: "POST", body: JSON.stringify({ extractedText: result.text, chunkSettings: page.chunkSettings }),
    });
    if (!previewBody.chunks.length) throw new Error(`OCR trang ${String(pageNumber).padStart(2, "0")} không đọc được nội dung rõ ràng.`);
    return { result, previewBody };
  }

  async function saveDraftText(page: Page, extractedText: string) {
    const saveInput: SavePageInput = {
      sourcePageId: page.sourcePageId, title: page.title, extractedText, reviewStatus: "draft",
      chunkSettings: page.chunkSettings, chunkLinks: {},
    };
    const response = await requestApi<SavePageResponse>("/api/v1/admin/rag/pages", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saveInput),
    });
    setPages((current) => current.map((item) => item.sourcePageId === page.sourcePageId
      ? { ...item, extractedText, reviewStatus: "draft", revision: response.revision, chunkLinks: {}, reviewedBy: null, reviewedAt: null }
      : item));
    if (selectedId === page.sourcePageId) setDirty(false);
    return response;
  }

  async function scanOcr() {
    if (!selected) return;
    if ((selected.extractedText.trim() || selected.reviewStatus !== "draft") && !window.confirm("Trang này đã có bản chép hoặc trạng thái duyệt. Quét lại sẽ chỉ tạo bản OCR riêng; nội dung hiện có được giữ nguyên cho đến khi bạn chủ động thay thế và lưu. Tiếp tục?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { result, previewBody } = await recognizePage(selected);
      setOcrRecognizedText(previewBody.source);
      setOcrDraft(previewBody.chunks.map((chunk) => ({
        index: chunk.index, heading: chunk.heading, text: previewBody.source.slice(chunk.start, chunk.end), imported: false,
      })));
      setOcrPageId(selected.sourcePageId);
      setMobileWorkspaceTab("chunks");
      setNotice(`OCR bằng ${result.model} xong: ${previewBody.chunks.length} chunk nháp. Sửa và nhập từng chunk cần dùng.`);
    } catch (cause) {
      setError(errorMessage(cause, cause instanceof Error ? cause.message : "Quét OCR thất bại. Kiểm tra Ollama rồi thử lại."));
    } finally { setBusy(false); }
  }

  async function scanOcrBatch(retryPageIds?: Set<number>) {
    if (dirty) { setError("Hãy lưu hoặc bỏ thay đổi trước khi quét hàng loạt."); return; }
    const batchPages = retryPageIds ? pages.filter((page) => retryPageIds.has(page.sourcePageId)) : pages;
    const selection = selectOcrBatchPages(batchPages);
    if (!selection.eligible.length) {
      setNotice("Không có trang nháp trống cần OCR. Trang đã có bản chép hoặc đã duyệt được giữ nguyên.");
      return;
    }
    if (!retryPageIds && !window.confirm(`Sẽ quét tuần tự ${selection.eligible.length} trang trống và lưu kết quả ở trạng thái bản nháp. Trang có chữ hoặc đã duyệt sẽ được bỏ qua. Tiếp tục?`)) return;
    setBusy(true); setError(""); setNotice("");
    setOcrQueue((current) => ({
      ...current,
      ...Object.fromEntries(selection.eligible.map((page) => [page.sourcePageId, { sourcePageId: page.sourcePageId, status: "queued" as const }])),
      ...Object.fromEntries(selection.skipped.map((result) => [result.sourcePageId, result])),
    }));
    try {
      const results = await runSequentialOcrBatch(batchPages, async (page) => {
        setOcrQueue((current) => ({ ...current, [page.sourcePageId]: { sourcePageId: page.sourcePageId, status: "processing" } }));
        const { previewBody } = await recognizePage(page);
        await saveDraftText(page, previewBody.source);
      }, (result) => setOcrQueue((current) => ({ ...current, [result.sourcePageId]: result })));
      const savedCount = results.filter((result) => result.status === "saved").length;
      const failedCount = results.filter((result) => result.status === "failed").length;
      const skippedCount = results.filter((result) => result.status === "skipped").length;
      setNotice(`Đã lưu ${savedCount} bản nháp; ${skippedCount} trang được bỏ qua; ${failedCount} trang cần thử lại. Kết quả OCR chưa được duyệt hoặc lập chỉ mục.`);
    } catch (cause) {
      setError(errorMessage(cause, cause instanceof Error ? cause.message : "Không chạy được hàng đợi OCR."));
    } finally { setBusy(false); }
  }

  async function loadSignedSourceImage() {
    if (!selected || sourceImageFallback?.sourcePageId === selected.sourcePageId) { if (selected) setSourceImageErrorPageId(selected.sourcePageId); return; }
    try {
      const { signedUrl } = await fetchSourceSignedUrl(selected.storagePath);
      setSourceImageFallback({ sourcePageId: selected.sourcePageId, url: signedUrl });
    } catch {
      setSourceImageErrorPageId(selected.sourcePageId);
    }
  }

  function updateOcrChunk(index: number, text: string) {
    setOcrDraft((chunks) => chunks.map((chunk) => chunk.index === index ? { ...chunk, text, imported: false } : chunk));
  }

  function importOcrChunk(index: number) {
    if (!selected || ocrPageId !== selected.sourcePageId) return;
    const chunk = ocrDraft.find((item) => item.index === index);
    if (!chunk || chunk.imported || !chunk.text.trim()) return;
    const section = [chunk.heading ? `${chunk.heading}:` : "", chunk.text.trim()].filter(Boolean).join("\n");
    const extractedText = [selected.extractedText.trim(), section].filter(Boolean).join("\n");
    updateSelected({ extractedText, chunkLinks: {}, reviewStatus: "draft" });
    setOcrDraft((chunks) => chunks.map((item) => item.index === index ? { ...item, imported: true } : item));
    setMobileWorkspaceTab("transcript");
  }

  function replaceTranscriptWithOcr() {
    if (!selected || ocrPageId !== selected.sourcePageId || !ocrRecognizedText.trim()) return;
    if (!window.confirm("Thay toàn bộ bản chép đang có bằng kết quả OCR? Nội dung mới chỉ được gửi lên khi bạn bấm Lưu bản nháp.")) return;
    updateSelected({ extractedText: ocrRecognizedText, chunkLinks: {}, reviewStatus: "draft" });
    setNotice("Đã thay nội dung trong trình soạn thảo. Bản lưu cũ vẫn còn nguyên cho đến khi lưu bản nháp mới.");
  }

  return <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 lg:px-6">
    <div className="flex items-center justify-between gap-4"><Link href="/questions" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--green)]"><ArrowLeft size={17}/> Về hỏi giá</Link><Button type="button" onClick={() => void logout?.()} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold text-[var(--muted)]"><LogOut size={15}/> Đăng xuất</Button></div>
    <div className="mt-4 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-[var(--green)]">{canManage ? "QUẢN TRỊ RAG" : "NHẬP LIỆU OCR"}</p><h1 className="mt-1 text-2xl font-semibold">{canManage ? "Duyệt tài liệu & tạo embedding" : "Đọc trang nguồn thành bản nháp"}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{canManage ? "Đối chiếu chữ và số tiền với ảnh gốc, lưu bản nháp rồi duyệt trang đã kiểm tra." : "Chọn trang, quét chữ và sửa nội dung trước khi lưu bản nháp."}</p></div>{canManage && <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void checkHealth()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-5 py-3 font-bold disabled:opacity-50"><Activity size={18}/> Kiểm tra kết nối</Button><Button disabled={busy || dirty} onClick={() => void buildIndex()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--green)] px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={18}/> : <Sparkles size={18}/>} Tạo lại embedding</Button></div>}</div>
    <div className="mt-3 flex flex-wrap gap-3 text-sm"><span className="font-medium">{pages.length} trang nguồn</span><span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">{approvedCount} trang đã duyệt</span>{canManage && indexed !== null && <span className="rounded-full bg-blue-50 px-4 py-2 text-blue-800">{indexed} chunk đã lập chỉ mục</span>}</div>
    {pages.length > 0 && <section aria-label="Hàng đợi OCR 13 trang" className="mt-5 flex flex-col items-stretch gap-4 rounded-lg border border-[var(--line)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="min-w-0 sm:flex-1"><h2 className="font-semibold">Nạp bản chép cho các trang còn trống</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">Quét từng ảnh một, tự lưu nội dung thành bản nháp. Trang có bản chép hoặc đã duyệt được giữ nguyên; lỗi có thể thử lại riêng.</p>{queuedResults.length > 0 && <p aria-live="polite" className="mt-2 text-sm font-semibold text-[var(--green)]">Tiến độ hàng đợi: {completedOcrCount}/{queuedResults.length} trang đã xử lý.</p>}</div><Button type="button" disabled={busy || dirty || ocrSelection.eligible.length === 0} onClick={() => void scanOcrBatch()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--green)] px-4 py-2 font-bold text-white disabled:opacity-50 sm:w-auto sm:shrink-0"><ScanLine size={17}/> OCR các trang chưa có bản chép ({ocrSelection.eligible.length})</Button></section>}
    {error && <Alert color="failure" className="mt-4">{error}</Alert>}{notice && <Alert color="success" className="mt-4">{notice}</Alert>}
    {canManage && indexProgress && <section aria-label="Tiến độ lập chỉ mục" className="mt-4 rounded-lg border border-[var(--line)] bg-white p-4 text-sm"><p className="font-bold">Run #{indexProgress.runId}: {indexProgress.status === "completed" ? "Đã hoàn tất" : indexProgress.status === "failed" ? "Bị gián đoạn" : "Đang lập chỉ mục"}</p><progress className="mt-2 w-full" value={indexProgress.checkpoint} max={Math.max(indexProgress.chunks, 1)} /><p>{indexProgress.checkpoint}/{indexProgress.chunks} chunk · {indexProgress.indexed} mới · {indexProgress.reused} tái sử dụng · {indexProgress.removed} đã bỏ</p>{indexProgress.status !== "completed" && !busy && <Button onClick={() => void buildIndex()} className="mt-2 rounded-lg border border-[var(--line)] px-3 py-2 font-bold">Chạy tiếp</Button>}</section>}
    {canManage && health && <section aria-label="Trạng thái RAG" className="mt-4 grid gap-2 rounded-lg border border-[var(--line)] bg-white p-4 text-sm sm:grid-cols-3">{(["database", "embedding", "chat"] as const).map((key) => {
      const check = health[key];
      const model = "model" in check ? check.model : undefined;
      const dimensions = "dimensions" in check ? check.dimensions : undefined;
      const fingerprint = "fingerprint" in check ? check.fingerprint : undefined;
      return <div key={key} className="rounded-lg bg-[#f3f5ef] p-3"><b>{key === "database" ? "Supabase" : key === "embedding" ? "Embedding" : "Chat"}: <Badge color={check.ok ? "success" : "failure"}>{check.ok ? "Sẵn sàng" : "Lỗi"}</Badge></b><p className="mt-1 break-words">{check.detail}</p>{model && <p className="mt-1 text-xs">Model: {model}{dimensions ? ` · ${dimensions} chiều` : ""}{fingerprint ? ` · ${fingerprint}` : ""}</p>}</div>;
    })}</section>}
    {canManage && <section aria-label="Tổng hợp phản hồi RAG" className="mt-4 rounded-lg border border-[var(--line)] bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Phản hồi câu trả lời</h2><p className="mt-1 text-sm text-[var(--muted)]">{feedback ? `${feedback.total} phản hồi · ${feedback.helpful} hữu ích · ${feedback.notHelpful} cần xem lại` : "Đang tải tổng hợp phản hồi…"}</p></div><Button type="button" disabled={!feedback || feedback.total === 0} onClick={exportFeedbackCsv} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold disabled:opacity-50">Xuất CSV</Button></div>{feedback && <div className="mt-3 flex flex-wrap gap-2">{feedback.reasons.map((item) => <span key={item.reason} className="rounded-full bg-[#f3f5ef] px-3 py-1.5 text-xs">{item.reason === "missing_data" ? "Thiếu dữ liệu" : item.reason === "retrieval_error" ? "Tìm sai" : item.reason === "answer_error" ? "Câu trả lời sai" : "Khác"}: {item.count}</span>)}</div>}{feedback?.truncated && <p className="mt-2 text-xs text-amber-800">Bản tổng hợp đang giới hạn 1.000 phản hồi gần nhất.</p>}</section>}
      <div role="tablist" aria-label="Khu vực biên tập" className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--line)] bg-white p-1 lg:hidden">{([["image", "Ảnh nguồn"], ["transcript", "Bản chép"], ["chunks", "Các đoạn"]] as const).map(([tab, label]) => <Button key={tab} type="button" role="tab" aria-selected={mobileWorkspaceTab === tab} onClick={() => setMobileWorkspaceTab(tab)} className={`min-h-11 rounded-md px-2 text-sm font-semibold ${mobileWorkspaceTab === tab ? "bg-blue-700 text-white" : "bg-white text-[var(--ink)]"}`}>{label}</Button>)}</div>
      <label className="block text-sm font-semibold lg:hidden">Chọn trang nguồn<Select aria-label="Chọn trang nguồn" className="mt-2 min-h-11 w-full pr-10" value={selectedId ?? ""} onChange={(event) => { selectPage(Number(event.target.value)); setMobileWorkspaceTab("image"); }}>{pages.map((page) => <option key={page.sourcePageId} value={page.sourcePageId}>Trang {String(page.pageNumber ?? page.sourcePageId).padStart(2, "0")} · {page.reviewStatus === "approved" ? "Đã duyệt" : page.extractedText.trim() ? "Có bản chép" : "Chưa có bản chép"}</option>)}</Select></label>
    {selected && ocrPageId === selected.sourcePageId && ocrDraft.length > 0 && <section aria-label="Bản nháp OCR theo chunk" className={`mt-4 rounded-lg border border-[var(--line)] bg-white p-4 ${mobileWorkspaceTab === "chunks" ? "block" : "hidden"} lg:block`}><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Quét ảnh thành bản chép</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">Đối chiếu ảnh gốc và sửa từng đoạn trước khi nhập.</p></div></div>{ocrPageId === selected.sourcePageId && ocrDraft.length > 0 && <ol className="mt-4 grid gap-3">{ocrDraft.map((chunk) => <li key={chunk.index} className="rounded-lg border border-[var(--line)] bg-[#f8f9f6] p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Đoạn {chunk.index + 1}{chunk.heading ? ` · ${chunk.heading}` : ""}</p><p className="mt-1 text-xs text-[var(--muted)]">Đối chiếu từng dòng với ảnh; phần không rõ được đánh dấu [?].</p></div><Button type="button" disabled={busy || chunk.imported || !chunk.text.trim()} onClick={() => importOcrChunk(chunk.index)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-bold disabled:opacity-50">{chunk.imported ? <Check size={16}/> : null}{chunk.imported ? "Đã nhập" : `Nhập đoạn ${chunk.index + 1} vào bản chép`}</Button></div><Textarea aria-label={`Nội dung đoạn ${chunk.index + 1}`} readOnly={chunk.imported} value={chunk.text} onChange={(event) => updateOcrChunk(chunk.index, event.target.value)} rows={Math.min(10, Math.max(3, chunk.text.split("\n").length))} className="mt-3 w-full rounded-lg border border-[var(--line)] bg-white p-3 font-mono text-sm leading-6 read-only:bg-[#f1f2ed]"/></li>)}</ol>}</section>}
    {selected && ocrPageId === selected.sourcePageId && selected.extractedText.trim() && ocrRecognizedText.trim() && <Button type="button" disabled={busy} onClick={replaceTranscriptWithOcr} className="mt-3 min-h-10 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">Thay toàn bộ bản chép bằng OCR trang {String(selected.pageNumber ?? selected.sourcePageId).padStart(2, "0")}</Button>}
    <div className="mt-6 grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Trang sổ giá" className="hidden content-start gap-2 lg:grid">{pages.map((page) => {
        const pageNumber = String(page.pageNumber ?? page.sourcePageId).padStart(2, "0");
        const queue = ocrQueue[page.sourcePageId];
        const statusLabel = queue?.status === "saved" ? "Đã lưu bản nháp" : queue?.status === "processing" ? "Đang quét OCR" : queue?.status === "queued" ? "Chờ quét" : queue?.status === "failed" ? "Lỗi OCR · Thử lại" : queue?.status === "skipped" ? queue.reason === "reviewed" ? "Đã duyệt · Không quét" : "Bỏ qua · Có bản chép" : page.reviewStatus === "approved" ? "Đã duyệt · Không quét" : page.reviewStatus === "rejected" ? "Đã thu hồi · Không quét" : page.extractedText.trim() ? "Có bản chép · Giữ nguyên" : "Chưa có bản chép";
        const statusColor: "success" | "failure" | "warning" | "info" | "gray" = queue?.status === "saved" || page.reviewStatus === "approved" ? "success" : queue?.status === "failed" || page.reviewStatus === "rejected" ? "failure" : queue?.status === "processing" || queue?.status === "queued" ? "info" : statusLabel.includes("Bỏ qua") || statusLabel.includes("Có bản chép") ? "warning" : "gray";
        return <div key={page.sourcePageId} className="min-w-0">
          <Button color="light" disabled={busy} aria-label={`Chọn trang ${pageNumber}`} aria-pressed={selectedId === page.sourcePageId} onClick={() => selectPage(page.sourcePageId)} className={`flex h-auto min-h-20 w-full flex-col items-stretch justify-start gap-2 rounded-lg border p-3 text-left whitespace-normal text-[var(--ink)] disabled:opacity-70 ${selectedId === page.sourcePageId ? "border-blue-700 bg-blue-50" : "border-gray-200 bg-white"}`}>
            <span className="flex flex-col items-start gap-2"><b>Trang {pageNumber}</b><Badge className="max-w-full whitespace-normal text-left" color={statusColor}>{statusLabel}</Badge></span>
            {(sourceImageErrorPageId === page.sourcePageId || !page.storagePath) && <span className="block text-xs text-red-700">{sourceImageErrorPageId === page.sourcePageId ? "Không tải được ảnh nguồn" : "Thiếu đường dẫn ảnh"}</span>}
            {canManage && <span className="mt-1 block text-xs text-[var(--muted)]">Rev {page.revision} · {page.chunkCount} chunk{page.indexedAt ? ` · index ${new Date(page.indexedAt).toLocaleDateString("vi-VN")}` : " · chưa index"}</span>}
            {canManage && page.reviewedBy && <span className="mt-1 block text-xs text-[var(--muted)]">Duyệt bởi {page.reviewedBy.slice(0, 8)} · {page.reviewedAt ? new Date(page.reviewedAt).toLocaleDateString("vi-VN") : "chưa rõ thời điểm"}</span>}
            {canManage && page.indexError && <span className="mt-1 block text-xs font-semibold text-red-700">{page.indexError}</span>}
          </Button>
          {queue?.status === "failed" && <><p role="alert" className="mt-1 break-words text-xs text-red-700">{queue.error}</p><Button type="button" disabled={busy || dirty} aria-label={`Thử lại OCR trang ${pageNumber}`} onClick={() => void scanOcrBatch(new Set([page.sourcePageId]))} className="mt-1 min-h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 py-1 text-xs font-bold disabled:opacity-50">Thử lại OCR</Button></>}
        </div>;
      })}</nav>
      {selected ? <section className="rounded-lg border border-[var(--line)] bg-white p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Trang {String(selected.pageNumber ?? selected.sourcePageId).padStart(2, "0")}</h2><Button type="button" onClick={() => setZoomOpen(true)} className="mt-1 inline-flex items-center gap-2 bg-transparent px-0 text-sm font-bold text-[var(--green)] underline hover:bg-transparent"><BookOpenCheck size={16}/> Phóng ảnh nguồn</Button><p className="mt-1 text-xs text-[var(--muted)]">Nguồn: {sourceStatusLabel(selected.sourceStatus)} · Lần sửa {selected.revision}</p></div><Button type="button" disabled={busy} onClick={() => void scanOcr()} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-[var(--green)] px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={17}/> : <ScanLine size={17}/>} Quét OCR trang {String(selected.pageNumber ?? selected.sourcePageId).padStart(2, "0")}</Button><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">{selected.reviewStatus === "approved" ? "Đã duyệt" : "Bản nháp cần đối chiếu"}</span></div><div className="mt-4 grid gap-5 xl:grid-cols-[minmax(280px,.85fr)_minmax(380px,1.15fr)]"><figure className="min-w-0"><figcaption className="mb-2 text-sm font-bold">Ảnh sổ gốc · Trang {String(selected.pageNumber ?? selected.sourcePageId).padStart(2, "0")}</figcaption>{sourceImageErrorPageId === selected.sourcePageId && <p role="alert" className="mb-2 text-sm text-red-700">Không tải được ảnh nguồn. Kiểm tra file trong Supabase Storage.</p>}<Button type="button" onClick={() => setZoomOpen(true)} aria-label="Phóng ảnh sổ gốc" className={`relative h-[55vh] ${mobileWorkspaceTab === "image" ? "block" : "hidden"} lg:block min-h-80 w-full overflow-auto rounded-lg border border-[var(--line)] bg-[#f3f1e9] xl:sticky xl:top-4 xl:h-[calc(100vh-9rem)]`}><Image src={sourceImageUrl} onError={() => void loadSignedSourceImage()} alt={`Ảnh sổ giá trang ${selected.pageNumber ?? selected.sourcePageId}`} width={1200} height={2000} unoptimized className="h-full w-full object-contain"/></Button></figure><div className={`min-w-0 ${mobileWorkspaceTab === "transcript" ? "block" : "hidden"} lg:block`}><label className="block text-sm font-bold">Tên tài liệu<TextInput value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} className="mt-2 font-normal" maxLength={200}/></label><label className="mt-4 block text-sm font-bold">Bản chép/OCR đã đối chiếu<Textarea value={selected.extractedText} onChange={(event) => updateSelected({ extractedText: event.target.value, chunkLinks: {}, reviewStatus: selected.reviewStatus === "approved" ? "draft" : selected.reviewStatus })} rows={18} maxLength={100000} placeholder="Nhập nội dung đọc được từ trang sổ. Ghi mỗi mặt hàng/quy cách thành một dòng; dùng dòng kết thúc bằng dấu hai chấm làm heading. Giữ số đo, mã hàng và đơn vị; giá sẽ được đọc riêng từ SQL." className="mt-2 w-full rounded-lg border border-[var(--line)] p-3 font-mono text-sm leading-6"/><span className="mt-1 block text-right text-xs text-[var(--muted)]">{selected.extractedText.length.toLocaleString("vi-VN")} / 100.000 ký tự</span></label><div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void save("draft")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--line)] px-4 py-2 font-bold"><Save size={16}/> Lưu bản nháp</Button>{canManage && <Button disabled={busy || !selected.extractedText.trim()} onClick={() => void save("approved")} className="min-h-11 rounded-lg bg-[var(--green)] px-4 py-2 font-bold text-white disabled:opacity-50">Duyệt bản chép</Button>} {canManage && <Button disabled={busy || selected.reviewStatus === "rejected"} onClick={() => void save("rejected")} className="min-h-11 rounded-lg border border-red-200 px-4 py-2 font-bold text-red-800">Thu hồi cả trang</Button>}</div></div></div></section> : pagesLoadState === "loading" ? <div aria-live="polite" className="grid min-h-64 place-items-center rounded-lg border border-dashed border-[var(--line)] bg-white p-6 text-center text-sm text-[var(--muted)]">Đang tải trạng thái 13 trang…</div> : <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-[var(--line)] bg-white p-6 text-center text-sm text-[var(--muted)]">{pagesLoadState === "error" ? "Không thể tải danh sách. Kiểm tra quyền truy cập hoặc kết nối rồi thử tải lại." : pages.length ? "Chọn một trang nguồn để xem." : "Chưa có trang nguồn nào."}</div>}
      {selected && <section aria-label="Xem trước đoạn tìm kiếm" className={`rounded-lg border border-[var(--line)] bg-white p-4 sm:p-6 ${mobileWorkspaceTab === "chunks" ? "block" : "hidden"} lg:block`}><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Xem trước record và liên kết sản phẩm</h3><span className="text-xs text-[var(--muted)]">{chunkPreview.length} record · chunker v3</span></div><div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-[#f8f9f6] p-3"><label className="text-xs font-bold">Giới hạn ký tự<TextInput type="number" min={200} max={4000} step={100} value={selected.chunkSettings.maxCharacters} onChange={(event) => updateSelected({ chunkSettings: { ...selected.chunkSettings, maxCharacters: Number(event.target.value) }, chunkLinks: {} })} className="mt-1 block h-9 w-32 rounded border px-2 text-sm"/></label><label className="text-xs font-bold">Chồng lấn<TextInput type="number" min={0} max={3900} step={20} value={selected.chunkSettings.overlapCharacters} onChange={(event) => updateSelected({ chunkSettings: { ...selected.chunkSettings, overlapCharacters: Number(event.target.value) }, chunkLinks: {} })} className="mt-1 block h-9 w-32 rounded border px-2 text-sm"/></label><p className="max-w-md text-xs leading-5 text-[var(--muted)]">Mỗi dòng là một record; dòng kết thúc bằng “:” làm heading cho các dòng sau. Có thể gắn record với biến thể đã xác minh của trang này.</p></div>{chunkPreview.length ? <ol className="mt-3 grid gap-3">{chunkPreview.map((chunk) => <li key={chunk.index} className={`rounded-lg border p-3 ${focusedChunk === chunk.index ? "border-[var(--green)] bg-emerald-50" : "border-[var(--line)] bg-[#f8f9f6]"}`}><Button type="button" onClick={() => setFocusedChunk(chunk.index)} className="text-left"><p className="text-xs font-bold text-[var(--muted)]">Record {chunk.index + 1} · ký tự {chunk.start}–{chunk.end}{chunk.heading ? ` · ${chunk.heading}` : ""}</p>{chunk.heading && <p className="mt-1 text-xs font-semibold text-[var(--green)]">Heading kế thừa: {chunk.heading}</p>}<p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">OCR chuẩn hóa · source span</p><pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-6">{preview.source.slice(chunk.start, chunk.end)}</pre><p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">Nội dung đưa vào embedding</p><pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-6">{[selected.title || `Sổ giá - Trang ${selected.pageNumber ?? selected.sourcePageId}`, chunk.heading ? `Nhóm: ${chunk.heading}` : "", chunk.content].filter(Boolean).join("\n")}</pre></Button>{canManage && <label className="mt-2 block max-w-xl text-xs font-bold">Gắn variant đã xác minh<Select value={selected.chunkLinks[`${chunk.start}:${chunk.end}`] ?? ""} onChange={(event) => { const key = `${chunk.start}:${chunk.end}`; const next = { ...selected.chunkLinks }; if (event.target.value) next[key] = Number(event.target.value); else delete next[key]; updateSelected({ chunkLinks: next }); }} className="mt-1 h-10 w-full rounded border border-[var(--line)] bg-white px-2 text-sm font-normal"><option value="">Chưa gắn variant</option>{selected.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}</Select></label>}{focusedChunk === chunk.index && <p className="mt-2 text-xs font-semibold text-[var(--green)]">Source span {chunk.start}–{chunk.end} · revision {selected.revision}.</p>}</li>)}</ol> : <p className="mt-2 text-sm text-[var(--muted)]">Chưa có nội dung để chia record. Nhập và đối chiếu bản chép với ảnh.</p>}</section>}
    </div>
    {zoomOpen && selected && <div ref={zoomDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Ảnh sổ giá phóng to" className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-3 outline-none" onClick={() => setZoomOpen(false)}><Button type="button" onClick={() => setZoomOpen(false)} aria-label="Đóng ảnh phóng to" className="absolute right-4 top-4 z-10 min-h-11 min-w-11 rounded-full bg-white p-3 text-black"><X/></Button><div className="relative h-full max-h-screen w-full max-w-5xl" onClick={(event) => event.stopPropagation()}><Image src={sourceImageUrl} onError={() => void loadSignedSourceImage()} alt={`Ảnh sổ giá phóng to trang ${selected.pageNumber ?? selected.sourcePageId}`} fill unoptimized sizes="100vw" className="object-contain"/></div></div>}
    <p className="mt-5 text-xs leading-5 text-[var(--muted)]">Đối chiếu số lượng, quy cách và giá với ảnh gốc trước khi duyệt. Bản nháp chưa được dùng để trả lời hỏi giá.</p>
  </main>;
}




