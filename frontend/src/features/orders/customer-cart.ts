import type { ApiPaths } from "@/lib/api/generated/api-types";

export type PublicPrice = ApiPaths["/api/v1/public/catalog"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type CustomerCartLine = { priceId: number; version: number; quantity: number };
export const CUSTOMER_ORDER_MAX_ITEMS = 50;
export const CUSTOMER_ORDER_MAX_QUANTITY = 10_000;

export function addToCustomerCart(cart: CustomerCartLine[], price: PublicPrice): CustomerCartLine[] {
  if (!price.purchasable || price.isDemo) return cart;
  const existing = cart.find(line => line.priceId === price.priceId);
  if (!existing) {
    if (cart.length >= CUSTOMER_ORDER_MAX_ITEMS || price.minimumQuantity > CUSTOMER_ORDER_MAX_QUANTITY) return cart;
    return [...cart, { priceId: price.priceId, version: price.version, quantity: Math.max(1, price.minimumQuantity) }];
  }
  return cart.map(line => line.priceId === price.priceId
    ? { ...line, version: price.version, quantity: Math.min(CUSTOMER_ORDER_MAX_QUANTITY, Math.max(line.quantity + 1, price.minimumQuantity)) }
    : line);
}

export function setCustomerCartQuantity(cart: CustomerCartLine[], price: PublicPrice, quantity: number): CustomerCartLine[] {
  if (!price.purchasable || price.isDemo) return cart.filter(line => line.priceId !== price.priceId);
  if (!Number.isFinite(quantity) || quantity <= 0) return cart.filter(line => line.priceId !== price.priceId);
  const clamped = Math.min(CUSTOMER_ORDER_MAX_QUANTITY, Math.max(price.minimumQuantity, quantity));
  if (!cart.some(line => line.priceId === price.priceId)) {
    if (cart.length >= CUSTOMER_ORDER_MAX_ITEMS || price.minimumQuantity > CUSTOMER_ORDER_MAX_QUANTITY) return cart;
    return [...cart, { priceId: price.priceId, version: price.version, quantity: clamped }];
  }
  return cart.map(line => line.priceId === price.priceId ? { ...line, version: price.version, quantity: clamped } : line);
}

export function customerCartSubtotal(cart: CustomerCartLine[], prices: PublicPrice[]): { subtotal: number; stalePriceIds: number[] } {
  let subtotal = 0;
  const stalePriceIds: number[] = [];
  for (const line of cart) {
    const price = prices.find(item => item.priceId === line.priceId && item.version === line.version);
    if (!price || !price.purchasable || price.isDemo) stalePriceIds.push(line.priceId);
    else if (line.quantity >= price.minimumQuantity) subtotal += price.price * line.quantity;
  }
  return { subtotal, stalePriceIds };
}
