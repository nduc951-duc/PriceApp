"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Progress } from "flowbite-react";
import { requestApi } from "@/lib/api/client";
import type { ApiResponse } from "@/lib/api/generated/api-types";

type Run = ApiResponse<"/api/v1/admin/rag/index", "get">["run"];
type Job = ApiResponse<"/api/v1/admin/rag/index-job", "get">["job"];
type ChunkPage = ApiResponse<"/api/v1/admin/rag/chunks/{page}", "get">;
const labels: Record<string, string> = { queued: "Đang chờ lập chỉ mục", running: "Đang lập chỉ mục", completed: "Đã hoàn tất", failed: "Lập chỉ mục chưa hoàn tất" };

export function RagIndexOverview({ run, job }: { run: Run; job: Job }) {
  const [page, setPage] = useState(1);
  const [chunks, setChunks] = useState<ChunkPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void requestApi<ChunkPage>(`/api/v1/admin/rag/chunks/${page}`)
      .then(data => { if (active) { setChunks(data); setError(""); } })
      .catch(() => { if (active) setError("Không tải được các chunk đã lập. Vui lòng thử lại."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, retry, run?.runId, run?.status]);
  function changePage(next: number) { setLoading(true); setError(""); setPage(next); }
  const pending = job?.status === "queued" || job?.status === "running";
  const status = run?.status === "running" ? "running" : pending ? job.status : run?.status ?? job?.status;
  const done = pending && run?.status !== "running" ? 0 : run?.checkpoint ?? 0;
  const total = run?.chunks ?? 0;
  const progress = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
  const pages = chunks ? Math.max(1, Math.ceil(chunks.total / chunks.pageSize)) : 1;
  return <>
    <Card className="dark:bg-slate-800 dark:text-white">
      <h2 className="text-lg font-bold">Tiến độ lập chỉ mục</h2>
      <p role="status">{status ? labels[status] : "Chưa lập chỉ mục"}</p>
      <Progress aria-label="Tiến độ lập chỉ mục" progress={progress} color="blue" />
      <p className="text-sm tabular-nums">{done} / {total} chunk</p>
      {status === "failed" && <Alert color="failure">Lập chỉ mục bị gián đoạn. Bạn có thể chạy lại để tiếp tục.</Alert>}
    </Card>
    <Card className="dark:bg-slate-800 dark:text-white">
      <h2 className="text-lg font-bold">Các chunk đã lập chỉ mục</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">Nội dung trong chỉ mục đang được dùng để tìm kiếm.</p>
      {loading && <p role="status">Đang tải chunk…</p>}
      {error ? <Alert color="failure">{error}<Button color="light" onClick={() => { setLoading(true); setError(""); setRetry(value => value + 1); }} className="mt-2">Thử lại</Button></Alert> : !loading && chunks && <>
        <p className="text-sm">{chunks.total} chunk đã lập chỉ mục</p>
        {chunks.items.length === 0 ? <p>Chưa có chunk trong chỉ mục đang dùng.</p> : <div className="space-y-3">{chunks.items.map(chunk => <article key={chunk.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-600">
          <h3 className="font-semibold">{[chunk.productName, chunk.variantName].filter(Boolean).join(" · ") || "Chunk " + chunk.id}</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{chunk.content}</p>
        </article>)}</div>}
        {pages > 1 && <nav aria-label="Phân trang chunk" className="flex flex-wrap items-center justify-between gap-3">
          <Button color="light" disabled={page <= 1} onClick={() => changePage(page - 1)}>Trang trước</Button>
          <span className="text-sm">Trang {page} / {pages}</span>
          <Button color="light" disabled={page >= pages} onClick={() => changePage(page + 1)}>Trang sau</Button>
        </nav>}
      </>}
    </Card>
  </>;
}
