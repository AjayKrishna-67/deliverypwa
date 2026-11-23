/**
 * Goods Transfer service — stock moving between branches.
 *
 * Every call runs under the SELECTED channel token (the sidebar's channel
 * dropdown), which is what makes a read branch-scoped: Madurai sees Madurai's
 * transfers because of that header, not because of anything a screen decides. The
 * server re-checks the channel on every write, so this is convenience, never the
 * guard.
 *
 * All reads and all writes but one go through `vendureFetch`, the same JSON proxy
 * the rest of the dashboard uses. The exception is `createDamageRequest`: it
 * carries photo files, and files cannot travel as a JSON variable. That one call
 * uses `uploadFetch` below — see the comment there for why it needs its own route.
 */

import {
    GraphQLOperationError,
    GraphQLRequestError,
    vendureFetch,
    type GraphQLResponse,
} from '@/graphql/client';
import {
    APPROVE_DAMAGE_REQUEST_MUTATION,
    CONFIRM_GOODS_TRANSFER_MUTATION,
    CREATE_DAMAGE_REQUEST_MUTATION,
    CREATE_GOODS_TRANSFER_MUTATION,
    CREATE_TRANSFER_REQUEST_MUTATION,
    DELETE_GOODS_TRANSFER_MUTATION,
    DISPATCH_GOODS_TRANSFER_MUTATION,
    EXPIRING_PRODUCTS_QUERY,
    GOODS_TRANSFERS_QUERY,
    GOODS_TRANSFER_LOCAL_NAMES_QUERY,
    GOODS_TRANSFER_QUERY,
    RECEIVE_GOODS_TRANSFER_MUTATION,
    REJECT_DAMAGE_REQUEST_MUTATION,
    SEARCH_TRANSFER_PRODUCTS_QUERY,
    SEND_TRANSFER_REQUEST_MUTATION,
    TRANSFER_CHANNELS_QUERY,
    TRANSFER_LOADING_LIST_QUERY,
    TRANSFER_PDF_QUERY,
    UPDATE_GOODS_TRANSFER_MUTATION,
    UPDATE_TRANSFER_REQUEST_MUTATION,
} from '@/graphql/operations/goods-transfer';
import type {
    CombinedDocumentInput,
    ConfirmedTransfer,
    CreateDamageRequestInput,
    CreateGoodsTransferInput,
    CreateTransferRequestInput,
    CreatedDamageRequest,
    CreatedTransfer,
    DecidedDamageRequest,
    DestinationProduct,
    DispatchedTransfer,
    ExpiringProductList,
    ReceivedTransfer,
    ReportInput,
    ReportStatus,
    TransferChannel,
    TransferDetail,
    TransferDocument,
    TransferListResult,
    TransferState,
    TransferLoadingList,
    UpdateGoodsTransferInput,
    UpdatedTransfer,
} from '@/types/goods-transfer';

// ─── Reads ───────────────────────────────────────────────────────────

/**
 * The list, the report tabs and the search box in one read.
 *
 * `alerts` rides along: whatever another branch has done since `input.alertsAfterId`
 * arrives with the rows the screen was already fetching.
 */
export async function fetchTransfers(
    status: ReportStatus | undefined,
    input: ReportInput,
    channelToken: string,
): Promise<TransferListResult> {
    const { data } = await vendureFetch<{ goodsTransfers: TransferListResult }>(
        GOODS_TRANSFERS_QUERY,
        { status, input },
        channelToken,
    );
    return data.goodsTransfers;
}

/**
 * Products this branch has been warned about, soonest to expire first.
 *
 * A separate read from the transfer list on purpose — it answers a different question
 * ("what is ageing on my shelf") and returns a different shape (one row per product,
 * not per transfer).
 */
export async function fetchExpiringProducts(
    input: { skip?: number; take?: number },
    channelToken: string,
): Promise<ExpiringProductList> {
    const { data } = await vendureFetch<{ expiringProducts: ExpiringProductList }>(
        EXPIRING_PRODUCTS_QUERY,
        { input },
        channelToken,
    );
    return data.expiringProducts;
}

export async function fetchTransfer(id: string, channelToken: string): Promise<TransferDetail> {
    const { data } = await vendureFetch<{ goodsTransfer: TransferDetail }>(
        GOODS_TRANSFER_QUERY,
        { id },
        channelToken,
    );
    return data.goodsTransfer;
}

/**
 * The printable document for one transfer.
 *
 * Fetched when the PDF button is pressed rather than with the list: asking for every
 * row's URL up front would fetch documents nobody opens. Null before CONFIRMED —
 * no document exists until then.
 */
export async function fetchTransferPdf(
    id: string,
    channelToken: string,
): Promise<TransferDocument | null> {
    const { data } = await vendureFetch<{ goodsTransfer: { pdfAsset: TransferDocument | null } }>(
        TRANSFER_PDF_QUERY,
        { id },
        channelToken,
    );
    return data.goodsTransfer.pdfAsset;
}

/**
 * The lines behind the loading list, unmerged.
 *
 * Same selection as the trip note, so the two sheets always cover the same
 * transfers. Throws when nothing matches rather than returning an empty list.
 */
export async function fetchTransferLoadingList(
    input: CombinedDocumentInput,
    channelToken: string,
): Promise<TransferLoadingList> {
    const { data } = await vendureFetch<{ transferLoadingList: TransferLoadingList }>(
        TRANSFER_LOADING_LIST_QUERY,
        { input },
        channelToken,
    );
    return data.transferLoadingList;
}

/** The branches offered in Ship-To. The project's existing query. */
export async function fetchTransferChannels(channelToken: string): Promise<TransferChannel[]> {
    const { data } = await vendureFetch<{ getChannelList: TransferChannel[] }>(
        TRANSFER_CHANNELS_QUERY,
        {},
        channelToken,
    );
    return data.getChannelList;
}

/**
 * Products of the branch chosen in Ship-To.
 *
 * Disabled products come back too and stay selectable — a disabled line still
 * travels, still prints and still posts stock — being off sale only means customers
 * cannot see it.
 */
export async function searchTransferProducts(
    destinationChannelId: string,
    search: string,
    channelToken: string,
    /**
     * Omitted by the picker, which wants the server's short default. The product
     * request screen asks for the whole branch catalogue and says so.
     */
    take?: number,
): Promise<DestinationProduct[]> {
    const { data } = await vendureFetch<{ searchTransferProducts: DestinationProduct[] }>(
        SEARCH_TRANSFER_PRODUCTS_QUERY,
        { destinationChannelId, search: search || undefined, take },
        channelToken,
    );
    return data.searchTransferProducts;
}

/**
 * The catalogue's own local names, keyed by product id and by variant id.
 *
 * Vendure holds these on the product and on each variant, so a line can be named
 * without matching anything: no SKU, no spelling, no family. Whatever is missing here
 * falls through to the Excel master, which is why an empty value is returned as absent
 * rather than as an empty string.
 *
 * Scoped to the token's channel, which is exactly right for the request screen — the
 * products it lists are that branch's own.
 */
export async function fetchLocalNames(
    channelToken: string,
    take = 2000,
): Promise<{ byProductId: Map<string, string>; byVariantId: Map<string, string> }> {
    const byProductId = new Map<string, string>();
    const byVariantId = new Map<string, string>();
    try {
        const { data } = await vendureFetch<{
            products: {
                items: Array<{
                    id: string;
                    customFields?: { localName?: string | null } | null;
                    variants: Array<{
                        id: string;
                        customFields?: { localName?: string | null } | null;
                    }>;
                }>;
            };
        }>(GOODS_TRANSFER_LOCAL_NAMES_QUERY, { take }, channelToken);

        for (const p of data.products.items) {
            const pn = p.customFields?.localName?.trim();
            if (pn) byProductId.set(String(p.id), pn);
            for (const v of p.variants ?? []) {
                const vn = v.customFields?.localName?.trim();
                if (vn) byVariantId.set(String(v.id), vn);
            }
        }
    } catch {
        // A catalogue that will not answer must not stop a sheet from printing. The
        // Excel master still names what it can.
    }
    return { byProductId, byVariantId };
}

// ─── Transfer lifecycle ──────────────────────────────────────────────

export async function createTransfer(
    input: CreateGoodsTransferInput,
    channelToken: string,
): Promise<CreatedTransfer> {
    const { data } = await vendureFetch<{ createGoodsTransfer: CreatedTransfer }>(
        CREATE_GOODS_TRANSFER_MUTATION,
        { input },
        channelToken,
    );
    return data.createGoodsTransfer;
}

/**
 * Ask another branch to send these products.
 *
 * Raised by the branch that will RECEIVE them, which is the one difference from
 * createTransfer: the channel token names the asker, and `sourceChannelId` names who
 * is being asked. What comes back is an ordinary transfer sitting one state earlier.
 */
export async function createTransferRequest(
    input: CreateTransferRequestInput,
    channelToken: string,
): Promise<{ id: string; transferNumber: string; state: TransferState }> {
    const { data } = await vendureFetch<{
        createGoodsTransferRequest: { id: string; transferNumber: string; state: TransferState };
    }>(CREATE_TRANSFER_REQUEST_MUTATION, { input }, channelToken);
    return data.createGoodsTransferRequest;
}

/**
 * Correct an unsent request. Same input and line semantics as updateTransfer; its own
 * call because it carries the request permission rather than Update.
 */
export async function updateTransferRequest(
    input: UpdateGoodsTransferInput,
    channelToken: string,
): Promise<UpdatedTransfer> {
    const { data } = await vendureFetch<{ updateGoodsTransferRequest: UpdatedTransfer }>(
        UPDATE_TRANSFER_REQUEST_MUTATION,
        { input },
        channelToken,
    );
    return data.updateGoodsTransferRequest;
}

/** REQUEST_DRAFT → REQUESTED. Only the branch that raised it may send it. */
export async function sendTransferRequest(
    id: string,
    channelToken: string,
): Promise<{ id: string; transferNumber: string; state: TransferState }> {
    const { data } = await vendureFetch<{
        sendGoodsTransferRequest: { id: string; transferNumber: string; state: TransferState };
    }>(SEND_TRANSFER_REQUEST_MUTATION, { id }, channelToken);
    return data.sendGoodsTransferRequest;
}

/**
 * Edit at DRAFT, CONFIRMED or DISPATCHED alike.
 *
 * Sending only the line you touched is safe — rows not mentioned are left alone.
 * Removal is explicit through `input.removeLineIds`.
 */
export async function updateTransfer(
    input: UpdateGoodsTransferInput,
    channelToken: string,
): Promise<UpdatedTransfer> {
    const { data } = await vendureFetch<{ updateGoodsTransfer: UpdatedTransfer }>(
        UPDATE_GOODS_TRANSFER_MUTATION,
        { input },
        channelToken,
    );
    return data.updateGoodsTransfer;
}

export async function deleteTransfer(id: string, channelToken: string): Promise<boolean> {
    const { data } = await vendureFetch<{ deleteGoodsTransfer: boolean }>(
        DELETE_GOODS_TRANSFER_MUTATION,
        { id },
        channelToken,
    );
    return data.deleteGoodsTransfer;
}

/** DRAFT → CONFIRMED. Locks the lines, issues the document, tells the destination. */
export async function confirmTransfer(
    id: string,
    channelToken: string,
): Promise<ConfirmedTransfer> {
    const { data } = await vendureFetch<{ confirmGoodsTransfer: ConfirmedTransfer }>(
        CONFIRM_GOODS_TRANSFER_MUTATION,
        { id },
        channelToken,
    );
    return data.confirmGoodsTransfer;
}

/** CONFIRMED → DISPATCHED. The goods have physically left the source branch. */
export async function dispatchTransfer(
    id: string,
    channelToken: string,
): Promise<DispatchedTransfer> {
    const { data } = await vendureFetch<{ dispatchGoodsTransfer: DispatchedTransfer }>(
        DISPATCH_GOODS_TRANSFER_MUTATION,
        { id },
        channelToken,
    );
    return data.dispatchGoodsTransfer;
}

/**
 * DISPATCHED → RECEIVED. The only call in the module that writes stock, and it
 * writes it once. It belongs to the destination branch alone — the server checks
 * the channel, not just the permission, so the sending branch cannot accept on the
 * other's behalf.
 */
export async function receiveTransfer(
    id: string,
    channelToken: string,
): Promise<ReceivedTransfer> {
    const { data } = await vendureFetch<{ receiveGoodsTransfer: ReceivedTransfer }>(
        RECEIVE_GOODS_TRANSFER_MUTATION,
        { id },
        channelToken,
    );
    return data.receiveGoodsTransfer;
}

// ─── Damage ──────────────────────────────────────────────────────────

/**
 * Raise one claim covering every product found broken in a transfer.
 *
 * The photos travel as real files in the same request, and `input.lines[].photoIndexes`
 * says which of them belong to which product. A line whose damage reaches 5% of what
 * was received must carry at least one — the server refuses the claim otherwise, and
 * says so in words worth showing to the person on the screen.
 */
export async function createDamageRequest(
    input: CreateDamageRequestInput,
    photos: File[],
    channelToken: string,
): Promise<CreatedDamageRequest> {
    const data = await uploadFetch<{ createDamageRequest: CreatedDamageRequest }>(
        CREATE_DAMAGE_REQUEST_MUTATION,
        { input, photos: photos.map(() => null) },
        photos,
        channelToken,
    );
    return data.createDamageRequest;
}

/** PENDING_APPROVAL → APPROVED. Deducts destination stock, issues the document. */
export async function approveDamageRequest(
    id: string,
    channelToken: string,
): Promise<DecidedDamageRequest> {
    const { data } = await vendureFetch<{ approveDamageRequest: DecidedDamageRequest }>(
        APPROVE_DAMAGE_REQUEST_MUTATION,
        { id },
        channelToken,
    );
    return data.approveDamageRequest;
}

/** PENDING_APPROVAL → REJECTED. No stock change. */
export async function rejectDamageRequest(
    id: string,
    channelToken: string,
): Promise<DecidedDamageRequest> {
    const { data } = await vendureFetch<{ rejectDamageRequest: DecidedDamageRequest }>(
        REJECT_DAMAGE_REQUEST_MUTATION,
        { id },
        channelToken,
    );
    return data.rejectDamageRequest;
}

// ─── Error shapes ────────────────────────────────────────────────────

/**
 * True when the server rejected the call because the session is gone or the role
 * does not allow it.
 *
 * Worth telling apart from every other failure: a background poll that hits this
 * should stop and hand the person back to the login screen, while a poll that
 * merely could not reach the server should just try again on the next tick.
 */
export function isAuthError(err: unknown): boolean {
    if (!(err instanceof GraphQLOperationError)) {
        return false;
    }
    return err.errors.some((e) => {
        const code = (e.extensions as { code?: string } | undefined)?.code;
        return code === 'FORBIDDEN' || code === 'UNAUTHORIZED';
    });
}

/**
 * Names that exist ONLY because the Goods Transfer plugin declared them.
 *
 * A server without the plugin has never heard of any of them, and says so by name.
 * Matching on them is what separates "this module is not installed here" from an
 * ordinary mistake in some unrelated query.
 */
const GOODS_TRANSFER_SCHEMA_NAMES =
    /(goodsTransfers?|searchTransferProducts|TransferReportStatus|ReportInput|GoodsTransferLineInput|CreateGoodsTransferInput|UpdateGoodsTransferInput|CreateDamageRequestInput|DamageRequest)/i;

/** How GraphQL words a name it does not know. */
const UNKNOWN_TO_THE_SCHEMA = /GRAPHQL_VALIDATION_FAILED|Unknown type|Cannot query field/i;

/**
 * True when the server has no Goods Transfer plugin installed.
 *
 * Every permission gate in this section closes on its own when the plugin is
 * absent, because the permissions it checks are declared BY that plugin and so
 * cannot be held by anyone. SuperAdmin is the exception — it passes every gate —
 * which means exactly one kind of account can reach these screens on a server that
 * cannot answer them. Recognising that case is what lets the screen say so plainly
 * instead of showing a failure that looks like a bug.
 *
 * BOTH error shapes have to be recognised, and missing one of them is exactly what
 * put a raw 400 and a wall of JSON on a live screen:
 *
 *   - GraphQL rejects an unknown TYPE or field at validation time, before any
 *     resolver runs, and answers HTTP 400. vendureFetch turns any non-2xx into a
 *     GraphQLRequestError carrying the body as text, so it never reaches the
 *     `errors` array. This is the shape a server without the plugin really returns.
 *   - A 200 with a populated `errors` array becomes GraphQLOperationError. Still
 *     handled, because a proxy or gateway in front may normalise the status.
 *
 * Each is checked for a validation complaint AND for a name this module owns, so a
 * bad query somewhere else can never be mistaken for a missing plugin.
 */
export function isPluginMissingError(err: unknown): boolean {
    if (err instanceof GraphQLRequestError) {
        return (
            err.status === 400 &&
            UNKNOWN_TO_THE_SCHEMA.test(err.message) &&
            GOODS_TRANSFER_SCHEMA_NAMES.test(err.message)
        );
    }
    if (err instanceof GraphQLOperationError) {
        return err.errors.some(
            (e) =>
                UNKNOWN_TO_THE_SCHEMA.test(e.message) &&
                GOODS_TRANSFER_SCHEMA_NAMES.test(e.message),
        );
    }
    return false;
}

// ─── Multipart transport ─────────────────────────────────────────────

/**
 * The one request in this module that carries files.
 *
 * GraphQL cannot put a file in a JSON variable, so the multipart spec sends three
 * parts: the operation with `null` where each file belongs, a `map` saying which
 * part fills which null, and then the files themselves. Every GraphQL server that
 * accepts uploads reads exactly this shape.
 *
 * It goes to /api/graphql-upload rather than /api/graphql because the JSON proxy
 * cannot carry it: that route reads the body with `request.text()` and re-sends it
 * as `application/json`. Both halves of that are fatal here — the multipart boundary
 * lives only in the Content-Type header it discards, and decoding raw JPEG bytes as
 * UTF-8 replaces every invalid byte, corrupting the image beyond repair. The upload
 * route streams the body through untouched instead. Leaving the JSON route alone is
 * deliberate: every other screen in this dashboard depends on it.
 *
 * Content-Type is NOT set here — the browser has to write it itself so it can append
 * the multipart boundary. Setting it by hand produces a body the server cannot split.
 */
async function uploadFetch<T>(
    query: string,
    variables: Record<string, unknown>,
    files: File[],
    channelToken: string,
): Promise<T> {
    const form = new FormData();
    form.append('operations', JSON.stringify({ query, variables }));
    form.append(
        'map',
        JSON.stringify(
            Object.fromEntries(files.map((_, i) => [String(i), [`variables.photos.${i}`]])),
        ),
    );
    files.forEach((file, i) => form.append(String(i), file, file.name));

    const headers: Record<string, string> = {};
    if (channelToken) {
        headers['vendure-token'] = channelToken;
    }

    const res = await fetch('/api/graphql-upload', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: form,
    });

    if (!res.ok) {
        let detail = '';
        try {
            detail = await res.text();
        } catch {
            detail = '';
        }
        throw new GraphQLRequestError(
            `Vendure API error: ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`,
            res.status,
            res.statusText,
        );
    }

    const json = (await res.json()) as GraphQLResponse<T>;

    // Same contract as vendureFetch: a populated `errors` array becomes an exception
    // so callers never have to null-check every nested field. The server's wording is
    // passed through untouched — "damage is 8.39% (>= 5%) — at least one photo is
    // mandatory" says more than anything this layer could invent.
    if (json.errors && json.errors.length > 0) {
        throw new GraphQLOperationError(json.errors.map((e) => e.message).join('; '), json.errors);
    }

    return json.data;
}
