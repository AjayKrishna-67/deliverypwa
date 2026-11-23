/**
 * Figures for one printed bill, laid out the way the customer's own invoice
 * (app / website) shows a coupon:
 *
 *  - a coupon gift product is its own line, marked FREE (amount 0);
 *  - a coupon's item-level discount (e.g. % off a product) lowers that line,
 *    with the saving shown under it;
 *  - the subtotal is the sum of those line amounts;
 *  - only the ORDER-level part of the coupon is a separate discount line, and
 *    loyalty points are their own line;
 *  - so Subtotal + Shipping − Coupon − Loyalty = Net Total.
 *
 * All money is in paise; `shadowPrice` (MRP) is in rupees, as the backend sends it.
 */

export interface BillFiguresLine {
    qty: number;
    /** MRP in rupees (product custom field); null when not set. */
    shadowPrice: number | null;
    /** List price per unit, incl. GST (paise). */
    rate: number;
    /** qty × rate (paise). */
    total: number;
    /** Line total after item-level coupon discounts (paise); null on old cached rows. */
    discountedTotal?: number | null;
    /** Coupon gift product; null on old cached rows. */
    isFree?: boolean | null;
}

export interface BillFiguresInput {
    lines: BillFiguresLine[];
    /** Shipping charged, after any free-shipping promo (paise). */
    shipping: number;
    /** Shipping before any free-shipping promo (paise). */
    originalShipping: number;
    netTotal: number;
    /** Raw couponCodes from the backend: a JSON array string, or null. */
    couponCode: string | null;
    discounts: Array<{ description: string; code: string | null; source: string; amount: number }>;
}

export interface BillFiguresLineOut {
    /** What the customer pays for the line (paise). */
    amount: number;
    /** Per-unit price after item-level coupon discounts (paise). */
    unitAmount: number;
    isFree: boolean;
    /** The coupon lowered this line (free or a partial discount). */
    isDiscounted: boolean;
    /** Saving vs MRP (or vs list price when no MRP), paise. */
    saving: number;
}

export interface BillFigures {
    lines: BillFiguresLineOut[];
    subtotal: number;
    shipping: number;
    shippingSavings: number;
    /** Order-level coupon discount only (paise). */
    couponDiscount: number;
    /** Coupon codes + promotion names, de-duplicated, e.g. "SAVE50 Flat 50 off". */
    couponLabel: string;
    loyaltyDiscount: number;
    netTotal: number;
    totalSavings: number;
}

function parseCouponCodes(raw: string | null): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return parsed.map((c) => String(c)).filter(Boolean);
        return parsed ? [String(parsed)] : [];
    } catch {
        return raw.split(',').map((c) => c.trim()).filter(Boolean);
    }
}

export function computeBillFigures(bill: BillFiguresInput): BillFigures {
    const lines = bill.lines.map((l) => {
        const listTotal = Number(l.total) || 0;
        const amount = typeof l.discountedTotal === 'number'
            ? Math.max(0, Math.min(listTotal, l.discountedTotal))
            : listTotal;
        const isFree = l.isFree === true || (listTotal > 0 && amount === 0 && typeof l.discountedTotal === 'number');
        const mrpTotal = l.shadowPrice != null ? l.shadowPrice * 100 * l.qty : listTotal;
        return {
            amount,
            unitAmount: l.qty > 0 ? Math.round(amount / l.qty) : amount,
            isFree,
            isDiscounted: amount < listTotal,
            saving: Math.max(0, mrpTotal - amount),
        };
    });

    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const shipping = Number(bill.shipping) || 0;
    const shippingSavings = Math.max(0, (Number(bill.originalShipping) || 0) - shipping);

    const loyaltyDiscount = bill.discounts
        .filter((d) => d.source.startsWith('SURCHARGE:'))
        .reduce((s, d) => s + Math.abs(d.amount), 0);
    const netTotal = Number(bill.netTotal) || 0;
    // Whatever the lines and loyalty do not explain is the order-level coupon.
    const couponDiscount = Math.max(0, subtotal + shipping - loyaltyDiscount - netTotal);

    const seen = new Map<string, string>();
    const promotionNames = bill.discounts
        .filter((d) => d.source.startsWith('PROMOTION:'))
        .flatMap((d) => [d.code ?? '', d.description]);
    for (const s of [...parseCouponCodes(bill.couponCode), ...promotionNames]) {
        const t = s.trim();
        if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    }
    const couponLabel = seen.size ? Array.from(seen.values()).join(' ') : 'Coupon Discount';

    const totalSavings = lines.reduce((s, l) => s + l.saving, 0) + couponDiscount + loyaltyDiscount + shippingSavings;

    return {
        lines,
        subtotal,
        shipping,
        shippingSavings,
        couponDiscount,
        couponLabel,
        loyaltyDiscount,
        netTotal,
        totalSavings,
    };
}
