export type OcrBatchPage = {
  sourcePageId: number;
  reviewStatus: "draft" | "approved" | "rejected";
  extractedText: string;
};

export type OcrBatchSkipReason = "existing-draft" | "reviewed";
export type OcrBatchResult =
  | { sourcePageId: number; status: "saved" }
  | { sourcePageId: number; status: "failed"; error: string }
  | { sourcePageId: number; status: "skipped"; reason: OcrBatchSkipReason };

export function selectOcrBatchPages<TPage extends OcrBatchPage>(pages: TPage[]) {
  const eligible: TPage[] = [];
  const skipped: Extract<OcrBatchResult, { status: "skipped" }>[] = [];
  for (const page of pages) {
    if (page.reviewStatus !== "draft") skipped.push({ sourcePageId: page.sourcePageId, status: "skipped", reason: "reviewed" });
    else if (page.extractedText.trim()) skipped.push({ sourcePageId: page.sourcePageId, status: "skipped", reason: "existing-draft" });
    else eligible.push(page);
  }
  return { eligible, skipped };
}

export async function runSequentialOcrBatch<TPage extends OcrBatchPage>(
  pages: TPage[],
  processPage: (page: TPage) => Promise<void>,
  onResult: (result: OcrBatchResult) => void | Promise<void>,
): Promise<OcrBatchResult[]> {
  const selection = selectOcrBatchPages(pages);
  const results: OcrBatchResult[] = [];
  for (const result of selection.skipped) {
    results.push(result);
    await onResult(result);
  }
  for (const page of selection.eligible) {
    let result: OcrBatchResult;
    try {
      await processPage(page);
      result = { sourcePageId: page.sourcePageId, status: "saved" };
    } catch (cause) {
      result = {
        sourcePageId: page.sourcePageId,
        status: "failed",
        error: cause instanceof Error && cause.message.trim() ? cause.message : "Không xử lý được trang này.",
      };
    }
    results.push(result);
    await onResult(result);
  }
  const sourceOrder = new Map(pages.map((page, index) => [page.sourcePageId, index]));
  return results.sort((left, right) => (sourceOrder.get(left.sourcePageId) ?? 0) - (sourceOrder.get(right.sourcePageId) ?? 0));
}
