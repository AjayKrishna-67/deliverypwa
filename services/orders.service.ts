/**
 * Orders service — fetches delivery orders and shipping methods.
 * Accepts an optional channelToken; when provided all requests are
 * scoped to that channel via the vendure-token header.
 */

import { vendureFetch } from '@/graphql/client';
import { withCache } from '@/lib/clientCache';
import {
    DELIVERY_ORDERS_QUERY,
    DELIVERY_ORDER_POSTAL_CODES_QUERY,
    POSTAL_CODE_AREAS_QUERY,
    ORDERS_BY_STATE_QUERY,
    SHIPPING_METHODS_QUERY,
    ORDER_FULL_DETAIL_QUERY,
    ORDER_DETAIL_QUERY,
    ORDER_FULFILLMENT_DETAIL_QUERY,
    SETTLE_PAYMENT_MUTATION,
    GET_DELIVERY_PERSONS_QUERY,
    CREATE_DELIVERY_FULFILLMENT_MUTATION,
    TRANSIT_TO_OUT_FOR_DELIVERY_MUTATION,
    TRANSIT_TO_DELIVERED_MUTATION,
    GENERATE_DELIVERY_QR_CODE_MUTATION,
    CHECK_DELIVERY_QR_STATUS_MUTATION,
    CLOSE_DELIVERY_QR_CODE_MUTATION,
    CREATE_PAYMENT_LINK_MUTATION,
    CHECK_PAYMENT_LINK_STATUS_MUTATION,
    CANCEL_PAYMENT_LINK_MUTATION,
} from '@/graphql/operations/orders';
import { MY_DELIVERY_ORDERS_QUERY } from '@/graphql/operations/fulfillment';

// ─── Types ───────────────────────────────────────────────────────────

export interface DeliveryOrder {
    id: string;
    code: string;
    state: string;
    totalWithTax: number;
    currencyCode: string;
    updatedAt: string;
    customFields?: {
        invoiceNo?: number | null;
    } | null;
    shippingAddress?: {
        postalCode?: string | null;
        fullName?: string | null;
        streetLine1?: string | null;
        streetLine2?: string | null;
        city?: string | null;
        province?: string | null;
        countryCode?: string | null;
        phoneNumber?: string | null;
        /** Address custom fields — lat/lng power the delivery map + distance display */
        customFields?: {
            area?: string | null;
            latitude?: number | null;
            longitude?: number | null;
        } | null;
    } | null;
    shippingLines: Array<{
        shippingMethod: {
            id: string;
            name: string;
        };
    }>;
    customer?: {
        firstName: string;
        lastName: string;
    } | null;
    lines?: Array<{
        id: string;
        quantity: number;
        linePriceWithTax?: number;
        productVariant?: {
            id: string;
            name: string;
            sku: string;
            stockOnHand?: number;
            featuredAsset?: { preview: string } | null;
        } | null;
        fulfillmentLines?: Array<{
            fulfillment: { id: string; state: string };
            quantity: number;
        }> | null;
    }> | null;
    fulfillments?: Array<{
        id: string;
        state: string;
    }> | null;
    /** Payment handler code: 'razorpay-payment' (online) or 'offline' (COD) */
    paymentMethod?: string;
}

export interface DeliveryPerson {
    id: string;
    firstName: string;
    lastName: string;
    emailAddress?: string | null;
    phoneNumber?: string | null;
}

export interface DeliveryOrderListResult {
    totalItems: number;
    items: DeliveryOrder[];
}

export interface ShippingMethodItem {
    id: string;
    name: string;
    code: string;
}

export interface DeliveryOrderListOptions {
    shippingMethodId?: string;
    postalCode?: string;
    area?: string;
    search?: string;        // filter by order code or customer last name
    activeStates?: string[]; // filter by specific states; empty = all delivery states
    skip?: number;
    take?: number;
    /** Only return orders updated on/after this ISO date string */
    updatedAfter?: string;
    /** Vendure channel token — scopes the query to just this channel */
    channelToken?: string;
    /** Server-side filter parameter (DeliveryOrderFilterParameter) */
    filter?: Record<string, unknown>;
    /** Server-side sort parameter (DeliveryOrderSortParameter) */
    sort?: Record<string, string>;
}

/** Default states loaded on page open — only states that need active action.
 *  Delivered is intentionally excluded: a busy channel accumulates tens of
 *  thousands of Delivered orders and there's no server-side date cap, so
 *  including it inflates totalItems and slows every fetch. Users who want
 *  to see Delivered (or Cancelled / CancellationRequested) orders can add
 *  a state filter via the FilterPanel — those queries will then run with
 *  whatever date / search filters the user picks.
 */
const DELIVERY_STATES = [
    'PaymentAuthorized', 'PaymentSettled',
    'Shipped', 'PartiallyShipped', 'OutforDelivery',
];

/** States returned by `deliveryOrders` (pre-fulfillment) */
const PRE_FULFILLMENT_STATES = ['PaymentAuthorized', 'PaymentSettled'];

/** States returned by standard `orders` query (post-fulfillment).
 *  This list defines which states ROUTE through the standard `orders` query
 *  (vs. the custom `deliveryOrders` query). It is NOT the default-fetched set.
 *  Delivered/Cancelled/CancellationRequested are routed here so that the
 *  FilterPanel can request them on demand.
 */
const POST_FULFILLMENT_STATES = [
    'Shipped', 'PartiallyShipped', 'OutforDelivery',
    'Delivered', 'Cancelled', 'CancellationRequested',
];

/**
 * Fetch delivery orders by combining two data sources:
 *   1. `deliveryOrders` — custom query returning PaymentAuthorized & PaymentSettled
 *   2. `orders`         — standard Vendure query for Shipped, OutForDelivery, Delivered
 *
 * Both are fetched in parallel when needed, then merged, filtered, sorted, and paginated.
 */
export async function fetchDeliveryOrders(
    options?: DeliveryOrderListOptions,
): Promise<DeliveryOrderListResult> {
    const {
        channelToken,
        shippingMethodId,
        postalCode,
        area,
        search,
        activeStates,
        skip = 0,
        take = 10,
        updatedAfter,
        filter,
        sort,
    } = options ?? {};

    const statesToUse = (activeStates && activeStates.length > 0)
        ? activeStates
        : DELIVERY_STATES;

    const needPre = statesToUse.some((s) => PRE_FULFILLMENT_STATES.includes(s));
    const needPost = statesToUse.some((s) => POST_FULFILLMENT_STATES.includes(s));

    // ── Server-side pagination ─────────────────────────────────────────
    //
    // We fetch from two sources (deliveryOrders + orders) and merge. To
    // avoid loading 500+ records from each source, we pass the real take/skip
    // to each query and sum their totalItems for the grand total.
    //
    // Trade-off: when both sources are active, we fetch `take` from each and
    // merge/sort/slice to `take` items. This means we fetch up to 2x `take`
    // records total (e.g. 20 instead of 500+500). The server does the heavy
    // lifting (filtering, sorting, pagination), not the browser.
    //
    // For search, we still need a larger fetch because Vendure's standard
    // orders query doesn't support code/name search natively — the custom
    // deliveryOrders query may support it but the standard one doesn't.
    // When searching, we fetch more (up to 100) and filter client-side.

    const isSearching = !!(search && search.trim());
    const serverTake = isSearching ? 100 : take;
    const serverSkip = isSearching ? 0 : skip;
    const serverSort = sort && Object.keys(sort).length > 0 ? sort : { updatedAt: 'DESC' };

    const promises: Promise<{ items: DeliveryOrder[]; totalItems: number }>[] = [];

    if (needPre) {
        const queryOpts: Record<string, unknown> = {
            skip: serverSkip,
            take: serverTake,
        };
        if (shippingMethodId) queryOpts.shippingMethodId = shippingMethodId;
        if (postalCode) queryOpts.postalCode = postalCode;
        if (area) queryOpts.area = area;
        if (filter && Object.keys(filter).length > 0) queryOpts.filter = filter;
        if (Object.keys(serverSort).length > 0) queryOpts.sort = serverSort;

        promises.push(
            vendureFetch<{ deliveryOrders: DeliveryOrderListResult }>(
                DELIVERY_ORDERS_QUERY,
                { options: queryOpts },
                channelToken,
            ).then(({ data }) => {
                if (!data?.deliveryOrders) throw new Error('ACCESS_DENIED');
                return {
                    totalItems: data.deliveryOrders.totalItems,
                    items: data.deliveryOrders.items.map((o: DeliveryOrder & { payments?: Array<{ method: string }> }) => ({
                        ...o,
                        paymentMethod: o.payments?.[0]?.method,
                    })),
                };
            }),
        );
    }

    if (needPost) {
        const postStates = statesToUse.filter((s) => POST_FULFILLMENT_STATES.includes(s));
        const postFilter: Record<string, unknown> = { state: { in: postStates }, ...filter };
        const orderOpts: Record<string, unknown> = {
            filter: postFilter,
            sort: serverSort,
            skip: serverSkip,
            take: serverTake,
        };

        promises.push(
            vendureFetch<{ orders: DeliveryOrderListResult }>(
                ORDERS_BY_STATE_QUERY,
                { options: orderOpts },
                channelToken,
            ).then(({ data }) => ({
                totalItems: data?.orders?.totalItems ?? 0,
                items: (data?.orders?.items ?? []).map((o: DeliveryOrder & { payments?: Array<{ method: string }> }) => ({
                    ...o,
                    paymentMethod: o.payments?.[0]?.method,
                })),
            })),
        );
    }

    // Use allSettled (not all) so one forbidden/failing source doesn't sink the
    // other. An admin may lack permission for the custom `deliveryOrders` query
    // while still being allowed the standard `orders` query (or vice versa) —
    // with Promise.all, one ForbiddenError rejected the whole fetch and the page
    // showed a hard error even though valid orders were available. We keep every
    // source that succeeded; only when ALL fail do we rethrow so the caller's
    // admin→DP fallback (and, ultimately, the error screen) still runs.
    const settled = await Promise.allSettled(promises);
    const results = settled
        .filter((s): s is PromiseFulfilledResult<{ items: DeliveryOrder[]; totalItems: number }> => s.status === 'fulfilled')
        .map((s) => s.value);

    if (results.length === 0) {
        const firstRejection = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
        throw firstRejection?.reason ?? new Error('Failed to load orders');
    }

    let items = results.flatMap(r => r.items);
    const serverTotal = results.reduce((sum, r) => sum + r.totalItems, 0);

    // ── Client-side post-processing ─────────────────────────────────
    //
    // Note: there used to be an auto-hide filter that trimmed Delivered
    // orders older than 5 minutes. That's no longer needed for the default
    // fetch (Delivered is now excluded from DELIVERY_STATES at the source).
    // When the user explicitly filters by Delivered they want to see ALL
    // matches, so client-side trimming would be wrong there too.

    // Search by order code or customer name (client-side for search mode)
    if (isSearching) {
        const q = search!.trim().toLowerCase();
        items = items.filter((o) => {
            const code = o.code?.toLowerCase() ?? '';
            const name = o.customer
                ? `${o.customer.firstName} ${o.customer.lastName}`.toLowerCase()
                : '';
            return code.includes(q) || name.includes(q);
        });
    }

    // Date range
    if (updatedAfter) {
        const cutoff = new Date(updatedAfter).getTime();
        items = items.filter((o) => new Date(o.updatedAt).getTime() >= cutoff);
    }

    // Sort merged results by most recently updated
    items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // For search mode, we fetched extra and filter client-side — paginate here
    if (isSearching) {
        const totalItems = items.length;
        items = items.slice(skip, skip + take);
        return { totalItems, items };
    }

    // For normal mode, server already paginated — use server's totalItems
    return { totalItems: serverTotal, items: items.slice(0, take) };
}


export async function fetchShippingMethods(channelToken?: string): Promise<ShippingMethodItem[]> {
    return withCache('shipping-methods', channelToken, async () => {
        const { data } = await vendureFetch<{
            shippingMethods: { items: ShippingMethodItem[] };
        }>(SHIPPING_METHODS_QUERY, undefined, channelToken);
        return data.shippingMethods.items;
    });
}

/**
 * Fetch unique postal codes across all delivery-relevant order states.
 * Uses the custom deliveryOrders query with optional server-side shippingMethodId filter.
 */
export async function fetchOrderPostalCodes(
    shippingMethodId?: string,
    channelToken?: string,
): Promise<string[]> {
    // Cache key includes shippingMethodId so per-method postal lists stay isolated.
    return withCache(
        'postal-codes',
        channelToken,
        async () => {
            const queryOpts: Record<string, unknown> = { take: 500 };
            if (shippingMethodId) {
                queryOpts.shippingMethodId = shippingMethodId;
            }
            const { data } = await vendureFetch<{
                deliveryOrders: { items: Array<{ shippingAddress?: { postalCode?: string | null } | null }> };
            }>(
                DELIVERY_ORDER_POSTAL_CODES_QUERY,
                { options: queryOpts },
                channelToken,
            );
            const codes = data.deliveryOrders.items
                .map((o) => o.shippingAddress?.postalCode ?? '')
                .filter(Boolean);
            return [...new Set(codes)].sort();
        },
        undefined,
        shippingMethodId ?? 'all',
    );
}

/**
 * Fetch all postal code areas for the current channel.
 * Returns area names with their parent postal code.
 */
export interface PostalCodeAreaItem {
    id: string;
    name: string;
    postalCode?: { id: string; code: string } | null;
}

export async function fetchOrderAreas(
    channelToken?: string,
): Promise<PostalCodeAreaItem[]> {
    return withCache('postal-code-areas', channelToken, async () => {
        const { data } = await vendureFetch<{
            postalCodeAreas: PostalCodeAreaItem[];
        }>(POSTAL_CODE_AREAS_QUERY, {}, channelToken);
        return data.postalCodeAreas ?? [];
    });
}

/**
 * Settle the payment for an order in "PaymentAuthorized" state.
 * 1) Query the order to get its payment ID(s)
 * 2) Call settlePayment mutation on the authorized payment
 *
 * vendureFetch now throws GraphQLOperationError on top-level GraphQL errors,
 * so we don't have to null-check the data shape for that case. We still
 * defensively guard against the union returning an unexpected payload.
 */
export async function settleOrderPayment(
    orderId: string,
    channelToken?: string,
): Promise<void> {
    // Step 1: fetch order payments
    const { data: orderData } = await vendureFetch<{
        order: { id: string; state: string; payments: Array<{ id: string; state: string }> } | null;
    }>(ORDER_DETAIL_QUERY, { id: orderId }, channelToken);

    if (!orderData.order) {
        throw new Error(`Order ${orderId} not found.`);
    }

    const payment = orderData.order.payments.find((p) => p.state === 'Authorized');
    if (!payment) {
        throw new Error('No authorized payment found for this order.');
    }

    // Step 2: settle the payment
    const { data: settleData } = await vendureFetch<{
        settlePayment: { __typename: string; errorCode?: string; message?: string } | null;
    }>(SETTLE_PAYMENT_MUTATION, { id: payment.id }, channelToken);

    const result = settleData.settlePayment;
    if (!result) {
        throw new Error('Settlement failed: server returned no result.');
    }
    if (result.__typename !== 'Payment') {
        throw new Error(
            result.message ?? `Settlement failed: ${result.errorCode ?? result.__typename}`,
        );
    }
}

/** Fetch all delivery persons for the fulfillment dropdown */
export async function fetchDeliveryPersons(channelToken?: string): Promise<DeliveryPerson[]> {
    return withCache('delivery-persons', channelToken, async () => {
        const { data } = await vendureFetch<{ deliveryPersons: DeliveryPerson[] }>(
            GET_DELIVERY_PERSONS_QUERY,
            undefined,
            channelToken,
        );
        return data.deliveryPersons;
    });
}

// ─── Full Order Detail ──────────────────────────────────────────────

export interface OrderFullDetail {
    id: string;
    code: string;
    state: string;
    active: boolean;
    totalWithTax: number;
    subTotalWithTax: number;
    shippingWithTax: number;
    currencyCode: string;
    createdAt: string;
    updatedAt: string;
    orderPlacedAt?: string | null;
    totalQuantity: number;
    couponCodes: string[];
    customFields?: {
        invoiceNo?: number | null;
        cancellationReason?: string | null;
        otherInstructions?: string | null;
        platform?: string | null;
        deviceMedium?: string | null;
        loyaltyPointsEarned?: number | null;
        loyaltyPointsUsed?: number | null;
    } | null;
    customer?: {
        id: string;
        firstName: string;
        lastName: string;
        phoneNumber?: string | null;
        emailAddress?: string | null;
    } | null;
    shippingAddress?: {
        fullName?: string | null;
        company?: string | null;
        streetLine1?: string | null;
        streetLine2?: string | null;
        city?: string | null;
        province?: string | null;
        postalCode?: string | null;
        countryCode?: string | null;
        phoneNumber?: string | null;
        customFields?: {
            latitude?: number | null;
            longitude?: number | null;
        } | null;
    } | null;
    billingAddress?: {
        fullName?: string | null;
        streetLine1?: string | null;
        city?: string | null;
        province?: string | null;
        postalCode?: string | null;
        countryCode?: string | null;
    } | null;
    lines: Array<{
        id: string;
        quantity: number;
        linePriceWithTax: number;
        unitPriceWithTax: number;
        productVariant: {
            id: string;
            name: string;
            sku: string;
        };
        featuredAsset?: { preview: string } | null;
        fulfillmentLines?: Array<{
            fulfillment: { id: string; state: string };
            quantity: number;
        }> | null;
    }>;
    payments: Array<{
        id: string;
        method: string;
        amount: number;
        state: string;
        transactionId?: string | null;
        createdAt: string;
        errorMessage?: string | null;
    }>;
    fulfillments: Array<{
        id: string;
        state: string;
        method: string;
        trackingCode?: string | null;
        createdAt: string;
        updatedAt: string;
        lines?: Array<{
            orderLineId: string;
            quantity: number;
        }> | null;
    }>;
    shippingLines: Array<{
        shippingMethod: {
            id: string;
            name: string;
            code: string;
        };
        priceWithTax: number;
    }>;
    surcharges: Array<{
        id: string;
        description: string;
        sku?: string | null;
        priceWithTax: number;
    }>;
    taxSummary: Array<{
        description: string;
        taxRate: number;
        taxBase: number;
        taxTotal: number;
    }>;
    history: {
        items: Array<{
            id: string;
            type: string;
            createdAt: string;
            isPublic: boolean;
            data: Record<string, unknown>;
            administrator?: {
                firstName: string;
                lastName: string;
            } | null;
        }>;
    };
}

/** Fetch complete order details for the order detail page */
export async function fetchOrderFullDetail(
    orderId: string,
    channelToken?: string,
): Promise<OrderFullDetail> {
    const { data, errors } = await vendureFetch<{
        order: OrderFullDetail;
    }>(ORDER_FULL_DETAIL_QUERY, { id: orderId }, channelToken);

    if (errors?.length) {
        throw new Error(errors[0].message ?? 'Failed to fetch order details');
    }
    if (!data.order) {
        throw new Error('Order not found');
    }
    return data.order;
}

export interface OrderFulfillmentLine {
    id: string;
    quantity: number;
    productVariant?: {
        name: string;
        sku: string;
        stockOnHand: number;
    };
    featuredAsset?: {
        preview: string;
    } | null;
    fulfillmentLines: Array<{
        fulfillment: { id: string; state: string };
        quantity: number;
    }>;
}

export interface OrderFulfillmentDetail {
    fulfillments: Array<{ id: string; state: string }>;
    lines: OrderFulfillmentLine[];
}

/**
 * Fetch fulfillment + line details for a single order on-demand.
 * Used when the user clicks Fulfill / Out for Delivery / Delivered buttons.
 */
export async function fetchOrderFulfillmentDetail(
    orderId: string,
    channelToken?: string,
): Promise<OrderFulfillmentDetail> {
    const { data } = await vendureFetch<{
        order: { id: string; fulfillments: OrderFulfillmentDetail['fulfillments']; lines: OrderFulfillmentDetail['lines'] };
    }>(ORDER_FULFILLMENT_DETAIL_QUERY, { id: orderId }, channelToken);
    return { fulfillments: data.order.fulfillments, lines: data.order.lines };
}

/**
 * Create a delivery fulfillment for an order.
 * Uses the role-based `createDeliveryFulfillment` mutation which handles
 * handler config and order state transition internally.
 */
export async function createFulfillmentWithDeliveryPerson(
    orderLines: Array<{ id: string; quantity: number }>,
    deliveryPersonId: string,
    channelToken?: string,
): Promise<void> {
    const input = {
        lines: orderLines.map((l) => ({ orderLineId: l.id, quantity: l.quantity })),
        deliveryPersonId: String(deliveryPersonId),
    };

    const { data, errors } = await vendureFetch<{
        createDeliveryFulfillment: { id: string; state: string; method: string; trackingCode: string; createdAt: string } | null;
    }>(CREATE_DELIVERY_FULFILLMENT_MUTATION, { input }, channelToken);

    if (errors?.length) {
        throw new Error(errors[0].message ?? 'Fulfillment failed');
    }
    if (!data.createDeliveryFulfillment) {
        throw new Error('Fulfillment failed: no result returned');
    }
}

/**
 * Transition a fulfillment to OutForDelivery.
 * Uses the role-based `transitToOutForDelivery` mutation which handles
 * both fulfillment and order state transitions internally.
 */
export async function transitToOutForDelivery(
    fulfillmentId: string,
    channelToken?: string,
): Promise<void> {
    const { data, errors } = await vendureFetch<{
        transitToOutForDelivery: { id: string; state: string } | null;
    }>(TRANSIT_TO_OUT_FOR_DELIVERY_MUTATION, { fulfillmentId }, channelToken);

    if (errors?.length) {
        throw new Error(errors[0].message ?? 'Transition to OutforDelivery failed');
    }
    if (!data.transitToOutForDelivery) {
        throw new Error('Transition to OutforDelivery failed: no result returned');
    }
}

/**
 * Find the order's active fulfillment and transition it to OutforDelivery.
 * Shared by the delivery tracking page (map flow) and the legacy no-map
 * path in useOrderActions. Throws on failure.
 */
export async function startOrderOutForDelivery(
    order: Pick<DeliveryOrder, 'id' | 'fulfillments'>,
    channelToken?: string,
): Promise<void> {
    // Prefer the fulfillment already known to be Shipped — skip Cancelled ones
    let fulfillmentId = order.fulfillments?.find((f) => f.state === 'Shipped')?.id;
    if (!fulfillmentId) {
        // Fall back to a server fetch for fresh fulfillment data
        const detail = await fetchOrderFulfillmentDetail(order.id, channelToken);
        fulfillmentId = detail.fulfillments?.find((f) => f.state === 'Shipped')?.id
            ?? detail.fulfillments?.find((f) => f.state !== 'Cancelled')?.id;
    }
    if (!fulfillmentId) throw new Error('No active fulfillment found for this order');
    await transitToOutForDelivery(fulfillmentId, channelToken);
}

/**
 * Map a full order detail onto the DeliveryOrder shape consumed by the
 * delivery flow components (map view, payment sheet). Used by the
 * /delivery/[orderId] tracking page, which fetches by id.
 */
export function toDeliveryOrder(o: OrderFullDetail): DeliveryOrder {
    return {
        id: o.id,
        code: o.code,
        state: o.state,
        totalWithTax: o.totalWithTax,
        currencyCode: o.currencyCode,
        updatedAt: o.updatedAt,
        customFields: o.customFields ? { invoiceNo: o.customFields.invoiceNo } : null,
        shippingAddress: o.shippingAddress ?? null,
        shippingLines: [],
        customer: o.customer
            ? { firstName: o.customer.firstName, lastName: o.customer.lastName }
            : null,
        fulfillments: o.fulfillments?.map((f) => ({ id: f.id, state: f.state })) ?? null,
        paymentMethod: o.payments?.[0]?.method,
    };
}

/**
 * Transition a fulfillment to Delivered.
 * Accepts optional paymentCollection for COD orders (Cash/QR/Split).
 */
export async function transitToDelivered(
    fulfillmentId: string,
    channelToken?: string,
    paymentCollection?: {
        paymentCollectionMethod: string;
        collectedAmount: number;
        collectionNote?: string;
    },
): Promise<void> {
    const variables: Record<string, unknown> = { fulfillmentId };
    if (paymentCollection) {
        variables.paymentCollection = paymentCollection;
    }

    const { data, errors } = await vendureFetch<{
        transitToDelivered: { id: string; state: string } | null;
    }>(TRANSIT_TO_DELIVERED_MUTATION, variables, channelToken);

    if (errors?.length) {
        throw new Error(errors[0].message ?? 'Transition to Delivered failed');
    }
    if (!data.transitToDelivered) {
        throw new Error('Transition to Delivered failed: no result returned');
    }
}

// ─── QR Code APIs ───────────────────────────────────────────────────

export interface DeliveryQrCodeResult {
    qrCodeId: string;
    imageUrl: string;
    /** QR amount in paise */
    amount: number;
    /** Cash portion in paise (0 if pure QR) */
    cashAmount: number;
    /** 'active' | 'paid' | 'closed' */
    status: string;
    closesAt?: string | null;
}

/** Generate a Razorpay QR code for COD payment collection */
export async function generateDeliveryQrCode(
    fulfillmentId: string,
    cashAmount?: number,
    channelToken?: string,
): Promise<DeliveryQrCodeResult> {
    const input: Record<string, unknown> = { fulfillmentId };
    if (cashAmount != null && cashAmount > 0) {
        input.cashAmount = cashAmount;
    }

    const { data, errors } = await vendureFetch<{
        generateDeliveryQrCode: DeliveryQrCodeResult;
    }>(GENERATE_DELIVERY_QR_CODE_MUTATION, { input }, channelToken);

    if (errors?.length) {
        throw new Error(errors[0].message ?? 'Failed to generate QR code');
    }
    return data.generateDeliveryQrCode;
}

/** Poll QR payment status */
export async function checkDeliveryQrStatus(
    fulfillmentId: string,
    channelToken?: string,
): Promise<DeliveryQrCodeResult> {
    const { data, errors } = await vendureFetch<{
        checkDeliveryQrStatus: DeliveryQrCodeResult;
    }>(CHECK_DELIVERY_QR_STATUS_MUTATION, { fulfillmentId }, channelToken);

    if (errors?.length) {
        throw new Error(errors[0].message ?? 'Failed to check QR status');
    }
    return data.checkDeliveryQrStatus;
}

/** Cancel/close an active QR code */
export async function closeDeliveryQrCode(
    fulfillmentId: string,
    channelToken?: string,
): Promise<{ qrCodeId: string; status: string }> {
    const { data, errors } = await vendureFetch<{
        closeDeliveryQrCode: { qrCodeId: string; status: string };
    }>(CLOSE_DELIVERY_QR_CODE_MUTATION, { fulfillmentId }, channelToken);

    if (errors?.length) {
        throw new Error(errors[0].message ?? 'Failed to close QR code');
    }
    return data.closeDeliveryQrCode;
}

// ─── Payment Link APIs ─────────────────────────────────────────────

export interface PaymentLinkResult {
    paymentLinkId: string;
    shortUrl: string;
    /** Amount in paise */
    amount: number;
    /** 'created' | 'paid' | 'cancelled' | 'expired' */
    status: string;
    customerPhone: string;
}

/** Create a Razorpay Payment Link and send via SMS to the given phone number */
export async function createPaymentLink(
    fulfillmentId: string,
    customerPhone: string,
    channelToken?: string,
): Promise<PaymentLinkResult> {
    const { data, errors } = await vendureFetch<{
        createDeliveryPaymentLink: PaymentLinkResult;
    }>(CREATE_PAYMENT_LINK_MUTATION, { input: { fulfillmentId, customerPhone } }, channelToken);

    if (errors?.length) {
        throw new Error(errors[0].message ?? 'Failed to create payment link');
    }
    return data.createDeliveryPaymentLink;
}

/** Poll Payment Link status */
export async function checkPaymentLinkStatus(
    fulfillmentId: string,
    channelToken?: string,
): Promise<PaymentLinkResult> {
    const { data, errors } = await vendureFetch<{
        checkDeliveryPaymentLinkStatus: PaymentLinkResult;
    }>(CHECK_PAYMENT_LINK_STATUS_MUTATION, { fulfillmentId }, channelToken);

    if (errors?.length) {
        throw new Error(errors[0].message ?? 'Failed to check payment link status');
    }
    return data.checkDeliveryPaymentLinkStatus;
}

/** Cancel an active Payment Link */
export async function cancelPaymentLink(
    fulfillmentId: string,
    channelToken?: string,
): Promise<{ paymentLinkId: string; status: string }> {
    const { data, errors } = await vendureFetch<{
        cancelDeliveryPaymentLink: { paymentLinkId: string; status: string };
    }>(CANCEL_PAYMENT_LINK_MUTATION, { fulfillmentId }, channelToken);

    if (errors?.length) {
        throw new Error(errors[0].message ?? 'Failed to cancel payment link');
    }
    return data.cancelDeliveryPaymentLink;
}

// ─── Delivery Person (DP) APIs ──────────────────────────────────────

/** Raw order shape returned by the myDeliveryOrders query. */
interface MyDeliveryOrderItem {
    id: string;
    code: string;
    state: string;
    totalWithTax: number;
    currencyCode: string;
    updatedAt: string;
    customFields?: { invoiceNo?: number | null } | null;
    shippingAddress?: DeliveryOrder['shippingAddress'];
    customer?: { firstName: string; lastName: string; phoneNumber?: string | null } | null;
    payments?: Array<{ id: string; method: string; state: string }> | null;
    fulfillments?: Array<{ id: string; state: string }> | null;
}

/**
 * Fetch the orders assigned to the logged-in delivery person via the
 * order-centric `myDeliveryOrders` query. Server-scoped to this DP, so no
 * client-side grouping — a straight map from Order to the DeliveryOrder shape
 * the OrderCard/OrderRow already render.
 *
 * `state` is taken from the active (non-cancelled) fulfillment, not order.state:
 * the DP card/buttons key off delivery progress (Shipped → OutforDelivery →
 * Delivered), and this matches the behaviour of the old fulfillment-based path.
 */
export async function fetchMyDeliveryOrders(
    channelToken?: string,
    opts?: { skip?: number; take?: number; deliveredSince?: string; search?: string },
): Promise<DeliveryOrderListResult> {
    const { data } = await vendureFetch<{
        myDeliveryOrders: { totalItems: number; items: MyDeliveryOrderItem[] };
    }>(
        // Server owns sort (updatedAt DESC default), the delivered-window, paging and
        // count. Client passes only skip/take/deliveredSince/search — no 200-cap, no
        // client sort/cutoff/slice. deliveredSince keeps long-delivered orders out of
        // SQL entirely, so page 1 is the actionable Shipped/OutforDelivery set.
        MY_DELIVERY_ORDERS_QUERY,
        {
            options: {
                skip: opts?.skip,
                take: opts?.take,
                deliveredSince: opts?.deliveredSince,
                search: opts?.search,
            },
        },
        channelToken,
    );
    const items: DeliveryOrder[] = data.myDeliveryOrders.items.map((o) => {
        const activeFulfillment = o.fulfillments?.find((f) => f.state !== 'Cancelled');
        return {
            id: o.id,
            code: o.code,
            state: activeFulfillment?.state ?? o.state,
            totalWithTax: o.totalWithTax,
            currencyCode: o.currencyCode,
            updatedAt: o.updatedAt,
            customFields: o.customFields ?? null,
            shippingAddress: o.shippingAddress ?? null,
            shippingLines: [],
            customer: o.customer
                ? { firstName: o.customer.firstName, lastName: o.customer.lastName }
                : null,
            fulfillments: o.fulfillments ?? null,
            paymentMethod: o.payments?.[0]?.method,
        };
    });
    return { totalItems: data.myDeliveryOrders.totalItems, items };
}
