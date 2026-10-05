/** Reciprocal rank fusion across vector and lexical variant results. */
export function rankVariantIds(vectorIds: number[], lexicalIds: number[], limit = 12): number[] {
  const scores = new Map<number, { score: number; firstRank: number }>();
  for (const ids of [vectorIds, lexicalIds]) {
    const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
    unique.forEach((id, index) => {
      const previous = scores.get(id) ?? { score: 0, firstRank: index };
      scores.set(id, { score: previous.score + 1 / (60 + index + 1), firstRank: Math.min(previous.firstRank, index) });
    });
  }
  return [...scores].sort((a, b) => b[1].score - a[1].score || a[1].firstRank - b[1].firstRank || a[0] - b[0])
    .slice(0, limit).map(([id]) => id);
}
