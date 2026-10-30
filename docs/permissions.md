# RBAC permission matrix

Model: `permission = resource:action`. Roles bundle permissions. `role_assignments` carry an optional `branch_id`; a null branch means all branches. Every server action calls `authorize(user, permission, { branchId? , resourceOwner? })`; deny by default; UI hiding is cosmetic only. Branch-scoped roles can only read/write rows whose `branch_id` is in their assignments (enforced in repository queries, not in routes).

Legend: **A** all branches, **B** own branch only, **R** read only, **—** none. MFA is mandatory for every staff role.

| Module | HQ Admin | Ops Mgr | Marketing | Finance | Branch Mgr | Inventory | Support | Content Ed. |
|---|---|---|---|---|---|---|---|---|
| Overview KPIs | A | A | R(marketing) | R(finance) | B | B (stock) | — | — |
| Orders view | A | A | — | R | B | B | R | — |
| Orders manage (status, notes) | A | A | — | — | B | — | notes | — |
| Refunds approve | A | — | — | A | — | — | request | — |
| Catalog edit | A | A | — | — | — | — | — | R |
| Price change | A | A | — | — | — | — | — | — |
| Media upload | A | A | A | — | — | — | — | A |
| Inventory view | A | A | — | R | B | B | R | — |
| Stock adjust / receipt | A | A | — | — | B | B | — | — |
| Transfers request / approve | A | A | — | — | B / approve own | request B | — | — |
| Branches edit | A | A | — | — | B (hours, contact) | — | — | — |
| Customers view | A | A | R(segments) | R | B | — | A | — |
| Customer notes / tickets | A | — | — | — | — | — | A | — |
| Coupons / promotions | A | A | A | R | — | — | — | — |
| CMS blocks / banners / blog | A | — | A | — | — | — | — | A (publish needs Marketing/HQ) |
| Appointments | A | A | — | — | B | — | B | — |
| Finance / exports | A | R | — | A | — | — | — | — |
| Reports | A | A | R | A | B | B | — | — |
| Staff & roles | A | — | — | — | — | — | — | — |
| Integrations / settings | A | — | — | — | — | — | — | — |
| Audit log | A | R(ops) | — | R(finance) | — | — | — | — |

Notes: custom restricted roles are composed from the same permission strings by HQ Admin. Dangerous actions (price change, refund, stock adjust, role change, publish) always write an `audit_entries` row. Refunds over a configurable threshold need a second approver. Customer personal data export (CSV) requires explicit `export:customers` permission and is audited.

## Customer-side authorization

Customers access only their own orders/addresses (`customer_id = session.customer_id`). Guest tracking requires order ref plus matching phone or email, rate-limited, returning minimal fields.
