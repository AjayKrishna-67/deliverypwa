/**
 * Goods Transfer type definitions.
 *
 * These describe the SHAPE THE SCREENS USE, mirroring the field selections in
 * graphql/operations/goods-transfer.ts. The response envelopes (`{ goodsTransfer:
 * … }`) are not modelled here — the service unwraps them inline, the same way
 * services/location-stock.service.ts does.
 *
 * Quantities cross the wire as INTEGERS in a base unit: grams for pooled lines,
 * pieces for the rest. Convert at the UI boundary only — lib/stock-units.ts already
 * holds that conversion and is a port of the backend's own stock-units module.
 */

// ─── Lifecycle ───────────────────────────────────────────────────────

/**
 * The states a transfer moves through, in order.
 *
 * The first two exist only when the RECEIVING branch asked for the goods:
 * REQUEST_DRAFT is a request still being written and visible to nobody else,
 * REQUESTED one that has been sent. The source accepting it makes it an ordinary
 * DRAFT, and from there the two kinds are indistinguishable.
 */
export type TransferState =
    | 'REQUEST_DRAFT'
    | 'REQUESTED'
    | 'DRAFT'
    | 'CONFIRMED'
    | 'DISPATCHED'
    | 'RECEIVED';

/** The list's tabs. Not all of these are transfer states — some are views. */
export type ReportStatus =
    | 'ALL'
    | 'REQUEST_DRAFT'
    | 'REQUESTED'
    | 'DRAFT'
    | 'CONFIRMED'
    | 'DISPATCHED'
    | 'RECEIVED'
    | 'EXPIRING_SOON'
    | 'DAMAGE_PENDING'
    /** Approved OR rejected — every claim that has been settled. */
    | 'DAMAGE_DECIDED'
    | 'DAMAGE_APPROVED'
    | 'DAMAGE_REJECTED';

export type DamageState = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

// ─── List ────────────────────────────────────────────────────────────

/** The count behind each tab, so the tabs need no query of their own. */
export interface Summary {
    all: number;
    /** Requests written here and not sent yet — this branch's alone. */
    requestDraft: number;
    /** Requests waiting for the other branch to accept them. */
    requested: number;
    draft: number;
    confirmed: number;
    dispatched: number;
    received: number;
    damagePending: number;
    /** Approved or rejected together — what the combined tab counts. */
    damageDecided: number;
    damageApproved: number;
    damageRejected: number;
    /**
     * Products warned about and still on the shelf.
     *
     * Counts PRODUCTS, not transfers, unlike everything else here — expiry belongs to
     * something on a shelf rather than to a document. Comes from the same computation
     * the Expiring soon page uses, so the tab and the page can never disagree.
     */
    expiringSoon: number;
}

export interface TransferRow {
    id: string;
    transferNumber: string;
    state: TransferState;
    sourceChannelId: string;
    destinationChannelId: string;
    itemCount: number;
    createdAt: string;
    createdByName: string;
    /**
     * Set only on rows the receiving branch asked for, and kept once the source accepts
     * them — by then the state says DRAFT like any other, and this is all that is left
     * to tell a request apart from a load the source started itself.
     */
    requestedAt: string | null;
    requestedByName: string | null;
    /** Null until the transfer is confirmed — no document exists before then. */
    pdfAssetId: string | null;
    /**
     * Every claim raised against this transfer, state only.
     *
     * Enough to say "approved" or "rejected" on the row without opening it — which is
     * the whole question someone is asking while looking at the decided tab.
     */
    damageRequests: Array<{ state: DamageState }>;
}

/**
 * Something another branch did that this one should know about.
 *
 * Alerts ride on the list query rather than having an endpoint of their own, so
 * being told costs no extra call and there is no read/unread state to keep.
 */
export interface Alert {
    id: string;
    type: string;
    title: string;
    refType: string;
    refId: string;
    transferNumber: string | null;
    productName: string | null;
    createdAt: string;
}

// ─── Expiring products ───────────────────────────────────────────────

/**
 * One product nearing the end of its shelf life.
 *
 * A PRODUCT, not a transfer. `currentStock` is in base units — grams, millilitres or
 * pieces when pooled (`poolUnit` says which), pieces otherwise — like every other
 * quantity crossing this wire.
 *
 * `expiresAt` is what the sweep computed when it raised the warning, not something
 * recalculated for the screen. A shelf life edited afterwards therefore does not move
 * the date under a notification somebody is still holding.
 */
export interface ExpiringProduct {
    lineId: string;
    productName: string;
    sku: string | null;
    isPooled: boolean;
    /** What currentStock counts when pooled: 'kg', 'litre' or 'piece'. */
    poolUnit: string | null;
    currentStock: number;
    receivedAt: string;
    expiresAt: string | null;
    warnedAt: string;
    transferId: string;
    transferNumber: string;
}

export interface ExpiringProductList {
    totalItems: number;
    items: ExpiringProduct[];
}

// ─── Detail ──────────────────────────────────────────────────────────

/** The stored document. `updatedAt` is what breaks the browser cache. */
export interface TransferDocument {
    id: string;
    name: string;
    source: string;
    updatedAt: string;
}

/**
 * One product on a transfer.
 *
 * Pooled lines are product-level (`weightGrams` / `poolQty`); the rest are
 * variant-level and counted (`quantityPcs`). Which one applies is decided by the
 * PRODUCT, never by the person entering — that is what `isPooled` carries.
 *
 * A pooled line is NOT necessarily weighed: `poolUnit` says whether its pool counts
 * kilograms, litres or pieces, and `poolQty` is the figure in that unit. Read those
 * two. `weightKg` is null on anything that is not actually weighed.
 */
export interface TransferLine {
    id: string;
    /** Carried so a line can be looked up in the catalogue by id rather than by name. */
    productId: string;
    /** Null on a pooled line — pool entry is product-level. */
    productVariantId: string | null;
    productName: string;
    sku: string;
    isPooled: boolean;
    /** 'kg' | 'litre' | 'piece'. Null when not pooled, or on a legacy row. */
    poolUnit: string | null;
    quantityPcs: number | null;
    /** The pool figure as stored — an integer in the base unit of `poolUnit`. */
    weightGrams: number | null;
    /** The pool figure in its own unit. The one screens should display. */
    poolQty: number | null;
    /** The same, in kg — null unless the product is genuinely weighed. */
    weightKg: number | null;
    /** Live stock at the destination, or null when it cannot be read. */
    currentStock: number | null;
    damagedQty: number;
}

export interface AuditEntry {
    id: string;
    createdAt: string;
    action: string;
    fromState: string | null;
    toState: string | null;
    userName: string;
}

export interface DamageLine {
    id: string;
    lineId: string;
    productName: string;
    sku: string;
    isPooled: boolean;
    /** The unit of the line this was claimed against. See TransferLine.poolUnit. */
    poolUnit: string | null;
    damagedPcs: number | null;
    /** The damaged amount in the line's own unit — what screens should show. */
    damagedPoolQty: number | null;
    damagedKg: number | null;
    receivedQtySnapshot: number;
    /** Server-computed, as a string so the exact figure survives the round trip. */
    damagePercent: string | null;
    note: string | null;
    photos: Array<{ id: string; name: string; preview: string; source: string }>;
}

export interface DamageRequestDetail {
    id: string;
    damageNumber: string;
    state: DamageState;
    remarks: string | null;
    createdAt: string;
    createdByName: string;
    approvedByName: string | null;
    approvedAt: string | null;
    lines: DamageLine[];
}

export interface TransferDetail {
    id: string;
    transferNumber: string;
    state: TransferState;
    sourceChannelCode: string;
    destinationChannelCode: string;
    sourceChannelId: string;
    destinationChannelId: string;
    remarks: string | null;
    driverName: string | null;
    driverPhone: string | null;
    vehicleNumber: string | null;
    createdByName: string;
    createdAt: string;
    /** Set only on transfers the receiving branch asked for; kept once accepted. */
    requestedAt: string | null;
    requestedByName: string | null;
    confirmedAt: string | null;
    confirmedByName: string | null;
    dispatchedAt: string | null;
    dispatchedByName: string | null;
    receivedAt: string | null;
    receivedByName: string | null;
    pdfAsset: TransferDocument | null;
    lines: TransferLine[];
    audit: { totalItems: number; items: AuditEntry[] };
    damageRequests: DamageRequestDetail[];
}

/** What `createGoodsTransfer` hands back — enough to open the new draft. */
export interface CreatedTransfer {
    id: string;
    transferNumber: string;
    state: TransferState;
    lines: Array<{
        id: string;
        productName: string;
        sku: string;
        isPooled: boolean;
        poolUnit: string | null;
        quantityPcs: number | null;
        weightGrams: number | null;
        poolQty: number | null;
    }>;
}

// ─── Product picker ──────────────────────────────────────────────────

export interface DestinationVariant {
    id: string;
    sku: string;
    name: string;
    enabled: boolean;
}

/**
 * A product of the destination branch, as offered by the picker.
 *
 * Disabled products are returned and are deliberately selectable: being off sale is
 * no reason a product cannot be moved between branches. Stock posts for them like
 * any other line;  only decides whether customers see it.
 */
export interface DestinationProduct {
    productId: string;
    productName: string;
    isPooled: boolean;
    /**
     * What this product's pool is counted in: 'kg', 'litre' or 'piece'. Null when the
     * product is not pooled.
     *
     * Label the picker and the quantity box from THIS, not from `isPooled`. A pooled
     * product is not automatically a weighed one — Amla and Lemon are pooled and
     * counted in pieces, and calling every pool "KG" is what this field exists to
     * stop.
     */
    poolUnit: string | null;
    enabled: boolean;
    variants: DestinationVariant[];
}

/**
 * A row being built on screen, before it is sent.
 *
 * `amount` is kept as TEXT so a half-typed "1." does not become 1 while the person
 * is still typing. It is in the line's own unit: `poolUnit` for pooled lines —
 * kilograms, litres or a plain count — and pieces for the rest.
 */
export interface DraftLine {
    key: string;
    productId: string;
    productVariantId: string | null;
    productName: string;
    sku: string;
    isPooled: boolean;
    /** The pooled line's unit, copied off the product when it was picked. */
    poolUnit: string | null;
    enabled: boolean;
    amount: string;
}

/** A branch, as offered by the Ship-To picker. */
export interface TransferChannel {
    id: string;
    code: string;
    /**
     * The branch's API token.
     *
     * Carried so a screen can read ANOTHER branch's catalogue — the local names of the
     * products on a transfer live in the channel that stocks them, and the viewer is
     * often the other side of that transfer.
     */
    token: string;
}

// ─── Inputs ──────────────────────────────────────────────────────────

/**
 * One row being sent to the server.
 *
 * A row carrying an `id` changes THAT row's quantity; a row without one is added.
 * The product on an existing row cannot be changed — remove it and add the new
 * product instead.
 *
 * A pooled row sends `poolQty`, in the product's own unit. `weightKg` is left over
 * from when every pool was assumed to be a weight and the server refuses it on
 * anything else, so nothing here should send it.
 */
export interface GoodsTransferLineInput {
    id?: string;
    /** Pool products — entry is product-level. */
    productId?: string;
    /** PCS products — entry is variant-level. */
    productVariantId?: string;
    quantityPcs?: number;
    /** The pool quantity in the product's own unit — 1.5 kg, or 30 pieces. */
    poolQty?: number;
}

/**
 * One product request: the branch being asked, and what is wanted from it.
 *
 * The asking branch is never named — it is whichever branch the caller is acting as,
 * taken from the channel token, exactly as the source is on an ordinary transfer.
 */
export interface CreateTransferRequestInput {
    /** The branch being asked to send. Any branch except the one asking. */
    sourceChannelId: string;
    remarks?: string;
    lines: GoodsTransferLineInput[];
    /** false keeps it a private draft; true (the default) sends it at once. */
    send?: boolean;
}

export interface CreateGoodsTransferInput {
    destinationChannelId: string;
    remarks?: string;
    driverName?: string;
    driverPhone?: string;
    vehicleNumber?: string;
    lines: GoodsTransferLineInput[];
}

/**
 * Send ONLY what changes — anything left out stays exactly as it was. Nothing is
 * deleted by being absent; removal is explicit through `removeLineIds`.
 *
 * The head fields accept null as well as a string, and the difference matters:
 * LEAVING ONE OUT means "do not touch it", while sending null means "clear it".
 * Without null there would be no way to remove a driver name once entered — the
 * field would simply keep its old value and the save would look like it silently
 * failed.
 */
export interface UpdateGoodsTransferInput {
    id: string;
    remarks?: string | null;
    driverName?: string | null;
    driverPhone?: string | null;
    vehicleNumber?: string | null;
    lines?: GoodsTransferLineInput[];
    removeLineIds?: string[];
}

/**
 * One damaged product. PCS product → `damagedPcs`; pool product → `damagedPoolQty`,
 * in the line's own unit. `photoIndexes` names the positions in the flat photo
 * upload list that belong to THIS product — required once its damage reaches 5%.
 */
export interface DamageLineInput {
    lineId: string;
    damagedPcs?: number;
    /** The damaged amount in the line's own unit — 0.25 kg, or 4 pieces. */
    damagedPoolQty?: number;
    note?: string;
    photoIndexes?: number[];
}

export interface CreateDamageRequestInput {
    transferId: string;
    remarks?: string;
    lines: DamageLineInput[];
}

/**
 * Filters for the list read.
 *
 * `alertsAfterId` is the id of the newest alert this client has already shown — an
 * id, never a timestamp. `createdAt` is stored to microseconds but read back to
 * milliseconds, so a timestamp sent back as the marker is still earlier than the row
 * it came from, and the same alert repeats forever.
 */
export interface ReportInput {
    from?: string;
    to?: string;
    /** SuperAdmin only — otherwise the selected channel is used. */
    channelIds?: string[];
    /** Matches transfer number, driver name or driver phone. */
    search?: string;
    skip?: number;
    take?: number;
    alertsAfterId?: string | null;
}

/**
 * Which of this branch's transfers to print on one sheet.
 *
 * Everything is optional and the server's defaults are wide, the same way the list's
 * are. The screen sends the dates it is showing, so the sheet covers what the person
 * was looking at rather than a window they never chose.
 */
/** Which side of a transfer this branch is on — see CombinedDocumentInput. */
export type TransferDirection = 'OUT' | 'IN';

export interface CombinedDocumentInput {
    /**
     * OUT (the default) for transfers this branch is sending; IN for transfers coming
     * to it, its own product requests included. The trip note is the sender's paper
     * and always reads OUT.
     */
    direction?: TransferDirection;
    /**
     * Exactly which transfers to print. Naming any SILENCES the branch and date
     * filters — a screen that has just created three transfers knows which three, and
     * a date window would also sweep up whatever else went out today.
     */
    transferIds?: string[];
    /** The branches at the far end. Empty or absent means every branch in the window. */
    branchIds?: string[];
    from?: string;
    to?: string;
}

/**
 * The trip note as bytes.
 *
 * `content` is base64 — the document is built on demand and never stored, so there is
 * no asset URL to open. The screen turns it into a blob and opens that.
 */
export interface CombinedTransferDocument {
    filename: string;
    content: string;
    /** The transfers it covers, in the order they are printed. */
    transferNumbers: string[];
    /** The branches it covers, each named once. */
    destinationChannelCodes: string[];
}

/**
 * Every line of every consignment in the selection, as the server returned it.
 *
 * The rows are merged in the browser — see lib/goods-transfer-loading-list.ts for the
 * rule and for why the local name is the key.
 */
export interface TransferLoadingList {
    /** The branch being acted as. */
    channelCode: string;
    /** Which side of these transfers that branch is on. */
    direction: TransferDirection;
    rows: Array<{
        /** The far end: where this is going when OUT, where it is from when IN. */
        branchCode: string;
        transferNumber: string;
        /** The English name, snapshotted onto the line when it was added. */
        productName: string;
        /**
         * The shopper-facing name the branches share — what the merge matches on.
         * Null when nobody has filled in the Local Name field for that product.
         */
        localName: string | null;
        /** Empty for pooled products, which have no variant. */
        sku: string;
        quantityPcs: number | null;
        /** The pool quantity as stored: an integer in the base unit named by poolUnit. */
        weightGrams: number | null;
        /** 'kg', 'litre' or 'piece'. Null on a counted (variant) line. */
        poolUnit: string | null;
    }>;
}

// ─── Mutation results ────────────────────────────────────────────────
//
// Each mirrors exactly what its mutation selects — no more, so a screen cannot read
// a field the server was never asked for.

export interface TransferListResult {
    totalItems: number;
    summary: Summary;
    items: TransferRow[];
    alerts: Alert[];
}

export interface UpdatedTransfer {
    id: string;
    state: TransferState;
    remarks: string | null;
    driverName: string | null;
    driverPhone: string | null;
    vehicleNumber: string | null;
    lines: TransferLine[];
}

export interface ConfirmedTransfer {
    id: string;
    state: TransferState;
    confirmedByName: string | null;
    confirmedAt: string | null;
    pdfAsset: TransferDocument | null;
}

export interface DispatchedTransfer {
    id: string;
    state: TransferState;
    dispatchedByName: string | null;
    dispatchedAt: string | null;
}

export interface ReceivedTransfer {
    id: string;
    state: TransferState;
    receivedByName: string | null;
    receivedAt: string | null;
    lines: Array<{
        id: string;
        productName: string;
        isPooled: boolean;
        currentStock: number | null;
    }>;
}

export interface CreatedDamageRequest {
    id: string;
    damageNumber: string;
    state: DamageState;
    lines: Array<{
        id: string;
        productName: string;
        damagedPcs: number | null;
        damagedPoolQty: number | null;
        damagePercent: string | null;
        photos: Array<{ id: string; name: string; preview: string }>;
    }>;
}

export interface DecidedDamageRequest {
    id: string;
    damageNumber: string;
    state: DamageState;
    approvedByName: string | null;
    approvedAt: string | null;
}
