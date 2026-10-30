# Orders, inventory and pricing policy (as built in Phase 4)

All rules live in `server/` and are used by both the storefront and the admin. Money is integer piasters everywhere.

## Cart and pricing

- The browser holds only a shopping list (variant id + quantity) in localStorage. It never sends prices.
- `POST /:lang/api/quote` (read-only) and `createOrder` re-price every line from the database. A request with a price, total or discount field is rejected (`.strict()` schemas).
- Only published products with a non-archived variant can be bought.
- One coupon per order (no stacking). Percent coupons round half up on piasters, are capped by the coupon maximum and by the subtotal. Item coupons never discount shipping. Tax is `0` until the business confirms tax treatment (the column exists).
- Shipping: delivery uses `shipping_rates` per governorate (fee, optional free-over threshold, active flag). Pickup is free. The seeded fees are **placeholders pending business input**.

## Stock

- `branch_inventory.on_hand` and `reserved`; sellable = `on_hand - reserved`. Database checks keep `0 <= reserved <= on_hand`.
- Every change to `on_hand` writes an append-only `stock_movements` row (receipt, sale, adjustment, return_to_stock). `reconcileLedger` proves the ledger sums to `on_hand`.
- A hold is a single atomic `UPDATE … WHERE on_hand - reserved >= qty`, so two buyers cannot both get the last unit. Rows are locked in variant-id order, so opposite-order carts cannot deadlock.
- Fulfilment is single-branch: delivery orders are allocated to the first online-fulfilment branch that can hold every line; pickup orders use the chosen pickup branch. A failed attempt rolls back to a savepoint. No split shipments in the MVP.
- Manual changes (`adjustStock`) need `inventory:write` for that branch and a reason, and can never push stock below the reserved quantity or zero.

## Order lifecycle

Order, payment and fulfilment are separate states (see `server/orders/state.ts`).

| Event | Order | Payment | Stock |
|---|---|---|---|
| Online order placed | `pending_payment`, expires in 30 min | `unpaid` | hold (`reserved += q`) |
| Provider confirms payment (`markOrderPaid`) | `confirmed` | `paid` | hold becomes a sale |
| COD order placed (only if `ENABLE_COD=true`) | `confirmed` | `awaiting_collection` | sold at once |
| Staff record cash after hand-over | `completed` (by delivery) | `paid` | — |
| Unpaid order expires (cron, every 5 min) | `cancelled` | `unpaid` | hold released |
| Cancelled before dispatch | `cancelled` | unchanged; `needs_refund` if it was paid | hold released or units returned, once |

- Idempotency: the checkout key is unique per order; a pg advisory lock serialises concurrent submits so a double click creates one order and one hold.
- COD is never `paid` because an order was submitted; only `recordCodCollection` (after delivered / picked up) marks it paid.
- Late payment after expiry: the service re-holds the stock at the same branch. If that works the order is reopened; if the stock is gone the payment is recorded, the order stays cancelled, `needs_refund = true` and `exception` is set for a human.
- Customers can cancel only unpaid orders. Staff cancellation needs `orders:manage` for the order's branch. Cancelling after dispatch is refused (use a return).
- Guest tracking: order reference + the phone number used on the order (or the signed access cookie issued when the order is placed). A wrong phone and an unknown reference give the same answer, and lookups are rate limited.

## Not built yet

Refund execution and provider reconciliation (Phase 5), returns restocking, transfers between branches (Phase 6), coupons admin UI (Phase 6/7), server-side persistent cart (the list lives in the browser; the server prices it every time).
