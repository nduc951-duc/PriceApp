import { describe, expect, it } from "vitest";
import { addToCustomerCart, customerCartSubtotal, setCustomerCartQuantity, type CustomerCartLine, type PublicPrice } from "./customer-cart";

const retail: PublicPrice = { category: "Vít", name: "Vít tự khoan", variant: "Đầu dù 4x20", specification: "4 x 20 mm", productCode: null, aliases: [], packaging: "Gói 100 cái", packageQuantity: 100, unit: "cái", priceId: 21, version: 3, priceType: "retail", minimumQuantity: 1, price: 15000 };
const wholesale: PublicPrice = { ...retail, priceId: 22, priceType: "wholesale", minimumQuantity: 5, price: 12000 };

describe("customer cart", () => {
  it("starts a line at its selected price minimum and updates the same price line", () => {
    const first = addToCustomerCart([], wholesale);
    expect(first).toEqual([{ priceId: 22, version: 3, quantity: 5 }]);
    expect(addToCustomerCart(first, wholesale)).toEqual([{ priceId: 22, version: 3, quantity: 6 }]);
  });

  it("keeps retail and wholesale selections separate for the same product", () => {
    expect(addToCustomerCart(addToCustomerCart([], retail), wholesale)).toEqual([
      { priceId: 21, version: 3, quantity: 1 }, { priceId: 22, version: 3, quantity: 5 },
    ]);
  });

  it("clamps changed quantities to the public minimum and removes an empty line", () => {
    const cart: CustomerCartLine[] = [{ priceId: 22, version: 3, quantity: 5 }];
    expect(setCustomerCartQuantity(cart, wholesale, 2)[0].quantity).toBe(5);
    expect(setCustomerCartQuantity(cart, wholesale, 0)).toEqual([]);
  });

  it("calculates an estimate from only matching current server catalog versions", () => {
    const cart: CustomerCartLine[] = [{ priceId: 21, version: 3, quantity: 2 }, { priceId: 22, version: 2, quantity: 5 }];
    expect(customerCartSubtotal(cart, [retail, wholesale])).toEqual({ subtotal: 30000, stalePriceIds: [22] });
  });

  it("caps quantities and refuses a line beyond the server order limit", () => {
    expect(setCustomerCartQuantity([], retail, 20_000)[0].quantity).toBe(10_000);
    const full = Array.from({ length: 50 }, (_, index) => ({ priceId: index + 100, version: 1, quantity: 1 }));
    expect(addToCustomerCart(full, retail)).toHaveLength(50);
    expect(setCustomerCartQuantity(full, retail, 2)).toHaveLength(50);
  });
});
