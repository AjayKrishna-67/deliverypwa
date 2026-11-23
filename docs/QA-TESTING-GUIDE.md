# Transfers & Catalogue Names — QA Testing Guide

**Prepared:** 19 September 2026
**Applies to:** Delivery-PWA · Vendure Goods Transfer + Reports plugins
**Audience:** Testing team

Three things changed together:

1. The Daily Invoice stopped reading the Excel master and started reading the Vendure catalogue.
2. Goods Transfer learned to raise a request or a transfer against several branches at once.
3. The printed paperwork split into two documents built two different ways.

This is how each one works, the GraphQL behind it, and what to test.

---

## Contents

1. [Daily Invoice: names now come from Vendure](#part-1--daily-invoice-names-now-come-from-vendure)
2. [Goods Transfer: requests and transfers across several branches](#part-2--goods-transfer-requests-and-transfers-across-several-branches)
3. [The printed paperwork: trip note vs loading list](#part-3--the-printed-paperwork-trip-note-vs-loading-list)
4. [Running the queries yourself](#part-4--running-the-queries-yourself)
5. [Known data gaps before you start](#part-5--known-data-gaps-before-you-start)

---

# Part 1 — Daily Invoice: names now come from Vendure

The Tamil name printed under each English one used to be read from an Excel product master
uploaded on the Reports screen. It is now read from the product catalogue in Vendure.
**No spreadsheet is involved in any Daily Sales report any more.**

## Where each field moved to

| What prints | Old source (Excel column) | New source (Vendure) |
|---|---|---|
| Tamil / local name | `Tamil Name` (or `Malayalam Name` on the Idukki file) | `ProductVariant.customFields.localName` — product-level counterpart for weighed goods |
| Purchase-list section (OrdNo) | `OrdNo` | `FacetValue.customFields.purchaseOrdNo` — lowest number across the product's facet values |
| Category | `Category` | The product's facet values |
| English name | `Product Name` | Vendure's own order line — what the customer actually ordered |

> **The key that joins them:** bills and catalogue are matched on **SKU**. The bill row calls it
> `pCode`; the catalogue calls it `sku`. A SKU the catalogue does not know simply prints without
> a local name — it is not an error.

## The flow, in two calls

A Daily Sales report is two round trips, not one. The report query returns the bill lines; a
second query turns their SKUs into names. They are separate because the first comes from the
Reports plugin and the second from Vendure's ordinary catalogue API.

**Step 1** — Reports plugin. Needs `ViewBusinessReports` or `ViewDailyInvoiceReport`.

```graphql
# Returns one row per order line. pCode is the SKU we need next.
query BillPrintReport($input: BillPrintReportInput!) {
  billPrintReport(input: $input) {
    totalItems
    items {
      id  code  pCode  date  time
      itemName          # the English name
      qty  rate  total  netTotal
      hsnCode  taxRate  taxAmount
      ordNo  paymentMode  billingAddress
    }
  }
}
```

**Step 2** — standard Admin API. Needs `ReadCatalog` / `ReadProduct`.

```graphql
# Sent in chunks of 100 SKUs, take: 200 per chunk (room for a SKU
# that exists on more than one variant).
query ProductVariantsBySku($skus: [String!]!, $take: Int!) {
  productVariants(options: { filter: { sku: { in: $skus } }, take: $take }) {
    items {
      id  sku  name
      customFields { localName }             # the Tamil name
      product {
        id  name
        customFields { localName }           # umbrella name, weighed goods
        facetValues {
          id  name
          customFields { purchaseOrdNo }     # the section number
        }
      }
    }
  }
}
```

Variables for step 2:

```json
{
  "skus": ["VEG-TOM-500", "FRU-POM-1000"],
  "take": 200
}
```

## Five rules that decide what you see

1. **The lookup runs through the default channel.** A local name is a translation, not channel
   data, so any channel carrying the variant answers the same. The report asks
   `__default_channel__` first because it carries every product, and falls back to the channel
   you are viewing if you have no access to the default one.
2. **A variant never borrows the product's local name.** If the variant's `localName` is empty,
   the line prints in English — it does not fall back to the product's. Otherwise every pack
   size of one vegetable would print identically.
3. **Names are held with the report, not cached globally.** Once a report is loaded it keeps the
   names it loaded with. Pressing **Apply** is what re-reads the catalogue — so a name corrected
   in Vendure a moment ago shows on Apply, not on a re-open.
4. **Two variants on one SKU:** the one that actually has a local name wins.
5. **A failed lookup never blocks the report.** If the catalogue call fails (no permission,
   backend hiccup) the bills still print, in English only, under an amber banner reading
   "Tamil names could not be loaded from the catalogue".

## The Purchase List moved further still

The Purchase List is no longer assembled in the browser at all. The backend builds it and
returns it ready-sorted — by section, then Tamil collation. It is deliberately unpaginated: a
truncated purchase list under-orders food.

```graphql
query PurchaseListReport($input: PurchaseListReportInput!) {
  purchaseListReport(input: $input) {
    rows {
      ordNo         # section; null sorts last
      label         # localName, English only as a rescue
      productId  variantId  scope        # PRODUCT | VARIANT
      totalQty  unitKind  unitLabel      # WEIGHT|VOLUME|COUNT -> kg / l / Pcs
      variantCount
      incomplete    # part of totalQty is an assumption, not a measurement
    }
    orderCount  lineCount  incompleteCount
  }
}

# input: { from, to, channelIds?, states? }
# states defaults to outstanding orders — excludes Delivered,
# Cancelled, AddingItems, CancellationRequested.
```

> **Do not do this.** Never pass `__default_channel__` in `channelIds` alongside a city channel.
> Every order belongs to both, so the order is counted once per channel and the quantities double.

## What to test

| ID | What to do | Expected result |
|---|---|---|
| 1.1 | Change a variant's Local Name in the Vendure Dashboard, then press Apply on the Daily Sales report. | The new name prints. A re-open without Apply may still show the old one — that is by design, not a bug. |
| 1.2 | Find a SKU whose variant has an empty Local Name but whose parent product has one. | The line prints its English name only. It does **not** borrow the product's name. |
| 1.3 | A bill line whose `pCode` matches no variant in the catalogue. | Prints in English, no error, rest of the bill unaffected. |
| 1.4 | Sign in as a role without `ReadCatalog` and open a Daily Sales report. | Amber banner above the report; bills still print, in English. |
| 1.5 | Run a Daily Sales report on the Idukki channel. | Names print in whatever script the catalogue holds, with the right font — no boxes or blank glyphs. |
| 1.6 | Tag two differently-spelled categories with the same `purchaseOrdNo`, then run the Purchase List. | They merge into one section. A product with no tagged facet sorts last. |
| 1.7 | Upload a product master Excel on the Reports screen with a name you can recognise, then run any Daily Sales report. | Nothing changes. The upload screen still exists but no report reads it. |

> **Known rough edge — worth raising as a defect.** The master-upload cards are still on the
> Reports menu and `/api/tamil-names` still exists, but nothing consumes what is uploaded.
> Anyone uploading a corrected sheet will see it succeed and change nothing.

---

# Part 2 — Goods Transfer: requests and transfers across several branches

Two flows run in opposite directions, and telling them apart is most of understanding this
module. A **transfer** is a branch sending its own goods. A **request** is a branch asking
another branch to send. Both can now be raised against several branches in one pass.

## Which way round

| | Transfer | Request |
|---|---|---|
| **Raised by** | The branch **sending** | The branch **receiving** |
| **You pick** | `destinationChannelId` — who gets it | `sourceChannelId` — who is being asked |
| **Catalogue checked against** | The destination's catalogue | The asking branch's own catalogue |
| **Driver / vehicle** | Entered up front | Not present — the source fills them in at dispatch |
| **Direction on documents** | `OUT` | `IN` |
| **Permission** | `CreateGoodsTransfer` | `CreateGoodsTransfer` **or** `ApproveGoodsTransferReceipt` |

> **Why the request permission is wider.** Asking is a receiving-side act. A Receiving Manager
> holds Read plus the receipt permission and no Create at all — gating requests on Create would
> stop exactly the branches that run short from asking for stock.

## The states

### Request — raised by the receiver

```
REQUEST_DRAFT  →  REQUESTED  →  CONFIRMED  →  DISPATCHED  →  RECEIVED
```

| State | Who acts | What it means |
|---|---|---|
| `REQUEST_DRAFT` | The asker | Private. The branch being asked cannot see it at all. |
| `REQUESTED` | The asker sends it | The source can now see it and accept by confirming. |
| `CONFIRMED` | The source | Accepted. The transfer PDF is generated at this point. |
| `DISPATCHED` | The source | On the vehicle. Driver and vehicle are filled in here. |
| `RECEIVED` | The destination | Stock moves. Nothing before this point touches stock. |

`send: false` stops at REQUEST_DRAFT so the shelves can be walked and the list corrected before
the other branch ever sees it. `send: true` (the default) goes straight to REQUESTED.

### Transfer — raised by the sender

```
DRAFT  →  CONFIRMED  →  DISPATCHED  →  RECEIVED
```

No document exists until CONFIRMED.

> **The single most important behaviour in this module: stock moves ONLY at RECEIVED.**
> Nothing is reserved or deducted before it. A request in particular commits nothing — it is a
> question.

## Multi-branch: one mutation per branch

The screen lets you pick several branches and enter lines for each. Behind it there is **no
multi-branch mutation**. The form loops and sends one ordinary create call per branch, in
sequence, producing one normal transfer each — exactly what that branch would have received on
its own.

> **The most important test in this section: it is not atomic.**
> If the third branch fails, the first two are already created. The screen reports this by
> transfer number rather than hiding it — you should see something like
> "… TRF-C-0007 (Idukki), TRF-C-0008 (Salem) were already saved".
> A partial save is safe (a draft has moved no stock and can be deleted in a tap) but it must be
> *said out loud*. Test it by making one branch fail.

```graphql
# The destination decides which products may be entered — you are
# listing what can ARRIVE there, not what the sender happens to stock.
query SearchTransferProducts($destinationChannelId: ID!, $search: String) {
  searchTransferProducts(destinationChannelId: $destinationChannelId, search: $search) {
    productId  productName
    isPooled      # true = weighed, entered at PRODUCT level
    enabled
    variants { id  sku  name  enabled }
  }
}
```

```graphql
# One call per destination branch
mutation CreateGoodsTransfer($input: CreateGoodsTransferInput!) {
  createGoodsTransfer(input: $input) {
    id  transferNumber  state
    lines { id  productName  sku  isPooled  quantityPcs  weightGrams  weightKg }
  }
}
```

```graphql
# One call per branch being asked
mutation CreateGoodsTransferRequest($input: CreateGoodsTransferRequestInput!) {
  createGoodsTransferRequest(input: $input) {
    id  transferNumber  state
  }
}

# REQUEST_DRAFT -> REQUESTED, when the asker is ready
mutation SendGoodsTransferRequest($id: ID!) {
  sendGoodsTransferRequest(id: $id) { id  transferNumber  state }
}
```

## How a line is written

There are exactly two shapes, and mixing them is the commonest way to get a confusing error.

```json
{
  "input": {
    "destinationChannelId": "12",
    "remarks": "morning run",
    "driverName": "Hari",
    "driverPhone": "9876543210",
    "vehicleNumber": "TN 38 BX 1234",
    "lines": [
      { "productId": "418", "weightKg": 1.5 },
      { "productVariantId": "2207", "quantityPcs": 12 }
    ]
  }
}
```

The first line is **weighed** (`isPooled: true`) — product level, kilograms.
The second is **counted** — variant level, whole pieces.

| Rule | Detail |
|---|---|
| Weight units | `weightKg` (float, smallest 0.001) **or** `weightGrams` (int) — never both. Always stored as integer grams. |
| One measure per line | Exactly one of `quantityPcs` / weight is set. A product carried both ways in two branches will never merge on a printed sheet. |
| At least one line | Both create inputs require a non-empty `lines` array. |
| Destination is fixed | It cannot be changed after creation — every line belongs to that branch's catalogue. Wrong branch means delete and start again. |

## Editing: send only what changed

The line semantics on `updateGoodsTransfer` are not obvious and are worth a test of their own.
**Nothing is deleted by being absent.**

| You send | What happens |
|---|---|
| A line **with** an `id` | That row's quantity changes. The product on it cannot be changed. |
| A line **without** an `id` | Added as a new row. |
| A line you **omit** | Left exactly as it was. |
| `removeLineIds` | Those rows are dropped. Removals are applied first, so a product can be dropped and re-added in one call. |

Editing is allowed at **DRAFT, CONFIRMED and DISPATCHED** — a vehicle can be stopped to add
items. After CONFIRMED the document is regenerated and the destination is told what changed. At
**RECEIVED it is blocked**: stock is written, so a change is a damage claim, not an edit. A
request that has not been sent is corrected through `updateGoodsTransferRequest` instead, which
carries the request permission.

## What to test

| ID | What to do | Expected result |
|---|---|---|
| 2.1 | Pick three branches, enter lines for each, save. | Three separate transfers, three transfer numbers, each containing only its own branch's lines. |
| 2.2 | Make the second of three branches fail (revoke permission on it, or enter an invalid quantity). | An error naming the transfers that **were** created, and the form left alone so the rest can be retried. No silent partial save. |
| 2.3 | Select a branch but enter no lines for it. | No empty transfer is created for that branch. |
| 2.4 | Raise a request with `send: false`, then sign in as the branch being asked. | REQUEST_DRAFT is invisible to them. After Send request it appears as REQUESTED. |
| 2.5 | Use a role with the receipt permission and no Create. | The Request screen is available; New transfer is not. |
| 2.6 | On a 5-line transfer, send an update containing one line only. | The other four lines are untouched. |
| 2.7 | Try to edit a RECEIVED transfer. | Refused by the server, not merely hidden by the screen. |
| 2.8 | Watch destination stock through DRAFT → CONFIRMED → DISPATCHED → RECEIVED. | It moves only at RECEIVED. |
| 2.9 | Try to add a product that exists in the sender's catalogue but not the destination's. | It does not appear in the picker at all. |
| 2.10 | Give an account create rights in Madurai and receipt-only in Idukki, then switch branches. | The available buttons change with the branch, not just with the account. |

---

# Part 3 — The printed paperwork: trip note vs loading list

These are two different documents, built in two different places, for two different people.
Confusing them is the main risk in this area, so start here.

| | Trip note (merged PDF) | Loading list (the p-list) |
|---|---|---|
| **For** | The driver — every drop on one run | The godown — what to weigh out |
| **Built by** | Vendure, pdfkit, server-side | The browser, printed through the print dialog |
| **Query** | `combinedTransferDocument` | `transferLoadingList` |
| **Returns** | A base64 PDF | Flat, **unmerged** rows — the browser adds them up |
| **Drafts** | **Never** — a load nobody confirmed must not reach a driver | **Included** — it is wanted before anything is confirmed |
| **Direction** | Always reads `OUT`, whatever you send | Honours `OUT` / `IN` |
| **Stored?** | No — rebuilt each time, nothing in the asset store | No |
| **Tamil names** | **Cannot** — Helvetica has no Tamil glyphs | Yes — that is why it is built in the browser |

> **Why the split exists at all.** The backend draws its PDFs with pdfkit in Helvetica, which
> cannot render a single Tamil or Malayalam character. The loading list is headed by the local
> name of every product, so it had to move to the browser — which is also how the dashboard
> already prints bills and packing lists every day.

## Both take the same selection input

```graphql
input CombinedTransferDocumentInput {
  direction:    TransferDirection   # OUT (default) | IN
  transferIds:  [ID!]               # naming any SILENCES branchIds/from/to
  branchIds:    [ID!]               # far end; empty = every branch in the window
  from:         String
  to:           String
}
```

| Rule | Why it matters to you |
|---|---|
| `transferIds` wins | Name any ids and the branch and date filters are ignored entirely. A date window would be a guess that also swept up whatever else went to those branches that day. |
| Direction scopes the query | The server matches `sourceChannelId` when OUT and `destinationChannelId` when IN, against the branch you are acting as. **Send the wrong direction and you get an empty sheet, not an error.** |
| Another branch's paperwork is refused | Naming an id is not a way to read a transfer your branch is not on the chosen side of. |
| Dates are IST | A bare `YYYY-MM-DD` is widened to `T00:00:00+05:30` / `T23:59:59.999+05:30`. Read as plain UTC, "today" would end at 5:30 am IST and drop the newest loads. |

```graphql
# The merged PDF
query GoodsTransferCombinedDocument($input: CombinedTransferDocumentInput!) {
  combinedTransferDocument(input: $input) {
    filename                 # TRIP-<source>-<branches>-<date>.pdf
    content                  # the PDF, base64
    transferNumbers          # what it covers, in print order
    destinationChannelCodes
  }
}
```

In the PWA this is not fetched directly. It is served as a real PDF at
`/api/goods-transfer/trip-note?channel=…&transfers=…` so the URL is known *before* the click — a
window opened after an async fetch returns gets blocked by the browser. The route forwards your
session cookie and carries no authority of its own.

```graphql
# The loading list
query GoodsTransferLoadingList($input: CombinedTransferDocumentInput!) {
  transferLoadingList(input: $input) {
    channelCode
    direction
    rows {
      branchCode  transferNumber
      productName      # English, snapshotted when the line was added
      localName        # read LIVE from the catalogue; null if unset
      sku              # empty for weighed goods (no variant)
      quantityPcs  weightGrams
    }
  }
}
```

## The merge rule

The branches keep separate catalogues. The same vegetable is a different product row in each,
with its own id, its own SKU and usually its own English spelling — Idukki's "Uzhunnu Kanji Mix
100gm" and Madurai's "Black Urad Dal Porridge Mix 100gm" are one thing to weigh out and nothing
at all to match on. The only field they share is the name a shopper reads.

| Situation | Result on the sheet |
|---|---|
| Same Local Name, same measure | One line, quantities added |
| Different Local Name | Separate lines — a pack size is part of the name, so 250 g and 500 g stay apart |
| Weighed vs counted, same name | **Never** added together. 24 pieces plus 30 kg is a number true of nothing. |
| No Local Name at all | English name stands in, the row is **flagged** "no Local Name set", and those rows are grouped at the end |
| Same branch, same product, two transfers | One share — the godown weighs it out once |

## On screen vs on paper

One document, narrowed by the print stylesheet — so there are not two versions that can drift
apart. **Save as PDF gives you the paper version**, because printing is what Save as PDF is.

- **On screen:** row number, both names, a quantity column per branch, and the total.
- **On paper / in the PDF:** one name and the total. Nothing else.

The split between branches is the office's question, not the picker's, and every extra column on
a printed list is a column to misread under a lorry.

## New: the Tamil / Manglish dropdown

Both names are already on every row, so choosing between them costs no extra request and changes
nothing about the merge. The dropdown picks which one **heads the printed column**; the other
drops to the screen-only column beside it.

| Option | Reads | Looks like |
|---|---|---|
| **Tamil** (default) | Vendure `customFields.localName` | மஞ்சள்பூசணி 250 கி |
| **Manglish / English** | The Vendure product name | Mathanga (cut) 250gm |

It appears in four places:

- The transfer list → **Loading list** dialog, beside the date fields
- **New transfer**, after saving, above the print buttons
- **Request**, after saving, above the print buttons
- A single **transfer's own page**, in the action row — compact, beside a new Loading list button

> **Three limits to check — these are expected, not defects.**
>
> 1. **It does not affect Open PDF.** That file was rendered by the backend when the transfer was
>    confirmed and stored as an asset — nothing chosen at open time can change it, and it has no
>    Tamil glyphs anyway. It already shows the product name.
> 2. **Rows with no Local Name print the same either way.** In Tamil mode a blank local name falls
>    back to the product name on paper, so on those rows both options are identical.
> 3. **Merging never follows the dropdown.** Two branches spelling one product differently still
>    collapse to one line in Manglish mode, because matching stays on the Local Name.

## What to test

| ID | What to do | Expected result |
|---|---|---|
| 3.1 | Print the same selection twice, once per dropdown option. | The leading column swaps between the Tamil name and the product name; the totals are identical. |
| 3.2 | Find a product two branches spell differently in English but which shares a Local Name. Print in Manglish. | Still **one** line, with both English spellings joined by "/", and one combined total. |
| 3.3 | Same transfers, same option, printed from each of the four screens. | The same sheet from all four. |
| 3.4 | Use the browser's print preview or Save as PDF. | Only the chosen name and the total — no row numbers, no per-branch columns. |
| 3.5 | Include a product with an empty Local Name. | On screen it carries "no Local Name set — matched by English name" and sits with the other unnamed rows at the end. |
| 3.6 | Send the same product by weight from one branch and by pieces from another. | Two lines, one in kg and one in pcs. Never added together. |
| 3.7 | Print a multi-branch run with "A page per branch". | One print job, a page each, each merged only within its own branch — nothing added across branches. |
| 3.8 | Print both documents for a run containing an unconfirmed transfer. | The loading list includes it; the trip note does not. |
| 3.9 | Open a transfer detail page and use the new Loading list button. | A sheet for that one transfer, in the chosen name. It works on a REQUESTED transfer. |
| 3.10 | Open the same transfer as the source branch and then as the destination branch, printing from each. | Both print a populated sheet. A blank sheet here is a bug — report it with both branch codes. |
| 3.11 | Print a date range ending today, including a transfer raised this evening. | The evening transfer is on the sheet (IST day edges). |
| 3.12 | Block pop-ups in the browser, then print. | A readable message telling you to allow pop-ups — not a silent nothing. |

---

# Part 4 — Running the queries yourself

Everything above is the Vendure **Admin API**. You can run any of it from the Admin API
playground, or against the PWA's own proxy while signed into the PWA.

| What | Where | Notes |
|---|---|---|
| Vendure Admin API | the URL in `NEXT_PUBLIC_VENDURE_ADMIN_API` | Ask the dev team for the environment you are testing. |
| PWA proxy | `POST /api/graphql` | Same body. The browser talks only to the PWA; the PWA talks to Vendure. |
| Choosing a branch | `vendure-token` header | The channel token. This is what "acting as" a branch means — every permission check is per branch. |
| Auth | session cookie | Forwarded as-is. No cookie means an anonymous caller, which gets nothing. |

## Permissions you will need

| Area | Permission |
|---|---|
| Bill print / purchase list | `ViewBusinessReports` or `ViewDailyInvoiceReport` |
| Catalogue name lookup | `ReadCatalog` / `ReadProduct` |
| Read transfers | `ReadGoodsTransfer` |
| Create a transfer | `CreateGoodsTransfer` |
| Raise a request | `CreateGoodsTransfer` **or** `ApproveGoodsTransferReceipt` |
| Edit / delete | `UpdateGoodsTransfer` / `DeleteGoodsTransfer` |
| Receive goods | `ApproveGoodsTransferReceipt` |
| Damage | `RecordTransferDamage` / `ApproveTransferDamage` |

> **A useful habit.** When a sheet or report comes back empty, check the `vendure-token` and the
> `direction` before raising a bug. Between them they explain most empty results, and neither
> produces an error message.

---

# Part 5 — Known data gaps before you start

Moving off Excel did not remove the data dependency — it moved it into Vendure. Any variant
without a Local Name will print its English name and will not merge with the matching product at
another branch. These counts are from the live catalogue on 18 September 2026, enabled variants
only.

| Branch | Enabled variants | No Local Name | What you will see |
|---|---:|---:|---|
| Idukki | 309 | 1 | Effectively complete |
| Trichy | 377 | 22 | Occasional flagged row |
| Salem | 381 | 23 | Occasional flagged row |
| Madurai | 454 | 26 | Occasional flagged row |
| Coimbatore | 457 | 32 | Occasional flagged row |
| **Coimbatore Zone 2** | 460 | **85** | Expect flagged rows regularly |

Treat a flagged row as a **catalogue gap, not a software defect** — the flag exists to show you
which product rows still need a Local Name filled in. Report it as a data task rather than a bug,
with the SKU and the branch.

> **One more thing to know.** Every Local Name in the catalogue today is stored on the `en`
> translation row, and every one of them is in Tamil script. The `ta` and `ml` rows exist but
> carry no local names at all. So Idukki has been printing Tamil, which is exactly why the
> Manglish option was added.

---

Questions on anything here — especially an empty sheet or a flagged row you are not sure about —
go to the dev team with the branch code, the transfer number and the direction you were printing.
