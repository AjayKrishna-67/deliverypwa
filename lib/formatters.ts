/**
 * Shared formatting utilities for the delivery dashboard.
 */

export function getStateBadgeClasses(state: string): string {
    switch (state) {
        // ── Yellowish-orange (Vendure style) ──
        case 'PaymentAuthorized':
            return 'bg-[rgba(251,191,36,0.12)] text-[var(--tone-amber)]';   // amber-400
        case 'PaymentSettled':
            return 'bg-[rgba(245,158,11,0.14)] text-[var(--tone-amber-deep)]';   // amber-500 (slightly deeper)

        // ── Blue ──
        case 'Shipped':
            return 'bg-[rgba(59,130,246,0.14)] text-[var(--tone-blue)]';   // blue-400

        // ── Bluish-green (teal) ──
        case 'OutforDelivery':
            return 'bg-[rgba(20,184,166,0.14)] text-[var(--tone-teal)]';   // teal-400

        // ── Green ──
        case 'Delivered':
            return 'bg-[rgba(34,197,94,0.14)] text-[var(--tone-green)]';    // green-400

        // ── Orange ──
        case 'CancellationRequested':
            return 'bg-[rgba(251,146,60,0.12)] text-[var(--tone-orange)]';   // orange-400

        // ── Red ──
        case 'Cancelled':
            return 'bg-[rgba(239,68,68,0.12)] text-[var(--tone-red)]';    // red-400

        default:
            return 'bg-white/[0.06] text-[var(--text-muted)]';
    }
}

export function formatState(state: string, isDeliveryPerson = false): string {
    if (isDeliveryPerson && state === 'Shipped') return 'Assigned';
    return state
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .replace(/^(\w)/, (_, c: string) => c.toUpperCase())
        .replace(/ (\w)/g, (_, c: string) => ' ' + c.toLowerCase());
}

export function formatCurrency(amount: number, currencyCode: string): string {
    const locale = currencyCode === 'INR' ? 'en-IN' : 'en-US';
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
    }).format(amount / 100);
}

/**
 * Returns a human-readable relative time string (e.g. "just now", "5m ago", "2h ago", "3d ago").
 */
export function formatRelativeTime(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    // Fallback to short date
    return new Date(isoString).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
