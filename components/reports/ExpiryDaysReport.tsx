'use client';

/**
 * Reports → Expiry Days: every product variant of the channel with its
 * shelf life, coloured red / yellow / green by day counts entered here.
 * Banding and search rules live in lib/expiry-days.ts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { fetchVariantExpiryDays } from '@/services/expiry-days.service';
import {
    bandCounts,
    bandRangeLabel,
    DEFAULT_EXPIRY_THRESHOLDS,
    EXPIRY_BANDS,
    EXPIRY_COLORS,
    expiryBand,
    matchesVariantSearch,
    parseStoredThresholds,
    sortByExpiryDays,
    thresholdsInOrder,
    type ExpiryBand,
    type ExpiryColor,
    type ExpiryThresholds,
    type VariantExpiry,
} from '@/lib/expiry-days';

const BAND_STYLE: Record<ExpiryBand, { label: string; color: string }> = {
    red: { label: 'Red', color: '#f87171' },
    yellow: { label: 'Yellow', color: '#fbbf24' },
    green: { label: 'Green', color: '#4ade80' },
    longer: { label: 'Longer', color: '#94a3b8' },
    unset: { label: 'Not set', color: '#64748b' },
};

/** The three day counts, per device. */
const THRESHOLDS_KEY = 'reports-expiry-day-colors';
const ROWS_STEP = 300;

/** Variants per channel token — survives leaving the report; Refresh replaces it. */
const variantCache = new Map<string, VariantExpiry[]>();

function readSavedThresholds(): ExpiryThresholds {
    try {
        return parseStoredThresholds(localStorage.getItem(THRESHOLDS_KEY));
    } catch {
        return DEFAULT_EXPIRY_THRESHOLDS;
    }
}

function saveThresholds(t: ExpiryThresholds): void {
    try {
        localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(t));
    } catch {
        // private window / blocked storage — the counts still apply until reload
    }
}

function asInputs(t: ExpiryThresholds): Record<ExpiryColor, string> {
    return { red: String(t.red), yellow: String(t.yellow), green: String(t.green) };
}

function loadErrorMessage(err: unknown): string {
    const msg = err instanceof Error ? err.message : 'Failed to load product variants';
    return /expiryDays/.test(msg) ? 'This backend has no "Expiry days" field on product variants yet.' : msg;
}

const INPUT_STYLE = { background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' };
const TH = 'px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]';

export function ExpiryDaysReportView({ channelToken, onBack }: { channelToken: string | null; onBack: () => void }) {
    const [result, setResult] = useState<{ key: string; rows: VariantExpiry[] } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [thresholds, setThresholds] = useState<ExpiryThresholds>(readSavedThresholds);
    const [inputs, setInputs] = useState<Record<ExpiryColor, string>>(() => asInputs(thresholds));
    const [search, setSearch] = useState('');
    const [band, setBand] = useState<ExpiryBand | null>(null);
    const [limit, setLimit] = useState(ROWS_STEP);

    const load = useCallback(async () => {
        if (!channelToken) return;
        const key = channelToken;
        setLoading(true);
        setError('');
        try {
            const rows = await fetchVariantExpiryDays(key);
            variantCache.set(key, rows);
            setResult({ key, rows });
        } catch (err) {
            setError(loadErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [channelToken]);

    // First open for this channel: cached list, else one load. Refresh reloads.
    const resultKey = result?.key ?? null;
    useEffect(() => {
        if (!channelToken || resultKey === channelToken) return;
        const cached = variantCache.get(channelToken);
        const t = setTimeout(() => (cached ? setResult({ key: channelToken, rows: cached }) : load()), 0);
        return () => clearTimeout(t);
    }, [channelToken, resultKey, load]);

    const rows = result && result.key === channelToken ? result.rows : null;
    const sorted = useMemo(() => (rows ? sortByExpiryDays(rows) : []), [rows]);
    const searched = useMemo(() => sorted.filter((r) => matchesVariantSearch(r, search)), [sorted, search]);
    const counts = useMemo(() => bandCounts(searched, thresholds), [searched, thresholds]);
    const shown = useMemo(
        () => (band ? searched.filter((r) => expiryBand(r.expiryDays, thresholds) === band) : searched),
        [searched, band, thresholds],
    );

    function changeCount(color: ExpiryColor, value: string) {
        setInputs((prev) => ({ ...prev, [color]: value }));
        const n = Number(value);
        if (value.trim() === '' || !Number.isInteger(n) || n < 0) return;
        const next = { ...thresholds, [color]: n };
        setThresholds(next);
        saveThresholds(next);
    }

    function pickBand(next: ExpiryBand | null) {
        setBand((prev) => (prev === next ? null : next));
        setLimit(ROWS_STEP);
    }

    return (
        <>
            {/* ── Header bar ── */}
            <div
                className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3"
                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
            >
                <button onClick={onBack} className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline mr-1">
                    ← Reports
                </button>
                <h1 className="text-[1rem] font-semibold text-[var(--foreground)] mr-auto">Expiry Days</h1>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setLimit(ROWS_STEP);
                        }}
                        placeholder="Search variant name, ID or SKU…"
                        className="flex-1 sm:flex-none sm:w-[260px] px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={INPUT_STYLE}
                    />
                    <button
                        onClick={() => load()}
                        disabled={loading || !channelToken}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', color: '#818cf8' }}
                    >
                        {loading ? 'Loading...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* ── Content ── */}
            <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
                {/* Day count per colour */}
                <div
                    className="rounded-xl px-4 py-3 mb-4"
                    style={{ background: 'rgb(var(--overlay-rgb)/0.02)', border: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
                >
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                        Colour by expiry days
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {EXPIRY_COLORS.map((color) => (
                            <label key={color} className="flex items-center gap-2 text-[0.8125rem] text-[var(--foreground)]">
                                <span className="w-3 h-3 rounded-full" style={{ background: BAND_STYLE[color].color }} />
                                <span className="font-semibold" style={{ color: BAND_STYLE[color].color }}>{BAND_STYLE[color].label}</span>
                                <span className="text-[var(--text-muted)]">up to</span>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    step={1}
                                    value={inputs[color]}
                                    onChange={(e) => changeCount(color, e.target.value)}
                                    onBlur={() => setInputs(asInputs(thresholds))}
                                    className="w-[64px] px-2 py-1 rounded-lg text-[0.8125rem] text-right tabular-nums outline-none"
                                    style={INPUT_STYLE}
                                    aria-label={`${BAND_STYLE[color].label} up to how many days`}
                                />
                                <span className="text-[var(--text-muted)]">days</span>
                            </label>
                        ))}
                    </div>
                    <p className="text-[0.6875rem] mt-2" style={{ color: thresholdsInOrder(thresholds) ? 'var(--text-muted)' : '#fbbf24' }}>
                        {thresholdsInOrder(thresholds)
                            ? 'Saved on this device.'
                            : 'Each colour needs more days than the one before it — a colour with no days stays empty.'}
                    </p>
                </div>

                {error && (
                    <div className="px-3 py-2 rounded-lg mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                        <p className="text-[0.75rem] text-red-400">{error}</p>
                    </div>
                )}

                {!rows && loading && (
                    <div className="flex items-center justify-center py-16"><Spinner /></div>
                )}

                {rows && (
                    <>
                        {/* Count per colour — tap one to show only those */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                            <BandBox
                                label="All"
                                count={searched.length}
                                range="Product variants"
                                color="#818cf8"
                                active={band === null}
                                onClick={() => pickBand(null)}
                            />
                            {EXPIRY_BANDS.map((b) => (
                                <BandBox
                                    key={b}
                                    label={BAND_STYLE[b].label}
                                    count={counts[b]}
                                    range={bandRangeLabel(b, thresholds)}
                                    color={BAND_STYLE[b].color}
                                    active={band === b}
                                    onClick={() => pickBand(b)}
                                />
                            ))}
                        </div>

                        <p className="text-[0.75rem] text-[var(--text-muted)] mb-3">
                            Showing <span className="text-[var(--foreground)] font-medium">{Math.min(limit, shown.length)}</span> of{' '}
                            <span className="text-[var(--foreground)] font-medium">{shown.length}</span> product variants
                            {band && <> · {BAND_STYLE[band].label}</>}
                        </p>

                        {shown.length === 0 ? (
                            <p className="text-center text-[var(--text-muted)] text-[0.8125rem] py-10">
                                {search.trim() ? 'No product variant matches this search.' : 'No product variants here.'}
                            </p>
                        ) : (
                            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse min-w-[560px]">
                                        <thead>
                                            <tr style={{ background: 'rgb(var(--overlay-rgb)/0.02)', borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                                <th className={TH}>ID</th>
                                                <th className={TH}>Product variant</th>
                                                <th className={TH}>SKU</th>
                                                <th className={`${TH} text-right`}>Expiry days</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {shown.slice(0, limit).map((row) => (
                                                <VariantRow key={row.id} row={row} band={expiryBand(row.expiryDays, thresholds)} />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {shown.length > limit && (
                            <div className="flex justify-center mt-4">
                                <button
                                    onClick={() => setLimit((n) => n + ROWS_STEP)}
                                    className="px-3 py-1.5 rounded-lg text-[0.75rem] font-medium cursor-pointer transition-all"
                                    style={INPUT_STYLE}
                                >
                                    Show {Math.min(ROWS_STEP, shown.length - limit)} more
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
}

function BandBox({
    label,
    count,
    range,
    color,
    active,
    onClick,
}: {
    label: string;
    count: number;
    range: string;
    color: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            aria-pressed={active}
            className="rounded-xl px-4 py-3 flex flex-col gap-1 text-left cursor-pointer transition-all"
            style={{
                background: `color-mix(in srgb, ${color} ${active ? 16 : 6}%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color} ${active ? 60 : 20}%, transparent)`,
            }}
        >
            <span className="text-[0.625rem] font-semibold uppercase tracking-widest" style={{ color: `color-mix(in srgb, ${color} 70%, white)` }}>
                {label}
            </span>
            <span className="text-[1.125rem] font-bold tabular-nums" style={{ color }}>{count}</span>
            <span className="text-[0.6875rem]" style={{ color: 'var(--text-muted)' }}>{range}</span>
        </button>
    );
}

function VariantRow({ row, band }: { row: VariantExpiry; band: ExpiryBand }) {
    const { color } = BAND_STYLE[band];
    return (
        <tr className="transition-colors hover:bg-overlay/[0.02]" style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.04)' }}>
            <td className="px-3 py-2.5" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
                <span className="text-[0.75rem] tabular-nums text-[var(--text-muted)]">{row.id}</span>
            </td>
            <td className="px-3 py-2.5">
                <span className="text-[0.8125rem] font-medium text-[var(--foreground)]">{row.name}</span>
                {!row.enabled && <span className="ml-2 text-[0.625rem] uppercase tracking-wider text-[var(--text-muted)]">Disabled</span>}
            </td>
            <td className="px-3 py-2.5">
                <span className="text-[0.75rem] text-[var(--text-muted)]">{row.sku || '—'}</span>
            </td>
            <td className="px-3 py-2.5 text-right">
                <span
                    className="inline-block px-2 py-0.5 rounded-full text-[0.75rem] font-semibold tabular-nums"
                    style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
                >
                    {row.expiryDays == null ? 'Not set' : `${row.expiryDays} day${row.expiryDays === 1 ? '' : 's'}`}
                </span>
            </td>
        </tr>
    );
}
