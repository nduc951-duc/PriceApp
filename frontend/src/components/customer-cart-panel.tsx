"use client";

import { type FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { Alert, Button, Label, Textarea, TextInput } from "flowbite-react";
import type { CustomerCartLine, PublicPrice } from "@/features/orders/customer-cart";
import { CUSTOMER_ORDER_MAX_ITEMS, CUSTOMER_ORDER_MAX_QUANTITY } from "@/features/orders/customer-cart";
import { formatVnd } from "@/features/pricing/validation";

type Contact = { customerName: string; phone: string; address: string; notes: string };
type Props = {
  cart: CustomerCartLine[]; prices: PublicPrice[]; subtotal: number; stalePriceIds: number[];
  checkout: boolean; onCheckout: (value: boolean) => void; contact: Contact; onContact: (value: Contact) => void;
  submitting: boolean; blocked: boolean; error: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRemove: (id: number) => void; onQuantity: (price: PublicPrice, quantity: number) => void; onRefresh: () => void;
};

// Flowbite Forms composition, shared by the desktop aside and mobile Drawer.
export function CustomerCartPanel(p: Props) {
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>({});
  return <div>
    <div className="flex items-baseline justify-between gap-2 border-b border-gray-200 pb-4"><h2 className="text-lg font-semibold">{p.checkout ? "Thông tin liên hệ" : "Đơn đang chọn"}</h2><span className="text-sm text-gray-500">{p.cart.length} dòng hàng</span></div>
    {p.cart.length >= CUSTOMER_ORDER_MAX_ITEMS && <p role="status" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Đơn đã đạt {CUSTOMER_ORDER_MAX_ITEMS} dòng. Xóa một dòng nếu muốn thêm mặt hàng khác.</p>}
    {!p.cart.length ? <p className="py-6 text-sm leading-6 text-gray-500">Chọn mặt hàng và bấm “Thêm” để xem bảng tính giá tại đây.</p> : <>
      <div className="divide-y divide-gray-100">{p.cart.map(line => {
        const price = p.prices.find(row => row.priceId === line.priceId);
        if (!price) return <div key={line.priceId} className="py-4"><p className="text-sm text-red-700">Mức giá này không còn được công bố.</p><Button color="light" size="sm" className="mt-2" onClick={() => p.onRemove(line.priceId)}>Bỏ khỏi đơn</Button></div>;
        const stale = p.stalePriceIds.includes(line.priceId);
        return <div key={line.priceId} className="py-4"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words [overflow-wrap:anywhere] text-sm font-semibold">{price.name}</h3><p className="mt-1 break-words [overflow-wrap:anywhere] text-sm text-gray-600">{price.variant} · {price.packaging}</p><p className="mt-1 text-sm text-gray-500">{price.priceType === "wholesale" ? "Giá sỉ" : "Giá lẻ"}{price.minimumQuantity > 1 && ` · Tối thiểu ${price.minimumQuantity} × ${price.packaging} (${price.minimumQuantity * price.packageQuantity} ${price.unit})`}</p></div><Button color="light" size="sm" aria-label={`Xóa ${price.name} khỏi đơn`} disabled={p.submitting} onClick={() => p.onRemove(line.priceId)}><Trash2 size={16}/></Button></div>
          <div className="mt-3 flex items-center gap-2"><TextInput className="w-20" type="number" aria-label={`Số lượng gói ${price.name} trong giỏ, ${price.priceType === "wholesale" ? "giá sỉ" : "giá lẻ"}`} min={price.minimumQuantity} max={CUSTOMER_ORDER_MAX_QUANTITY} step="any" value={quantityDrafts[price.priceId] ?? String(line.quantity)} disabled={stale || p.submitting} onChange={e => setQuantityDrafts(current => ({ ...current, [price.priceId]: e.target.value }))} onBlur={() => { const raw = quantityDrafts[price.priceId]; if (raw === undefined) return; const value = Number(raw); if (raw.trim() && Number.isFinite(value) && value > 0) p.onQuantity(price, value); setQuantityDrafts(current => { const next = { ...current }; delete next[price.priceId]; return next; }); }}/><span className="text-sm text-gray-600">× {formatVnd(price.price)} / gói</span></div>
          <p className="mt-2 text-right text-sm font-semibold tabular-nums">{stale ? "Cần kiểm tra giá" : formatVnd(line.quantity * price.price)}</p>{stale && <p className="mt-1 text-sm text-red-700">Giá vừa thay đổi. Vui lòng xem lại.</p>}
        </div>;
      })}</div>
      <div className="flex justify-between gap-3 border-t border-gray-200 pt-4"><span className="font-medium">Tạm tính</span><strong className="text-lg tabular-nums">{formatVnd(p.subtotal)}</strong></div>
      <p className="mt-2 text-sm leading-5 text-gray-500">Chưa gồm phí giao hàng. Cửa hàng sẽ trao đổi khi xác nhận.</p>
      {p.stalePriceIds.length > 0 && <Button color="light" className="mt-4 w-full" onClick={p.onRefresh}>Dùng giá hiện tại và tính lại</Button>}
      {p.error && <Alert color="failure" className="mt-4">{p.error}</Alert>}
      {p.checkout ? <form className="mt-5 space-y-4" onSubmit={p.onSubmit}>
        <Button type="button" color="light" size="sm" disabled={p.submitting} onClick={() => p.onCheckout(false)}><ArrowLeft size={15} className="mr-2"/>Sửa giỏ hàng</Button>
        <div><Label htmlFor="order-name">Tên khách hàng</Label><TextInput className="mt-1.5" id="order-name" name="customerName" required minLength={2} maxLength={120} autoComplete="name" value={p.contact.customerName} onChange={e => p.onContact({ ...p.contact, customerName: e.target.value })} disabled={p.submitting}/></div>
        <div><Label htmlFor="order-phone">Số điện thoại</Label><TextInput className="mt-1.5" id="order-phone" name="phone" type="tel" required minLength={8} maxLength={24} pattern="[0-9+() .-]+" autoComplete="tel" inputMode="tel" value={p.contact.phone} onChange={e => p.onContact({ ...p.contact, phone: e.target.value })} disabled={p.submitting}/></div>
        <div><Label htmlFor="order-address">Địa chỉ giao hàng <span className="font-normal text-gray-500">(tùy chọn)</span></Label><TextInput className="mt-1.5" id="order-address" name="address" autoComplete="street-address" maxLength={500} placeholder="Có thể trao đổi sau" value={p.contact.address} onChange={e => p.onContact({ ...p.contact, address: e.target.value })} disabled={p.submitting}/></div>
        <div><Label htmlFor="order-notes">Ghi chú <span className="font-normal text-gray-500">(tùy chọn)</span></Label><Textarea className="mt-1.5" id="order-notes" name="notes" rows={2} maxLength={1000} value={p.contact.notes} onChange={e => p.onContact({ ...p.contact, notes: e.target.value })} disabled={p.submitting}/></div>
        <Button type="submit" className="w-full" disabled={p.submitting || p.blocked || p.stalePriceIds.length > 0 || !p.cart.length}>{p.submitting ? "Đang gửi yêu cầu…" : "Gửi yêu cầu đặt hàng"}</Button><p className="text-sm leading-5 text-gray-500">Cửa hàng sẽ gọi để xác nhận. Chưa thanh toán, chưa chốt phí giao.</p>
      </form> : <Button className="mt-5 w-full" disabled={p.blocked || p.stalePriceIds.length > 0} onClick={() => p.onCheckout(true)}>Tiếp tục<ArrowRight size={16} className="ml-2"/></Button>}
    </>}
  </div>;
}
