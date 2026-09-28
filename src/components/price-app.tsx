"use client";

import { useEffect, useMemo, useState } from "react";
import {
  History,
  Home,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Package,
  Pencil,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { cacheSnapshot, readSnapshot } from "@/features/offline/cache";
import { formatVnd, priceSchema } from "@/features/pricing/validation";
import { matchesCatalogQuery } from "@/features/search/parser";
import { createClient } from "@/lib/supabase/client";

type Item = {
  id: number;
  priceId: number;
  categoryId: number;
  productId: number;
  variantId: number;
  packagingId: number;
  name: string;
  category: string;
  variantDisplayName: string;
  spec: string;
  variantSpec: string;
  packageName: string;
  packageQuantity: number;
  packageNote: string;
  priceType: string;
  minimumQuantity: number;
  price: number;
  unit: string;
  supplier: string;
  sourcePages: number[];
  sourceFiles: string[];
  status: "verified" | "needs_review" | "unreadable";
  version: number;
};
type ProductGroup = {
  name: string;
  category: string;
  items: Item[];
  variants: string[];
  minPrice: number | null;
  maxPrice: number | null;
  wholesaleFrom: number | null;
  smallestRetailPackage: number | null;
  unit: string | null;
};
type CatalogEntry = {
  categoryId: number;
  productId: number;
  variantId: number;
  name: string;
  category: string;
  spec: string;
  displayName: string;
  sourcePages: number[];
  sourceFiles: string[];
};
type PriceRow = {
  id: number;
  amount: number | string;
  version: number;
  price_type: string;
  minimum_quantity: number | string;
  active: boolean;
  price_lists: { suppliers: { name: string } | null } | null;
};
type PackageRow = {
  id: number;
  name: string;
  quantity: number | string;
  base_unit: string;
  note: string | null;
  prices: PriceRow[];
};
type VariantRow = {
  id: number;
  display_name: string;
  raw_specification: string | null;
  verification_status: Item["status"];
  products: { id: number; name: string; categories: { id: number; name: string } | null } | null;
  packaging_options: PackageRow[];
  variant_sources: { source_pages: { page_number: number | null; storage_path:string } | null }[];
};
type UndoEntry = {
  itemId: number;
  historyId: number;
  oldAmount: number;
  expectedVersion: number;
};
type InvoiceLine = {
  key: string;
  item: Item;
  requestedQuantity: number;
  packageCount: number;
  unitPrice: number;
  total: number;
};
type CatalogEditor = {
  categoryId: number;
  categoryName: string;
  productId: number;
  productName: string;
  variantId: number;
  variantDisplayName: string;
  rawSpecification: string;
  packagingId: number | null;
  packageName: string;
  packageQuantity: string;
  baseUnit: string;
  priceId: number | null;
  priceType: string;
  minimumQuantity: string;
  amount: string;
  expectedVersion: number | null;
};

function variantFamily(specification: string) {
  const normalized = specification.trim();
  const dimension = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:ly\s*x\s*|x)/i);
  if (dimension) return `${dimension[1]} ly`;
  const ly = normalized.match(/^(\d+(?:\.\d+)?)\s*ly\b/i);
  if (ly) return `${ly[1]} ly`;
  const code = normalized.match(/^(\d+(?:F\d*|T\d*))(?=\b|\s|$)/i);
  if (code) return code[1].toUpperCase();
  if (/^m[oÃ³]c\b/i.test(normalized)) return "MÃ³c";
  return null;
}

function variantChoiceLabel(specification: string, family: string) {
  if (family === "MÃ³c") return specification;
  const escapedFamily = family.replace(" ly", "");
  return (
    specification
      .replace(new RegExp(`^${escapedFamily}\\s*(?:ly\\s*x\\s*|x|ly\\s*)`, "i"), "")
      .trim() || specification
  );
}

function compareVariantChoices(a: string, b: string, family: string) {
  const labelA = variantChoiceLabel(a, family);
  const labelB = variantChoiceLabel(b, family);
  const numberA = Number.parseFloat(labelA.replace(",", "."));
  const numberB = Number.parseFloat(labelB.replace(",", "."));
  if (Number.isFinite(numberA) && Number.isFinite(numberB) && numberA !== numberB)
    return numberA - numberB;
  const thicknessRank = (label: string) =>
    /m[oá»]ng/i.test(label) ? 0 : /d[aÃ ]y/i.test(label) ? 1 : 0;
  const rankDifference = thicknessRank(labelA) - thicknessRank(labelB);
  return rankDifference || labelA.localeCompare(labelB, "vi", { numeric: true });
}

function specificationSortValue(specification: string) {
  const normalized = specification.trim().toUpperCase();
  const phan = normalized.match(/^(\d+)F(\d*)$/);
  if (phan) return Number(phan[1]) + (phan[2] ? Number(`0.${phan[2]}`) : 0);
  const tac = normalized.match(/^(\d+)T(\d*)$/);
  if (tac) return Number(tac[1]) * 10 + (tac[2] ? Number(tac[2]) : 0);
  const numeric = Number.parseFloat(normalized.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function compareSpecifications(a: string, b: string) {
  const numberA = specificationSortValue(a);
  const numberB = specificationSortValue(b);
  if (numberA !== null && numberB !== null && numberA !== numberB)
    return numberA - numberB;
  if (numberA !== null && numberB === null) return -1;
  if (numberA === null && numberB !== null) return 1;
  return a.localeCompare(b, "vi", { numeric: true });
}

function displaySpecification(specification: string) {
  return specification
    .replace(/^1T$/i, "1 táº¥c")
    .replace(/\bmong\b/gi, "má»ng")
    .replace(/\bday\b/gi, "dÃ y")
    .replace(/\bmoc\b/gi, "mÃ³c");
}

function displayPackageName(packageName: string) {
  const legacyNames: Record<string, string> = {
    "Láº» 10 con": "10 con/bá»‹ch",
    "Bá»‹ch 95 con": "95 con/bá»‹ch",
    "Há»™p 50 con": "50 con/há»™p",
    "Láº» 1 con": "1 con",
    "GÃ³i nhá» 100 con": "100 con/gÃ³i",
    "Bá»‹ch lá»›n 1.000 con": "1.000 con/bá»‹ch",
    "Láº» 1 bÃ¡nh": "1 bÃ¡nh/cÃ¡i",
    "Le 10 bo": "10 bá»™/bá»‹ch",
    "Bich 100 bo": "100 bá»™/bá»‹ch",
    "Le 1 met": "1 mÃ©t",
    "Cuon 100 met": "100 mÃ©t/cuá»™n",
  };
  return legacyNames[packageName] ?? packageName;
}

function displayItemPackageName(item: Item) {
  if (item.name === "MÃ³c U") {
    if (item.packageQuantity === 10) return "10 con/bá»‹ch";
    if (item.packageQuantity === 100) return "100 con/bá»‹ch";
    if (item.packageQuantity === 1) return "1 con";
  }
  return displayPackageName(item.packageName);
}

function displayPriceType(item: Item) {
  if (item.name === "MÃ³c U")
    return item.priceType === "wholesale" ? "GiÃ¡ sá»‰" : "GiÃ¡ láº»";
  if (item.packageName.startsWith("Äáº§u trÃ²n + lÃ¡")) return "Äáº§u trÃ²n + lÃ¡";
  if (item.packageName.startsWith("Äáº§u dÃ¹")) return "Äáº§u dÃ¹";
  return item.priceType === "wholesale" ? "GiÃ¡ sá»‰" : "GiÃ¡ láº»";
}

const recent = ["bulong 8ly 3f", "tac ke 6x50", "day cap inox 6 ly"];
export function PriceApp() {
  const [supabase] = useState(() => createClient());
  const [items, setItems] = useState<Item[]>([]);
  const [catalogEntries, setCatalogEntries] = useState<CatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [synced, setSynced] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<UndoEntry[]>([]);
  const [selected, setSelected] = useState<{
    name: string;
    spec: string;
  } | null>(null);
  const [packageCounts, setPackageCounts] = useState<Record<number, string>>({});
  const [invoice, setInvoice] = useState<InvoiceLine[]>([]);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceReady, setInvoiceReady] = useState(false);
  const [openingSource, setOpeningSource] = useState<string | null>(null);
  const [sourceImageError, setSourceImageError] = useState("");
  const [catalogEditor, setCatalogEditor] = useState<CatalogEditor | null>(null);
  const [savingCatalog, setSavingCatalog] = useState(false);
  const [variantFamilyFilters, setVariantFamilyFilters] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const updateNetwork = () => setOnline(navigator.onLine);
    updateNetwork();
    addEventListener("online", updateNetwork);
    addEventListener("offline", updateNetwork);
    async function load() {
      if (!navigator.onLine || !supabase) {
        const cached = await readSnapshot<Item[]>("catalog");
        if (cached) {
          setItems(cached.data);
          setSynced(cached.syncedAt);
        }
        const cachedEntries = await readSnapshot<CatalogEntry[]>("catalog-entries");
        if (cachedEntries) setCatalogEntries(cachedEntries.data);
        setLoading(false);
        return;
      }
      const { data, error: loadError } = await supabase
        .from("product_variants")
        .select(
          `
        id, display_name, raw_specification, verification_status,
        products!inner(id, name, categories!inner(id, name)),
        variant_sources(source_pages(page_number, storage_path)),
        packaging_options(id, name, quantity, base_unit, note,
          prices(id, amount, version, price_type, minimum_quantity, active, price_lists(suppliers(name)))
        )
      `,
        )
        .eq("active", true)
        .neq("verification_status", "sample")
        .limit(1000);
      if (loadError) {
        setError(`KhÃ´ng táº£i Ä‘Æ°á»£c báº£ng giÃ¡: ${loadError.message}`);
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as unknown as VariantRow[];
      const entries = rows.map((variant) => ({
        categoryId: variant.products?.categories?.id ?? 0,
        productId: variant.products?.id ?? 0,
        variantId: variant.id,
        name: variant.products?.name ?? variant.display_name,
        category: variant.products?.categories?.name ?? "ChÆ°a phÃ¢n nhÃ³m",
        spec: variant.raw_specification ?? variant.display_name,
        displayName: variant.display_name,
        sourcePages: variant.variant_sources
          .map((source) => source.source_pages?.page_number)
          .filter((page): page is number => page !== null && page !== undefined),
        sourceFiles: variant.variant_sources
          .map((source) => source.source_pages?.storage_path)
          .filter((path): path is string => Boolean(path)),
      }));
      const loaded = rows.flatMap((variant) =>
        variant.packaging_options.flatMap((pack) =>
          pack.prices.filter((price) => price.active).map((price) => ({
            id: price.id,
            priceId: price.id,
            categoryId: variant.products?.categories?.id ?? 0,
            productId: variant.products?.id ?? 0,
            variantId: variant.id,
            packagingId: pack.id,
            name: variant.products?.name ?? variant.display_name,
            category: variant.products?.categories?.name ?? "ChÆ°a phÃ¢n nhÃ³m",
            variantDisplayName: variant.display_name,
            spec: `${variant.raw_specification ?? variant.display_name} â€¢ ${pack.name}`,
            variantSpec: variant.raw_specification ?? variant.display_name,
            packageName: pack.name,
            packageQuantity: Number(pack.quantity),
            packageNote: pack.note ?? "",
            priceType: price.price_type,
            minimumQuantity: Number(price.minimum_quantity),
            price: Number(price.amount),
            unit: pack.base_unit,
            supplier:
              price.price_lists?.suppliers?.name ?? "ChÆ°a rÃµ nhÃ  cung cáº¥p",
            sourcePages: variant.variant_sources
              .map((source) => source.source_pages?.page_number)
              .filter((page): page is number => page !== null && page !== undefined),
            sourceFiles: variant.variant_sources
              .map((source) => source.source_pages?.storage_path)
              .filter((path): path is string => Boolean(path)),
            status: variant.verification_status,
            version: price.version,
          })),
        ),
      );
      setItems(loaded);
      setCatalogEntries(entries);
      await cacheSnapshot("catalog", loaded);
      await cacheSnapshot("catalog-entries", entries);
      setSynced(new Date().toISOString());
      setLoading(false);
    }
    load();
    return () => {
      removeEventListener("online", updateNetwork);
      removeEventListener("offline", updateNetwork);
    };
  }, [supabase]);

  const groups = useMemo<ProductGroup[]>(() => {
    const grouped = new Map<string, { entries: CatalogEntry[]; items: Item[] }>();
    for (const entry of catalogEntries) {
      const key = `${entry.category}\u0000${entry.name}`;
      const group = grouped.get(key) ?? { entries: [], items: [] };
      group.entries.push(entry);
      grouped.set(key, group);
    }
    for (const item of items) {
      const key = `${item.category}\u0000${item.name}`;
      const group = grouped.get(key) ?? { entries: [], items: [] };
      group.items.push(item);
      if (!group.entries.some((entry) => entry.spec === item.variantSpec))
        group.entries.push({
          name: item.name,
          category: item.category,
          spec: item.variantSpec,
          categoryId: item.categoryId,
          productId: item.productId,
          variantId: item.variantId,
          displayName: item.variantDisplayName,
          sourcePages: item.sourcePages,
          sourceFiles: item.sourceFiles,
        });
      grouped.set(key, group);
    }
    return [...grouped.values()]
      .map(({ entries, items: groupItems }) => ({
        name: entries[0].name,
        category: entries[0].category,
        items: groupItems,
        variants: [...new Set(entries.map((entry) => entry.spec))],
        minPrice:
          groupItems.length > 0
            ? Math.min(...groupItems.map((item) => item.price))
            : null,
        maxPrice:
          groupItems.length > 0
            ? Math.max(...groupItems.map((item) => item.price))
            : null,
        wholesaleFrom: groupItems.some(
          (item) =>
            item.priceType === "wholesale" &&
            !item.packageNote.includes("ChÆ°a rÃµ sá»‘ lÆ°á»£ng tá»‘i thiá»ƒu"),
        )
          ? Math.min(
              ...groupItems
                .filter(
                  (item) =>
                    item.priceType === "wholesale" &&
                    !item.packageNote.includes("ChÆ°a rÃµ sá»‘ lÆ°á»£ng tá»‘i thiá»ƒu"),
                )
                .map((item) => item.packageQuantity),
            )
          : null,
        smallestRetailPackage: groupItems.some(
          (item) => item.priceType === "retail",
        )
          ? Math.min(
              ...groupItems
                .filter((item) => item.priceType === "retail")
                .map((item) => item.packageQuantity),
            )
          : null,
        unit: groupItems[0]?.unit ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [catalogEntries, items]);
  const shown = useMemo(() => {
    return query.trim()
      ? groups.filter((group) =>
          matchesCatalogQuery(query, `${group.name} ${group.variants.join(" ")}`),
        )
      : groups;
  }, [groups, query]);
  const selectedPrices = selected
    ? items.filter(
        (item) =>
          item.name === selected.name && item.variantSpec === selected.spec,
      )
    : [];
  const selectedCatalogEntries = selected
    ? catalogEntries.filter(
        (entry) =>
          entry.name === selected.name && entry.spec === selected.spec,
      )
    : [];
  const selectedSourcePages = [
    ...new Set([
      ...selectedPrices.flatMap((item) => item.sourcePages),
      ...selectedCatalogEntries.flatMap((entry) => entry.sourcePages),
    ]),
  ].sort((a, b) => a - b);
  const selectedSourceFiles = [
    ...new Set([
      ...selectedPrices.flatMap((item) => item.sourceFiles),
      ...selectedCatalogEntries.flatMap((entry) => entry.sourceFiles),
    ]),
  ];
  const priceOptions = selectedPrices
    .map((item) => {
      const packageCount = Math.max(
        0,
        Number.parseInt(packageCounts[item.priceId] ?? "0", 10) || 0,
      );
      return {
        item,
        packageCount,
        unitPrice: item.price,
        requestedQuantity: packageCount * item.packageQuantity,
        total: packageCount * item.price,
        eligible: packageCount > 0,
      };
    })
    .sort(
      (a, b) =>
        Number(a.item.priceType === "wholesale") -
          Number(b.item.priceType === "wholesale") ||
        a.item.packageQuantity - b.item.packageQuantity,
    );
  const recommended = priceOptions.find((option) => option.eligible) ?? priceOptions[0];
  const displayedPriceOptions = priceOptions;

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = localStorage.getItem("gia-chuan-invoice");
        if (saved) setInvoice(JSON.parse(saved) as InvoiceLine[]);
      } catch {
      } finally {
        setInvoiceReady(true);
      }
    });
  }, []);
  useEffect(() => {
    if (invoiceReady)
      localStorage.setItem("gia-chuan-invoice", JSON.stringify(invoice));
  }, [invoice, invoiceReady]);

  function addToInvoice(option: {
    item: Item;
    packageCount: number;
    requestedQuantity: number;
    unitPrice: number;
    total: number;
  }) {
    const key = String(option.item.priceId);
    setInvoice((current) => {
      const existing = current.find((line) => line.key === key);
      if (!existing)
        return [
          ...current,
          {
            key,
            item: option.item,
            requestedQuantity: option.requestedQuantity,
            packageCount: option.packageCount,
            unitPrice: option.unitPrice,
            total: option.total,
          },
        ];
      return current.map((line) =>
        line.key === key
          ? {
              ...line,
              requestedQuantity:
                line.requestedQuantity + option.requestedQuantity,
              packageCount: line.packageCount + option.packageCount,
              unitPrice: option.unitPrice,
              total: line.total + option.total,
            }
          : line,
      );
    });
    setSelected(null);
    setPackageCounts((current) => ({ ...current, [option.item.priceId]: "0" }));
    setQuery("");
    setTimeout(
      () =>
        document
          .querySelector<HTMLInputElement>('[aria-label="TÃ¬m váº­t tÆ°"]')
          ?.focus(),
      0,
    );
  }

  async function openSourceImage(storagePath: string) {
    if (openingSource) return;
    setSourceImageError("");
    setOpeningSource(storagePath);
    const imageWindow = window.open("about:blank", "_blank");
    if (imageWindow) imageWindow.opener = null;
    const objectPath = storagePath.replace(/^source-pages\//, "");
    const fileName = objectPath.split("/").at(-1);
    const localUrl = `/source-pages/${encodeURIComponent(fileName ?? objectPath)}`;
    try {
      const localImage = await fetch(localUrl, { method: "HEAD", cache: "no-store" });
      if (localImage.ok) {
        setOpeningSource(null);
        if (imageWindow) imageWindow.location.href = localUrl;
        else window.open(localUrl, "_blank", "noopener,noreferrer");
        return;
      }
    } catch {
      // Fall through to the private Storage bucket.
    }
    if (!supabase) {
      imageWindow?.close();
      setOpeningSource(null);
      setSourceImageError(`KhÃ´ng tÃ¬m tháº¥y áº£nh cá»¥c bá»™ ${fileName ?? objectPath}.`);
      return;
    }
    const { data, error: signedUrlError } = await supabase.storage
      .from("source-pages")
      .createSignedUrl(objectPath, 300);
    setOpeningSource(null);
    if (signedUrlError || !data?.signedUrl) {
      imageWindow?.close();
      setSourceImageError(
        signedUrlError?.message ??
          "KhÃ´ng táº¡o Ä‘Æ°á»£c liÃªn káº¿t áº£nh. Kiá»ƒm tra file Ä‘Ã£ Ä‘Æ°á»£c upload.",
      );
      return;
    }
    if (imageWindow) imageWindow.location.href = data.signedUrl;
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function openCatalogEditor(priceItem?: Item) {
    const entry = selectedCatalogEntries[0];
    if (!entry) return;
    const item = priceItem ?? selectedPrices[0];
    setCatalogEditor({
      categoryId: entry.categoryId,
      categoryName: entry.category,
      productId: entry.productId,
      productName: entry.name,
      variantId: entry.variantId,
      variantDisplayName: entry.displayName,
      rawSpecification: entry.spec,
      packagingId: item?.packagingId ?? null,
      packageName: item?.packageName ?? "",
      packageQuantity: item ? String(item.packageQuantity) : "",
      baseUnit: item?.unit ?? "",
      priceId: item?.priceId ?? null,
      priceType: item?.priceType ?? "retail",
      minimumQuantity: item ? String(item.minimumQuantity) : "1",
      amount: item ? String(item.price) : "",
      expectedVersion: item?.version ?? null,
    });
    setError("");
  }

  async function saveCatalogEditor() {
    const form = catalogEditor;
    if (!form || !supabase || savingCatalog) return;
    setSavingCatalog(true);
    setError("");
    const { data, error: updateError } = await supabase.rpc(
      "update_catalog_item",
      {
        p_category_id: form.categoryId,
        p_category_name: form.categoryName.trim(),
        p_product_id: form.productId,
        p_product_name: form.productName.trim(),
        p_variant_id: form.variantId,
        p_variant_display_name: form.variantDisplayName.trim(),
        p_raw_specification: form.rawSpecification.trim(),
        p_packaging_id: form.packagingId,
        p_package_name: form.packagingId ? form.packageName.trim() : null,
        p_package_quantity: form.packagingId
          ? Number(form.packageQuantity)
          : null,
        p_base_unit: form.packagingId ? form.baseUnit.trim() : null,
        p_price_id: form.priceId,
        p_price_type: form.priceId ? form.priceType : null,
        p_minimum_quantity: form.priceId
          ? Number(form.minimumQuantity)
          : null,
        p_amount: form.priceId
          ? Number(form.amount.replace(/[^\d.]/g, ""))
          : null,
        p_expected_version: form.expectedVersion,
      },
    );
    setSavingCatalog(false);
    if (updateError) {
      setError(
        updateError.message.includes("owner_required")
          ? "Chá»‰ tÃ i khoáº£n chá»§ cá»­a hÃ ng má»›i Ä‘Æ°á»£c sá»­a toÃ n bá»™ thÃ´ng tin."
          : updateError.message.includes("duplicate key")
            ? "TÃªn vá»«a nháº­p Ä‘ang trÃ¹ng vá»›i má»™t dá»¯ liá»‡u Ä‘Ã£ cÃ³."
            : `KhÃ´ng lÆ°u Ä‘Æ°á»£c: ${updateError.message}`,
      );
      return;
    }
    const result = data as unknown as { price_version?: number } | null;
    const updateItem = (item: Item): Item => ({
      ...item,
      category:
        item.categoryId === form.categoryId ? form.categoryName.trim() : item.category,
      name: item.productId === form.productId ? form.productName.trim() : item.name,
      variantDisplayName:
        item.variantId === form.variantId
          ? form.variantDisplayName.trim()
          : item.variantDisplayName,
      variantSpec:
        item.variantId === form.variantId
          ? form.rawSpecification.trim()
          : item.variantSpec,
      packageName:
        item.packagingId === form.packagingId ? form.packageName.trim() : item.packageName,
      packageQuantity:
        item.packagingId === form.packagingId
          ? Number(form.packageQuantity)
          : item.packageQuantity,
      unit: item.packagingId === form.packagingId ? form.baseUnit.trim() : item.unit,
      priceType: item.priceId === form.priceId ? form.priceType : item.priceType,
      minimumQuantity:
        item.priceId === form.priceId
          ? Number(form.minimumQuantity)
          : item.minimumQuantity,
      price:
        item.priceId === form.priceId
          ? Number(form.amount.replace(/[^\d.]/g, ""))
          : item.price,
      version:
        item.priceId === form.priceId
          ? (result?.price_version ?? item.version + 1)
          : item.version,
    });
    setItems((current) => current.map(updateItem));
    setInvoice((current) =>
      current.map((line) => {
        const item = updateItem(line.item);
        return {
          ...line,
          item,
          unitPrice: item.price,
          total: line.packageCount * item.price,
        };
      }),
    );
    setCatalogEntries((current) =>
      current.map((entry) => ({
        ...entry,
        category:
          entry.categoryId === form.categoryId
            ? form.categoryName.trim()
            : entry.category,
        name:
          entry.productId === form.productId
            ? form.productName.trim()
            : entry.name,
        displayName:
          entry.variantId === form.variantId
            ? form.variantDisplayName.trim()
            : entry.displayName,
        spec:
          entry.variantId === form.variantId
            ? form.rawSpecification.trim()
            : entry.spec,
      })),
    );
    setSelected({
      name: form.productName.trim(),
      spec: form.rawSpecification.trim(),
    });
    setCatalogEditor(null);
  }

  async function save(itemId: number, raw: string) {
    const parsed = priceSchema.safeParse(raw.replace(/\D/g, ""));
    const item = items.find((candidate) => candidate.id === itemId);
    if (!parsed.success || !item || !supabase) {
      setEditing(null);
      return;
    }
    setError("");
    const { data, error: saveError } = await supabase.rpc(
      "update_price_with_history",
      {
        p_price_id: item.priceId,
        p_new_amount: parsed.data,
        p_expected_version: item.version,
        p_reason: "Cáº­p nháº­t tá»« á»©ng dá»¥ng",
      },
    );
    if (saveError) {
      setError(
        saveError.message.includes("version_conflict")
          ? "GiÃ¡ Ä‘Ã£ Ä‘Æ°á»£c ngÆ°á»i khÃ¡c sá»­a. HÃ£y táº£i láº¡i trang."
          : saveError.message,
      );
      setEditing(null);
      return;
    }
    const updated = data as unknown as {
      amount: number | string;
      version: number;
    };
    const { data: historyRows } = await supabase
      .from("price_history")
      .select("id")
      .eq("price_id", item.priceId)
      .order("changed_at", { ascending: false })
      .limit(1);
    const historyId = historyRows?.[0]?.id as number | undefined;
    setItems((current) =>
      current.map((row) =>
        row.id === itemId
          ? { ...row, price: Number(updated.amount), version: updated.version }
          : row,
      ),
    );
    if (historyId)
      setHistory((current) => [
        ...current,
        {
          itemId,
          historyId,
          oldAmount: item.price,
          expectedVersion: updated.version,
        },
      ]);
    setEditing(null);
  }

  async function undo() {
    const last = history.at(-1);
    if (!last || !supabase) return;
    const { data, error: undoError } = await supabase.rpc("undo_price_change", {
      p_history_id: last.historyId,
      p_expected_version: last.expectedVersion,
    });
    if (undoError) {
      setError(undoError.message);
      return;
    }
    const updated = data as unknown as {
      amount: number | string;
      version: number;
    };
    setItems((current) =>
      current.map((row) =>
        row.id === last.itemId
          ? { ...row, price: Number(updated.amount), version: updated.version }
          : row,
      ),
    );
    setHistory((current) => current.slice(0, -1));
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[var(--card)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--green)] text-xl font-black text-white">
              Ä‘
            </span>
            <div>
              <p className="text-lg font-black">GIÃ CHUáº¨N</p>
              <p className="text-xs text-[var(--muted)]">
                Váº­t tÆ° Ä‘Ãºng giÃ¡, Ä‘Ãºng lÃºc
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`hidden items-center gap-1.5 text-sm sm:flex ${online ? "text-emerald-700" : "text-amber-700"}`}
            >
              {online ? <Wifi size={16} /> : <WifiOff size={16} />}{" "}
              {online ? "Trá»±c tuyáº¿n" : "Ngoáº¡i tuyáº¿n"}
            </span>
            <a href="/questions" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm font-bold">Hỏi giá</a>
            <button
              onClick={() => setInvoiceOpen(true)}
              className="relative flex items-center gap-2 rounded-xl bg-[var(--green)] px-3 py-2 text-sm font-bold text-white"
            >
              <ShoppingCart size={18} />{" "}
              <span className="hidden sm:inline">HÃ³a Ä‘Æ¡n</span>
              {invoice.length > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-[var(--lime)] text-[10px] text-[var(--ink)]">
                  {invoice.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8 sm:py-12">
        <p className="mb-2 text-sm font-bold uppercase tracking-[.18em] text-[var(--green)]">
          Tra cá»©u tá»©c thÃ¬
        </p>
        <h1 className="text-4xl font-black tracking-[-.04em] sm:text-6xl">
          TÃ¬m Ä‘Ãºng váº­t tÆ°.
          <br />
          <span className="text-[var(--green)]">Biáº¿t ngay giÃ¡.</span>
        </h1>
        <div className="relative mt-8 max-w-3xl">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-[var(--green)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="TÃ¬m váº­t tÆ°"
            placeholder="Thá»­ 'bulong 8ly 3f'..."
            className="h-16 w-full rounded-2xl border-2 border-[var(--green)] bg-white pl-14 pr-5 text-lg outline-none shadow-[0_8px_0_#d9e2d8]"
          />
        </div>
        {!query && (
          <div className="mt-5 flex gap-2 overflow-x-auto">
            {recent.map((value) => (
              <button
                key={value}
                onClick={() => setQuery(value)}
                className="shrink-0 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm"
              >
                {value}
              </button>
            ))}
          </div>
        )}
        <section className="mt-12">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <p className="text-sm font-bold text-[var(--muted)]">
                {loading
                  ? "Äang táº£i báº£ng giÃ¡â€¦"
                  : `${shown.length} nhÃ³m sáº£n pháº©m`}
              </p>
              <h2 className="text-2xl font-black">
                {query ? `Káº¿t quáº£ cho â€œ${query}â€` : "Báº£ng giÃ¡ hiá»‡n táº¡i"}
              </h2>
            </div>
            {history.length > 0 && (
              <button
                onClick={undo}
                className="flex items-center gap-2 rounded-xl bg-[var(--lime)] px-4 py-2 text-sm font-bold"
              >
                <RotateCcw size={16} /> HoÃ n tÃ¡c
              </button>
            )}
          </div>
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800"
            >
              {error}
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map((group) => {
              const groupKey = `${group.category}\u0000${group.name}`;
              const families = [
                ...new Set(
                  group.variants
                    .map(variantFamily)
                    .filter((family): family is string => family !== null),
                ),
              ].sort(compareSpecifications);
              const useTwoLevels =
                families.length > 1 &&
                group.variants.filter((spec) => variantFamily(spec)).length >= 4 &&
                group.variants.length > families.length;
              const activeFamily = variantFamilyFilters[groupKey] ?? families[0] ?? "";
              const visibleVariants = useTwoLevels
                ? activeFamily
                  ? group.variants.filter(
                      (spec) => variantFamily(spec) === activeFamily,
                    ).sort((a, b) => compareVariantChoices(a, b, activeFamily))
                  : []
                : [...group.variants].sort(compareSpecifications);
              return (
              <article
                key={`${group.category}-${group.name}`}
                className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black">{group.name}</h3>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {group.variants.length} quy cÃ¡ch â€¢{" "}
                      {group.minPrice === null
                        ? "chÆ°a cÃ³ giÃ¡ Ä‘Ã£ Ä‘á»c"
                        : `tá»« ${formatVnd(group.minPrice)}${
                            group.maxPrice !== group.minPrice
                              ? ` â€“ ${formatVnd(group.maxPrice ?? group.minPrice)}`
                              : ""
                          }`}
                    </p>
                    {group.wholesaleFrom !== null && (
                      <p className="mt-1 text-xs font-bold text-amber-700">
                        GiÃ¡ sá»‰ tá»« {group.wholesaleFrom} {group.unit}
                        {group.smallestRetailPackage
                          ? ` (â‰ˆ ${Math.ceil(group.wholesaleFrom / group.smallestRetailPackage)} gÃ³i láº» Ã— ${group.smallestRetailPackage} ${group.unit})`
                          : ""}
                      </p>
                    )}
                  </div>
                  <span className="rounded-full bg-[#edf1e8] px-3 py-1 text-xs font-bold">
                    {group.items.length} giÃ¡
                  </span>
                </div>
                <div className="my-4 h-px bg-[var(--line)]" />
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  {useTwoLevels
                    ? "BÆ°á»›c 1 Â· Chá»n Ä‘Æ°á»ng kÃ­nh hoáº·c loáº¡i"
                    : "Chá»n quy cÃ¡ch Ä‘á»ƒ xem giÃ¡"}
                </p>
                {useTwoLevels && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {families.map((family) => (
                      <button
                        key={family}
                        type="button"
                        onClick={() =>
                          setVariantFamilyFilters((current) => ({
                            ...current,
                            [groupKey]: family,
                          }))
                        }
                        className={`rounded-lg px-3 py-2 text-sm font-black transition ${
                          activeFamily === family
                            ? "bg-[var(--green)] text-white"
                            : "border border-[var(--line)] bg-[#edf1e8]"
                        }`}
                      >
                        {family}
                      </button>
                    ))}
                  </div>
                )}
                {useTwoLevels && (
                  <p className="mb-2 mt-1 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                    BÆ°á»›c 2 Â· {activeFamily === "MÃ³c" ? "Chá»n cá»¡ mÃ³c" : `Chá»n chiá»u dÃ i cho ${activeFamily}`}
                  </p>
                )}
                <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">
                  {visibleVariants.map((spec) => {
                    const unknownMinimumWholesale = group.items.find(
                      (item) =>
                        item.variantSpec === spec &&
                        item.priceType === "wholesale" &&
                        item.packageNote.includes("ChÆ°a rÃµ sá»‘ lÆ°á»£ng tá»‘i thiá»ƒu"),
                    );

                    return (
                      <button
                        key={spec}
                        onClick={() => setSelected({ name: group.name, spec })}
                        className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-left text-sm font-bold transition hover:border-[var(--green)] hover:bg-[#f0f5eb]"
                      >
                        <span className="block">
                          {useTwoLevels && activeFamily
                            ? displaySpecification(variantChoiceLabel(spec, activeFamily))
                            : displaySpecification(spec)}
                        </span>
                        {unknownMinimumWholesale && (
                          <span className="mt-0.5 block whitespace-nowrap text-[11px] font-bold text-amber-700">
                            GiÃ¡ sá»‰: {formatVnd(unknownMinimumWholesale.price)}/con
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </article>
              );
            })}
            {!loading && shown.length === 0 && (
              <div className="col-span-2 rounded-2xl border border-dashed border-[var(--line)] p-10 text-center">
                <Package className="mx-auto mb-3" />
                <b>ChÆ°a cÃ³ má»©c giÃ¡ phÃ¹ há»£p</b>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Kiá»ƒm tra migration 004 hoáº·c thá»­ tá»« khÃ³a khÃ¡c.
                </p>
              </div>
            )}
          </div>
        </section>
        <p className="mt-8 text-center text-xs text-[var(--muted)]">
          {synced
            ? `Äá»“ng bá»™: ${new Date(synced).toLocaleString("vi-VN")}`
            : "ChÆ°a cÃ³ dá»¯ liá»‡u Ä‘á»“ng bá»™"}
        </p>
      </main>
      {selected && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="price-dialog-title"
            className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-[var(--card)] p-5 shadow-2xl sm:rounded-3xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase text-[var(--green)]">
                  Chá»n giÃ¡ cho hÃ³a Ä‘Æ¡n
                </p>
                <h2
                  id="price-dialog-title"
                  className="mt-1 text-2xl font-black"
                >
                  {selected.name}
                </h2>
                <button
                  type="button"
                  onClick={() => openCatalogEditor(recommended?.item)}
                  className="group mt-0.5 flex items-center gap-1.5 text-left text-[var(--muted)]"
                  title="Báº¥m Ä‘á»ƒ sá»­a quy cÃ¡ch"
                >
                  Quy cÃ¡ch:{" "}
                  <b className="text-[var(--ink)] group-hover:text-[var(--green)]">
                    {displaySpecification(selected.spec)}
                  </b>
                  <Pencil size={13} className="text-[var(--green)]" />
                </button>
                <p className="mt-1 text-sm font-bold text-amber-700">
                  {selectedSourcePages.length > 0
                    ? `Äá»‘i chiáº¿u: Trang ${selectedSourcePages.join(", ")}`
                    : "ChÆ°a cÃ³ sá»‘ trang nguá»“n"}
                </p>
                <div className="mt-2 flex max-w-[calc(100vw-7rem)] flex-nowrap gap-2 overflow-x-auto pb-1 sm:max-w-none">
                  {selectedSourceFiles.length > 0 && (
                    <>
                    {selectedSourceFiles.map((file) => (
                      <button
                        key={file}
                        type="button"
                        onClick={() => openSourceImage(file)}
                        disabled={openingSource !== null}
                        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--green)] bg-white px-3 py-1.5 text-xs font-bold text-[var(--green)] disabled:cursor-wait disabled:opacity-60"
                      >
                        {openingSource === file ? (
                          <LoaderCircle className="animate-spin" size={14} />
                        ) : (
                          <ImageIcon size={14} />
                        )}
                        Xem {file.split("/").at(-1)}
                      </button>
                    ))}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => openCatalogEditor(recommended?.item)}
                    className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--lime)] px-3 py-1.5 text-xs font-black text-[var(--ink)]"
                  >
                    <Pencil size={14} /> Sá»­a giÃ¡ & thÃ´ng tin
                  </button>
                </div>
                {sourceImageError && (
                  <p role="alert" className="mt-2 text-xs font-bold text-red-700">
                    KhÃ´ng má»Ÿ Ä‘Æ°á»£c áº£nh: {sourceImageError}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label="ÄÃ³ng"
                className="grid size-10 place-items-center rounded-full bg-[#edf1e8]"
              >
                <X size={20} />
              </button>
            </div>
            <div className="mt-5 grid gap-3">
              {selectedPrices.length === 0 && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Quy cÃ¡ch nÃ y Ä‘Ã£ Ä‘Æ°á»£c nháº­p tá»« áº£nh nguá»“n nhÆ°ng giÃ¡ chÆ°a Ä‘á»§ rÃµ
                  Ä‘á»ƒ ghi nháº­n. HÃ£y Ä‘á»‘i chiáº¿u áº£nh trÆ°á»›c khi bá»• sung giÃ¡.
                </p>
              )}
              {displayedPriceOptions.map((option, index) => (
                <div
                  key={option.item.id}
                  className={`rounded-2xl border p-4 ${index === 0 ? "border-[var(--green)] bg-[#f3f7ed]" : "border-[var(--line)] bg-white"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase text-[var(--green)]">
                        {displayPriceType(option.item)}
                      </p>
                      <p className="font-bold">
                        {displayItemPackageName(option.item)}
                      </p>
                    </div>
                    <button
                      onClick={() => setEditing(option.item.id)}
                      className="money flex items-center gap-1 text-xl font-black"
                      aria-label={`Sá»­a giÃ¡ ${option.item.name}`}
                    >
                      {formatVnd(option.item.price)} <Pencil size={13} />
                    </button>
                  </div>
                  {editing === option.item.id && (
                    <input
                      autoFocus
                      defaultValue={option.item.price}
                      inputMode="numeric"
                      onKeyDown={(event) => {
                        if (event.key === "Enter")
                          save(option.item.id, event.currentTarget.value);
                        if (event.key === "Escape") setEditing(null);
                      }}
                      className="mt-3 w-full rounded-xl border-2 border-[var(--green)] px-3 py-2 text-xl font-black"
                    />
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPackageCounts((current) => ({
                          ...current,
                          [option.item.priceId]: String(
                            Math.max(0, option.packageCount - 1),
                          ),
                        }))
                      }
                      aria-label={`Giáº£m ${displayItemPackageName(option.item)}`}
                      className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#edf1e8] text-xl font-black text-[var(--green)]"
                    >
                      âˆ’
                    </button>
                    <input
                      value={packageCounts[option.item.priceId] ?? "0"}
                      onChange={(event) =>
                        setPackageCounts((current) => ({
                          ...current,
                          [option.item.priceId]: event.target.value.replace(/\D/g, ""),
                        }))
                      }
                      inputMode="numeric"
                      aria-label={`Sá»‘ lÆ°á»£ng ${displayItemPackageName(option.item)}`}
                      className="h-11 min-w-0 flex-1 rounded-xl border-2 border-[var(--green)] bg-white text-center text-xl font-black"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPackageCounts((current) => ({
                          ...current,
                          [option.item.priceId]: String(option.packageCount + 1),
                        }))
                      }
                      aria-label={`TÄƒng ${displayItemPackageName(option.item)}`}
                      className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--green)] text-xl font-black text-white"
                    >
                      +
                    </button>
                  </div>
                  <p className="mt-1 text-center text-xs text-[var(--muted)]">
                    {option.packageCount} Ã— {option.item.packageQuantity} ={" "}
                    <b>{option.requestedQuantity} {option.item.unit}</b>
                  </p>
                  {option.item.priceType === "wholesale" &&
                    option.item.packageNote.includes("ChÆ°a rÃµ sá»‘ lÆ°á»£ng tá»‘i thiá»ƒu") && (
                      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                        ChÆ°a rÃµ sá»‘ lÆ°á»£ng tá»‘i thiá»ƒu Ä‘á»ƒ Ã¡p dá»¥ng giÃ¡ sá»‰. Chá»‰ dÃ¹ng
                        giÃ¡ nÃ y sau khi xÃ¡c nháº­n khÃ¡ch mua Ä‘á»§ sá»‘ lÆ°á»£ng.
                      </p>
                    )}
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
                    <p className="money text-2xl font-black">{formatVnd(option.total)}</p>
                    <button
                      onClick={() => addToInvoice(option)}
                      disabled={!option.eligible}
                      className="rounded-xl bg-[var(--green)] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                      {option.eligible
                        ? "ThÃªm vÃ o hÃ³a Ä‘Æ¡n"
                        : "Nháº­p sá»‘ lÆ°á»£ng"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {catalogEditor && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-editor-title"
            className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[var(--card)] p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase text-[var(--green)]">
                  Chá»‰nh sá»­a dá»¯ liá»‡u gá»‘c
                </p>
                <h2 id="catalog-editor-title" className="text-2xl font-black">
                  Sá»­a giÃ¡ & thÃ´ng tin
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCatalogEditor(null)}
                aria-label="ÄÃ³ng trÃ¬nh sá»­a"
                className="grid size-10 place-items-center rounded-full bg-[#edf1e8]"
              >
                <X size={20} />
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["TÃªn nhÃ³m sáº£n pháº©m", "categoryName"],
                ["TÃªn sáº£n pháº©m", "productName"],
                ["TÃªn biáº¿n thá»ƒ", "variantDisplayName"],
                ["ThÃ´ng tin / quy cÃ¡ch", "rawSpecification"],
              ].map(([label, field]) => (
                <label key={field} className="text-sm font-bold">
                  {label}
                  <input
                    value={catalogEditor[field as keyof CatalogEditor] as string}
                    onChange={(event) =>
                      setCatalogEditor((current) =>
                        current
                          ? { ...current, [field]: event.target.value }
                          : current,
                      )
                    }
                    className="mt-1 h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 font-normal outline-none focus:border-[var(--green)]"
                  />
                </label>
              ))}
            </div>
            {catalogEditor.priceId !== null ? (
              <>
                <h3 className="mt-7 border-t border-[var(--line)] pt-5 text-lg font-black">
                  ÄÃ³ng gÃ³i vÃ  giÃ¡
                </h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-sm font-bold">
                    TÃªn Ä‘Ã³ng gÃ³i
                    <input
                      value={catalogEditor.packageName}
                      onChange={(event) =>
                        setCatalogEditor((current) =>
                          current
                            ? { ...current, packageName: event.target.value }
                            : current,
                        )
                      }
                      className="mt-1 h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    Sá»‘ lÆ°á»£ng Ä‘Ã³ng gÃ³i
                    <input
                      value={catalogEditor.packageQuantity}
                      onChange={(event) =>
                        setCatalogEditor((current) =>
                          current
                            ? { ...current, packageQuantity: event.target.value }
                            : current,
                        )
                      }
                      inputMode="decimal"
                      className="mt-1 h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    ÄÆ¡n vá»‹ tÃ­nh
                    <input
                      value={catalogEditor.baseUnit}
                      onChange={(event) =>
                        setCatalogEditor((current) =>
                          current
                            ? { ...current, baseUnit: event.target.value }
                            : current,
                        )
                      }
                      className="mt-1 h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    Loáº¡i giÃ¡
                    <select
                      value={catalogEditor.priceType}
                      onChange={(event) =>
                        setCatalogEditor((current) =>
                          current
                            ? { ...current, priceType: event.target.value }
                            : current,
                        )
                      }
                      className="mt-1 h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 font-normal"
                    >
                      <option value="retail">GiÃ¡ láº»</option>
                      <option value="wholesale">GiÃ¡ sá»‰</option>
                      <option value="dealer">GiÃ¡ Ä‘áº¡i lÃ½</option>
                    </select>
                  </label>
                  <label className="text-sm font-bold">
                    Sá»‘ lÆ°á»£ng tá»‘i thiá»ƒu
                    <input
                      value={catalogEditor.minimumQuantity}
                      onChange={(event) =>
                        setCatalogEditor((current) =>
                          current
                            ? { ...current, minimumQuantity: event.target.value }
                            : current,
                        )
                      }
                      inputMode="decimal"
                      className="mt-1 h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    GiÃ¡ bÃ¡n (VND)
                    <input
                      value={catalogEditor.amount}
                      onChange={(event) =>
                        setCatalogEditor((current) =>
                          current
                            ? { ...current, amount: event.target.value.replace(/\D/g, "") }
                            : current,
                        )
                      }
                      inputMode="numeric"
                      className="money mt-1 h-11 w-full rounded-xl border-2 border-[var(--green)] bg-white px-3 font-black"
                    />
                  </label>
                </div>
              </>
            ) : (
              <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
                Quy cÃ¡ch nÃ y chÆ°a cÃ³ giÃ¡. Báº¡n váº«n cÃ³ thá»ƒ sá»­a nhÃ³m, sáº£n pháº©m vÃ 
                thÃ´ng tin biáº¿n thá»ƒ; chá»©c nÄƒng táº¡o giÃ¡ má»›i sáº½ cáº§n báº£ng giÃ¡ vÃ 
                quy cÃ¡ch Ä‘Ã³ng gÃ³i riÃªng.
              </p>
            )}
            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCatalogEditor(null)}
                className="rounded-xl border border-[var(--line)] px-5 py-2.5 font-bold"
              >
                Há»§y
              </button>
              <button
                type="button"
                onClick={saveCatalogEditor}
                disabled={savingCatalog}
                className="rounded-xl bg-[var(--green)] px-5 py-2.5 font-bold text-white disabled:opacity-60"
              >
                {savingCatalog ? "Äang lÆ°uâ€¦" : "LÆ°u táº¥t cáº£ thay Ä‘á»•i"}
              </button>
            </div>
          </section>
        </div>
      )}
      {invoiceOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/45"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setInvoiceOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-title"
            className="flex h-full w-full max-w-4xl flex-col bg-[var(--card)] shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-[var(--line)] p-5">
              <div>
                <p className="text-xs font-bold uppercase text-[var(--green)]">
                  HÃ³a Ä‘Æ¡n táº¡m tÃ­nh
                </p>
                <h2 id="invoice-title" className="text-2xl font-black">
                  {invoice.length} sáº£n pháº©m
                </h2>
              </div>
              <button
                onClick={() => setInvoiceOpen(false)}
                aria-label="ÄÃ³ng hÃ³a Ä‘Æ¡n"
                className="grid size-10 place-items-center rounded-full bg-[#edf1e8]"
              >
                <X />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {invoice.length === 0 ? (
                <div className="py-16 text-center">
                  <ShoppingCart className="mx-auto mb-3" />
                  <b>HÃ³a Ä‘Æ¡n Ä‘ang trá»‘ng</b>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    TÃ¬m sáº£n pháº©m vÃ  chá»n â€œThÃªm vÃ o hÃ³a Ä‘Æ¡nâ€.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-white">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead className="bg-[#edf1e8] text-left text-xs uppercase text-[var(--muted)]">
                      <tr>
                        <th className="px-3 py-3">Sáº£n pháº©m</th>
                        <th className="px-3 py-3">Quy cÃ¡ch</th>
                        <th className="px-3 py-3 text-right">Sá»‘ lÆ°á»£ng</th>
                        <th className="px-3 py-3 text-right">ÄÆ¡n giÃ¡</th>
                        <th className="px-3 py-3 text-right">ThÃ nh tiá»n</th>
                        <th className="w-10 px-2 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.map((line) => (
                        <tr key={line.key} className="border-t border-[var(--line)] align-top">
                          <td className="px-3 py-3 font-black">{line.item.name}</td>
                          <td className="px-3 py-3">
                            <b>{displaySpecification(line.item.variantSpec)}</b>
                            <p className="mt-0.5 whitespace-nowrap text-xs text-[var(--muted)]">
                              {line.item.priceType === "wholesale"
                                ? `${line.packageCount} bá»‹ch Ã— ${line.item.packageQuantity} ${line.item.unit}`
                                : `${line.packageCount} ${displayItemPackageName(line.item)}`}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-right font-bold">
                            {line.requestedQuantity} {line.item.unit}
                          </td>
                          <td className="money whitespace-nowrap px-3 py-3 text-right">
                            {formatVnd(line.unitPrice ?? line.total / line.packageCount)}
                            <p className="text-xs text-[var(--muted)]">
                              /{displayItemPackageName(line.item)}
                            </p>
                          </td>
                          <td className="money whitespace-nowrap px-3 py-3 text-right text-base font-black">
                            {formatVnd(line.total)}
                          </td>
                          <td className="px-2 py-3 text-center">
                            <button
                              onClick={() =>
                                setInvoice((current) =>
                                  current.filter((item) => item.key !== line.key),
                                )
                              }
                              aria-label={`XÃ³a ${line.item.name} khá»i hÃ³a Ä‘Æ¡n`}
                              className="text-red-600"
                            >
                              <Trash2 size={17} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <footer className="border-t border-[var(--line)] p-5">
              <div className="mb-4 flex items-end justify-between">
                <span className="font-bold">Tá»•ng cá»™ng</span>
                <strong className="money text-3xl">
                  {formatVnd(
                    invoice.reduce((sum, line) => sum + line.total, 0),
                  )}
                </strong>
              </div>
              <button
                onClick={() => {
                  setInvoiceOpen(false);
                  setQuery("");
                  setTimeout(
                    () =>
                      document
                        .querySelector<HTMLInputElement>(
                          '[aria-label="TÃ¬m váº­t tÆ°"]',
                        )
                        ?.focus(),
                    0,
                  );
                }}
                className="h-12 w-full rounded-xl bg-[var(--green)] font-bold text-white"
              >
                ThÃªm sáº£n pháº©m khÃ¡c
              </button>
              {invoice.length > 0 && (
                <button
                  onClick={() => setInvoice([])}
                  className="mt-2 h-10 w-full text-sm font-bold text-red-700"
                >
                  XÃ³a hÃ³a Ä‘Æ¡n
                </button>
              )}
            </footer>
          </aside>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t bg-white py-2 sm:hidden">
        {[
          [Home, "Trang chá»§"],
          [Layers3, "Danh má»¥c"],
          [History, "Lá»‹ch sá»­"],
        ].map(([Icon, label]) => {
          const I = Icon as typeof Home;
          return (
            <span
              key={label as string}
              className="flex flex-col items-center text-[10px]"
            >
              <I size={20} />
              {label as string}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
