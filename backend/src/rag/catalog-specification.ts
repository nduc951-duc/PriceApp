function normalizeDiacritics(value: string): string {
  return value.toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "");
}

function normalizeWords(value: string): string[] {
  return normalizeDiacritics(value).match(/[a-z0-9]+/gu) ?? [];
}

function cleanNumber(value: string): string {
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) ? String(number) : value;
}

function screwDimensions(specification: string): { diameter: string; length: string } | null {
  const number = "(\\d+(?:[.,]\\d+)?)";
  const joined = new RegExp(`^\\s*${number}\\s*(?:(?:ly|li|mm)\\s*)?[x×]\\s*${number}\\s*(?:mm)?\\s*$`, "iu").exec(specification);
  const spaced = new RegExp(`^\\s*${number}\\s*(?:ly|li)\\s+${number}\\s*(?:mm)?\\s*$`, "iu").exec(specification);
  const match = joined ?? spaced;
  if (!match?.[1] || !match[2]) return null;
  return { diameter: cleanNumber(match[1]), length: cleanNumber(match[2]) };
}

function measurementMeaning(value: string): string | null {
  const code = /(?:^|[^\p{L}\p{N}])(\d+)\s*([ft])\s*(\d)(?=$|[^\p{L}\p{N}])/iu.exec(value);
  if (code?.[1] && code[2] && code[3]) {
    const marker = code[2].toUpperCase();
    const notation = `${code[1]}${marker}${code[3]}`;
    const millimeters = marker === "T"
      ? Number(code[1]) * 100 + Number(code[3]) * 10
      : Number(code[1]) * 10 + Number(code[3]);
    const unit = marker === "T" ? "tấc" : "phân";
    return `ký hiệu ${unit} ${notation} tương đương ${millimeters} mm`;
  }

  const spokenTac = /(?:^|[^\p{L}\p{N}])(\d+)\s*tac\s*(\d)(?=$|[^\p{L}\p{N}])/iu.exec(normalizeDiacritics(value));
  if (spokenTac?.[1] && spokenTac[2]) {
    const notation = `${spokenTac[1]}T${spokenTac[2]}`;
    const millimeters = Number(spokenTac[1]) * 100 + Number(spokenTac[2]) * 10;
    return `ký hiệu tấc ${notation} tương đương ${millimeters} mm`;
  }

  return null;
}

/** Interpret only the catalog size conventions confirmed for this business. */
export function catalogSpecificationMeaning(specification: string | null | undefined, productIdentity: Array<string | null | undefined>): string | null {
  const value = specification?.trim();
  if (!value) return null;

  const measurement = measurementMeaning(value);
  if (measurement) return measurement;

  const identityWords = productIdentity.flatMap((identity) => normalizeWords(identity ?? ""));
  if (!identityWords.includes("vit")) return null;
  const dimensions = screwDimensions(value);
  return dimensions
    ? `đường kính ${dimensions.diameter} ly (${dimensions.diameter} mm), chiều dài ${dimensions.length} mm`
    : null;
}
