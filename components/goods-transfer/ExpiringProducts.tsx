'use client';

/**
 * What is ageing on this branch's shelf — one row per PRODUCT.
 *
 * This replaces the "Expiring soon" tab of the transfer list, which listed
 * TRANSFERS. That was the wrong subject: expiry belongs to a product sitting in a
 * cold room, and the transfer is only how it got there. A list of transfer numbers
 * made the reader open each one to work out which product was meant — the actual
 * question, every time.
 *
 * The window is 80% of the shelf life up to the expiry itself, which is exactly the
 * span in which the page is worth reading: long enough to mark something down and
 * still sell it, over the moment it can no longer be sold. A product that has not
 * reached 80% is not here — this is a list of warnings given, not a forecast.
 *
 * The server drops a row when its stock runs out or when it expires, whichever comes
 * first, so the list shrinks on its own and never needs tidying by hand.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { PluginMissingNotice } from '@/components/goods-transfer/notices';
import { Spinner } from '@/components/ui/Spinner';
import { useGoodsTransferPushRefresh } from '@/hooks/useGoodsTransferPushRefresh';
import { ALERT_INTERVAL_MS } from '@/lib/goods-transfer-alert-marker';
import { shortDate } from '@/lib/goods-transfer-format';
import { STOCK_UNITS, formatMeasured } from '@/lib/stock-units';
import { fetchExpiringProducts, isPluginMissingError } from '@/services/goods-transfer.service';
import type { ExpiringProduct } from '@/types/goods-transfer';

const TH = 'px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';

/**
 * Stock in the unit the product is measured in — grams are not a shelf quantity,
 * and neither is a weight for something counted out by hand.
 */
function stockOf(row: ExpiringProduct): string {
    if (!row.isPooled) {
        return `${row.currentStock} pcs`;
    }
    const base = STOCK_UNITS[row.poolUnit ?? '']?.baseUnit ?? 'piece';
    return base === 'piece' ? `${row.currentStock} pcs` : formatMeasured(row.currentStock, base);
}

/**
 * How long is left, in the words someone would use.
 *
 * Whole days from today. The "over" case should never be reached — the server drops a
 * row the moment it expires — and is kept only as a safety net for the seconds around
 * that moment, and for a browser clock that runs ahead of the server's.
 */
function daysLeft(expiresAt: string | null): { text: string; tone: 'over' | 'today' | 'soon' | 'ok' } {
    if (!expiresAt) {
        return { text: '—', tone: 'ok' };
    }
    const end = new Date(expiresAt);
    const now = new Date();
    // Compared date-to-date so "today" means today, rather than depending on whether
    // the shelf life happens to run out before or after the current hour.
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOfDay(end) - startOfDay(now)) / 86_400_000);

    if (days < 0) {
        return { text: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} over`, tone: 'over' };
    }
    if (days === 0) {
        return { text: 'today', tone: 'today' };
    }
    return {
        text: `${days} day${days === 1 ? '' : 's'} left`,
        tone: days <= 2 ? 'soon' : 'ok',
    };
}

const TONE_CLASS: Record<'over' | 'today' | 'soon' | 'ok', string> = {
    over: 'text-[var(--tone-red)] font-semibold',
    today: 'text-[var(--tone-red)] font-semibold',
    soon: 'text-[var(--tone-amber)] font-semibold',
    ok: 'text-[var(--text-muted)]',
};

export function ExpiringProducts({ channelToken }: { channelToken: string }) {
    const [rows, setRows] = useState<ExpiringProduct[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pluginMissing, setPluginMissing] = useState(false);

    /** `silent` for the interval and the push — a live update is the data changing,
     *  not the screen saying it is about to. */
    const load = useCallback(async (silent = false) => {
        if (!silent) {
            setIsLoading(true);
        }
        try {
            const result = await fetchExpiringProducts({ take: 200 }, channelToken);
            setRows(result.items);
            setError(null);
        } catch (err) {
            if (isPluginMissingError(err)) {
                setPluginMissing(true);
                return;
            }
            setError(err instanceof Error ? err.message : 'Could not read what is expiring');
        } finally {
            if (!silent) {
                setIsLoading(false);
            }
        }
    }, [channelToken]);

    useEffect(() => {
        void load();
    }, [load]);

    // Same cadence as the rest of the section, plus an immediate re-read when a push
    // says something happened — an expiry warning is one of the things it can say.
    useEffect(() => {
        const timer = window.setInterval(() => void load(true), ALERT_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [load]);

    useGoodsTransferPushRefresh(() => void load(true));

    if (pluginMissing) {
        return <PluginMissingNotice />;
    }

    if (isLoading && !rows.length) {
        return (
            <div className="flex items-center justify-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-10 text-[0.8125rem] text-[var(--text-muted)]">
                <Spinner size="md" />
                Loading…
            </div>
        );
    }

    if (error && !rows.length) {
        return (
            <div className="rounded-2xl border border-[rgba(239,68,68,0.3)] bg-[var(--error-bg)] px-4 py-3 text-[0.8125rem] text-[var(--tone-red)]">
                {error}
            </div>
        );
    }

    if (!rows.length) {
        return (
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-10 text-center">
                <h3 className="mb-1 text-[0.9375rem] font-semibold text-[var(--foreground)]">
                    Nothing expiring
                </h3>
                <p className="text-[0.8125rem] text-[var(--text-muted)]">
                    Products appear here once they have used up most of their shelf life and stock is
                    still on hand.
                </p>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
            {/* ── Phone: one card per product ── */}
            <ul className="md:hidden">
                {rows.map((row) => {
                    const left = daysLeft(row.expiresAt);
                    return (
                        <li
                            key={row.lineId}
                            className="border-b border-[var(--card-border)] p-3 last:border-b-0"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 text-[0.875rem] font-medium text-[var(--foreground)]">
                                    {row.productName}
                                </p>
                                <span className={`shrink-0 text-[0.75rem] ${TONE_CLASS[left.tone]}`}>
                                    {left.text}
                                </span>
                            </div>
                            {row.sku && (
                                <p className="mt-0.5 font-mono text-[0.75rem] text-[var(--text-muted)]">
                                    {row.sku}
                                </p>
                            )}
                            <dl className="mt-2 grid grid-cols-3 gap-2">
                                <Figure label="In stock" value={stockOf(row)} strong />
                                <Figure label="Received" value={shortDate(row.receivedAt)} />
                                <Figure
                                    label="Expires"
                                    value={row.expiresAt ? shortDate(row.expiresAt) : '—'}
                                />
                            </dl>
                            <Link
                                href={`/goods-transfer/${row.transferId}`}
                                className="mt-2 inline-block text-[0.75rem] text-[var(--tone-indigo-soft)] underline-offset-2 hover:underline"
                            >
                                Came on {row.transferNumber}
                            </Link>
                        </li>
                    );
                })}
            </ul>

            {/* ── md and up: the table ── */}
            <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[46rem] border-collapse text-[0.8125rem]">
                    <thead>
                        <tr className="border-b border-[var(--card-border)]">
                            <th className={TH}>Product</th>
                            <th className={TH}>SKU</th>
                            <th className={`${TH} text-right`}>In stock</th>
                            <th className={`${TH} text-right`}>Received</th>
                            <th className={`${TH} text-right`}>Expires</th>
                            <th className={`${TH} text-right`}>Time left</th>
                            {/* Last, deliberately: how it arrived is the follow-up question. */}
                            <th className={TH}>Transfer</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => {
                            const left = daysLeft(row.expiresAt);
                            return (
                                <tr
                                    key={row.lineId}
                                    className="border-b border-[var(--card-border)] last:border-b-0"
                                >
                                    <td className="px-4 py-2.5 text-[var(--foreground)]">
                                        {row.productName}
                                    </td>
                                    <td className="px-4 py-2.5 font-mono text-[0.75rem] text-[var(--text-muted)]">
                                        {row.sku || '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--foreground)]">
                                        {stockOf(row)}
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">
                                        {shortDate(row.receivedAt)}
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">
                                        {row.expiresAt ? shortDate(row.expiresAt) : '—'}
                                    </td>
                                    <td className={`px-4 py-2.5 text-right ${TONE_CLASS[left.tone]}`}>
                                        {left.text}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <Link
                                            href={`/goods-transfer/${row.transferId}`}
                                            className="tabular-nums text-[var(--tone-indigo-soft)] underline-offset-2 hover:underline"
                                        >
                                            {row.transferNumber}
                                        </Link>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="border-t border-[var(--card-border)] px-4 py-3 text-[0.75rem] text-[var(--text-muted)]">
                {rows.length} product{rows.length === 1 ? '' : 's'} · soonest first
            </div>
        </div>
    );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="min-w-0">
            <dt className="truncate text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {label}
            </dt>
            <dd
                className={`mt-0.5 text-[0.8125rem] tabular-nums ${
                    strong ? 'text-[var(--foreground)]' : 'text-[var(--text-muted)]'
                }`}
            >
                {value}
            </dd>
        </div>
    );
}
