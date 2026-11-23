# PWA prompt — Consume the new `deliveredOrdersReport` GraphQL query

Copy-paste everything below into a new Claude Code conversation started in
`/home/adminuser/Desktop/Website/Delivery-PWA`. It is self-contained — the new
conversation does not need access to the Admin-ui repo.

---

I have a Next.js 16 + React 19 PWA at this working directory. It already
consumes a Vendure Admin API via `/api/graphql` proxy (see
[graphql/client.ts](graphql/client.ts) — `vendureFetch` is the shared client)
and already has one report page at [app/reports/page.tsx](app/reports/page.tsx)
consuming a `deliveryReport` query. I want to add a second report page that
consumes a **new** backend query the Vendure plugin already exposes.

## What the backend provides

A new Vendure plugin (`ReportsPlugin`) has been added to the Admin API. It
exposes this Admin-API query — the SDL is exactly:

```graphql
type DeliveredOrdersReportRow {
  orderCode: String!
  orderStatus: String!
  "subTotalWithTax — product subtotal in paise"
  orderAmount: Int!
  "subTotalWithTax + shippingWithTax in paise"
  netAmount: Int!
  orderPlacedAt: DateTime
  deliveredAt: DateTime!
  channelId: ID!
  channelCode: String!
}

type DeliveredOrdersReport {
  items: [DeliveredOrdersReportRow!]!
  totalItems: Int!
  "Aggregate totals across the full (unpaginated) result set, in paise"
  totalOrderAmount: Int!
  totalNetAmount: Int!
}

input DeliveredOrdersReportInput {
  "Start of delivery date range (inclusive) — filters order.updatedAt"
  from: DateTime!
  "End of delivery date range (inclusive) — filters order.updatedAt"
  to: DateTime!
  "Optional channel filter. If omitted, uses the caller's active channel."
  channelIds: [ID!]
  skip: Int
  take: Int
}

extend type Query {
  deliveredOrdersReport(input: DeliveredOrdersReportInput!): DeliveredOrdersReport!
}
```

### Important behavior of the backend

- **Auth**: requires an admin session with the `ViewBusinessReports` permission
  (or SuperAdmin). Session is already provided by the existing `vendureFetch`
  — no extra work required. If the admin lacks the permission, the query
  returns a GraphQL `FORBIDDEN` error; the `GraphQLOperationError` class in
  `graphql/client.ts` will surface it automatically.
- **Money**: `orderAmount`, `netAmount`, `totalOrderAmount`, `totalNetAmount`
  are in **paise** (Int, minor units). Divide by 100 for rupees. Use
  [lib/formatters.ts](lib/formatters.ts) if it already has a money formatter;
  otherwise add one there.
- **Dates**: `orderPlacedAt` / `deliveredAt` are ISO-8601 strings. Format on
  the client — do not pass formatted strings to the backend.
- **Channel scoping**: if `channelIds` is omitted, the backend scopes to the
  caller's active channel (the channel selected via the `vendure-token`
  header). So for a default view, do not send `channelIds` — and do send the
  channel token exactly like [services/reports.service.ts](services/reports.service.ts)
  already does.
- **Pagination**: `skip` + `take`. Backend defaults `take=100`, caps at 1000.
- **Multi-row orders**: an order that belongs to N channels in the filter
  appears N times (one row per channel). This is intentional — same semantics
  as the original hand-written SQL.

## What I want you to build

Follow the exact same pattern already used by the existing delivery report.
Do not invent new abstractions — mirror the file layout and code style.

### 1. GraphQL operation
Create [graphql/operations/business-reports.ts](graphql/operations/business-reports.ts)
with an exported `DELIVERED_ORDERS_REPORT_QUERY` string. Mirror the style of
[graphql/operations/reports.ts](graphql/operations/reports.ts).

### 2. Service
Create [services/business-reports.service.ts](services/business-reports.service.ts)
with:
- TypeScript interfaces `DeliveredOrdersReportRow`, `DeliveredOrdersReport`,
  `DeliveredOrdersReportInput` matching the SDL above
- `fetchDeliveredOrdersReport(input, channelToken?)` function that calls
  `vendureFetch` and surfaces errors the same way
  [services/reports.service.ts](services/reports.service.ts) does

### 3. Page
Create [app/reports/business/page.tsx](app/reports/business/page.tsx) — a
client component with:
- Date range picker (from / to) — default to the current month
- "Apply" button that triggers fetch
- Results table with columns: Delivered Date, Order Code, Channel, Status,
  Order Amount (₹), Net Amount (₹)
- Footer row showing `totalOrderAmount` and `totalNetAmount` (formatted in ₹)
- "Total: X records" indicator above the table
- Basic pagination (Previous / Next, 50 per page) using `skip` + `take`
- Loading state, empty state, error state — copy styling from
  [app/reports/page.tsx](app/reports/page.tsx)
- "Download CSV" button that exports the currently-loaded page (client-side
  CSV generation — do not round-trip to the server)

### 4. Navigation
Add a link to `/reports/business` from wherever the existing
`/reports` entry point is linked in the app shell (check
[components/](components/) and [app/layout.tsx](app/layout.tsx) for the nav).

### 5. Auth gating
The existing reports page uses [providers/AuthProvider.tsx](providers/AuthProvider.tsx)
to check role. The new page should be accessible to ADMIN and ACCOUNTANT
roles only (hide it / redirect DELIVERY_PERSON). Mirror the gating pattern
already used in `app/reports/page.tsx`.

### 6. Types / codegen
If the project uses `npm run codegen` (see [codegen.ts](codegen.ts)), run it
after adding the new operation so typed hooks are regenerated. If the
generated client is not currently in use on the existing reports page, do not
introduce it for this one — match the existing style.

## Non-goals — do NOT do these

- Do NOT create new wrapper abstractions or utility libraries.
- Do NOT add a state-management library. Local `useState` + `useEffect` is
  fine — that's what the existing reports page uses.
- Do NOT try to format money or dates on the backend — that's the client's
  job and the SDL already returns raw paise / ISO datetimes.
- Do NOT add server-side CSV generation. Client-side from loaded rows is
  enough for the first version.
- Do NOT add feature flags, retry logic, or optimistic UI — ship the simple
  version first.

## Acceptance checklist (verify before reporting done)

- [ ] `npm run dev` starts with no TS errors
- [ ] Navigating to `/reports/business` renders the page
- [ ] Default date range = current month; table loads without input
- [ ] Changing dates + clicking Apply re-fetches
- [ ] Amounts display as `₹X,XXX.XX` (paise ÷ 100, Indian number formatting)
- [ ] DELIVERY_PERSON role cannot see the page or the nav link
- [ ] CSV download produces a file matching the visible table
- [ ] Empty-state message renders when zero rows returned
- [ ] Network error (stop the Vendure server) shows a friendly error, not a
  white screen

## Reference files already in the repo (read these first — do not reinvent)

- [graphql/client.ts](graphql/client.ts) — the `vendureFetch` wrapper
- [graphql/operations/reports.ts](graphql/operations/reports.ts) — query
  string style
- [services/reports.service.ts](services/reports.service.ts) — service
  pattern and error surfacing
- [app/reports/page.tsx](app/reports/page.tsx) — UI patterns, loading/error
  states, auth gating
- [lib/formatters.ts](lib/formatters.ts) — check for existing money / date
  formatters and reuse
- [providers/AuthProvider.tsx](providers/AuthProvider.tsx) — role detection

Start by reading those six files. Then build the four new files above. Keep
it minimal.
