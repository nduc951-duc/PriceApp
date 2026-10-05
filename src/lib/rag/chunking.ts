export type TextChunk = { index: number; content: string; start: number; end: number };
export const CHUNKER_VERSION = "lines-1100-overlap160-v1";

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

  const units = normalized.split(/\n+/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    if (trimmed.length <= chunkChars) return [trimmed];
    return trimmed.match(/[^.!?;]+[.!?;]?\s*/g)?.map((part) => part.trim()).filter(Boolean)
      ?? [trimmed];
  });

  const chunks: TextChunk[] = [];
  let current = "";
  let cursor = 0;
  let start = 0;
  const push = () => {
    const content = current.trim();
    if (!content) return;
    const actualStart = normalized.indexOf(content, start);
    const offset = actualStart >= 0 ? actualStart : start;
    chunks.push({ index: chunks.length, content, start: offset, end: offset + content.length });
    cursor = offset + content.length;
    const overlapStart = Math.max(offset, cursor - overlapChars);
    current = normalized.slice(overlapStart, cursor).trim();
    start = overlapStart;
  };

  for (const unit of units) {
    if (unit.length > chunkChars) {
      if (current.trim()) push();
      const unitStart = normalized.indexOf(unit, cursor);
      for (let offset = 0; offset < unit.length; offset += chunkChars - overlapChars) {
        const rawPiece = unit.slice(offset, offset + chunkChars);
        const piece = rawPiece.trim();
        const pieceStart = unitStart + offset + (rawPiece.length - rawPiece.trimStart().length);
        if (piece) chunks.push({ index: chunks.length, content: piece, start: pieceStart, end: pieceStart + piece.length });
      }
      current = "";
      continue;
    }
    const candidate = current ? `${current}\n${unit}` : unit;
    if (candidate.length > chunkChars && current.trim()) push();
    current = current ? `${current}\n${unit}` : unit;
    if (current.length > chunkChars) current = unit;
  }
  if (current.trim()) {
    const content = current.trim();
    const actualStart = normalized.indexOf(content, start);
    const offset = actualStart >= 0 ? actualStart : start;
    chunks.push({ index: chunks.length, content, start: offset, end: offset + content.length });
  }
  return chunks;
}
