/**
 * Stock unit helpers for the PWA. PORT of the backend's
 * src/plugins/Stock/shared/stock-units.ts (separate app, can't import across
 * repos — keep the two in sync if units change).
 *
 * Every quantity is stored as an INTEGER in its baseUnit; the display value is
 * base / factor. That is what lets a 1500 g row render "1.5 kg" and a 500 g row
 * render "500 g" off one stored integer — the display unit is chosen at render,
 * never stored.
 */
export interface StockUnit {
    code: string;
    label: string;
    baseUnit: 'g' | 'ml' | 'piece';
    factor: number;
    decimals: number;
    kind: 'measured' | 'counted';
}

export const STOCK_UNITS: Record<string, StockUnit> = {
    g: { code: 'g', label: 'Grams', baseUnit: 'g', factor: 1, decimals: 0, kind: 'measured' },
    kg: { code: 'kg', label: 'Kilograms', baseUnit: 'g', factor: 1000, decimals: 3, kind: 'measured' },
    ml: { code: 'ml', label: 'Millilitres', baseUnit: 'ml', factor: 1, decimals: 0, kind: 'measured' },
    litre: { code: 'litre', label: 'Litres', baseUnit: 'ml', factor: 1000, decimals: 3, kind: 'measured' },
    piece: { code: 'piece', label: 'Pieces', baseUnit: 'piece', factor: 1, decimals: 0, kind: 'counted' },
    packet: { code: 'packet', label: 'Packets', baseUnit: 'piece', factor: 1, decimals: 0, kind: 'counted' },
    dozen: { code: 'dozen', label: 'Dozens', baseUnit: 'piece', factor: 1, decimals: 0, kind: 'counted' },
};

export const DEFAULT_STOCK_UNIT = 'piece';

export function toBase(displayValue: number, unitCode: string): number {
    const unit = STOCK_UNITS[unitCode] ?? STOCK_UNITS[DEFAULT_STOCK_UNIT];
    return Math.round(displayValue * unit.factor);
}

export function fromBase(baseValue: number, unitCode: string): number {
    const unit = STOCK_UNITS[unitCode] ?? STOCK_UNITS[DEFAULT_STOCK_UNIT];
    return +(baseValue / unit.factor).toFixed(unit.decimals);
}

/** Magnitude-based label: g>=1000 -> "x kg", ml mirrors litre, piece stays a count. */
export function formatMeasured(baseValue: number, baseUnit: 'g' | 'ml' | 'piece'): string {
    if (baseUnit === 'piece') {
        return `${baseValue}`;
    }
    const big = baseUnit === 'g' ? 'kg' : 'litre';
    if (Math.abs(baseValue) >= 1000) {
        return `${+(baseValue / 1000).toFixed(3)} ${big}`;
    }
    return `${baseValue} ${baseUnit}`;
}

export function toKg(grams: number): number {
    return +(grams / 1000).toFixed(3);
}

export function toGrams(kg: number): number {
    return Math.round(kg * 1000);
}
