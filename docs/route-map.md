# Route map

All public routes live under `/:lang` where `lang ∈ {ar, en}`. `/` redirects to `/ar` (default) with `Vary: Accept-Language` logic limited to a first-visit cookie. Arabic is RTL; English is LTR. Slugs are per-locale columns in the DB.

| Route | Board | Index? | Notes |
|---|---|---|---|
| `/:lang` | 01 | yes | Homepage |
| `/:lang/shop` | 02 | yes | All products |
| `/:lang/c/:category` | 02 | yes | Category listing; filtered URLs `canonical` → unfiltered |
| `/:lang/brands`, `/:lang/b/:brand` | 01/02 | yes | Brand collections |
| `/:lang/p/:slug` | 03 | yes | Product, `Product`+`Offer` JSON-LD |
| `/:lang/search?q=` | 02 | no | `noindex,follow` |
| `/:lang/wishlist` | 02 | no | Local + account-synced |
| `/:lang/cart` | 04 | no | |
| `/:lang/checkout` | 05 | no | Guest or account |
| `/:lang/checkout/result/:orderRef` | 05 | no | "Pending verification" until webhook |
| `/:lang/order/:orderRef` | — | no | Guest tracking (ref + phone/email check) |
| `/:lang/account`, `/orders`, `/addresses`, `/settings`, `/consent` | — | no | Customer auth |
| `/:lang/login`, `/register`, `/reset-password` | — | no | Turnstile on forms |
| `/:lang/branches`, `/:lang/branches/:slug` | 06 | yes | `LocalBusiness` only with verified data |
| `/:lang/appointments/:branch` | 06 | no | Only if branch enables exams |
| `/:lang/about` | 07 | yes | |
| `/:lang/blog`, `/blog/c/:cat`, `/blog/:slug` | 08 | yes | `Article` JSON-LD |
| `/:lang/contact`, `/faq` | — | yes | Contact form with Turnstile |
| `/:lang/delivery-returns`, `/privacy`, `/terms` | — | yes | Legal copy requires business/legal approval |
| `/:lang/guides/*` | — | yes | Lens/frame guides (Phase 7) |
| `*` | — | no | Branded 404 / 500 / maintenance |
| `/sitemap.xml`, `/robots.txt`, `/feeds/merchant.xml` | — | — | Phase 7 |
| `/webhooks/paymob` | — | — | Server-only, HMAC-verified, not locale-prefixed |

## Admin (`/:lang/admin/*`, ar/en like the storefront, `noindex`, `X-Robots-Tag`)

overview (board 09), orders, orders/:id, catalog (products, variants, media, categories, brands, price lists, CSV import), inventory (stock, adjustments, receipts), transfers, branches, customers, support (tickets), marketing (coupons, promotions, campaigns), cms (home blocks, nav/footer, banners, pages), blog, appointments, finance, reports, staff (users, roles, invites, sessions), integrations, settings, audit. Login at `/admin/login` with MFA.

## User flows

1. **Guest shopper**: home → category → product → add to cart → cart → checkout (guest) → Paymob hosted page or COD → result page (pending) → email with tracking link.
2. **Registered customer**: same plus saved addresses, order history, wishlist sync, consent management.
3. **Customer support**: ticket queue → customer profile + orders → notes → refund request to finance.
4. **Branch manager**: own-branch inventory, pickup orders, transfers (request/receive), branch hours.
5. **Marketing manager**: coupons, banners, campaigns, blog; preview → publish → rollback.
6. **Super admin (HQ)**: all modules, staff and roles, integrations status, audit review.
