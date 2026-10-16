"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Select, TextInput } from "flowbite-react";
import {
  Home,
  ClipboardList,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  Package,
  Pencil,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { cacheSnapshot, readSnapshot } from "@/features/offline/cache";
import { formatVnd, parsePriceInput, priceSchema, priceWriteErrorMessage } from "@/features/pricing/validation";
import { selectBestPrice } from "@/features/pricing/select-price";
import { hasInvoicePriceChanged } from "@/features/pricing/invoice-price-review";
import { priceTierLabel } from "@/features/pricing/price-tier";
import { matchesCatalogQuery } from "@/features/search/parser";
import { fetchCatalog } from "@/lib/api/catalog";
import { fetchSourceSignedUrl } from "@/lib/api/source-files";
import { updateCatalogItem, updatePrice, undoPrice } from "@/lib/api/prices";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { useAuthLogout } from "@/components/auth-actions-context";
import { CustomerOrderInbox } from "@/components/customer-order-inbox";

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

function displaySpecification(specification: string) {
  return specification
    .replace(/^1T$/i, "1 tấc")
    .replace(/\bmong\b/gi, "mỏng")
    .replace(/\bday\b/gi, "dày")
    .replace(/\bmoc\b/gi, "móc");
}

function displayPackageName(packageName: string) {
  const legacyNames: Record<string, string> = {
    "Lẻ 10 con": "10 con/bịch",
    "Bịch 95 con": "95 con/bịch",
    "Hộp 50 con": "50 con/hộp",
    "Lẻ 1 con": "1 con",
    "Gói nhỏ 100 con": "100 con/gói",
    "Bịch lớn 1.000 con": "1.000 con/bịch",
    "Lẻ 1 bánh": "1 bánh/cái",
    "Le 10 bo": "10 bộ/bịch",
    "Bich 100 bo": "100 bộ/bịch",
    "Le 1 met": "1 mét",
    "Cuon 100 met": "100 mét/cuộn",
  };
  return legacyNames[packageName] ?? packageName;
}

function displayItemPackageName(item: Item) {
  return displayPackageName(item.packageName);
}

function displayPriceType(item: Item) {
  const tier = priceTierLabel(item.priceType);
  if (item.name === "Móc U") return tier;
  if (item.packageName.startsWith("Đầu tròn + lá")) return `Đầu tròn + lá · ${tier}`;
  if (item.packageName.startsWith("Đầu dù")) return `Đầu dù · ${tier}`;
  return tier;
}

const recent = ["bulong 8ly 3f", "tac ke 6x50", "day cap inox 6 ly"];
export function PriceApp() {
  const logout = useAuthLogout();
  const [customerOrdersOpen, setCustomerOrdersOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [catalogEntries, setCatalogEntries] = useState<CatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [serverAvailable, setServerAvailable] = useState(true);
  const [synced, setSynced] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<UndoEntry[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<{
    name: string;
    spec: string;
  } | null>(null);
  const [packageCounts, setPackageCounts] = useState<Record<number, string>>({});
  const [retailPackageCount, setRetailPackageCount] = useState("1");
  const [invoice, setInvoice] = useState<InvoiceLine[]>([]);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceReady, setInvoiceReady] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState("");
  const [openingSource, setOpeningSource] = useState<string | null>(null);
  const [sourceImageError, setSourceImageError] = useState("");
  const [catalogEditor, setCatalogEditor] = useState<CatalogEditor | null>(null);
  const [savingCatalog, setSavingCatalog] = useState(false);
  const [chatPriceReview, setChatPriceReview] = useState<{ priceId: number; expectedVersion: number; current: Item | null; acknowledged: boolean; requiresFreshCheck: boolean } | null>(null);
  const detailDialogRef = useModalFocus<HTMLElement>(detailOpen && !catalogEditor && !invoiceOpen, () => setDetailOpen(false));
  const catalogDialogRef = useModalFocus<HTMLElement>(Boolean(catalogEditor), () => setCatalogEditor(null));
  const invoiceDialogRef = useModalFocus<HTMLElement>(invoiceOpen, () => setInvoiceOpen(false));

  useEffect(() => {
    const updateNetwork = () => setOnline(navigator.onLine);
    updateNetwork();
    const handleOnline = () => {
      updateNetwork();
      void load();
    };
    addEventListener("online", handleOnline);
    addEventListener("offline", updateNetwork);
    async function restoreSnapshot() {
      try {
        const cached = await readSnapshot<Item[]>("catalog");
        const cachedEntries = await readSnapshot<CatalogEntry[]>("catalog-entries");
        if (cached) {
          setItems(cached.data);
          setSynced(cached.syncedAt);
          const params = new URLSearchParams(window.location.search);
          const expectedPriceId = Number(params.get("priceId"));
          const expectedPriceVersion = Number(params.get("priceVersion"));
          if (Number.isSafeInteger(expectedPriceId) && expectedPriceId > 0 && Number.isSafeInteger(expectedPriceVersion) && expectedPriceVersion > 0) {
            setChatPriceReview({ priceId: expectedPriceId, expectedVersion: expectedPriceVersion, current: cached.data.find((item) => item.priceId === expectedPriceId) ?? null, acknowledged: false, requiresFreshCheck: true });
          }
        }
        if (cachedEntries) {
          setCatalogEntries(cachedEntries.data);
          const requestedVariant = Number(new URLSearchParams(window.location.search).get("variantId"));
          const matched = cachedEntries.data.find((entry) => entry.variantId === requestedVariant);
          if (matched) setSelected({ name: matched.name, spec: matched.spec });
        }
        return Boolean(cached || cachedEntries);
      } catch {
        return false;
      }
    }
    async function load() {
      if (!navigator.onLine) {
        await restoreSnapshot();
        setLoading(false);
        return;
      }
      let response;
      try { response = await fetchCatalog(); }
      catch {
        const restored = await restoreSnapshot();
        setServerAvailable(false);
        setError(restored ? "Không thể kết nối với máy chủ. Đang xem bản giá đã lưu; hãy tải lại khi có mạng." : "Không tải được bảng giá. Kiểm tra kết nối rồi thử lại.");
        setLoading(false);
        return;
      }
      const entries = response.entries;
      const loaded = response.prices;
      const params = new URLSearchParams(window.location.search);
      const expectedPriceId = Number(params.get("priceId"));
      const expectedPriceVersion = Number(params.get("priceVersion"));
      if (Number.isSafeInteger(expectedPriceId) && expectedPriceId > 0 && Number.isSafeInteger(expectedPriceVersion) && expectedPriceVersion > 0) {
        const currentPrice = loaded.find((item) => item.priceId === expectedPriceId) ?? null;
        if (!currentPrice || currentPrice.version !== expectedPriceVersion) {
          setChatPriceReview({ priceId: expectedPriceId, expectedVersion: expectedPriceVersion, current: currentPrice, acknowledged: false, requiresFreshCheck: false });
        }
      }
      setItems(loaded);
      setCatalogEntries(entries);
      setServerAvailable(true);
      setError("");
      const requestedVariant = Number(new URLSearchParams(window.location.search).get("variantId"));
      const matchedVariant = entries.find((entry) => entry.variantId === requestedVariant);
      if (matchedVariant) {
        setSelected({
          name: matchedVariant.name,
          spec: matchedVariant.spec,
        });
      }
      setSynced(response.syncedAt);
      setSyncMessage("");
      setLoading(false);
    }
    load();
    return () => {
      removeEventListener("online", handleOnline);
      removeEventListener("offline", updateNetwork);
    };
  }, []);

  useEffect(() => {
    if (loading || !navigator.onLine || (items.length === 0 && catalogEntries.length === 0)) return;
    let active = true;
    void Promise.all([
      cacheSnapshot("catalog", items),
      cacheSnapshot("catalog-entries", catalogEntries),
    ]).then(() => {
      if (active) setSyncMessage("");
    }).catch(() => {
      if (active) setSyncMessage("Không lưu được bản ngoại tuyến trên thiết bị này.");
    });
    return () => { active = false; };
  }, [items, catalogEntries, loading]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "F1") { event.preventDefault(); document.getElementById("product-search")?.focus(); }
      if (event.key === "F4") { event.preventDefault(); setInvoiceOpen(true); }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

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
          groupItems.some((item) => item.status === "verified")
            ? Math.min(...groupItems.filter((item) => item.status === "verified").map((item) => item.price))
            : null,
        maxPrice:
          groupItems.some((item) => item.status === "verified")
            ? Math.max(...groupItems.filter((item) => item.status === "verified").map((item) => item.price))
            : null,
        wholesaleFrom: groupItems.some(
          (item) =>
            item.status === "verified" &&
            item.priceType === "wholesale" &&
            item.unit === (groupItems[0]?.unit ?? item.unit) &&
            !item.packageNote.includes("Chưa rõ số lượng tối thiểu"),
        )
          ? Math.min(
              ...groupItems
                .filter(
                  (item) =>
                    item.status === "verified" &&
                    item.priceType === "wholesale" &&
                    item.unit === (groupItems[0]?.unit ?? item.unit) &&
                    !item.packageNote.includes("Chưa rõ số lượng tối thiểu"),
                )
                .filter((item) => item.unit === (groupItems[0]?.unit ?? item.unit))
                .map((item) => item.packageQuantity * Math.max(1, item.minimumQuantity)),
            )
          : null,
        smallestRetailPackage: groupItems.some(
          (item) => item.status === "verified" && item.priceType === "retail",
        )
          ? Math.min(
              ...groupItems
                .filter((item) => item.status === "verified" && item.priceType === "retail")
                .map((item) => item.packageQuantity),
            )
          : null,
        unit: groupItems[0]?.unit ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [catalogEntries, items]);
  const shown = useMemo(() => groups.flatMap((group) => {
    const variants = query.trim()
      ? group.variants.filter((spec) => matchesCatalogQuery(query, `${group.name} ${spec}`))
      : group.variants;
    return variants.length ? [{ ...group, variants }] : [];
  }), [groups, query]);
  const selectedPrices = selected
    ? items.filter(
        (item) =>
          item.name === selected.name && item.variantSpec === selected.spec,
      )
    : [];
  const smallestRetailQuantity = selectedPrices
    .filter((item) => item.priceType === "retail" && item.packageQuantity > 0)
    .reduce((smallest, item) => Math.min(smallest, item.packageQuantity), Infinity);
  const retailUnit = selectedPrices.find((item) => item.priceType === "retail" && item.packageQuantity === smallestRetailQuantity)?.unit;
  const suggestedPrice = selectBestPrice(
    selectedPrices.filter((item) => item.unit === retailUnit),
    Number(retailPackageCount),
    smallestRetailQuantity,
  );
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
        eligible: item.status === "verified" &&
          packageCount >= Math.max(1, item.minimumQuantity) &&
          !(item.priceType === "wholesale" && item.packageNote.includes("Chưa rõ số lượng tối thiểu")),
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
  const activeInvoice = useMemo(() => {
    if (loading || items.length === 0) return [];
    const currentPrices = new Map(items.map((item) => [item.priceId, item]));
    return invoice.flatMap((line) => {
      const item = currentPrices.get(line.item.priceId);
      if (!item || item.status !== "verified") return [];
      return [{ ...line, item, unitPrice: item.price, total: line.packageCount * item.price, priceChanged: hasInvoicePriceChanged(line.item, item) }];
    });
  }, [invoice, items, loading]);

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

  async function addToInvoice(option: {
    item: Item;
    packageCount: number;
    requestedQuantity: number;
    unitPrice: number;
    total: number;
  }) {
    if (option.item.status !== "verified") {
      setError("Chỉ có thể thêm mức giá đã được duyệt vào báo giá.");
      return;
    }
    if (!navigator.onLine) {
      setError("Cần kết nối mạng để kiểm tra phiên bản giá và bao bì hiện hành trước khi thêm vào báo giá.");
      return;
    }
    if (chatPriceReview?.priceId === option.item.priceId && (chatPriceReview.requiresFreshCheck || option.item.version !== chatPriceReview.expectedVersion) && !chatPriceReview.acknowledged) {
      setError("Giá trong kết quả hỏi đáp đã đổi. Hãy xem và xác nhận giá hiện tại trước khi thêm vào báo giá.");
      setInvoiceOpen(true);
      return;
    }
    let latestCatalog: Awaited<ReturnType<typeof fetchCatalog>>;
    try { latestCatalog = await fetchCatalog(); }
    catch {
      setError("Không xác minh được giá hiện hành. Hãy thử lại trước khi thêm vào báo giá.");
      return;
    }
    const latestItem = latestCatalog.prices.find((item) => item.priceId === option.item.priceId);
    if (!latestItem) {
      setItems(latestCatalog.prices);
      setError("Mức giá này đã hết hiệu lực hoặc không còn trong bảng giá. Hãy chọn lại.");
      return;
    }
    if (latestItem.status !== "verified") {
      setItems(latestCatalog.prices);
      setError("Mức giá này chưa được duyệt để đưa vào báo giá. Hãy chọn mức giá đã duyệt.");
      return;
    }
    if (hasInvoicePriceChanged(option.item, latestItem)) {
      setItems(latestCatalog.prices);
      setChatPriceReview({ priceId: latestItem.priceId, expectedVersion: option.item.version, current: latestItem, acknowledged: false, requiresFreshCheck: false });
      setError("Giá hoặc bao bì vừa đổi. Hãy xem lại và xác nhận mức hiện tại trước khi thêm.");
      return;
    }
    const checkedOption = { ...option, item: latestItem, unitPrice: latestItem.price, total: option.packageCount * latestItem.price };
    const key = String(checkedOption.item.priceId);
    setInvoice((current) => {
      const existing = current.find((line) => line.key === key);
      if (!existing)
        return [
          ...current,
          {
            key,
            item: checkedOption.item,
            requestedQuantity: checkedOption.requestedQuantity,
            packageCount: checkedOption.packageCount,
            unitPrice: checkedOption.unitPrice,
            total: checkedOption.total,
          },
        ];
      return current.map((line) =>
        line.key === key
          ? {
              ...line,
              item: checkedOption.item,
              requestedQuantity:
                line.requestedQuantity + checkedOption.requestedQuantity,
              packageCount: line.packageCount + checkedOption.packageCount,
              unitPrice: checkedOption.unitPrice,
              total: line.total + checkedOption.total,
            }
          : line,
      );
    });
    setSelected(null);
    setPackageCounts((current) => ({ ...current, [checkedOption.item.priceId]: "0" }));
    setQuery("");
    setTimeout(
      () =>
        document
          .querySelector<HTMLInputElement>('[aria-label="Tìm vật tư"]')
          ?.focus(),
      0,
    );
  }

  async function copyQuote() {
    if (activeInvoice.length === 0) return;
    if (activeInvoice.length !== invoice.length) {
      setQuoteMessage("Có dòng giá chưa được duyệt hoặc đã hết hiệu lực; hãy chọn lại trước khi sao chép báo giá.");
      return;
    }
    if (!navigator.onLine) {
      setQuoteMessage("Cần kết nối mạng để xác minh các mức giá hiện hành trước khi sao chép báo giá.");
      return;
    }
    if (activeInvoice.some((line) => line.priceChanged)) {
      setQuoteMessage("Giá hoặc phiên bản giá đã thay đổi. Hãy xác nhận giá hiện tại trước khi sao chép.");
      return;
    }
    let latestCatalog: Awaited<ReturnType<typeof fetchCatalog>>;
    try { latestCatalog = await fetchCatalog(); }
    catch {
      setQuoteMessage("Không xác minh được giá hiện hành. Hãy thử lại trước khi sao chép báo giá.");
      return;
    }
    const freshById = new Map(latestCatalog.prices.map((item) => [item.priceId, item]));
    const unverifiedLine = invoice.find((line) => freshById.get(line.item.priceId)?.status !== "verified");
    if (unverifiedLine) {
      setItems(latestCatalog.prices);
      setQuoteMessage("Có dòng giá chưa được duyệt hoặc đã hết hiệu lực; hãy chọn lại trước khi sao chép báo giá.");
      return;
    }
    const changedLine = activeInvoice.find((line) => {
      const latest = freshById.get(line.item.priceId);
      return !latest || hasInvoicePriceChanged(line.item, latest);
    });
    if (changedLine) {
      setItems(latestCatalog.prices);
      const latest = freshById.get(changedLine.item.priceId);
      if (latest) setChatPriceReview({ priceId: latest.priceId, expectedVersion: changedLine.item.version, current: latest, acknowledged: false, requiresFreshCheck: false });
      setQuoteMessage(latest ? "Giá hoặc bao bì vừa đổi. Hãy xác nhận lại rồi mới sao chép." : "Một mức giá đã hết hiệu lực. Hãy chọn lại sản phẩm trong bảng hiện tại.");
      return;
    }
    setItems(latestCatalog.prices);
    const lines = activeInvoice.map((line, index) =>
      `${index + 1}. ${line.item.name} · ${displaySpecification(line.item.variantSpec)} · ${line.packageCount} ${displayItemPackageName(line.item)} × ${formatVnd(line.item.price)} = ${formatVnd(line.packageCount * line.item.price)}`,
    );
    const total = activeInvoice.reduce((sum, line) => sum + line.packageCount * line.item.price, 0);
    try {
      await navigator.clipboard.writeText(["BÁO GIÁ VẬT TƯ", ...lines, `Tổng cộng: ${formatVnd(total)}`].join("\n"));
      setQuoteMessage("Đã sao chép báo giá. Có thể dán vào tin nhắn cho khách.");
    } catch {
      setQuoteMessage("Không sao chép được. Hãy kiểm tra quyền truy cập bộ nhớ tạm của trình duyệt.");
    }
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
    let signedUrl: string;
    try {
      ({ signedUrl } = await fetchSourceSignedUrl(storagePath));
    } catch {
      imageWindow?.close();
      setOpeningSource(null);
      setSourceImageError("Không tạo được liên kết ảnh. Kiểm tra file đã được upload.");
      return;
    }
    setOpeningSource(null);
    if (imageWindow) imageWindow.location.href = signedUrl;
    else window.open(signedUrl, "_blank", "noopener,noreferrer");
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
    if (!form || savingCatalog) return;
    if (!navigator.onLine) {
      setError("Đang ngoại tuyến: chỉ xem được bảng giá đã lưu. Hãy kết nối mạng để sửa giá.");
      return;
    }
    const amount = form.priceId ? parsePriceInput(form.amount) : null;
    if (form.priceId && (amount === null || !priceSchema.safeParse(amount).success)) {
      setError("Giá phải là số không âm, tối đa 2 chữ số thập phân.");
      return;
    }
    setSavingCatalog(true);
    setError("");
    let result;
    try {
      result = await updateCatalogItem({
        categoryId: form.categoryId,
        categoryName: form.categoryName.trim(),
        productId: form.productId,
        productName: form.productName.trim(),
        variantId: form.variantId,
        variantDisplayName: form.variantDisplayName.trim(),
        rawSpecification: form.rawSpecification.trim(),
        packagingId: form.packagingId,
        packageName: form.packagingId ? form.packageName.trim() : null,
        packageQuantity: form.packagingId ? Number(form.packageQuantity) : null,
        baseUnit: form.packagingId ? form.baseUnit.trim() : null,
        priceId: form.priceId,
        priceType: form.priceId ? form.priceType as "retail" | "wholesale" | "dealer" : null,
        minimumQuantity: form.priceId ? Number(form.minimumQuantity) : null,
        amount,
        expectedVersion: form.expectedVersion,
      }, navigator.onLine);
    } catch (writeError) {
      setError(priceWriteErrorMessage(writeError));
      setSavingCatalog(false);
      return;
    }
    setSavingCatalog(false);
    const updateItem = (item: Item): Item => ({
      ...item,
      category: item.categoryId === form.categoryId ? form.categoryName.trim() : item.category,
      name: item.productId === form.productId ? form.productName.trim() : item.name,
      variantDisplayName: item.variantId === form.variantId ? form.variantDisplayName.trim() : item.variantDisplayName,
      variantSpec: item.variantId === form.variantId ? form.rawSpecification.trim() : item.variantSpec,
      packageName: item.packagingId === form.packagingId ? form.packageName.trim() : item.packageName,
      packageQuantity: item.packagingId === form.packagingId ? Number(form.packageQuantity) : item.packageQuantity,
      unit: item.packagingId === form.packagingId ? form.baseUnit.trim() : item.unit,
      priceType: item.priceId === form.priceId ? (result.price?.priceType ?? item.priceType) : item.priceType,
      minimumQuantity: item.priceId === form.priceId ? (result.price?.minimumQuantity ?? item.minimumQuantity) : item.minimumQuantity,
      price: item.priceId === form.priceId ? (result.price?.amount ?? item.price) : item.price,
      version: item.priceId === form.priceId ? (result.price?.version ?? item.version) : item.version,
    });
    setItems((current) => current.map(updateItem));
    setInvoice((current) => current.map((line) => {
      const item = updateItem(line.item);
      return { ...line, item, unitPrice: item.price, total: line.packageCount * item.price };
    }));
    setCatalogEntries((current) => current.map((entry) => ({
      ...entry,
      category: entry.categoryId === form.categoryId ? form.categoryName.trim() : entry.category,
      name: entry.productId === form.productId ? form.productName.trim() : entry.name,
      displayName: entry.variantId === form.variantId ? form.variantDisplayName.trim() : entry.displayName,
      spec: entry.variantId === form.variantId ? form.rawSpecification.trim() : entry.spec,
    })));
    setSelected({ name: form.productName.trim(), spec: form.rawSpecification.trim() });
    setCatalogEditor(null);
  }

  async function save(itemId: number, raw: string) {
    if (!navigator.onLine) {
      setError("Đang ngoại tuyến: chỉ xem được bảng giá đã lưu. Hãy kết nối mạng để sửa giá.");
      setEditing(null);
      return;
    }
    const amount = parsePriceInput(raw);
    const parsed = amount === null ? null : priceSchema.safeParse(amount);
    const item = items.find((candidate) => candidate.id === itemId);
    if (!parsed?.success || !item) {
      if (!parsed?.success) setError("Giá phải là số không âm, tối đa 2 chữ số thập phân.");
      setEditing(null);
      return;
    }
    setError("");
    let updated;
    try {
      updated = await updatePrice({ priceId: item.priceId, amount: parsed.data, expectedVersion: item.version, reason: "Cập nhật từ ứng dụng" }, navigator.onLine);
    } catch (writeError) {
      setError(priceWriteErrorMessage(writeError));
      setEditing(null);
      return;
    }
    setItems((current) => current.map((row) => row.id === itemId
      ? { ...row, price: updated.amount, version: updated.version }
      : row));
    setInvoice((current) => current.map((line) => line.item.priceId === item.priceId
      ? { ...line, item: { ...line.item, price: updated.amount, version: updated.version }, unitPrice: updated.amount, total: line.packageCount * updated.amount }
      : line));
    setHistory((current) => [...current, {
      itemId,
      historyId: updated.historyId,
      oldAmount: item.price,
      expectedVersion: updated.version,
    }]);
    setEditing(null);
  }

  async function undo() {
    if (!navigator.onLine) {
      setError("Đang ngoại tuyến: không thể hoàn tác sửa giá. Hãy kết nối mạng rồi thử lại.");
      return;
    }
    const last = history.at(-1);
    if (!last) return;
    let updated;
    try {
      updated = await undoPrice({ historyId: last.historyId, expectedVersion: last.expectedVersion }, navigator.onLine);
    } catch (writeError) {
      setError(priceWriteErrorMessage(writeError));
      return;
    }
    setItems((current) => current.map((row) => row.id === last.itemId
      ? { ...row, price: updated.amount, version: updated.version }
      : row));
    const item = items.find((row) => row.id === last.itemId);
    if (item) setInvoice((current) => current.map((line) => line.item.priceId === item.priceId
      ? { ...line, item: { ...line.item, price: updated.amount, version: updated.version }, unitPrice: updated.amount, total: line.packageCount * updated.amount }
      : line));
    setHistory((current) => current.slice(0, -1));
  }
  return (
    <div className="min-h-screen">
      <header className="pos-header">
        <div className="pos-header-inner">
          <Link href="/staff#sales-workspace" className="pos-brand" aria-label="Giá Chuẩn - về tra cứu"><span className="pos-brand-mark">đ</span><span className="pos-brand-copy"><b>Giá Chuẩn</b><small>Khu vực nhân viên</small></span></Link>
          <nav className="pos-top-nav" aria-label="Điều hướng chính"><Link href="/staff#sales-workspace" className="pos-nav-active">Tra cứu & bán hàng</Link><Link href="/questions" className="pos-nav-item">Hỏi giá</Link><Button type="button" className="pos-nav-item" onClick={() => setCustomerOrdersOpen(true)}><ClipboardList size={15}/> Đơn khách đặt</Button><Button type="button" className="pos-nav-item" onClick={() => document.getElementById("invoice-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Báo giá quầy</Button><Button type="button" className="pos-nav-item" onClick={() => selected ? setDetailOpen(true) : document.getElementById("product-search")?.focus()}>Cập nhật & sửa giá</Button></nav>
          <div className="pos-header-actions"><div className="pos-live-badge">{online && serverAvailable ? <Wifi size={13}/> : <WifiOff size={13}/>}<span>{synced ? (online && serverAvailable ? "ĐÃ CẬP NHẬT" : "ĐANG XEM BẢN LƯU") : online && serverAvailable ? "ĐANG KẾT NỐI" : "NGOẠI TUYẾN"}</span></div><span className="pos-header-count">{loading ? "Đang tải…" : items.length + " mức giá"}</span><Button type="button" onClick={() => setInvoiceOpen(true)} className="pos-invoice-button"><ShoppingCart size={18}/><span>Báo giá</span><b>{activeInvoice.length}</b></Button>{logout && <Button type="button" onClick={() => void logout()} className="pos-logout-button">Đăng xuất</Button>}</div>
        </div>
      </header>
      <main className="pos-main">
        {error && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
        <div className="pos-shift-bar"><div className="pos-shift-title"><span className="pos-shift-pulse"/> CA TRỰC · QUẦY CHÍNH <span className="pos-shift-note">Bảng giá vật tư · dữ liệu từ {new Set(items.flatMap(item => item.sourcePages)).size} trang nguồn</span></div><div className="pos-shift-meta"><span>{synced ? (online ? "Bảng giá đã đồng bộ" : "Đang dùng bảng giá đã lưu") : online ? "Đang tải dữ liệu Supabase…" : "Chưa có dữ liệu ngoại tuyến"}</span><span className="pos-meta-separator">•</span><span>{groups.length} nhóm hàng</span><span className="pos-meta-separator">•</span><span>{items.length} mức giá</span>{history.length > 0 && <Button type="button" className="pos-undo-button" onClick={undo}><RotateCcw size={13}/> Hoàn tác sửa giá</Button>}</div></div>
        {chatPriceReview && <section role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p>{chatPriceReview.requiresFreshCheck ? <>Đang ngoại tuyến nên chưa thể xác minh mức giá từ lúc hỏi đáp. Kết nối mạng và tải lại bảng giá trước khi thêm dòng này.</> : chatPriceReview.current ? <>Mức giá từ lúc hỏi đáp đã thay đổi (phiên bản {chatPriceReview.expectedVersion} → {chatPriceReview.current.version}). Giá hiện tại là <b>{formatVnd(chatPriceReview.current.price)}</b> / {displayItemPackageName(chatPriceReview.current)} ({chatPriceReview.current.packageQuantity} {chatPriceReview.current.unit} mỗi gói).</> : <>Mức giá từ lúc hỏi đáp đã hết hiệu lực hoặc không còn trong bảng giá hiện tại.</>} Hãy xem lại trước khi thêm vào báo giá.</p>{chatPriceReview.requiresFreshCheck ? null : chatPriceReview.current ? <Button type="button" className="mt-2 rounded-lg bg-amber-900 px-3 py-2 font-bold text-white" onClick={() => { const reviewed = chatPriceReview.current!; setInvoice((current) => current.map((line) => line.item.priceId === reviewed.priceId ? { ...line, item: reviewed, unitPrice: reviewed.price, requestedQuantity: line.packageCount * reviewed.packageQuantity, total: line.packageCount * reviewed.price } : line)); setChatPriceReview((current) => current ? { ...current, acknowledged: true } : null); setError(""); }}>Xác nhận giá hiện tại</Button> : <Button type="button" className="mt-2 rounded-lg bg-amber-900 px-3 py-2 font-bold text-white" onClick={() => { setChatPriceReview(null); setQuery(""); }}>Chọn lại từ bảng giá hiện tại</Button>}</section>}
        <div className="pos-workspace">
          <section id="sales-workspace" className="pos-column pos-catalog-column">
            <div className="pos-panel pos-search-panel"><div className="pos-panel-heading"><div><p className="pos-eyebrow">F1 · TRA CỨU NHANH</p><h1>Tìm vật tư</h1></div><Search className="text-[var(--green)]" size={23}/></div><label htmlFor="product-search" className="sr-only">Tìm tên hàng hoặc quy cách</label><div className="pos-search-field"><Search size={20}/><TextInput id="product-search" value={query} onChange={event => setQuery(event.target.value)} aria-label="Tìm vật tư" placeholder="Tên hàng, mã hoặc quy cách…" autoComplete="off"/><kbd>F1</kbd></div>{!query && <div className="pos-quick-search">{recent.map(value => <Button key={value} type="button" onClick={() => setQuery(value)}>{value}</Button>)}</div>}</div>
            <div className="pos-panel pos-results-panel"><div className="pos-panel-heading"><div><p className="pos-eyebrow">DANH MỤC VẬT TƯ</p><h2>{query ? "Kết quả tìm kiếm" : "Chọn mặt hàng"}</h2></div><span className="pos-result-count">{loading ? "…" : error && items.length === 0 && catalogEntries.length === 0 ? "—" : shown.length}</span></div>{error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}<div className="pos-product-list">{shown.map(group => <article key={group.category + "-" + group.name} className="pos-product-card"><div className="pos-product-heading"><div><span className="pos-category-label">{group.category}</span><h3>{group.name}</h3></div><span className="pos-product-price">{group.minPrice === null ? "Chưa có giá" : "Từ " + formatVnd(group.minPrice)}</span></div><div className="pos-variant-list">{group.variants.map(spec => <Button key={spec} type="button" onClick={() => { setDetailOpen(false); setSelected({ name: group.name, spec }); }} className={"pos-variant-chip " + (selected?.name === group.name && selected.spec === spec ? "pos-variant-selected" : "")}><span>{displaySpecification(spec)}</span><small>{group.items.filter(item => item.variantSpec === spec).length ? group.items.filter(item => item.variantSpec === spec).length + " giá" : "Chưa có giá"}</small></Button>)}</div>{group.wholesaleFrom !== null && <p className="pos-wholesale-hint">Giá sỉ từ {group.wholesaleFrom} {group.unit}</p>}</article>)}{!loading && shown.length === 0 && (error && items.length === 0 && catalogEntries.length === 0 ? <div className="pos-empty-small"><WifiOff size={22}/><span>Chưa tải được danh mục. Hãy thử tải lại khi có kết nối.<Button type="button" onClick={() => window.location.reload()} className="ml-2 min-h-11 rounded-md border border-[var(--line)] bg-white px-3 py-2 font-semibold">Thử tải lại</Button></span></div> : <div className="pos-empty-small"><Package size={22}/><span>Không tìm thấy mặt hàng phù hợp.</span></div>)}</div></div>
          </section>
          <section className="pos-column pos-detail-column" aria-label="Chi tiết mặt hàng">{selected ? <div className="pos-panel pos-detail-panel"><div className="pos-panel-heading"><div><p className="pos-eyebrow">MẶT HÀNG ĐANG CHỌN</p><h2>{selected.name}</h2></div><Button type="button" className="pos-close-detail" onClick={() => setSelected(null)} aria-label="Bỏ chọn mặt hàng"><X size={18}/></Button></div><div className="pos-spec-banner"><div><span className="pos-category-label">QUY CÁCH</span><b>{displaySpecification(selected.spec)}</b></div><Button type="button" onClick={() => setDetailOpen(true)}><Pencil size={15}/> Chi tiết & sửa</Button></div><div className="pos-source-row"><span>{selectedSourcePages.length ? "Nguồn sổ: trang " + selectedSourcePages.join(", ") : "Chưa gắn trang nguồn"}</span>{selectedSourceFiles.map(file => <Button key={file} type="button" onClick={() => openSourceImage(file)} disabled={openingSource !== null}><ImageIcon size={14}/>{openingSource === file ? "Đang mở…" : "Xem ảnh"}</Button>)}</div>{sourceImageError && <p role="alert" className="my-2 text-xs font-bold text-red-700">{sourceImageError}</p>}<div className="pos-suggestion"><label htmlFor="retail-package-count">Số lượng theo gói lẻ nhỏ nhất ({Number.isFinite(smallestRetailQuantity) ? smallestRetailQuantity : "?"} {retailUnit ?? "đơn vị"}/gói)</label><TextInput id="retail-package-count" inputMode="numeric" pattern="[0-9]*" value={retailPackageCount} onChange={event => setRetailPackageCount(event.target.value.replace(/\D/g, ""))} aria-describedby="retail-package-help"/><p id="retail-package-help">{suggestedPrice ? <>Gợi ý: {suggestedPrice.packageCount} × {displayItemPackageName(suggestedPrice.item)} · <strong>{formatVnd(suggestedPrice.item.price)}/gói</strong> · thành tiền <strong>{formatVnd(suggestedPrice.total)}</strong></> : "Chưa có dòng giá đủ điều kiện và bao bì khớp chính xác số lượng này."}</p><Button type="button" disabled={!suggestedPrice} onClick={() => { if (suggestedPrice) addToInvoice({ ...suggestedPrice, unitPrice: suggestedPrice.item.price, requestedQuantity: suggestedPrice.packageCount * suggestedPrice.item.packageQuantity }); }}>Thêm mức giá gợi ý vào báo giá</Button></div><div className="pos-price-list">{priceOptions.length ? priceOptions.map(option => <article className="pos-price-card" key={option.item.priceId}><div className="pos-price-card-top"><div><span className={"pos-tier-badge " + (option.item.priceType === "wholesale" ? "pos-tier-wholesale" : "")}>{displayPriceType(option.item)}</span><b>{displayItemPackageName(option.item)}</b></div><span className={"pos-verification " + (option.item.status === "verified" ? "pos-verified" : "")}>{option.item.status === "verified" ? "Đã duyệt" : option.item.status === "unreadable" ? "Khó đọc" : "Cần đối chiếu"}</span></div><p className="pos-min-quantity">{option.item.packageQuantity} {option.item.unit} / {displayItemPackageName(option.item)}{option.item.minimumQuantity > 1 ? " · tối thiểu " + option.item.minimumQuantity + " gói" : ""}</p><div className="pos-price-amount">{formatVnd(option.unitPrice)}</div><div className="pos-quantity-control"><Button type="button" aria-label={"Giảm " + displayItemPackageName(option.item)} onClick={() => setPackageCounts(current => ({ ...current, [option.item.priceId]: String(Math.max(0, option.packageCount - 1)) }))}>−</Button><TextInput aria-label={"Số lượng " + displayItemPackageName(option.item)} inputMode="numeric" value={packageCounts[option.item.priceId] ?? "0"} onChange={event => setPackageCounts(current => ({ ...current, [option.item.priceId]: event.target.value.replace(/\D/g, "") }))}/><Button type="button" aria-label={"Tăng " + displayItemPackageName(option.item)} onClick={() => setPackageCounts(current => ({ ...current, [option.item.priceId]: String(option.packageCount + 1) }))}>+</Button><span>{option.requestedQuantity} {option.item.unit}</span></div>{option.item.priceType === "wholesale" && option.item.packageNote.includes("Chưa rõ số lượng tối thiểu") && <p className="pos-price-warning">Chưa xác nhận ngưỡng áp dụng giá sỉ.</p>}<div className="pos-price-card-footer"><span>Tạm tính <b>{formatVnd(option.total)}</b></span><Button type="button" disabled={!option.eligible} onClick={() => addToInvoice(option)}><ShoppingCart size={16}/>{option.eligible ? "Thêm vào báo giá" : option.packageCount === 0 ? "Nhập số gói" : "Chưa đủ điều kiện"}</Button></div></article>) : <div className="pos-no-prices"><Package size={28}/><b>Chưa có giá cho quy cách này</b><span>Có thể kiểm tra ảnh nguồn hoặc cập nhật dữ liệu.</span><Button type="button" onClick={() => setDetailOpen(true)}><Pencil size={15}/> Mở chi tiết sản phẩm</Button></div>}</div><div className="pos-detail-bottom"><Button type="button" onClick={() => setDetailOpen(true)}><ImageIcon size={16}/> Đối chiếu sổ giá</Button>{selectedPrices.some(item => item.status !== "verified") && <span>Giá cần đối chiếu trước khi dùng</span>}</div></div> : <div className="pos-panel pos-selection-empty"><span className="pos-empty-icon"><Package size={28}/></span><p className="pos-eyebrow">CHI TIẾT GIAO DỊCH</p><h2>Chọn một quy cách</h2><p>Chọn sản phẩm ở cột trái để xem các mức giá, nguồn sổ và thêm số lượng vào báo giá.</p><Link href="/questions" className="pos-ask-link"><MessageCircle size={17}/> Hỏi giá bằng câu tự nhiên</Link><div className="pos-step-note"><span>1</span> Tìm mặt hàng <span>2</span> Chọn quy cách <span>3</span> Thêm vào báo giá</div></div>}</section>
          <aside id="invoice-panel" className="pos-column pos-invoice-column"><div className="pos-panel pos-invoice-panel"><div className="pos-panel-heading"><div><p className="pos-eyebrow">F4 · BÁO GIÁ</p><h2>Báo giá quầy</h2></div><Button type="button" className="pos-icon-action" onClick={() => setInvoiceOpen(true)} aria-label="Mở báo giá đầy đủ"><ShoppingCart size={18}/></Button></div><div className="pos-customer-note"><span className="pos-customer-icon"><Package size={17}/></span><div><b>Báo giá tạm tính</b><small>{activeInvoice.length} mặt hàng · lưu trên thiết bị này</small></div></div><div className="pos-invoice-lines">{activeInvoice.length ? activeInvoice.map((line, index) => <article key={line.key} className="pos-invoice-line"><div className="pos-invoice-line-head"><span className="pos-line-number">{index + 1}</span><b>{line.item.name}</b><Button type="button" aria-label={"Xóa " + line.item.name + " khỏi báo giá"} onClick={() => setInvoice(current => current.filter(item => item.key !== line.key))}><Trash2 size={15}/></Button></div><p>{displaySpecification(line.item.variantSpec)} · {line.requestedQuantity} {line.item.unit}</p><div><span>{line.packageCount} × {formatVnd(line.unitPrice)}</span><b>{formatVnd(line.total)}</b></div></article>) : <div className="pos-invoice-empty"><ShoppingCart size={24}/><span>Chưa có sản phẩm trong báo giá.</span></div>}</div><div className="pos-invoice-total"><span>TỔNG CỘNG</span><strong>{formatVnd(activeInvoice.reduce((sum, line) => sum + line.total, 0))}</strong><small>Giá theo quy cách đã chọn · VND</small></div><Button type="button" className="pos-open-invoice" onClick={() => setInvoiceOpen(true)}><ShoppingCart size={17}/> Xem & sao chép báo giá <kbd>F4</kbd></Button>{invoice.length > 0 && <Button type="button" className="pos-clear-invoice" onClick={() => setInvoice([])}>Xóa toàn bộ báo giá</Button>}<div className="pos-invoice-footnote"><ShieldCheck size={15}/> Giá lấy từ bảng hiện tại; chưa thực hiện thanh toán.</div></div></aside>
        </div>
        <p className="pos-sync-note">{synced ? "Đồng bộ dữ liệu: " + new Date(synced).toLocaleString("vi-VN") : "Đang chờ đồng bộ dữ liệu Supabase"}</p>
        {syncMessage && <p role="status" className="pos-sync-note">{syncMessage}</p>}
      </main>
      {selected && detailOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <section
            ref={detailDialogRef}
            role="dialog"
            aria-modal={!catalogEditor}
            aria-hidden={Boolean(catalogEditor)}
            aria-labelledby="price-dialog-title"
            className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-[var(--card)] p-5 shadow-2xl sm:rounded-3xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase text-[var(--green)]">
                  Chọn giá cho báo giá
                </p>
                <h2
                  id="price-dialog-title"
                  className="mt-1 text-2xl font-black"
                >
                  {selected.name}
                </h2>
                <Button
                  type="button"
                  onClick={() => openCatalogEditor(recommended?.item)}
                  className="group mt-0.5 flex items-center gap-1.5 text-left text-[var(--muted)]"
                  title="Bấm để sửa quy cách"
                >
                  Quy cách:{" "}
                  <b className="text-[var(--ink)] group-hover:text-[var(--green)]">
                    {displaySpecification(selected.spec)}
                  </b>
                  <Pencil size={13} className="text-[var(--green)]" />
                </Button>
                <p className="mt-1 text-sm font-bold text-amber-700">
                  {selectedSourcePages.length > 0
                    ? `Đối chiếu: Trang ${selectedSourcePages.join(", ")}`
                    : "Chưa có số trang nguồn"}
                </p>
                <div className="mt-2 flex max-w-[calc(100vw-7rem)] flex-nowrap gap-2 overflow-x-auto pb-1 sm:max-w-none">
                  {selectedSourceFiles.length > 0 && (
                    <>
                    {selectedSourceFiles.map((file) => (
                      <Button
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
                      </Button>
                    ))}
                    </>
                  )}
                  <Button
                    type="button"
                    onClick={() => openCatalogEditor(recommended?.item)}
                    className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--lime)] px-3 py-1.5 text-xs font-black text-[var(--ink)]"
                  >
                    <Pencil size={14} /> Sửa giá & thông tin
                  </Button>
                </div>
                {sourceImageError && (
                  <p role="alert" className="mt-2 text-xs font-bold text-red-700">
                    Không mở được ảnh: {sourceImageError}
                  </p>
                )}
              </div>
              <Button
                onClick={() => setSelected(null)}
                aria-label="Đóng"
                className="grid size-10 place-items-center rounded-full bg-[#edf1e8]"
              >
                <X size={20} />
              </Button>
            </div>
            <div className="mt-5 grid gap-3">
              {selectedPrices.length === 0 && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Quy cách này đã được nhập từ ảnh nguồn nhưng giá chưa đủ rõ
                  để ghi nhận. Hãy đối chiếu ảnh trước khi bổ sung giá.
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
                    <Button
                      onClick={() => setEditing(option.item.id)}
                      className="money flex items-center gap-1 text-xl font-black"
                      aria-label={`Sửa giá ${option.item.name}`}
                    >
                      {formatVnd(option.item.price)} <Pencil size={13} />
                    </Button>
                  </div>
                  {editing === option.item.id && (
                    <TextInput
                      autoFocus
                      defaultValue={option.item.price}
                      inputMode="decimal"
                      aria-label={`Giá mới của ${option.item.name} bằng VND`}
                      onKeyDown={(event) => {
                        if (event.key === "Enter")
                          save(option.item.id, event.currentTarget.value);
                        if (event.key === "Escape") setEditing(null);
                      }}
                      className="mt-3 w-full rounded-xl border-2 border-[var(--green)] px-3 py-2 text-xl font-black"
                    />
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      type="button"
                      onClick={() =>
                        setPackageCounts((current) => ({
                          ...current,
                          [option.item.priceId]: String(
                            Math.max(0, option.packageCount - 1),
                          ),
                        }))
                      }
                      aria-label={`Giảm ${displayItemPackageName(option.item)}`}
                      className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#edf1e8] text-xl font-black text-[var(--green)]"
                    >
                      âˆ’
                    </Button>
                    <TextInput
                      value={packageCounts[option.item.priceId] ?? "0"}
                      onChange={(event) =>
                        setPackageCounts((current) => ({
                          ...current,
                          [option.item.priceId]: event.target.value.replace(/\D/g, ""),
                        }))
                      }
                      inputMode="numeric"
                      aria-label={`Số lượng ${displayItemPackageName(option.item)}`}
                      className="h-11 min-w-0 flex-1 rounded-xl border-2 border-[var(--green)] bg-white text-center text-xl font-black"
                    />
                    <Button
                      type="button"
                      onClick={() =>
                        setPackageCounts((current) => ({
                          ...current,
                          [option.item.priceId]: String(option.packageCount + 1),
                        }))
                      }
                      aria-label={`Tăng ${displayItemPackageName(option.item)}`}
                      className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--green)] text-xl font-black text-white"
                    >
                      +
                    </Button>
                  </div>
                  <p className="mt-1 text-center text-xs text-[var(--muted)]">
                    {option.packageCount} × {option.item.packageQuantity} ={" "}
                    <b>{option.requestedQuantity} {option.item.unit}</b>
                  </p>
                  {option.item.priceType === "wholesale" &&
                    option.item.packageNote.includes("Chưa rõ số lượng tối thiểu") && (
                      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                        Chưa rõ số lượng tối thiểu để áp dụng giá sỉ. Chỉ dùng
                        giá này sau khi xác nhận khách mua đủ số lượng.
                      </p>
                    )}
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
                    <p className="money text-2xl font-black">{formatVnd(option.total)}</p>
                    <Button
                      onClick={() => addToInvoice(option)}
                      disabled={!option.eligible}
                      className="rounded-xl bg-[var(--green)] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                      {option.eligible
                        ? "Thêm vào báo giá"
                        : "Nhập số lượng"}
                    </Button>
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
            ref={catalogDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-editor-title"
            className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[var(--card)] p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase text-[var(--green)]">
                  Chỉnh sửa dữ liệu gốc
                </p>
                <h2 id="catalog-editor-title" className="text-2xl font-black">
                  Sửa giá & thông tin
                </h2>
              </div>
              <Button
                type="button"
                onClick={() => setCatalogEditor(null)}
                aria-label="Đóng trình sửa"
                className="grid size-10 place-items-center rounded-full bg-[#edf1e8]"
              >
                <X size={20} />
              </Button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["Tên nhóm sản phẩm", "categoryName"],
                ["Tên sản phẩm", "productName"],
                ["Tên biến thể", "variantDisplayName"],
                ["Thông tin / quy cách", "rawSpecification"],
              ].map(([label, field]) => (
                <label key={field} className="text-sm font-bold">
                  {label}
                  <TextInput
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
                  Đóng gói và giá
                </h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-sm font-bold">
                    Tên đóng gói
                    <TextInput
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
                    Số lượng đóng gói
                    <TextInput
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
                    Đơn vị tính
                    <TextInput
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
                    Loại giá
                    <Select
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
                      <option value="retail">Giá lẻ</option>
                      <option value="wholesale">Giá sỉ</option>
                      <option value="dealer">Giá đại lý</option>
                    </Select>
                  </label>
                  <label className="text-sm font-bold">
                    Số lượng tối thiểu
                    <TextInput
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
                    Giá bán (VND)
                    <TextInput
                      value={catalogEditor.amount}
                      onChange={(event) =>
                        setCatalogEditor((current) =>
                          current
                            ? { ...current, amount: event.target.value }
                            : current,
                        )
                      }
                      inputMode="decimal"
                      aria-describedby="catalog-price-help"
                      className="money mt-1 h-11 w-full rounded-xl border-2 border-[var(--green)] bg-white px-3 font-black"
                    />
                    <span id="catalog-price-help" className="mt-1 block text-xs font-normal text-[var(--muted)]">Dùng dấu phẩy hoặc dấu chấm cho tối đa 2 chữ số lẻ.</span>
                  </label>
                </div>
              </>
            ) : (
              <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
                Quy cách này chưa có giá. Bạn vẫn có thể sửa nhóm, sản phẩm và
                thông tin biến thể; chức năng tạo giá mới sẽ cần bảng giá và
                quy cách đóng gói riêng.
              </p>
            )}
            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                onClick={() => setCatalogEditor(null)}
                className="rounded-xl border border-[var(--line)] px-5 py-2.5 font-bold"
              >
                Hủy
              </Button>
              <Button
                type="button"
                onClick={saveCatalogEditor}
                disabled={savingCatalog}
                className="rounded-xl bg-[var(--green)] px-5 py-2.5 font-bold text-white disabled:opacity-60"
              >
                {savingCatalog ? "Đang lưu…" : "Lưu tất cả thay đổi"}
              </Button>
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
            ref={invoiceDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-title"
            className="flex h-full w-full max-w-4xl flex-col bg-[var(--card)] shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-[var(--line)] p-5">
              <div>
                <p className="text-xs font-bold uppercase text-[var(--green)]">
                  Báo giá tạm tính
                </p>
                <h2 id="invoice-title" className="text-2xl font-black">
                  {activeInvoice.length} sản phẩm
                </h2>
              </div>
              <Button
                onClick={() => setInvoiceOpen(false)}
                aria-label="Đóng báo giá"
                className="grid size-10 place-items-center rounded-full bg-[#edf1e8]"
              >
                <X />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {!loading && activeInvoice.length < invoice.length && <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Một số mức giá chưa được duyệt hoặc không còn hiệu lực; chúng không được đưa vào báo giá. Hãy chọn lại mức giá đã duyệt.</p>}
              {!loading && activeInvoice.some((line) => line.priceChanged) && <div role="alert" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p>Giá hoặc bao bì đã đổi kể từ lúc thêm vào báo giá. Đơn giá hiện tại được hiển thị bên dưới; hãy xem lại và xác nhận trước khi sao chép báo giá.</p><Button type="button" className="mt-2 rounded-lg bg-amber-900 px-3 py-2 font-bold text-white" onClick={() => setInvoice((current) => current.map((saved) => {
                const latest = activeInvoice.find((line) => line.key === saved.key);
                return latest?.priceChanged ? { ...saved, item: latest.item, unitPrice: latest.item.price, total: latest.packageCount * latest.item.price, requestedQuantity: latest.packageCount * latest.item.packageQuantity } : saved;
              }))}>Xác nhận giá hiện tại cho {activeInvoice.filter((line) => line.priceChanged).length} dòng</Button></div>}
              {activeInvoice.length === 0 ? (
                <div className="py-16 text-center">
                  <ShoppingCart className="mx-auto mb-3" />
                  <b>Báo giá đang trống</b>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Tìm sản phẩm và chọn “Thêm vào báo giá”.
                  </p>
                </div>
              ) : (
                <div className="invoice-lines overflow-x-auto rounded-xl border border-[var(--line)] bg-white">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead className="bg-[#edf1e8] text-left text-xs uppercase text-[var(--muted)]">
                      <tr>
                        <th className="px-3 py-3">Sản phẩm</th>
                        <th className="px-3 py-3">Quy cách</th>
                        <th className="px-3 py-3 text-right">Số lượng</th>
                        <th className="px-3 py-3 text-right">Đơn giá</th>
                        <th className="px-3 py-3 text-right">Thành tiền</th>
                        <th className="w-10 px-2 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {activeInvoice.map((line) => (
                        <tr key={line.key} className="border-t border-[var(--line)] align-top">
                          <td className="px-3 py-3 font-black">{line.item.name}</td>
                          <td className="px-3 py-3">
                            <b>{displaySpecification(line.item.variantSpec)}</b>
                            <p className="mt-0.5 whitespace-nowrap text-xs text-[var(--muted)]">
                              {priceTierLabel(line.item.priceType)} · {line.item.priceType === "wholesale"
                                ? `${line.packageCount} bịch × ${line.item.packageQuantity} ${line.item.unit}`
                                : `${line.packageCount} ${displayItemPackageName(line.item)}`}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-right font-bold">
                            {line.requestedQuantity} {line.item.unit}
                          </td>
                          <td className="money whitespace-nowrap px-3 py-3 text-right">
                            {formatVnd(line.item.price)}
                            <p className="text-xs text-[var(--muted)]">
                              /{displayItemPackageName(line.item)}
                            </p>
                          </td>
                          <td className="money whitespace-nowrap px-3 py-3 text-right text-base font-black">
                            {formatVnd(line.total)}
                          </td>
                          <td className="px-2 py-3 text-center">
                            <Button
                              onClick={() =>
                                setInvoice((current) =>
                                  current.filter((item) => item.key !== line.key),
                                )
                              }
                              aria-label={`Xóa ${line.item.name} khỏi báo giá`}
                              className="text-red-600"
                            >
                              <Trash2 size={17} />
                            </Button>
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
                <span className="font-bold">Tổng cộng</span>
                <strong className="money text-3xl">
                  {formatVnd(
                    activeInvoice.reduce((sum, line) => sum + line.total, 0),
                  )}
                </strong>
              </div>
              {quoteMessage && <p role="status" className="mb-3 rounded-lg bg-[#e9eee8] p-3 text-sm text-[var(--green)]">{quoteMessage}</p>}
              <Button type="button" onClick={copyQuote} disabled={activeInvoice.length === 0 || activeInvoice.length !== invoice.length || activeInvoice.some((line) => line.priceChanged)} className="mb-2 h-12 w-full rounded-xl bg-[var(--lime)] font-bold text-[var(--ink)] disabled:opacity-50">Sao chép báo giá</Button>
              <Button
                onClick={() => {
                  setInvoiceOpen(false);
                  setQuery("");
                  setTimeout(
                    () =>
                      document
                        .querySelector<HTMLInputElement>(
                          '[aria-label="Tìm vật tư"]',
                        )
                        ?.focus(),
                    0,
                  );
                }}
                className="h-12 w-full rounded-xl bg-[var(--green)] font-bold text-white"
              >
                Thêm sản phẩm khác
              </Button>
              {activeInvoice.length > 0 && (
                <Button
                  onClick={() => setInvoice([])}
                  className="mt-2 h-10 w-full text-sm font-bold text-red-700"
                >
                  Xóa báo giá
                </Button>
              )}
            </footer>
          </aside>
        </div>
      )}
      {customerOrdersOpen && <CustomerOrderInbox onClose={() => setCustomerOrdersOpen(false)} />}
      <nav className="mobile-nav sm:hidden" aria-label="Điều hướng chính">
        <Link href="/staff" className="active" aria-current="page"><Home size={20} />Tra giá</Link>
        <a href="/questions"><Search size={20} />Hỏi giá</a>
        <Button type="button" onClick={() => setCustomerOrdersOpen(true)}><ClipboardList size={20} />Đơn khách</Button>
        <Button type="button" onClick={() => setInvoiceOpen(true)}><ShoppingCart size={20} />Báo giá {activeInvoice.length > 0 ? `(${activeInvoice.length})` : ""}</Button>
      </nav>
   </div>
  );
}
