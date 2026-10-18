function normalizeQuestion(question: string): string {
  return question
    .toLocaleLowerCase("vi-VN")
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const LIST_INTENT_PATTERNS = [
  /\bco bao nhieu loai\b/u,
  /\bbao nhieu loai\b/u,
  /\bco cac quy cach nao\b/u,
  /\bco nhung quy cach nao\b/u,
  /\bnhung quy cach nao\b/u,
  /\b(?:cac|nhung) quy cach\b/u,
  /\b(?:cac|nhung)?\s*quy cach gi\b/u,
  /\bliet ke (?:cac )?quy cach\b/u,
  /\bgia (?:cac|nhung) quy cach\b/u,
  /\bgia tung quy cach\b/u,
  /\bliet ke (?:cac )?loai\b/u,
];

/** True only for explicit requests to count or list product variants/specifications. */
export function isVariantListIntent(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return LIST_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Recognizes the compact "product has what specifications?" form without involving the planner. */
export function isUnqualifiedVariantListQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return isVariantListIntent(question)
    && !/\b(?:gia|bao gia|so sanh|va|kem theo)\b/u.test(normalized);
}
