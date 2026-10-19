"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card } from "flowbite-react";
import { Activity, ArrowLeft, Database, LogOut, RefreshCw } from "lucide-react";
import { RagIndexOverview } from "@/components/rag-index-overview";
import { useAuthLogout } from "@/components/auth-actions-context";
import { requestApi, ApiRequestError } from "@/lib/api/client";
import { isRagHealthDiagnostics, type RagHealthDiagnostics } from "@/lib/api/rag-health";
import type { ApiResponse } from "@/lib/api/generated/api-types";
import { fetchRagFeedbackSummary, type RagFeedbackSummary } from "@/lib/api/rag-conversations";

type IndexRun = NonNullable<ApiResponse<"/api/v1/admin/rag/index", "get">["run"]>;
type IndexJob = ApiResponse<"/api/v1/admin/rag/index-job", "get">["job"];
function message(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && error.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (error instanceof ApiRequestError && error.status === 403) return "Chỉ chủ cửa hàng được quản lý chỉ mục RAG.";
  return fallback;
}
export function RagAdmin() {
  const logout = useAuthLogout();
  const [role, setRole] = useState<string | null>(null);
  const [run, setRun] = useState<IndexRun | null>(null);
  const [job, setJob] = useState<IndexJob>(null);
  const [health, setHealth] = useState<RagHealthDiagnostics | null>(null);
  const [feedback, setFeedback] = useState<RagFeedbackSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refreshStatus = useCallback(async () => {
    const [index, queue] = await Promise.all([
      requestApi<ApiResponse<"/api/v1/admin/rag/index", "get">>("/api/v1/admin/rag/index"),
      requestApi<ApiResponse<"/api/v1/admin/rag/index-job", "get">>("/api/v1/admin/rag/index-job"),
    ]);
    setRun(index.run); setJob(queue.job);
  }, []);
  const checkHealth = useCallback(async () => {
    const body = await requestApi<RagHealthDiagnostics>("/api/v1/admin/rag/health", {}, {
      acceptedStatuses: [503], validateAcceptedResponse: isRagHealthDiagnostics,
    });
    if (!isRagHealthDiagnostics(body)) throw new ApiRequestError(502, "INVALID_API_RESPONSE");
    setHealth(body);
  }, []);
  useEffect(() => {
    let active = true;
    void requestApi<ApiResponse<"/api/v1/me", "get">>("/api/v1/me").then(async me => {
      if (!active) return;
      setRole(me.role);
      if (me.role === "owner") {
        await refreshStatus();
        if (active) setFeedback(await fetchRagFeedbackSummary());
      }
    }).catch(cause => { if (active) setError(message(cause, "Không tải được trạng thái catalog RAG. Hãy kiểm tra API/Supabase và thử tải lại.")); });
    return () => { active = false; };
  }, [refreshStatus]);
  useEffect(() => {
    if (role !== "owner" || busy || !(job?.status === "queued" || job?.status === "running" || run?.status === "running")) return;
    const timer = window.setInterval(() => { void refreshStatus().catch(cause => setError(message(cause, "Không cập nhật được tiến độ lập chỉ mục."))); }, 5000);
    return () => window.clearInterval(timer);
  }, [role, busy, job?.status, run?.status, refreshStatus]);
  async function inspect() {
    setBusy(true); setError("");
    try { await Promise.all([refreshStatus(), checkHealth()]); }
    catch (cause) { setError(message(cause, "Không kiểm tra được catalog hoặc dịch vụ AI. Hãy kiểm tra kết nối và thử lại.")); }
    finally { setBusy(false); }
  }
  async function buildIndex() {
    setBusy(true); setError(""); setNotice("");
    try {
      let progress: IndexRun;
      do {
        progress = await requestApi<ApiResponse<"/api/v1/admin/rag/index", "post">>("/api/v1/admin/rag/index", { method: "POST" });
        setRun(progress);
      } while (progress.status === "running");
      setNotice("Đã hoàn tất lập chỉ mục " + progress.chunks + " chunk.");
      await Promise.all([refreshStatus(), checkHealth()]);
    } catch (cause) { setError(message(cause, "Lập chỉ mục catalog thất bại. Kiểm tra Supabase và model embedding; giá và quy cách vẫn được tra trực tiếp từ catalog.")); }
    finally { setBusy(false); }
  }
  function exportFeedback() {
    if (!feedback) return;
    const rows = ["metric,count", "total," + feedback.total, "helpful," + feedback.helpful, "not_helpful," + feedback.notHelpful, ...feedback.reasons.map(item => item.reason + "," + item.count)];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "rag-feedback-summary.csv"; link.click(); URL.revokeObjectURL(url);
  }
  const db = health?.database;
  return <main className="min-h-screen bg-[var(--cream)] p-4 text-[var(--ink)] md:p-8"><div className="mx-auto max-w-5xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><Link href="/staff" className="inline-flex items-center gap-2 text-sm"><ArrowLeft size={16} /> Về khu vực nhân viên</Link><h1 className="mt-3 flex items-center gap-2 text-2xl font-bold"><Database /> RAG từ danh mục Supabase</h1><p className="mt-2 text-sm text-[var(--muted)]">Tra cứu giá, quy cách và đóng gói từ dữ liệu đã xác minh của cửa hàng.</p></div><Button color="light" onClick={logout ?? undefined}><LogOut size={16} className="mr-2" /> Đăng xuất</Button></header>
    {error && <Alert color="failure" role="alert">{error}</Alert>}
    {notice && <Alert color="success" role="status">{notice}</Alert>}
    <Card className="dark:bg-slate-800 dark:text-white"><h2 className="text-lg font-bold">Nguồn dữ liệu</h2><p className="text-sm leading-6">Sản phẩm, biến thể, thuộc tính và đóng gói lấy từ các dòng catalog đã xác minh trong Supabase. Giá được đọc lại ở mỗi câu hỏi. Embedding hỗ trợ tìm kiếm ngữ nghĩa; tra giá cụ thể và thông tin quy cách không cần chờ embedding.</p><Link href="/staff/prices" className="font-semibold text-[var(--green)] underline dark:text-sky-300">Mở quản lý bảng giá</Link><Link href="/questions" className="font-semibold text-[var(--green)] underline dark:text-sky-300">Thử hỏi giá và quy cách</Link></Card>
    {role === null && !error && <p role="status">Đang tải quyền truy cập…</p>}
    {role !== null && role !== "owner" && <Alert color="info">Chủ cửa hàng quản lý chỉ mục và kiểm tra kết nối. Bạn có thể tra cứu danh mục tại màn hình hỏi đáp.</Alert>}
    {role === "owner" && <>
      <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={inspect}><Activity size={16} className="mr-2" /> {busy ? "Đang xử lý…" : "Kiểm tra kết nối và dữ liệu"}</Button><Button color="light" disabled={busy} onClick={buildIndex}><RefreshCw size={16} className="mr-2" /> {run?.status === "running" ? "Chạy tiếp chỉ mục catalog" : "Tạo lại embedding catalog"}</Button></div>
      <section className="grid gap-4 md:grid-cols-3" aria-label="Thống kê chỉ mục">
        <Card className="dark:bg-slate-800 dark:text-white"><h2 className="font-semibold">Biến thể đã xác minh</h2><p className="text-3xl font-bold">{db?.ok ? db.catalogVariants ?? "—" : "—"}</p><p className="text-sm">Nguồn tra cứu trực tiếp trong Supabase</p></Card>
        <Card className="dark:bg-slate-800 dark:text-white"><h2 className="font-semibold">Chunk catalog đang dùng</h2><p className="text-3xl font-bold">{db?.ok ? db.count : "—"}</p><p className="text-sm">Generation {db?.ok ? db.activeGeneration ?? "chưa có" : "chưa kiểm tra"}</p></Card>
        <Card className="dark:bg-slate-800 dark:text-white"><h2 className="font-semibold">Biến thể đã embedding</h2><p className="text-3xl font-bold">{db?.ok ? db.embeddedVariants ?? "—" : "—"}</p><p className="text-sm">{db?.ok ? (db.missingVariants ?? "—") + " biến thể chưa có vector với model hiện tại" : "Bấm kiểm tra để đọc trạng thái thực tế"}</p></Card>
      </section>
      {health && <Card className="dark:bg-slate-800 dark:text-white"><h2 className="text-lg font-bold">Kết nối dịch vụ</h2>{([["Supabase", health.database], ["Embedding", health.embedding], ["Chat", health.chat]] as const).map(([label, check]) => <div key={label} className="flex flex-wrap items-center gap-2"><Badge color={check.ok ? "success" : "failure"}>{label}: {check.ok ? "Sẵn sàng" : "Chưa sẵn sàng"}</Badge><span className="text-sm">{check.ok ? label === "Supabase" ? "Đọc được catalog và chỉ mục hiện hành." : check.detail : "Kiểm tra cấu hình và kết nối dịch vụ."}</span></div>)}{!health.chat.ok && <p className="text-sm">Chat chưa sẵn sàng: câu hỏi tra giá cụ thể và quy cách vẫn có thể dùng dữ liệu catalog.</p>}</Card>}
      <RagIndexOverview run={run} job={job} />
      {feedback && <Card className="dark:bg-slate-800 dark:text-white"><h2 className="text-lg font-bold">Phản hồi hỏi đáp</h2><p>{feedback.total} đánh giá · {feedback.helpful} hữu ích · {feedback.notHelpful} cần xem lại</p>{feedback.reasons.map(reason => <p key={reason.reason} className="text-sm">{reason.reason}: {reason.count}</p>)}<Button color="light" onClick={exportFeedback}>Xuất CSV phản hồi</Button></Card>}
    </>}
  </div></main>;
}
