export type VariantReference =
  | { kind: "none" }
  | { kind: "resolved"; variantIds: number[]; ordinal: number }
  | { kind: "ambiguous"; variantIds: number[] }
  | { kind: "missing"; ordinal: number };

function normalize(value: string) {
  return value.toLocaleLowerCase("vi-VN").replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const ORDINALS: Record<string, number> = {
  dau: 1, "dau tien": 1, nhat: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5,
  sau: 6, bay: 7, tam: 8, chin: 9, muoi: 10,
};

function ordinalNumber(value: string) {
  const normalized = value.trim();
  return /^\d{1,2}$/u.test(normalized) ? Number(normalized) : ORDINALS[normalized] ?? null;
}

/** Resolves user references only against IDs from the previously validated result. */
export function resolveVariantReference(question: string, previousVariantIds: number[]): VariantReference {
  const ids = [...new Set(previousVariantIds.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 40);
  const text = normalize(question);
  if (!ids.length) return { kind: "none" };

  const ordinal = text.match(/\b(?:loai|quy cach|mat hang|san pham|cai|mon)\s+(?:thu\s+)?(dau tien|dau|nhat|hai|ba|bon|tu|nam|sau|bay|tam|chin|muoi|\d{1,2})\b/u);
  if (ordinal?.[1]) {
    const index = ordinalNumber(ordinal[1]);
    if (index === null) return { kind: "none" };
    return index <= ids.length
      ? { kind: "resolved", variantIds: [ids[index - 1]!], ordinal: index }
      : { kind: "missing", ordinal: index };
  }

  if (/\b(?:hai|ca|cac|nhung) (?:loai|quy cach|mat hang)(?: do| kia| nay)\b/u.test(text)) {
    return { kind: "resolved", variantIds: ids, ordinal: 0 };
  }
  const singular = /\b(?:loai|quy cach|mat hang|san pham|cai|mon)\s+(?:do|nay|kia|ay)\b/u.test(text)
    || /\b(?:cai do|mon do|san pham do)\b/u.test(text);
  if (!singular) return { kind: "none" };
  if (ids.length === 1) return { kind: "resolved", variantIds: [ids[0]!], ordinal: 1 };
  if (/\b(?:loai|quy cach|mat hang|cai|mon) kia\b/u.test(text) && ids.length === 2) {
    return { kind: "resolved", variantIds: [ids[1]!], ordinal: 2 };
  }
  return { kind: "ambiguous", variantIds: ids };
}
