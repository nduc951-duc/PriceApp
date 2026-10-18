"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Label, Select, Spinner, TextInput } from "flowbite-react";
import { CustomerCartPanel } from "@/components/customer-cart-panel";
import { addToCustomerCart, CUSTOMER_ORDER_MAX_ITEMS, CUSTOMER_ORDER_MAX_QUANTITY, customerCartSubtotal, setCustomerCartQuantity, type CustomerCartLine, type PublicPrice } from "@/features/orders/customer-cart";
import { formatVnd } from "@/features/pricing/validation";
import { formatMinimumPackageQuantity, formatPackageContents } from "@/features/pricing/package-display";
import { matchesCatalogQuery } from "@/features/search/parser";
import { ApiRequestError } from "@/lib/api/client";
import { fetchPublicCustomerCatalog, submitStaffCustomerOrder } from "@/lib/api/customer-orders";

type Receipt = Awaited<ReturnType<typeof submitStaffCustomerOrder>>;
type Props = { initialCart?: CustomerCartLine[]; onCreated: (receipt: Receipt) => void; onCancel: () => void; onSubmittingChange: (busy: boolean) => void };
const productKey = (price: PublicPrice) => JSON.stringify([price.category, price.name]);
const variantKey = (price: PublicPrice) => JSON.stringify([price.variant, price.specification]);

export function StaffCustomerOrderForm({ initialCart, onCreated, onCancel, onSubmittingChange }: Props) {
  const [prices, setPrices] = useState<PublicPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [orderError, setOrderError] = useState("");
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("");
  const [variant, setVariant] = useState("");
  const [priceId, setPriceId] = useState("");
  const [cart, setCart] = useState<CustomerCartLine[]>(() => initialCart?.map(line => ({ ...line })) ?? []);
  const [checkout, setCheckout] = useState(Boolean(initialCart));
  const [contact, setContact] = useState({ customerName: "", phone: "", address: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchPublicCustomerCatalog().then(result => { if (active) setPrices(result.items); })
      .catch(() => { if (active) setCatalogError("Chưa tải được bảng giá hiện hành. Hãy thử lại trước khi tạo đơn."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function reloadCatalog() {
    setLoading(true); setCatalogError("");
    try { setPrices((await fetchPublicCustomerCatalog()).items); }
    catch { setCatalogError("Chưa tải được bảng giá hiện hành. Hãy thử lại trước khi tạo đơn."); }
    finally { setLoading(false); }
  }

  function changeCart(update: (current: CustomerCartLine[]) => CustomerCartLine[]) {
    idempotencyKey.current = null;
    setCart(update);
  }

  const matchingPrices = useMemo(() => prices.filter(price => !query.trim() || matchesCatalogQuery(query, `${price.name} ${price.category} ${price.variant} ${price.specification} ${price.productCode ?? ""} ${(price.aliases ?? []).join(" ")}`)), [prices, query]);
  const products = [...new Map(matchingPrices.map(price => [productKey(price), price])).values()];
  const productPrices = matchingPrices.filter(price => productKey(price) === product);
  const variants = [...new Map(productPrices.map(price => [variantKey(price), price])).values()];
  const variantPrices = productPrices.filter(price => variantKey(price) === variant);
  const selectedPrice = variantPrices.find(price => String(price.priceId) === priceId);
  const { subtotal, stalePriceIds } = customerCartSubtotal(cart, prices);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current || !cart.length || stalePriceIds.length || loading || catalogError) return;
    submissionInFlight.current = true;
    setSubmitting(true); onSubmittingChange(true); setOrderError("");
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    let receipt: Receipt | undefined;
    try {
      receipt = await submitStaffCustomerOrder({ customerName: contact.customerName, phone: contact.phone, idempotencyKey: key, deliveryAddress: contact.address || undefined, deliveryNotes: contact.notes || undefined, items: cart.map(({ priceId, version, quantity }) => ({ priceId, version, quantity })) });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        await reloadCatalog();
        setOrderError("Giá vừa thay đổi. Kiểm tra lại các dòng hàng trước khi gửi.");
      } else if (error instanceof ApiRequestError && [400, 401, 403, 422, 429].includes(error.status)) setOrderError(error.message);
      else setOrderError("Chưa gửi được yêu cầu. Thông tin đơn vẫn được giữ để thử lại.");
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false); onSubmittingChange(false);
    }
    if (receipt) onCreated(receipt);
  }

  return <div>
    <Button type="button" color="light" size="sm" onClick={onCancel} disabled={submitting} className="mb-4">{initialCart ? "Quay lại báo giá" : "Quay lại danh sách"}</Button>
    {initialCart && <>
      <p className="mb-4 text-sm text-gray-600">Các dòng hàng được lấy từ báo giá. Kiểm tra lại đơn và nhập thông tin khách để gửi.</p>
      {catalogError && <Alert color="failure" className="mb-4">{catalogError}<Button type="button" color="light" size="sm" className="mt-2" onClick={() => void reloadCatalog()}>Tải lại bảng giá</Button></Alert>}
    </>}
    <div className={`grid min-w-0 gap-6 ${initialCart ? "" : "lg:grid-cols-2"}`}>
      {!initialCart && <section aria-label="Chọn hàng cho đơn" className="min-w-0 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Chọn mặt hàng</h2>
        {loading ? <p className="flex items-center gap-2 text-sm text-gray-600"><Spinner size="sm"/>Đang tải bảng giá…</p> : catalogError ? <Alert color="failure">{catalogError}<Button type="button" color="light" size="sm" className="mt-3" onClick={() => void reloadCatalog()}>Tải lại bảng giá</Button></Alert> : <>
          <div><Label htmlFor="staff-order-search">Tìm hàng để tạo đơn</Label><TextInput id="staff-order-search" className="mt-1" placeholder="Tên hàng, mã hoặc quy cách" value={query} disabled={submitting} onChange={event => { setQuery(event.target.value); setProduct(""); setVariant(""); setPriceId(""); }}/></div>
          <div><Label htmlFor="staff-order-product">Mặt hàng</Label><Select id="staff-order-product" className="mt-1" value={product} disabled={submitting} onChange={event => { setProduct(event.target.value); setVariant(""); setPriceId(""); }}><option value="">Chọn mặt hàng</option>{products.map(price => <option key={productKey(price)} value={productKey(price)}>{price.name}</option>)}</Select></div>
          {!products.length && <p className="text-sm text-gray-600">Không có mặt hàng phù hợp trong bảng giá công khai.</p>}
          <div><Label htmlFor="staff-order-variant">Quy cách</Label><Select id="staff-order-variant" className="mt-1" value={variant} disabled={!product || submitting} onChange={event => { setVariant(event.target.value); setPriceId(""); }}><option value="">Chọn quy cách</option>{variants.map(price => <option key={variantKey(price)} value={variantKey(price)}>{price.variant}</option>)}</Select></div>
          <div><Label htmlFor="staff-order-price">Đóng gói và loại giá</Label><Select id="staff-order-price" className="mt-1" value={priceId} disabled={!variant || submitting} onChange={event => setPriceId(event.target.value)}><option value="">Chọn mức giá</option>{variantPrices.map(price => <option key={price.priceId} value={price.priceId}>{price.priceType === "wholesale" ? "Giá sỉ" : "Giá lẻ"} · {price.packaging} · {formatVnd(price.price)}</option>)}</Select></div>
          {selectedPrice && <div className="border-t border-gray-200 pt-3 text-sm text-gray-600"><p className="text-xl font-semibold text-gray-900 tabular-nums">{formatVnd(selectedPrice.price)} / {selectedPrice.packaging}</p><p className="mt-1">Mỗi {selectedPrice.packaging}: {formatPackageContents(selectedPrice.packageQuantity, selectedPrice.unit)}</p>{selectedPrice.minimumQuantity > 1 && <p className="mt-1">{formatMinimumPackageQuantity(selectedPrice.minimumQuantity, selectedPrice.packaging, selectedPrice.packageQuantity, selectedPrice.unit)}</p>}<p className="mt-1">Nguồn: bảng giá hiện hành trong Supabase.</p></div>}
          <Button type="button" disabled={!selectedPrice || submitting || selectedPrice.minimumQuantity > CUSTOMER_ORDER_MAX_QUANTITY || (cart.length >= CUSTOMER_ORDER_MAX_ITEMS && !cart.some(line => line.priceId === selectedPrice.priceId))} onClick={() => { if (selectedPrice) changeCart(current => addToCustomerCart(current, selectedPrice)); }}>Thêm vào đơn</Button>
        </>}
      </section>}
      <section aria-label="Nội dung đơn khách" className={`min-w-0 ${initialCart ? "" : "border-t border-gray-200 pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5"}`}>
        <CustomerCartPanel cart={cart} prices={prices} subtotal={subtotal} stalePriceIds={stalePriceIds} checkout={checkout} onCheckout={setCheckout} contact={contact} onContact={value => { idempotencyKey.current = null; setContact(value); }} submitting={submitting} blocked={loading || Boolean(catalogError)} error={orderError} onSubmit={submit}
          onRemove={id => changeCart(current => current.filter(line => line.priceId !== id))}
          onQuantity={(price, quantity) => changeCart(current => setCustomerCartQuantity(current, price, quantity))}
          onRefresh={() => changeCart(current => current.map(line => { const price = prices.find(price => price.priceId === line.priceId); return price ? { ...line, version: price.version, quantity: Math.max(line.quantity, price.minimumQuantity) } : line; }))}/>
      </section>
    </div>
  </div>;
}
