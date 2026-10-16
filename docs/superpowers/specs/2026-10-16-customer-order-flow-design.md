# Customer Order Flow Design

## Goal

Let unauthenticated shoppers browse the store's public product prices, assemble an order request, and ask the store to call them to confirm products and delivery. Keep the existing authenticated employee workspace available behind the employee choice.

## User flow

1. The entry screen offers **Khách hàng** and **Nhân viên**. Choosing employee mode opens the existing authenticated workspace; a visitor without a session sees the staff login and cannot enter staff features.
2. Customer mode shows products with current **retail and wholesale** prices, pack size, unit, and minimum quantity. Dealer prices and supplier/source details remain private. Customers can search, browse categories, set quantities, and review a server-priced estimate.
3. Before sending a request, the customer enters their name and phone number. Delivery address and delivery notes are optional so they can discuss arrangements by phone.
4. The customer submits an order request. The store calls the supplied phone number to confirm the line items and agree delivery details. No payment is collected, no delivery fee is fixed, and the request does not decrement inventory or count as revenue.
5. Authenticated owner/editor staff can review submitted requests in an inbox. The initial status is **Chờ cửa hàng xác nhận**. Staff can mark a request contacted, confirmed, or cancelled; confirmation is a store-side action.

## Data and pricing rules

- Public catalog responses contain only active, non-sample, verified product variants and active public retail/wholesale prices that are valid now and meet their minimum quantity rules. Never return supplier names, source page IDs/paths, internal notes, or dealer prices.
- The browser sends price IDs, price versions, and quantities as a quote request. The server reads canonical products/prices again and computes the estimate; client-submitted amounts/totals are ignored.
- Submission succeeds only if each selected price is still valid and its version/eligibility still matches. Otherwise return a conflict with refreshed public quote data and require the shopper to review again.
- Persist customer contact data and immutable line-item/price snapshots. Only authorized staff can list or read requests. Anonymous users can create a request but cannot read, update, or enumerate any request.
- Apply input bounds and per-IP submission throttling; store contact/address data only for order follow-up.

## Interface direction

Use a practical Vietnamese retail workflow: searchable product rows/cards, clear package/unit and minimum quantity, a persistent order summary, and a short contact/delivery form. Use restrained color, legible Vietnamese typography, clear price-tier labels, responsive layouts, and explicit pending-confirmation language. Avoid decorative gradients, oversized hero content, fake inventory, and invented delivery promises.

## Architecture

- Add a separate public catalog endpoint and an anonymous order-request endpoint. A narrow database RPC supplies sanitized public catalog data and a second RPC validates prices and creates immutable order snapshots. RLS prevents anonymous reads and limits the staff inbox to owner/editor roles.
- Keep the current employee catalog and business workflows authenticated. Add an entry choice that routes signed-in employees to the workspace and unsigned employee selections to `AuthGate`.
- Add customer catalog/cart/contact UI and an authenticated staff order inbox. The existing local invoice stays independent from public customer requests.

## Verification

- Unit/API tests prove public filtering, price recomputation, price-version conflicts, validation, throttling, and anonymous PII isolation.
- Browser tests cover entry role choices, employee login gate, customer browsing/cart/estimate, order submission confirmation, and staff inbox visibility.
- Run lint, typecheck, tests, OpenAPI checks, and production build. Report any external database migration still requiring deployment.

## References

- [KiotViet Web guide](https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-kiotviet-web/kiotviet-web/)
- [Sapo Web Order overview](https://help.sapo.vn/tong-quan-kenh-dat-hang-online-web-order)
- [Sapo online order approval workflow](https://help.sapo.vn/tao-va-duyet-don-hang-online)
