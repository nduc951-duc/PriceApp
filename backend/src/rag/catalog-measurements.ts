const number = "\\d+(?:[.,]\\d+)?";
const unit = "(?:mm|cm|ly|li|phân|phan|tấc|tac|f|t|m)";
const measurement = `${number}\\s*${unit}(?:\\s*\\d(?=$|[^\\p{L}\\p{N}]))?`;

function millimeters(value: string): string {
  const match = /^(\d+(?:[.,]\d+)?)\s*(mm|cm|ly|li|phân|phan|tấc|tac|f|t|m)?\s*(\d)?$/iu.exec(value.trim());
  if (!match) return value;
  const scale = /^(?:f|cm|phân|phan)$/iu.test(match[2] ?? "") ? 10
    : /^(?:t|tấc|tac)$/iu.test(match[2] ?? "") ? 100 : match[2]?.toLowerCase() === "m" ? 1000 : 1;
  return String(Number((Number(match[1]!.replace(",", ".")) * scale + Number(match[3] ?? 0) * scale / 10).toFixed(6)));
}

/** Search-time normalization only; the stored catalog spelling is never changed. */
export function canonicalCatalogQuery(value: string): string {
  return value
    .replace(new RegExp(`(?<![\\p{L}\\p{N}])(${number}\\s*(?:${unit})?)\\s*[x×]\\s*(${number}\\s*(?:${unit})?(?:\\d)?)(?![\\p{L}\\p{N}])`, "giu"), (_all, diameter: string, length: string) => `${millimeters(diameter)}x${millimeters(length)}`)
    .replace(new RegExp(`(?<![\\p{L}\\p{N}])(${number}\\s*(?:ly|li|mm))\\s+(${measurement})(?![\\p{L}\\p{N}])`, "giu"), (_all, diameter: string, length: string) => `${millimeters(diameter)}x${millimeters(length)}`)
    .replace(new RegExp(`(?<![\\p{L}\\p{N}])(${number}\\s*(?:ly|li|mm))\\s+(${number})(?![\\p{L}\\p{N}])`, "giu"), (_all, diameter: string, length: string) => `${millimeters(diameter)}x${millimeters(length)}`)
    .replace(new RegExp(`(?<![\\p{L}\\p{N}])(${measurement})(?![\\p{L}\\p{N}])`, "giu"), (value) => `${millimeters(value)} mm`);
}
