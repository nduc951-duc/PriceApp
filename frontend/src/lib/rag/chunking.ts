export type TextChunk = { index: number; content: string; start: number; end: number };
export const CHUNKER_VERSION = "lines-1100-overlap160-v2";

const DEFAULT_CHUNK_CHARS = 1_100;
const DEFAULT_OVERLAP_CHARS = 160;

/** Canonical text used by chunk offsets and the review preview. */
export function normalizeChunkSource(input: string): string {
  return input.normalize("NFC").replace(/\0/g, "").replace(/\r\n?/g, "\n")
    .split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

/** Splits reviewed page text on line/sentence boundaries, then adds a small overlap. */
export function chunkText(
  input: string,
  chunkChars = DEFAULT_CHUNK_CHARS,
  overlapChars = DEFAULT_OVERLAP_CHARS,
): TextChunk[] {
  if (!Number.isInteger(chunkChars) || chunkChars < 200) throw new Error("chunkChars must be at least 200");
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= chunkChars) {
    throw new Error("overlapChars must be smaller than chunkChars");
  }

  const normalized = normalizeChunkSource(input);
  if (!normalized) return [];

  const units: Array<{ start: number; end: number }> = [];
  const addUnit = (start: number, end: number) => {
    const raw = normalized.slice(start, end);
    const content = raw.trim();
    if (!content) return;
    const offset = start + raw.length - raw.trimStart().length;
    units.push({ start: offset, end: offset + content.length });
  };
  for (const line of normalized.matchAll(/[^\n]+/g)) {
    if (line[0].length <= chunkChars) {
      addUnit(line.index, line.index + line[0].length);
      continue;
    }
    for (const sentence of line[0].matchAll(/[^.!?;]+[.!?;]?\s*|[.!?;]+\s*/g)) {
      addUnit(line.index + sentence.index, line.index + sentence.index + sentence[0].length);
    }
  }

  const chunks: TextChunk[] = [];
  let currentStart: number | null = null;
  let currentEnd = 0;
  const emit = (start: number, end: number) => {
    const raw = normalized.slice(start, end);
    const content = raw.trim();
    if (!content) return null;
    const offset = start + raw.length - raw.trimStart().length;
    const chunk = { index: chunks.length, content, start: offset, end: offset + content.length };
    chunks.push(chunk);
    return chunk;
  };
  const push = () => {
    if (currentStart === null) return;
    const chunk = emit(currentStart, currentEnd);
    if (!chunk) { currentStart = null; return; }
    const overlapStart = Math.max(chunk.start, chunk.end - overlapChars);
    const overlap = normalized.slice(overlapStart, chunk.end);
    currentStart = overlap.trim() ? overlapStart + overlap.length - overlap.trimStart().length : null;
    currentEnd = chunk.end;
  };

  for (const unit of units) {
    if (unit.end - unit.start > chunkChars) {
      push();
      for (let start = unit.start; start < unit.end; start += chunkChars - overlapChars) {
        emit(start, Math.min(start + chunkChars, unit.end));
      }
      currentStart = null;
      continue;
    }
    if (currentStart !== null && unit.end - currentStart > chunkChars) push();
    if (currentStart === null || unit.end - currentStart > chunkChars) currentStart = unit.start;
    currentEnd = unit.end;
  }
  push();
  return chunks;
}
