import { describe, expect, it } from "vitest";
import { runSequentialOcrBatch, selectOcrBatchPages, type OcrBatchPage } from "./ocr-batch";

const page = (sourcePageId: number, patch: Partial<OcrBatchPage> = {}): OcrBatchPage => ({
  sourcePageId, reviewStatus: "draft", extractedText: "", ...patch,
});

describe("safe sequential OCR batch", () => {
  it("selects only empty draft pages", () => {
    const result = selectOcrBatchPages([page(1), page(2, { extractedText: "\n  \t" }), page(3, { extractedText: "existing" })]);
    expect(result.eligible.map((item) => item.sourcePageId)).toEqual([1, 2]);
    expect(result.skipped).toEqual([{ sourcePageId: 3, status: "skipped", reason: "existing-draft" }]);
  });

  it("skips pages with existing text or reviewed status", () => {
    const result = selectOcrBatchPages([
      page(1, { reviewStatus: "approved" }), page(2, { reviewStatus: "rejected" }), page(3, { extractedText: "already transcribed" }),
    ]);
    expect(result.eligible).toEqual([]);
    expect(result.skipped).toEqual([
      { sourcePageId: 1, status: "skipped", reason: "reviewed" },
      { sourcePageId: 2, status: "skipped", reason: "reviewed" },
      { sourcePageId: 3, status: "skipped", reason: "existing-draft" },
    ]);
  });

  it("processes one page at a time", async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await runSequentialOcrBatch([page(1), page(2), page(3)], async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
    }, () => {});
    expect(maximumActive).toBe(1);
    expect(results.map((result) => result.sourcePageId)).toEqual([1, 2, 3]);
  });

  it("continues after one page fails", async () => {
    const results = await runSequentialOcrBatch([page(1), page(2), page(3)], async (item) => {
      if (item.sourcePageId === 2) throw new Error("OCR timeout");
    }, () => {});
    expect(results).toEqual([
      { sourcePageId: 1, status: "saved" },
      { sourcePageId: 2, status: "failed", error: "OCR timeout" },
      { sourcePageId: 3, status: "saved" },
    ]);
  });
});
