"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, Label, Spinner, TextInput } from "flowbite-react";
import { ArrowLeft, Check, ChevronRight, ExternalLink, RefreshCw, Save, Search, WifiOff, X } from "lucide-react";
import { formatMinimumPackageQuantity, formatPackageContents } from "@/features/pricing/package-display";
import { formatVnd, parsePriceInput, priceSchema, priceWriteErrorMessage } from "@/features/pricing/validation";
import { matchesCatalogQuery } from "@/features/search/parser";
import { cacheSnapshot, readSnapshot } from "@/features/offline/cache";
import { ApiRequestError, requestApi } from "@/lib/api/client";
import { fetchCatalog, type CatalogEntry, type CatalogPrice } from "@/lib/api/catalog";
import { updatePrice } from "@/lib/api/prices";

type StaffRole = "owner" | "editor" | "viewer";
type CatalogSnapshot = { entries: CatalogEntry[]; prices: CatalogPrice[]; syncedAt: string };

function verificationLabel(status: CatalogEntry["verificationStatus"] | CatalogPrice["status"]) {
  return status === "verified" ? "Đã xác minh" : status === "unreadable" ? "Khó đọc" : "Cần đối chiếu";
}

function priceTypeLabel(priceType: string) {
  return priceType === "wholesale" ? "Giá sỉ" : priceType === "retail" ? "Giá lẻ" : "Giá khác";
}

function formatDate(value: string | null) {
  if (!value) return "Không đặt ngày kết thúc";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Ngày hiệu lực chưa rõ" : parsed.toLocaleDateString("vi-VN");
}

export function StaffPriceManagement() {
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [syncedAt, setSyncedAt] = useState("");
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [roleError, setRoleError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [amountDraft, setAmountDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [online, setOnline] = useState(true);

  const load = useCallback(async () => {
    setLoadError("");
    setLoading(true);
    let hasCachedCatalog = false;
    try {
      const [cachedPrices, cachedEntries] = await Promise.all([
        readSnapshot<CatalogPrice[]>("catalog"),
        readSnapshot<CatalogEntry[]>("catalog-entries"),
      ]);
      if (cachedPrices && cachedEntries) {
        hasCachedCatalog = true;
        setCatalog({ entries: cachedEntries.data, prices: cachedPrices.data, syncedAt: cachedPrices.syncedAt });
        setSyncedAt(cachedPrices.syncedAt);
        setStale(true);
      }
    } catch { /* Cache is best effort; online data remains authoritative. */ }

    const [catalogResult, roleResult] = await Promise.allSettled([
      fetchCatalog(),
      requestApi<{ userId: string; role: StaffRole }>("/api/v1/me"),
    ]);
    if (roleResult.status === "fulfilled") {
      setRole(roleResult.value.role);
      setRoleError("");
    } else {
      setRole(null);
      setRoleError("Chưa xác minh được quyền tài khoản; trang đang ở chế độ chỉ xem.");
    }

    if (catalogResult.status === "fulfilled") {
      const fresh = catalogResult.value;
      const snapshot = { entries: fresh.entries, prices: fresh.prices, syncedAt: fresh.syncedAt };
      setCatalog(snapshot);
      setSyncedAt(fresh.syncedAt);
      setStale(false);
      await Promise.allSettled([
        cacheSnapshot("catalog", fresh.prices),
        cacheSnapshot("catalog-entries", fresh.entries),
      ]);
    } else if (hasCachedCatalog) {
      setLoadError("Không tải được bảng giá mới. Đang xem bản lưu chỉ đọc.");
    } else {
      setCatalog(null);
      setLoadError("Không tải được danh mục. Kiểm tra kết nối rồi thử lại.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const updateNetwork = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
    };
  }, [load]);

  const results = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim();
    return catalog.entries.filter(entry => matchesCatalogQuery(needle, [
      entry.category, entry.name, entry.displayName, entry.spec, entry.productCode ?? "", ...entry.aliases,
      ...catalog.prices.filter(price => price.variantId === entry.variantId).map(price => `${price.packageName} ${price.priceType} ${price.supplier}`),
    ].join(" ")));
  }, [catalog, query]);
  const selected = catalog?.entries.find(entry => entry.variantId === selectedVariantId) ?? null;
  const selectedPrices = catalog?.prices.filter(price => price.variantId === selectedVariantId) ?? [];
  const canEditPrice = (role === "owner" || role === "editor") && online && !stale;

  async function savePrice(price: CatalogPrice) {
    if (!canEditPrice || saving) return;
    const amount = parsePriceInput(amountDraft);
    if (amount === null || !priceSchema.safeParse(amount).success) {
      setSaveError("Giá phải là số không âm, tối đa 2 chữ số thập phân.");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const updated = await updatePrice({ priceId: price.priceId, amount, expectedVersion: price.version, reason: "Cập nhật từ màn hình quản lý giá" }, online);
      const nextPrices = catalog?.prices.map(item => item.priceId === price.priceId ? { ...item, price: updated.amount, version: updated.version } : item) ?? [];
      setCatalog(current => current ? { ...current, prices: nextPrices } : current);
      setEditingPriceId(null);
      setSaveMessage(`Đã cập nhật ${priceTypeLabel(price.priceType).toLowerCase()}; phiên bản mới ${updated.version}.`);
      await cacheSnapshot("catalog", nextPrices).catch(() => undefined);
    } catch (error) {
      setSaveError(priceWriteErrorMessage(error));
      if (error instanceof ApiRequestError && error.status === 409) {
        await load();
        setSaveError("Giá hoặc phiên bản đã đổi. Đã tải lại dữ liệu; hãy kiểm tra mức giá mới trước khi sửa tiếp.");
      }
    } finally {
      setSaving(false);
    }
  }

  return <main className="min-h-screen bg-gray-50 text-gray-900">
    <header className="app-blue-navbar border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
        <Link href="/staff" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-gray-600 hover:text-blue-700"><ArrowLeft size={17}/>Quay lại khu vực nhân viên</Link>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Điều hướng nhân viên"><Link className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100" href="/staff">Tra cứu & bán hàng</Link><Link className="rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white" href="/staff/prices" aria-current="page">Cập nhật & sửa giá</Link><Link className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100" href="/questions">Hỏi đáp AI</Link></nav>
      </div>
    </header>
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">Danh mục nội bộ</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Cập nhật & sửa giá</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">Tìm đúng mã hàng và quy cách trước khi cập nhật. Giá được lưu theo từng bao bì và giữ nguyên phiên bản để đối chiếu lịch sử.</p></div>
        <Button color="light" onClick={() => void load()} disabled={loading} aria-label="Tải lại danh mục"><RefreshCw size={16} className="mr-2"/>Tải lại</Button>
      </div>

      {roleError && <Alert color="warning" className="mb-4" role="status">{roleError}</Alert>}
      {loadError && <Alert color={stale ? "warning" : "failure"} className="mb-4"><div className="flex items-start gap-2"><WifiOff size={17} className="mt-0.5 shrink-0"/><span>{loadError}{stale && syncedAt && <span className="mt-1 block text-xs">Bản lưu lúc {new Date(syncedAt).toLocaleString("vi-VN")} · Không thể sửa giá khi dữ liệu chưa đồng bộ.</span>}</span></div></Alert>}
      {saveError && <Alert color="failure" className="mb-4" role="alert">{saveError}</Alert>}
      {saveMessage && <Alert color="success" className="mb-4" role="status">{saveMessage}</Alert>}

      {loading && !catalog ? <div role="status" className="rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-600"><Spinner size="sm" className="mr-2"/>Đang tải danh mục và mức giá…</div>
        : !catalog ? <Card className="border-gray-200 shadow-none"><h2 className="font-semibold">Chưa có dữ liệu để hiển thị</h2><p className="text-sm text-gray-600">Kết nối máy chủ rồi tải lại danh mục.</p><Button className="w-fit" onClick={() => void load()}>Thử lại</Button></Card>
        : <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.4fr)]">
          <section className="min-w-0 rounded-lg border border-gray-200 bg-white" aria-label="Kết quả danh mục">
            <div className="border-b border-gray-200 p-4"><Label htmlFor="staff-price-search">Tìm theo tên, alias, SKU hoặc quy cách</Label><TextInput id="staff-price-search" className="mt-2" icon={Search} value={query} onChange={event => setQuery(event.target.value)} placeholder="Ví dụ: tắc kê đạn, TK-650, 6x50"/><p className="mt-2 text-xs text-gray-500">{results.length} kết quả{stale ? " · bản lưu chỉ đọc" : syncedAt ? ` · cập nhật ${new Date(syncedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}</p></div>
            {loading && catalog && <p role="status" className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">Đang kiểm tra bản mới…</p>}
            {stale && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">Đang xem bản lưu; mọi thao tác sửa đã khóa.</p>}
            {!results.length && !query.trim() && !catalog.entries.length ? <div className="p-5"><h2 className="font-semibold">Danh mục hiện chưa có mặt hàng</h2><p className="mt-1 text-sm text-gray-600">Sau khi dữ liệu được đồng bộ, mặt hàng sẽ xuất hiện tại đây.</p></div>
              : !results.length ? <div className="p-5"><h2 className="font-semibold">Không tìm thấy mặt hàng phù hợp</h2><p className="mt-1 text-sm text-gray-600">Thử tên gọi khác, SKU hoặc một phần quy cách.</p><Button color="light" size="sm" className="mt-3" onClick={() => setQuery("")}>Xóa từ khóa</Button></div>
                : <ul className="divide-y divide-gray-100">{results.map(entry => <li key={entry.variantId}><button type="button" onClick={() => { setSelectedVariantId(entry.variantId); setEditingPriceId(null); setSaveError(""); setSaveMessage(""); }} aria-current={selectedVariantId === entry.variantId ? "true" : undefined} className={`w-full p-4 text-left transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-700 ${selectedVariantId === entry.variantId ? "bg-blue-50" : ""}`}><span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block break-words font-semibold">{entry.name}</span><span className="mt-1 block break-words text-sm text-gray-600">{entry.displayName} · {entry.spec}</span><span className="mt-1 block text-xs text-gray-500">{entry.category}{entry.productCode ? ` · ${entry.productCode}` : ""}</span></span><span className="shrink-0 text-gray-400"><ChevronRight size={17}/></span></span><span className="mt-2 flex flex-wrap items-center gap-2"><Badge color={entry.verificationStatus === "verified" ? "success" : entry.verificationStatus === "unreadable" ? "failure" : "warning"}>{verificationLabel(entry.verificationStatus)}</Badge>{entry.aliases.slice(0, 2).map(alias => <span key={alias} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">{alias}</span>)}</span></button></li>)}</ul>}
          </section>

          <section className="min-w-0" aria-label="Chi tiết mặt hàng">
            {selected ? <Card className="border-gray-200 shadow-none">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{selected.category}{selected.productCode ? ` · ${selected.productCode}` : ""}</p><h2 className="mt-1 break-words text-xl font-semibold">{selected.name}</h2><p className="mt-1 break-words text-sm text-gray-600">{selected.displayName} · {selected.spec}</p>{selected.aliases.length > 0 && <p className="mt-2 text-sm text-gray-500">Tên gọi khác: {selected.aliases.join(", ")}</p>}</div><Badge color={selected.verificationStatus === "verified" ? "success" : selected.verificationStatus === "unreadable" ? "failure" : "warning"}>{verificationLabel(selected.verificationStatus)}</Badge></div>
              {role === "owner" && <Link href={`/staff?variantId=${selected.variantId}&edit=1`} className="inline-flex w-fit items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><ExternalLink size={15}/>Sửa thông tin hàng và bao bì</Link>}
              {selectedPrices.length === 0 ? <div className="rounded-md border border-dashed border-gray-300 p-5"><h3 className="font-medium">Chưa có giá hiện hành</h3><p className="mt-1 text-sm text-gray-600">Thông tin mặt hàng vẫn có thể được đối chiếu và bổ sung qua quy trình dữ liệu gốc.</p></div>
                : <div className="space-y-3">{selectedPrices.map(price => {
                  const contents = formatPackageContents(price.packageQuantity, price.unit);
                  const minimum = price.minimumQuantity > 1 ? formatMinimumPackageQuantity(price.minimumQuantity, price.packageName, price.packageQuantity, price.unit) : null;
                  return <article key={price.priceId} className="rounded-md border border-gray-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-gray-600">{priceTypeLabel(price.priceType)}</p><h3 className="mt-1 break-words text-base font-semibold">{price.packageName}</h3><p className="mt-1 text-sm text-gray-600">{contents ? `Chứa ${contents}` : "Số lượng trong bao bì chưa rõ"}{minimum ? ` · ${minimum}` : ""}</p></div><Badge color={price.status === "verified" ? "success" : price.status === "unreadable" ? "failure" : "warning"}>{verificationLabel(price.status)}</Badge></div>
                    <p className="mt-3 text-2xl font-semibold tabular-nums">{formatVnd(price.price)} <span className="text-sm font-normal text-gray-500">/ {price.packageName || "đơn vị bán chưa xác định"}</span></p>
                    <p className="mt-1 text-xs text-gray-500">Hiệu lực: {formatDate(price.validFrom)} – {formatDate(price.validTo)} · Nhà cung cấp: {price.supplier}</p>
                    <p className="mt-1 text-xs text-gray-500">Phiên bản {price.version}{price.sourcePages.length ? ` · Nguồn: trang ${price.sourcePages.join(", ")}` : " · Chưa gắn trang nguồn"}</p>
                    {editingPriceId === price.priceId ? <div className="mt-4 rounded-md bg-gray-50 p-3"><Label htmlFor={`price-amount-${price.priceId}`}>Giá mới VND</Label><TextInput id={`price-amount-${price.priceId}`} className="mt-1" inputMode="decimal" value={amountDraft} onChange={event => setAmountDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void savePrice(price); } if (event.key === "Escape") setEditingPriceId(null); }}/><p className="mt-2 text-xs text-gray-500">Giá hiện tại {formatVnd(price.price)} · sẽ lưu với phiên bản {price.version}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={saving || !canEditPrice} onClick={() => void savePrice(price)}><Save size={14} className="mr-1"/>{saving ? "Đang lưu…" : "Lưu giá"}</Button><Button size="sm" color="light" disabled={saving} onClick={() => { setEditingPriceId(null); setSaveError(""); }}><X size={14} className="mr-1"/>Hủy</Button></div></div>
                      : <div className="mt-3">{canEditPrice ? <Button size="sm" color="light" onClick={() => { setEditingPriceId(price.priceId); setAmountDraft(String(price.price)); setSaveError(""); setSaveMessage(""); }}><Save size={14} className="mr-1"/>Sửa {priceTypeLabel(price.priceType).toLowerCase()}</Button> : <p className="text-xs text-gray-500">{stale || !online ? "Chỉ xem khi dữ liệu chưa đồng bộ hoặc đang ngoại tuyến." : role === "viewer" ? "Tài khoản chỉ có quyền xem." : "Chưa xác minh được quyền sửa."}</p>}</div>}
                  </article>;
                })}</div>}
              <div className="flex items-center gap-2 border-t border-gray-200 pt-3 text-xs text-gray-500"><Check size={14}/>Giá hiển thị lấy nguyên từ SQL; không quy đổi hoặc tính lại.</div>
            </Card> : <Card className="border-dashed border-gray-300 bg-white shadow-none"><p className="text-sm text-gray-600">Chọn một mặt hàng để xem trạng thái, bao bì, mức giá và hiệu lực.</p></Card>}
          </section>
        </div>}
    </div>
  </main>;
}
