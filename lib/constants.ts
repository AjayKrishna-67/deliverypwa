/**
 * Shared constants for the delivery dashboard.
 */

// ─── Delivered order auto-hide ────────────────────────────────────────
/** Delivered orders disappear from the list after this duration (ms) */
export const DELIVERED_VISIBILITY_MS = 5 * 60 * 1000; // 5 minutes

// ─── Active delivery (map modal) ─────────────────────────────────────
/**
 * localStorage key holding the order id of the delivery currently in
 * progress on the /delivery/[orderId] tracking page. Enforces one-at-a-time
 * and lets login/refresh redirect back to the page. Cleared when the order
 * reaches a terminal state, and on logout.
 */
export const ACTIVE_DELIVERY_KEY = 'active-delivery-order-id';

/** localStorage key for the driver's last GPS fix (see DriverLocationProvider).
 *  Cleared on logout so a shared handset never shows another user's position. */
export const DRIVER_LAST_FIX_KEY = 'driver-last-fix';

// ─── Page size ────────────────────────────────────────────────────────
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

// ─── Column definitions ──────────────────────────────────────────────
export const ALL_COLUMNS = [
    { key: 'invoice', label: 'Invoice' },
    { key: 'code', label: 'Code' },
    { key: 'customer', label: 'Customer' },
    { key: 'state', label: 'State' },
    { key: 'total', label: 'Total' },
    { key: 'updatedAt', label: 'Updated' },
    { key: 'action', label: 'Action' },
] as const;

export type ColKey = (typeof ALL_COLUMNS)[number]['key'];

export const DEFAULT_ORDER: ColKey[] = ALL_COLUMNS.map((c) => c.key);
export const DEFAULT_VISIBLE: Set<ColKey> = new Set(DEFAULT_ORDER);

// ─── State filter chip definitions ───────────────────────────────────

export interface StateChip {
    key: string;
    label: string;
    color: string;
    bg: string;
    border: string;
}

export const ADMIN_STATE_CHIPS: StateChip[] = [
    { key: 'PaymentAuthorized', label: 'Authorized', color: 'var(--tone-amber-deep)', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)' },
    { key: 'PaymentSettled', label: 'Payment Settled', color: 'var(--tone-green-deep)', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.35)' },
    { key: 'Shipped', label: 'Shipped', color: 'var(--tone-sky-soft)', bg: 'rgba(99,179,237,0.12)', border: 'rgba(99,179,237,0.35)' },
    { key: 'OutforDelivery', label: 'Out for Delivery', color: 'var(--tone-teal-deep)', bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.35)' },
    { key: 'Delivered', label: 'Delivered', color: 'var(--tone-violet)', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.35)' },
    { key: 'CancellationRequested', label: 'Cancel Requested', color: 'var(--tone-orange)', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.35)' },
    { key: 'Cancelled', label: 'Cancelled', color: 'var(--error)', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)' },
];

export const DP_STATE_CHIPS: StateChip[] = [
    { key: 'Shipped', label: 'Assigned', color: 'var(--tone-sky-soft)', bg: 'rgba(99,179,237,0.12)', border: 'rgba(99,179,237,0.35)' },
    { key: 'OutforDelivery', label: 'Out for Delivery', color: 'var(--tone-teal-deep)', bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.35)' },
    { key: 'Delivered', label: 'Delivered', color: 'var(--tone-violet)', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.35)' },
];

// ─── Shared inline styles (extracted to avoid per-render recreation) ─

export const SETTLE_BUTTON_STYLE = {
    background: 'rgba(34,197,94,0.15)',
    color: 'var(--tone-green)',
    border: '1px solid rgba(34,197,94,0.3)',
} as const;

export const SETTLE_BUTTON_LOADING_STYLE = {
    background: 'rgba(34,197,94,0.08)',
    color: 'var(--tone-green)',
    border: '1px solid rgba(34,197,94,0.3)',
} as const;

export const FULFILL_BUTTON_STYLE = {
    background: 'rgba(99,102,241,0.15)',
    color: 'var(--tone-indigo-soft)',
    border: '1px solid rgba(99,102,241,0.35)',
} as const;

export const OUT_FOR_DELIVERY_BUTTON_STYLE = {
    background: 'rgba(20,184,166,0.15)',
    color: 'var(--tone-teal)',
    border: '1px solid rgba(20,184,166,0.35)',
} as const;

export const OUT_FOR_DELIVERY_BUTTON_LOADING_STYLE = {
    background: 'rgba(20,184,166,0.08)',
    color: 'var(--tone-teal)',
    border: '1px solid rgba(20,184,166,0.35)',
} as const;

export const DELIVER_BUTTON_STYLE = {
    background: 'rgba(167,139,250,0.15)',
    color: 'var(--tone-violet-soft)',
    border: '1px solid rgba(167,139,250,0.35)',
} as const;

export const DELIVER_BUTTON_LOADING_STYLE = {
    background: 'rgba(167,139,250,0.08)',
    color: 'var(--tone-violet-soft)',
    border: '1px solid rgba(167,139,250,0.35)',
} as const;
