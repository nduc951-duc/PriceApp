import { describe, expect, it } from "vitest";
import { chunkText } from "./chunking";

describe("chunkText", () => {
  it("returns nothing for blank input and preserves Vietnamese text", () => {
    expect(chunkText("  \n ")).toEqual([]);
    expect(chunkText("Giá sỉ tắc kê sắt 8 ly\nTrang 1")[0]?.content).toContain("tắc kê sắt 8 ly");
  });

  it("splits long text into bounded chunks with continuity overlap", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `Dòng ${index + 1}: tắc kê sắt 8 ly và thông tin quy cách.`);
    const text = lines.join("\n");
    const chunks = chunkText(text, 220, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 220)).toBe(true);
    expect(lines.every((line) => chunks.some((chunk) => chunk.content.includes(line)))).toBe(true);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
    expect(chunks[1]?.start).toBeLessThan(chunks[0]!.end);
  });

  it("returns source offsets into the normalized text when lines are indented or repeated", () => {
    const lines = Array.from({ length: 18 }, (_, index) => `   Tắc kê 8 ly dòng ${index + 1} có quy cách`);
    const input = `  ${lines.join("\r\n")}`;
    const normalized = lines.map((line) => line.trim()).join("\n");

    for (const chunk of chunkText(input, 200, 20)) {
      expect(normalized.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
    expect(chunkText(input, 200, 20).length).toBeGreaterThan(1);
  });
});
