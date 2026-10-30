# Design system — SHROUK / Modern Egyptian Eyewear Luxury

Tokens are semantic CSS variables exposed through Tailwind v4 `@theme`. Values below are calibrated from the nine boards plus the kit's `design-tokens.json`; the kit marks them as proposals to validate.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F3EE` | `#141312` | Page |
| `--surface` | `#FFFFFF` / warm panel `#F1E8DF` | `#1D1B19` | Cards, product panels |
| `--fg` | `#171514` | `#F7F3EE` | Text |
| `--muted` | `#6B5A50` | `#B8A99D` | Secondary text |
| `--brand` | `#FF6A00` (kit primary) | same | Logo mark, accents |
| `--cta` | `#B94E25` (copper) | `#D8612F` | Buttons, links; verified for AA with white text in Phase 1 |
| `--sand` | `#DFD0C5` | `#3A2F28` | Borders, chips |
| `--brown` | `#4B2E23` | `#E7D3C5` | Headings accents |
| `--danger/--success` | defined in Phase 1 | | Status, discount badge |

Open point: the kit lists `#FF6A00` as primary and `#B94E25` as hover, while the boards' buttons look like copper-brown. Decision: use `#B94E25`-range for filled buttons (contrast), `#FF6A00` for brand mark only. Contrast ratios are computed and recorded in Phase 1. Dark mode is designed per surface, not inverted; product images keep their panels.

## Typography

Arabic: IBM Plex Sans Arabic (primary candidate) or Cairo; English: Inter or Manrope. Both open-licence; self-host WOFF2 subsets with `font-display: swap`, size-adjusted fallbacks. Scale (fluid `clamp`): 12/14/16/18/20/24/32/44/56. Arabic line-height 1.7 body, 1.35 headings; English 1.5/1.2. Logo wordmark uses kit SVG assets (outlined variants for font independence).

## Layout, shape, motion

Container 1280 max with fluid gutters (16 mobile, 24 tablet, 32+ desktop); 4/8 spacing scale; radius 8 (inputs), 12 (cards), 999 (pills); soft warm shadows; icon grid 20/24. Use logical properties (`ms-`, `pe-`, `inset-inline-*`) so RTL/LTR need no duplicate CSS; mirror directional icons. Motion: 150–250 ms ease-out; hero light sweep/parallax and scroll reveal via Motion for React as progressive enhancement; all disabled under `prefers-reduced-motion`; no layout shift. No fake 360° or try-on.

## Theming

Three modes: light, dark, system. Cookie `theme` read in SSR plus a minimal inline script setting `data-theme` before paint; no flash. Focus ring 2px copper + offset, visible in both themes.

## Responsive QA matrix

Viewports 360, 390, 430, 768, 1024, 1280, 1440, 1920; portrait/landscape; 200% zoom; no horizontal overflow. Tablet board = 1024 layout; mobile board = 390 layout; other widths fluid. Playwright visual snapshots for each of the nine pages at 390/1024/1440 in ar/light and ar/dark minimum.

## Components

Primitives: Button, IconButton, Input, Select, Checkbox, Radio card, Switch, Tabs, Accordion, Dialog/Sheet, Toast, Badge, Chip, Skeleton, Pagination, Breadcrumb, Tooltip. Composites listed per page in `design-audit.md`. Keep one shared UI library in `app/design-system`; a Storybook is not justified for MVP (a `/dev/components` showcase route, excluded in production, is enough).

## Accessibility

WCAG 2.2 AA intent: 4.5:1 text, 3:1 UI, 24px minimum targets (44 on mobile primary), keyboard operable gallery/filters/stepper, `aria-live` for cart and form errors, associated labels, skip link, Arabic `lang`/`dir` on `<html>`.
