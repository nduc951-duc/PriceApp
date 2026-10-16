"use client";

import { ArrowRight, Check, Plus, Search, ShoppingBag, Store } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, Drawer, DrawerHeader, DrawerItems, Select, Spinner, TextInput } from "flowbite-react";
import { addToCustomerCart, CUSTOMER_ORDER_MAX_ITEMS, CUSTOMER_ORDER_MAX_QUANTITY, customerCartSubtotal, setCustomerCartQuantity, type CustomerCartLine, type PublicPrice } from "@/features/orders/customer-cart";
import { formatVnd } from "@/features/pricing/validation";
import { ApiRequestError } from "@/lib/api/client";
import { fetchPublicCustomerCatalog, submitPublicCustomerOrder } from "@/lib/api/customer-orders";
import { CustomerCartPanel } from "@/components/customer-cart-panel";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { PriceQuestionAssistant } from "@/components/price-question-assistant";
import { matchesCatalogQuery } from "@/features/search/parser";

type Receipt = Awaited<ReturnType<typeof submitPublicCustomerOrder>>;
function groupKey(p: PublicPrice) { return [p.category, p.name, p.variant, p.specification, p.packaging, p.packageQuantity, p.unit].join("|"); }

// Flowbite Forms, Button and Drawer composition. Source: design.md R5–R6.
export function CustomerStorefront() {
  const [prices, setPrices] = useState<PublicPrice[]>([]);
  const [syncedAt, setSyncedAt] = useState("");
  const [cart, setCart] = useState<CustomerCartLine[]>([]);
  const [cartRestored, setCartRestored] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [tier, setTier] = useState("all");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [orderError, setOrderError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [contact, setContact] = useState({ customerName: "", phone: "", address: "", notes: "" });
  const drawerRef = useModalFocus<HTMLDivElement>(cartOpen && !desktop, () => setCartOpen(false));

  useEffect(() => {
    if (cartRestored) {
      try { sessionStorage.setItem("gia-chuan-public-cart", JSON.stringify(cart)); } catch { /* Best-effort draft only. */ }
    }
  }, [cart, cartRestored]);

  useEffect(() => {
    if (!cartOpen || desktop) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [cartOpen, desktop]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => { setDesktop(media.matches); if (media.matches) setCartOpen(false); };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  async function loadCatalog() {
    setLoading(true); setCatalogError("");
    try { const r = await fetchPublicCustomerCatalog(); setPrices(r.items); setSyncedAt(r.syncedAt); }
    catch { setCatalogError("Chưa tải được bảng giá"); }
    finally { setLoading(false); }
  }
  function addRagPriceToCart(item: { productName: string; variant: string }, price: { id: number; version: number }) {
    const publicPrice = prices.find((candidate) => candidate.priceId === price.id && candidate.version === price.version);
    if (!publicPrice) {
      setAnnouncement("Giá này đã thay đổi. Tải lại bảng giá rồi chọn mức hiện hành.");
      void loadCatalog();
      return;
    }
    if (cart.length >= CUSTOMER_ORDER_MAX_ITEMS && !cart.some((line) => line.priceId === publicPrice.priceId)) {
      setAnnouncement(`Đơn tối đa ${CUSTOMER_ORDER_MAX_ITEMS} mặt hàng. Xóa một dòng rồi thử lại.`);
      return;
    }
    setCart((current) => addToCustomerCart(current, publicPrice));
    setAnnouncement(`Đã thêm ${item.productName} ${item.variant} vào đơn nháp`);
    if (desktop) document.getElementById("shop-cart")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else setCartOpen(true);
  }
  useEffect(() => {
    let active = true;
    let savedCart: CustomerCartLine[] = [];
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem("gia-chuan-public-cart") ?? "[]");
      if (Array.isArray(saved)) savedCart = saved.slice(0, CUSTOMER_ORDER_MAX_ITEMS).filter((line): line is CustomerCartLine =>
        line !== null && typeof line === "object" && Number.isSafeInteger(line.priceId) && line.priceId > 0 &&
        Number.isSafeInteger(line.version) && line.version >= 0 && Number.isFinite(line.quantity) && line.quantity > 0)
        .map(line => ({ ...line, quantity: Math.min(line.quantity, CUSTOMER_ORDER_MAX_QUANTITY) }));
    } catch { /* A blocked or invalid session store must not prevent shopping. */ }
    fetchPublicCustomerCatalog().then(r => { if (active) { setPrices(r.items); setSyncedAt(r.syncedAt); } })
      .catch(() => { if (active) setCatalogError("Chưa tải được bảng giá"); })
      .finally(() => { if (active) { setCart(savedCart); setCartRestored(true); setLoading(false); } });
    return () => { active = false; };
  }, []);
  const categories = useMemo(() => [...new Set(prices.map(p => p.category))].sort((a, b) => a.localeCompare(b, "vi")), [prices]);
  const groups = useMemo(() => {
    const grouped = new Map<string, { first: PublicPrice; prices: PublicPrice[] }>();
    for (const p of prices) {
      if (tier !== "all" && p.priceType !== tier) continue;
      const key = groupKey(p), entry = grouped.get(key);
      if (entry) entry.prices.push(p); else grouped.set(key, { first: p, prices: [p] });
    }
    return [...grouped.values()].filter(({ first }) =>
      (category === "all" || first.category === category) &&
      (!query.trim() || matchesCatalogQuery(query, `${first.category} ${first.name} ${first.variant} ${first.specification} ${first.productCode ?? ""} ${(first.aliases ?? []).join(" ")} ${first.packaging}`))
    );
  }, [prices, category, query, tier]);
  const { subtotal, stalePriceIds } = useMemo(() => customerCartSubtotal(cart, prices), [cart, prices]);
  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cart.length || cart.length > CUSTOMER_ORDER_MAX_ITEMS || cart.some(line => line.quantity > CUSTOMER_ORDER_MAX_QUANTITY) || stalePriceIds.length || catalogError || loading) return;
    setSubmitting(true); setOrderError("");
    try {
      const result = await submitPublicCustomerOrder({ customerName: contact.customerName, phone: contact.phone, deliveryAddress: contact.address || undefined, deliveryNotes: contact.notes || undefined, items: cart.map(({ priceId, version, quantity }) => ({ priceId, version, quantity })) });
      setCart([]);
      try { sessionStorage.removeItem("gia-chuan-public-cart"); } catch { /* The server receipt remains authoritative. */ }
      setReceipt(result);
      setCheckout(false);
      setCartOpen(false);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) { await loadCatalog(); setOrderError("Giá vừa thay đổi. Kiểm tra lại các dòng hàng trước khi gửi."); }
      else if (error instanceof ApiRequestError && error.status === 429) setOrderError(error.message);
      else if (error instanceof ApiRequestError && (error.status === 400 || error.status === 422)) setOrderError(`Mỗi đơn tối đa ${CUSTOMER_ORDER_MAX_ITEMS} dòng và ${CUSTOMER_ORDER_MAX_QUANTITY.toLocaleString("vi-VN")} gói mỗi dòng. Hãy chỉnh giỏ hàng rồi gửi lại.`);
      else setOrderError("Chưa gửi được yêu cầu. Thông tin của bạn vẫn được giữ để thử lại.");
    } finally { setSubmitting(false); }
  }
  const cartPanel = <CustomerCartPanel cart={cart} prices={prices} subtotal={subtotal} stalePriceIds={stalePriceIds} checkout={checkout} onCheckout={setCheckout} contact={contact} onContact={setContact} submitting={submitting} blocked={loading || Boolean(catalogError)} error={orderError} onSubmit={submitOrder}
    onRemove={id => setCart(current => current.filter(line => line.priceId !== id))}
    onQuantity={(price, quantity) => setCart(current => setCustomerCartQuantity(current, price, quantity))}
    onRefresh={() => setCart(current => current.map(line => { const p = prices.find(p => p.priceId === line.priceId); return p ? { ...line, version: p.version, quantity: Math.max(line.quantity, p.minimumQuantity) } : line; }))}/>;

  return <main className="min-h-screen bg-gray-50 pb-24 text-gray-900 lg:pb-10">
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 px-4 py-3 md:grid-cols-[auto_1fr_auto] lg:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-gray-900"><Store className="text-blue-700" size={26}/><span className="text-lg font-semibold">Giá Chuẩn</span></Link>
        <div className="col-span-2 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1"><TextInput icon={Search} aria-label="Tìm sản phẩm" value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm tên hàng hoặc quy cách…"/></div>
        <div className="col-start-2 row-start-1 flex items-center gap-3 md:col-start-3"><Link href="/" className="hidden text-sm text-gray-600 hover:text-blue-700 sm:block">Đổi vai trò</Link><Button color="light" aria-label={`Giỏ hàng (${cart.length})`} onClick={() => { if (desktop) document.getElementById("shop-cart")?.scrollIntoView({ behavior: "smooth", block: "start" }); else setCartOpen(true); }}><ShoppingBag size={18} className="mr-2"/>Giỏ hàng ({cart.length})</Button></div>
      </div>
    </header>
    <div aria-live="polite" className="sr-only">{announcement}</div>
    {!receipt && <PriceQuestionAssistant audience="customer" onChoosePrice={addRagPriceToCart}/>}
    {receipt ? <section className="mx-auto mt-10 max-w-lg rounded-lg border border-gray-200 bg-white p-6 md:p-8" aria-live="polite">
      <Check className="mb-4 text-green-700" size={28}/><h1 className="text-2xl font-semibold">Đã gửi yêu cầu</h1><p className="mt-3 text-gray-600">Cửa hàng sẽ gọi {contact.phone} để xác nhận mặt hàng và trao đổi cách giao.</p>
      <dl className="my-6 space-y-3 border-y border-gray-200 py-4"><div className="flex justify-between"><dt>Mã yêu cầu</dt><dd className="font-semibold">{receipt.reference}</dd></div><div className="flex justify-between"><dt>Tạm tính</dt><dd className="font-semibold tabular-nums">{formatVnd(receipt.subtotal)}</dd></div></dl>
      <p className="mb-6 text-sm text-gray-600">Chờ cửa hàng xác nhận. Chưa thu tiền và chưa chốt phí giao hàng.</p><Button onClick={() => { setReceipt(null); setCart([]); setCheckout(false); setContact({ customerName: "", phone: "", address: "", notes: "" }); }}>Tiếp tục xem giá<ArrowRight className="ml-2" size={16}/></Button>
    </section> : <div className="mx-auto max-w-7xl px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2"><h1 className="text-2xl font-semibold tracking-tight">Tra giá và đặt hàng</h1>{!catalogError && !loading && syncedAt && <p className="text-sm text-gray-500">Cập nhật {new Date(syncedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</p>}</div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white" aria-label="Bảng giá cửa hàng">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4"><Select className="min-w-[180px] flex-1 pr-10 sm:flex-none" aria-label="Lọc theo nhóm hàng" value={category} onChange={e => setCategory(e.target.value)}><option value="all">Tất cả nhóm hàng</option>{categories.map(c => <option key={c}>{c}</option>)}</Select><Select className="min-w-[150px] flex-1 pr-10 sm:flex-none" aria-label="Loại giá" value={tier} onChange={e => setTier(e.target.value)}><option value="all">Giá lẻ và giá sỉ</option><option value="retail">Giá lẻ</option><option value="wholesale">Giá sỉ</option></Select>{!loading && !catalogError && <span className="ml-auto text-sm text-gray-500">{groups.length} mặt hàng</span>}</div>
          {loading ? <div role="status" className="p-5"><p className="mb-6 flex items-center gap-2 text-sm text-gray-600"><Spinner size="sm"/>Đang tải bảng giá…</p>{[0, 1, 2, 3, 4].map(n => <div key={n} aria-hidden="true" className="animate-pulse border-t border-gray-100 py-6"><div className="h-4 w-2/3 rounded bg-gray-200"/><div className="mt-3 h-3 w-1/3 rounded bg-gray-100"/></div>)}</div>
          : catalogError ? <div className="p-6"><Alert color="failure"><span className="font-semibold">{catalogError}</span><p className="mt-1">Kết nối chưa thành công. Hãy thử lại để xem giá và đặt hàng.</p></Alert><Button className="mt-4" color="light" onClick={() => void loadCatalog()}>Thử lại</Button></div>
          : !prices.length ? <div className="px-6 py-12"><h2 className="font-semibold">Cửa hàng chưa công bố bảng giá</h2><p className="mt-2 text-sm text-gray-600">Vui lòng quay lại sau để xem các mặt hàng.</p><Button color="light" className="mt-4" onClick={() => void loadCatalog()}>Tải lại bảng giá</Button></div>
          : !groups.length ? <div className="px-6 py-12"><h2 className="font-semibold">Không tìm thấy mặt hàng</h2><p className="mt-2 text-sm text-gray-600">Thử tên hoặc quy cách khác.</p><Button color="light" className="mt-4" onClick={() => { setQuery(""); setCategory("all"); setTier("all"); }}>Xóa bộ lọc</Button></div>
          : <div className="divide-y divide-gray-200">{groups.map(group => <article key={groupKey(group.first)} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)] lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(230px,0.9fr)]">
            <div className="min-w-0"><h2 className="break-words [overflow-wrap:anywhere] text-base font-semibold">{group.first.name}</h2><p className="mt-1 break-words [overflow-wrap:anywhere] text-sm text-gray-600">{group.first.variant}{group.first.specification && ` · ${group.first.specification}`}</p><p className="mt-2 break-words [overflow-wrap:anywhere] text-sm text-gray-500">{group.first.packaging} · {group.first.category}</p></div>
            <div className="min-w-0 space-y-3">{[...group.prices].sort((a, b) => a.priceType.localeCompare(b.priceType)).map(price => <div key={price.priceId} className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1"><p className="text-sm text-gray-600">{price.priceType === "wholesale" ? "Giá sỉ" : "Giá lẻ"}</p><p className="break-words [overflow-wrap:anywhere] font-semibold tabular-nums">{formatVnd(price.price)} <span className="text-sm font-normal text-gray-500">/ {price.packaging.toLocaleLowerCase("vi")}</span></p>{price.minimumQuantity > 1 && <p className="mt-1 break-words text-sm text-gray-600">Tối thiểu {price.minimumQuantity} × {price.packaging} ({price.minimumQuantity * price.packageQuantity} {price.unit})</p>}</div>
              <div className="flex max-w-full shrink-0 items-center gap-2"><TextInput className="w-20" type="number" disabled={submitting} aria-label={`Số lượng gói ${price.name}, ${price.priceType === "wholesale" ? "giá sỉ" : "giá lẻ"}`} min={price.minimumQuantity} max={CUSTOMER_ORDER_MAX_QUANTITY} step="any" value={quantities[price.priceId] ?? price.minimumQuantity} onChange={e => setQuantities(current => ({ ...current, [price.priceId]: Number(e.target.value) }))}/><Button color="light" aria-label={`Thêm giá ${price.priceType === "wholesale" ? "sỉ" : "lẻ"}`} disabled={submitting || (cart.length >= CUSTOMER_ORDER_MAX_ITEMS && !cart.some(line => line.priceId === price.priceId)) || !Number.isFinite(quantities[price.priceId] ?? price.minimumQuantity) || (quantities[price.priceId] ?? price.minimumQuantity) < price.minimumQuantity || (quantities[price.priceId] ?? price.minimumQuantity) > CUSTOMER_ORDER_MAX_QUANTITY} onClick={() => {
                const quantity = quantities[price.priceId] ?? price.minimumQuantity;
                setCart(current => setCustomerCartQuantity(current, price, (current.find(line => line.priceId === price.priceId)?.quantity ?? 0) + quantity));
                setAnnouncement(`Đã thêm ${price.name} vào giỏ hàng`);
              }}><Plus size={16}/><span className="ml-1">Thêm</span></Button></div>
            </div>)}</div>
          </article>)}</div>}
        </section>
        {desktop && <aside id="shop-cart" className="sticky top-24 scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5">{cartPanel}</aside>}
      </div>
      <p className="mt-5 text-sm text-gray-500">Số lượng nhập là số gói bán. Cửa hàng xác nhận mặt hàng và phí giao trước khi chốt đơn.</p>
    </div>}
    {!desktop && !receipt && cartOpen && <Drawer ref={drawerRef} aria-label="Giỏ hàng" open onClose={() => setCartOpen(false)} position="right" className="w-full max-w-md pb-[max(16px,env(safe-area-inset-bottom))]"><DrawerHeader title="Giỏ hàng" titleIcon={ShoppingBag}/><DrawerItems>{cartPanel}</DrawerItems></Drawer>}
    {!desktop && cart.length > 0 && !receipt && <div hidden={cartOpen} className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]"><Button className="w-full" onClick={() => setCartOpen(true)}><span>{cart.length} dòng hàng · {formatVnd(subtotal)}</span><span className="ml-auto pl-6">Xem giỏ →</span></Button></div>}
  </main>;
}
