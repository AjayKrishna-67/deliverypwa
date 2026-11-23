/**
 * Display helpers shared by the Goods Transfer screens.
 *
 * The badge colours follow the same convention as lib/formatters.ts — a tinted
 * background with a matching foreground, written as Tailwind arbitrary values —
 * so a transfer state and an order state look like they belong to one dashboard.
 * They are kept apart from that file because the two sets of states are unrelated:
 * one describes an order's journey to a customer, the other stock moving between
 * branches, and a shared function would have to know about both.
 */

import { STOCK_UNITS, formatMeasured } from '@/lib/stock-units';
import type { DamageState, TransferState } from '@/types/goods-transfer';

export function transferStateClasses(state: TransferState | string): string {
    switch (state) {
        case 'REQUEST_DRAFT':
            return 'bg-white/[0.06] text-[var(--text-muted)]';
        case 'REQUESTED':
            return 'bg-[rgba(168,85,247,0.14)] text-[var(--tone-purple)]';
        case 'DRAFT':
            return 'bg-white/[0.06] text-[var(--text-muted)]';
        case 'CONFIRMED':
            return 'bg-[rgba(59,130,246,0.14)] text-[var(--tone-blue)]';
        case 'DISPATCHED':
            return 'bg-[rgba(245,158,11,0.14)] text-[var(--tone-amber-deep)]';
        case 'RECEIVED':
            return 'bg-[rgba(34,197,94,0.14)] text-[var(--tone-green)]';
        default:
            return 'bg-white/[0.06] text-[var(--text-muted)]';
    }
}

export function damageStateClasses(state: DamageState | string): string {
    switch (state) {
        case 'PENDING_APPROVAL':
            return 'bg-[rgba(245,158,11,0.14)] text-[var(--tone-amber-deep)]';
        case 'APPROVED':
            return 'bg-[rgba(34,197,94,0.14)] text-[var(--tone-green)]';
        case 'REJECTED':
            return 'bg-[rgba(239,68,68,0.12)] text-[var(--tone-red)]';
        default:
            return 'bg-white/[0.06] text-[var(--text-muted)]';
    }
}

/**
 * The little tags on a transfer line.
 *
 * The tag is the UNIT, not the storage model. "Pool" is how the code thinks about a
 * product whose stock is held once at product level; the person entering a load only
 * needs to know what to count out — kilograms, litres or pieces.
 *
 * A pooled product is NOT automatically a weighed one, which is what this file used
 * to assume: every pool was labelled KG, so Amla and Lemon — pooled, and counted in
 * pieces — asked for a weight nobody was ever going to put on a scale.
 *
 * Shared because the picker, the entry table and the edit table all show them, and
 * three sets that drift apart would make the same product look like two things.
 */
const TAG_BASE = 'rounded px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide';

export const TAG_POOL = `${TAG_BASE} bg-[rgba(20,184,166,0.15)] text-[var(--tone-teal)]`;
export const TAG_PCS = `${TAG_BASE} bg-[rgba(99,102,241,0.15)] text-[var(--tone-indigo-soft)]`;
export const TAG_OFF = `${TAG_BASE} bg-[rgba(239,68,68,0.12)] text-[var(--tone-red)]`;
export const TAG_NEW = `${TAG_BASE} bg-[rgba(34,197,94,0.15)] text-[var(--tone-green)]`;

// ─── Input rules ─────────────────────────────────────────────────────
//
// Shared because a transfer's driver and vehicle are entered on two screens — when
// it is created and when it is edited — and a rule enforced on one of them is not a
// rule.

/** An Indian mobile number. Ten digits, no country code — the driver is local. */
export const PHONE_DIGITS = 10;

/**
 * Digits only, and never more than ten.
 *
 * Applied to the VALUE rather than checked on submit: a field that quietly refuses
 * the letter you typed teaches the rule in the moment, where an error message after
 * the fact only reports it.
 */
export const cleanPhone = (value: string): string =>
    value.replace(/\D/g, '').slice(0, PHONE_DIGITS);

/**
 * A registration plate has one written form, and it is upper case.
 *
 * Upper-casing the value, not just its display: a CSS transform would show
 * TN59AB1234 and send tn59ab1234, and the document prints what was sent.
 */
export const cleanVehicle = (value: string): string => value.toUpperCase();

/** True for an empty box or a complete number — never for a half-typed one. */
export const isPhoneComplete = (value: string): boolean =>
    value.length === 0 || value.length === PHONE_DIGITS;

/**
 * Colours for a native <select>'s options.
 *
 * The list a select drops down is painted by the operating system, not by the page,
 * so it ignores everything set on the select itself — on Windows that means black
 * text on white inside an otherwise dark app. Setting the colours on each <option>
 * is the one part of that list a page is allowed to touch.
 *
 * The control stays native on purpose. This is built for phones, and a native select
 * gives a phone its own full-screen picker — far better to use with a thumb than any
 * dropdown that could be built here, and it needs no code to be accessible.
 */
export const SELECT_OPTION = 'bg-[var(--surface)] text-[var(--foreground)]';

/**
 * The unit a line is entered and read in.
 *
 * `poolUnit` comes from the server, which derives it from the product's measurement
 * option — the same source the stock maths divides the pool by. Null means the line
 * is counted in pieces: either it is a PCS line, or it is a pooled row saved before
 * the unit was recorded, and pieces is the safer reading of an unknown than a
 * weight would be.
 *
 * Everything below takes that code rather than a boolean, so a screen cannot label
 * a line one way and convert it another.
 */
export type PoolUnit = string | null;

const poolBase = (poolUnit: PoolUnit): 'g' | 'ml' | 'piece' =>
    STOCK_UNITS[poolUnit ?? '']?.baseUnit ?? 'piece';

export const unitTag = (poolUnit: PoolUnit) =>
    poolBase(poolUnit) === 'piece' ? TAG_PCS : TAG_POOL;

export const unitLabel = (poolUnit: PoolUnit) => {
    switch (poolBase(poolUnit)) {
        case 'g':
            return 'KG';
        case 'ml':
            return 'L';
        default:
            return 'PCS';
    }
};

export const unitSuffix = (poolUnit: PoolUnit) => {
    switch (poolBase(poolUnit)) {
        case 'g':
            return 'kg';
        case 'ml':
            return 'L';
        default:
            return 'pcs';
    }
};

/**
 * Whether this unit is counted rather than measured.
 *
 * Decides what a quantity box will accept: a count has no fractional part — there is
 * no half lemon to load — so a counted line takes digits only and a measured one
 * takes a decimal point too. A PCS line passes null here and lands on counted, which
 * is what it is.
 */
export const unitIsCounted = (poolUnit: PoolUnit) => poolBase(poolUnit) === 'piece';

/** What one step of the quantity box is worth. */
export const unitStep = (poolUnit: PoolUnit) => (unitIsCounted(poolUnit) ? '1' : '0.001');

/** The placeholder that matches that step. */
export const unitPlaceholder = (poolUnit: PoolUnit) => (unitIsCounted(poolUnit) ? '0' : '0.000');

/**
 * Strip whatever the unit cannot carry, as it is typed.
 *
 * Applied to the value rather than checked on submit: a box that quietly refuses the
 * character you typed teaches the rule in the moment, where an error afterwards only
 * reports it. Same reasoning as cleanPhone above.
 */
export const cleanAmount = (value: string, poolUnit: PoolUnit) =>
    unitIsCounted(poolUnit) ? value.replace(/\D/g, '') : value.replace(/[^\d.]/g, '');

/** "DAMAGE PENDING" reads worse than "Damage pending" on a badge. */
export function formatState(state: string): string {
    return state
        .toLowerCase()
        .split('_')
        .join(' ')
        .replace(/^./, (c) => c.toUpperCase());
}

/** Day and time, short enough for a table cell. */
export function shortDate(iso: string): string {
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return `${day} ${time}`;
}

/** Day only, for the audit trail and the damage cards. */
export function longDate(iso: string): string {
    return new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * How much of a product is on a line, in the unit that product is measured in.
 *
 * A pooled line is stored as one integer in its base unit and `poolUnit` says what
 * that base is. `formatMeasured` then picks the readable form off that integer,
 * which is why a 1500 g line reads "1.5 kg" and a 500 g line reads "500 g" without
 * either being stored differently — and why 30 in a piece pool reads "30 pcs"
 * rather than the "0.03 kg" this produced while every pool was assumed to be grams.
 * It is the dashboard's existing helper — a port of the backend's own stock-units
 * module — so the two cannot drift apart.
 */
export function formatQuantity(line: {
    isPooled: boolean;
    poolUnit?: string | null;
    quantityPcs: number | null;
    weightGrams: number | null;
}): string {
    if (line.isPooled) {
        const base = STOCK_UNITS[line.poolUnit ?? '']?.baseUnit ?? 'piece';
        const value = line.weightGrams ?? 0;
        return base === 'piece'
            ? `${value} ${value === 1 ? 'pc' : 'pcs'}`
            : formatMeasured(value, base);
    }
    const pcs = line.quantityPcs ?? 0;
    return `${pcs} ${pcs === 1 ? 'pc' : 'pcs'}`;
}

/**
 * The same, for a damage line — which carries its own pair of fields.
 *
 * `damagedPoolQty` arrives in the line's own unit rather than as a base integer, so
 * it is printed with that unit's suffix directly instead of being scaled first.
 */
export function formatDamagedQuantity(line: {
    isPooled: boolean;
    poolUnit?: string | null;
    damagedPcs: number | null;
    damagedPoolQty: number | null;
}): string {
    if (line.isPooled) {
        const qty = line.damagedPoolQty ?? 0;
        return `${qty} ${unitSuffix(line.poolUnit ?? null)}`;
    }
    const pcs = line.damagedPcs ?? 0;
    return `${pcs} ${pcs === 1 ? 'pc' : 'pcs'}`;
}

/**
 * The openable URL of a stored document.
 *
 * A RELATIVE URL, through this app's own /api/asset proxy.
 *
 * It used to be built against NEXT_PUBLIC_VENDURE_ADMIN_API, which is
 * `http://localhost:3005` in development. That address means "this machine", so it
 * only ever resolved on the machine running the server: on a phone reaching the app
 * through a tunnel, and in the TWA app, `localhost:3005` is the phone's own localhost
 * and nothing is listening there. Every transfer PDF and every damage photo silently
 * failed to open. Going through this server instead makes the link correct from
 * wherever the app is being used, because there is no host in it to be wrong.
 *
 * An absolute `source` is left exactly as it is. That is what a deployment storing
 * assets on S3 or a CDN returns, and such a URL is already reachable from anywhere —
 * proxying it would add a hop and buy nothing.
 *
 * Vendure can also return a storage-relative path with BACKSLASHES on a
 * Windows-hosted server (`source\trf-….pdf`). Browsers tolerate those in a path
 * today; a URL separator is a forward slash, and relying on the tolerance invites a
 * broken link the first time something in the chain is stricter. So it is normalised.
 *
 * The `v` parameter is the other half. The asset route answers `immutable` with a
 * year-long max-age, which is right for a file that never changes and wrong for this
 * one: editing a confirmed transfer rewrites the SAME file at the SAME path,
 * deliberately, so a number already printed still resolves. Without `v` the browser
 * keeps showing the superseded document and no amount of reloading dislodges it.
 * Stamping updatedAt on gives each revision its own address while leaving the caching
 * intact.
 */
/**
 * The part of an asset URL that names the file, whether it arrived absolute or not.
 *
 * An ABSOLUTE source is not left alone, and the reason is a query string. A
 * deployment serving assets through a CDN returns them already stamped with an
 * image transform — `…/trf-m-0001.pdf?preset=thumb`. On a photograph that is
 * harmless; on a PDF it asks the asset server to resize a document as though it
 * were an image, and the file will not open. It reached a live screen exactly that
 * way, while local development — storing assets on disk, with no preset applied —
 * showed nothing wrong.
 *
 * So the path is taken and the query discarded. `/api/asset` rebuilds the upstream
 * URL from the path segments alone, which is what drops the preset.
 *
 * Windows-hosted servers can return backslashes (`source\trf-….pdf`). Browsers
 * tolerate those today; a URL separator is a forward slash, and relying on the
 * tolerance invites a broken link the first time something in the chain is stricter.
 */
function assetPath(source: string): string {
    const normalised = source.replace(/\\/g, '/');
    if (!/^https?:\/\//i.test(normalised)) {
        return normalised.split('?')[0].replace(/^\/+/, '').replace(/^assets\//, '');
    }
    try {
        const { pathname } = new URL(normalised);
        // Everything after the asset server's own route, which /api/asset re-adds.
        return pathname.replace(/^\/+(assets\/)?/, '');
    } catch {
        return normalised.split('?')[0].replace(/^\/+/, '').replace(/^assets\//, '');
    }
}

export function assetUrl(asset: { source: string; updatedAt?: string }): string {
    /*
      Always through this app's own origin, never straight at the asset host.

      Two things depend on it. The `download` attribute is IGNORED across origins, so
      a link to another host can only ever open a PDF, never save one — which is what
      a phone needs. And the proxy rebuilds the upstream URL from the path, dropping
      the `?preset=` an image CDN adds, which is what stops a PDF being asked for as
      a thumbnail.
    */
    const base = `/api/asset/${assetPath(asset.source)}`;
    if (!asset.updatedAt) {
        return base;
    }
    /*
      The `v` parameter. The asset route answers `immutable` with a year-long
      max-age — right for a file that never changes, wrong for this one: editing a
      confirmed transfer rewrites the SAME file at the SAME path, deliberately, so a
      number already printed still resolves. Without `v` the browser keeps showing
      the superseded document and no amount of reloading dislodges it.
    */
    const version = Date.parse(asset.updatedAt);
    return `${base}?v=${Number.isNaN(version) ? asset.updatedAt : version}`;
}
