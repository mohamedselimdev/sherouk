# Design audit — nine reference boards

Source: `_kit/SHROUK_PRODUCTION_KIT/design-references/01..09-*.png`. All nine files were opened and inspected individually. The master prompt names them `shrouk_eyewear_*.png`; the kit ships them as `01-homepage.png` … `09-admin-overview.png`. Mapping is by content and order, and every board is present (no missing source).

Each board shows three columns: Desktop 1440, Tablet 1024, Mobile 390. All are Arabic RTL. The English variant has no board; it is derived by mirroring (logical CSS properties).

Data shown on boards (prices, ratings, discounts, brand logos, branch names/addresses/phones, statistics such as "+50 branches", "+500K customers", timeline years, admin KPIs, customer names) is **illustrative** and must not ship as fact. Board brand logos (Ray-Ban, Oakley, Tom Ford, Vogue, Persol, Polaroid) are third-party marks; they appear only if the business confirms it stocks them and has permission.

## Global shell (all storefront boards)

- Header desktop: utility cluster (EN|AR, theme moon, wishlist, account, cart with count badge), centered logo, rounded search field with copper button, second row of text nav (Home, Sunglasses, Prescription, Contact lenses, Kids, Collections, About, Blog). Active item copper.
- Header tablet/mobile: hamburger, centered logo, search icon, wishlist (tablet), cart badge.
- Footer: dark charcoal block, logo + tagline, link columns (Shop, Info, Customer service), newsletter field, social icons, payment-method marks, copyright. Mobile collapses columns to accordions.
- Trust strip (4 items): 24/7 support, fast shipping, authentic products, easy returns 14 days. Claims must be validated by the business before publishing.
- Product card: image on warm panel, wishlist heart, optional badge (discount % / best seller), title, subtitle, price (+struck old price), colour swatches, add-to-cart button.

## 1. Homepage → `/:lang`

Sections: hero slider (headline, subcopy, copper CTA, slide dots, arrows); 4 category tiles (sunglasses, prescription, contact lenses, kids); trust strip; "Best sellers" 4-up grid with "view all"; brands row; two editorial tiles (story, branches); footer. Tablet: 2×2 category tiles, 4-up compact cards. Mobile: 2×2 tiles, list-style product rows with cart icon button.
Components: `Header`, `HeroSlider`, `CategoryTile`, `TrustStrip`, `ProductCard`, `ProductRow`, `BrandStrip`, `EditorialTile`, `Footer`.
Data: CMS hero blocks, categories, best-seller query, brands, branch count (computed, never hard-coded).
Images: hero (text-free desktop + mobile art direction), category photos, editorial tiles.

## 2. Shop / catalog → `/:lang/shop`, `/:lang/c/:category`

Sections: category hero banner; sub-category chip carousel; sidebar filters (category, brand with counts, price range slider EGP, frame colour swatches, lens colour, frame shape); results count, sort dropdown, grid/list toggle; 4-col grid; numbered pagination. Tablet: filters in a button, 2-col grid, "load more". Mobile: Filter button + sort + view toggle, single-column list cards, "load more".
Components: `CategoryHero`, `ChipCarousel`, `FilterPanel` (sidebar / bottom sheet), `SortSelect`, `ViewToggle`, `ProductGrid`, `Pagination`, `LoadMore`.
Rules: filter state lives in the URL query; filter-only URLs canonicalise to the category page (see SEO policy in architecture).
Data: facets computed from DB, not constants.

## 3. Product details → `/:lang/p/:slug`

Sections: breadcrumb; gallery (thumb rail + large image + zoom; mobile swipe with 1/5 counter); title, rating, short description, price/old price/discount, colour swatches, size, add-to-cart, buy-now, wishlist; trust mini-strip; tabs (Description, Details, Reviews); feature list with icons (UV protection, polarised lenses, light frame, fits most faces); related products; mobile accordion instead of tabs; sticky bottom bar (price + add-to-cart).
Components: `Gallery`, `VariantPicker`, `PriceBlock`, `StickyBuyBar`, `Tabs`/`Accordion`, `FeatureList`, `RelatedProducts`, `Breadcrumbs`.
Rules: rating and review count only when real reviews exist (reviews module is Phase 2; MVP hides the rating row). Feature claims (UV400, polarised) come from product attributes, never copy.

## 4. Cart → `/:lang/cart`

Sections: title with item count; line table (image, name, variant, unit price, quantity stepper, line total, remove); order summary (subtotal, coupon field, shipping estimate with city + "change", total, VAT note, checkout CTA, continue shopping); trust strip; "You may also like"; promo tiles. Tablet/mobile: stacked line cards, summary below, sticky total + checkout bar on mobile.
Components: `CartLine`, `QuantityStepper`, `CouponForm`, `OrderSummary`, `ShippingEstimate`, `StickyCheckoutBar`.
Rules: totals from server; "inclusive of VAT" text only after tax policy is approved.

## 5. Checkout → `/:lang/checkout`

Sections: 4-step stepper (customer info, shipping & pickup, payment, review). Desktop shows all panels at once in 3 columns: customer info + delivery method + address; payment method list + secure-payment note + totals + place order; order summary with line items and coupon. Tablet: 2 columns. Mobile: accordion per step.
Payment options on the board: cash on delivery, cards (Visa/Mastercard/Meeza), e-wallets (Vodafone Cash, Orange, etc.), Valu instalments. Per the master prompt, **only methods verified with the merchant/provider are enabled**; others are hidden, not shown as disabled promises.
Components: `Stepper`, `CustomerForm`, `PhoneField` (+20), `DeliveryMethodCards`, `AddressForm` (governorate/city), `PaymentMethodList`, `SecureNote`, `CheckoutSummary`.
Rules: no card inputs in our UI; card goes to Paymob hosted page. Guest checkout default; "create account" checkbox optional.

## 6. Branch locator → `/:lang/branches`, `/:lang/branches/:slug`

Sections: hero (storefront photo); search field + city filter; list of branch cards (photo, name, "main branch" tag, address, phone, hours); map with numbered pins and zoom/locate controls; selected-branch detail card with Directions / Call / Book exam buttons. Tablet: map above list, cards with three buttons. Mobile: filters, map, list.
Components: `BranchSearch`, `BranchCard`, `BranchMap`, `BranchDetail`.
Rules: the board shows 7 branches with invented addresses. Count is data-driven; branch pages and LocalBusiness schema publish only verified data. "Book exam" shown only if the branch has appointments enabled. Map provider decision pending (see assumptions: Leaflet + OSM tiles vs Google Maps).

## 7. About → `/:lang/about`

Sections: hero with headline and CTA; story block with image; three value cards (values, vision, mission); stat row; timeline (4 milestones); "Why Shrouk" 4 icons; closing CTA with "find a branch" and "shop now"; footer.
Components: `PageHero`, `StoryBlock`, `ValueCard`, `StatRow`, `Timeline`, `FeatureGrid`, `CtaBand`.
Rules: stats and timeline years are placeholders. Content comes from CMS blocks and is marked "needs business input" until supplied.

## 8. Blog → `/:lang/blog`, `/:lang/blog/c/:category`, `/:lang/blog/:slug`

Sections: featured-article hero; category chip row (All, lifestyle, eye-care tips, glasses guide, fashion, contact lenses); latest-articles 4-up grid with category tags; featured wide article banner; newsletter signup. Tablet: 2-col grid. Mobile: list rows with arrow button.
Components: `FeaturedPost`, `CategoryChips`, `PostCard`, `PostRow`, `NewsletterForm`.
Rules: the article route is not on the board; it reuses the typography and hero style. Health content (lens care, eye health) needs reviewed copy; no medical claims.

## 9. Admin overview → `/admin` (localised UI)

Dark theme board. Sections: right-hand sidebar (dashboard, orders, products, inventory, branches, customers, marketing, reports, users, settings); top bar (search, notifications, quick action, user chip); greeting banner; 4 KPI cards (current sales, total orders, new customers, conversion) with delta; sales-trend line chart with range select; category donut; recent orders table; top products; branch performance table; low-stock list; new customers list. Tablet: sidebar → hamburger, 2×2 KPI. Mobile: KPI stack, chart, compact lists, quick-action tiles, bottom tab bar.
Components: `AdminShell`, `Sidebar`, `KpiCard`, `TrendChart`, `DonutChart`, `DataTable` (stacked on mobile), `StatusPill`, `BottomTabBar`.
Rules: every number comes from queries with date/branch/channel filters and a "last refreshed" stamp. "Conversion" requires analytics data and is hidden until instrumented. Admin is also light/dark per the master prompt; the board only shows dark.

## Image needs summary

Kit assets cover temporary hero/lifestyle crops and 10 vector product illustrations. Not production grade (kit's own limitation notes). Needed from the business: real product photography per SKU (white/neutral background, ≥1600px long side, 4:5 or 1:1), branch photos, hero campaign images, licensed lifestyle imagery, approved brand logos.
