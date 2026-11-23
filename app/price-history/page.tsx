'use client';

/**
 * Price Change History — superadmin-only audit table of variant price changes.
 *
 * Gate is UX-only: the backend enforces the real access via
 * @Allow(Permission.SuperAdmin). Non-superadmins are still bounced to / so the
 * page never half-renders for them.
 */

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { isSuperadmin } from '@/lib/is-superadmin';
import {
    fetchPriceChangeHistory,
    fetchPriceSyncBatches,
    PriceChangeLogItem,
    PriceSyncBatchItem,
} from '@/services/price-history.service';
import { paiseToRupeeString } from '@/lib/price';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

function formatRupee(paise: number): string {
    return `₹${paiseToRupeeString(paise)}`;
}

interface PriceChangeGroup {
    key: string;
    adminName: string;
    when: string; // ISO of the batch (first row's createdAt)
    items: PriceChangeLogItem[];
}

/**
 * Collapse the flat change-log into one row per update batch. A bulk edit
 * stamps every row with the same admin + same second, so (adminName + createdAt
 * truncated to the second) is the batch identity. Input is already sorted
 * newest-first by the backend, so groups come out in that order too.
 */
function groupChanges(items: PriceChangeLogItem[]): PriceChangeGroup[] {
    const byKey = new Map<string, PriceChangeGroup>();
    for (const it of items) {
        const second = new Date(it.createdAt).toISOString().slice(0, 19); // drop millis
        const key = `${it.adminName}__${second}`;
        const existing = byKey.get(key);
        if (existing) {
            existing.items.push(it);
        } else {
            byKey.set(key, { key, adminName: it.adminName, when: it.createdAt, items: [it] });
        }
    }
    return Array.from(byKey.values());
}

export default function PriceHistoryPage() {
    const { isLoading, currentUser } = useRequireAuth();
    const router = useRouter();
    const allowed = isSuperadmin(currentUser);
    const [items, setItems] = useState<PriceChangeLogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [batches, setBatches] = useState<PriceSyncBatchItem[]>([]);
    const [pendingInQueue, setPendingInQueue] = useState<number>(0);
    const [syncLoading, setSyncLoading] = useState(true);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    function toggleGroup(key: string): void {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }

    useEffect(() => {
        if (isLoading) return;
        if (!allowed) {
            router.replace('/');
            return;
        }
        fetchPriceChangeHistory({ take: 50 })
            .then((res) => setItems(res.items))
            .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load price history'))
            .finally(() => setLoading(false));
        fetchPriceSyncBatches({ take: 50 })
            .then((res) => {
                setBatches(res.items);
                setPendingInQueue(res.pendingInQueue);
            })
            .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load sync activity'))
            .finally(() => setSyncLoading(false));
    }, [isLoading, allowed, router]);

    if (isLoading || !allowed) {
        return (
            <DashboardLayout>
                {() => (
                    <div className="min-h-full w-full bg-zinc-950 px-4 pb-28 pt-5 text-sm text-zinc-400 sm:px-6">
                        Checking access…
                    </div>
                )}
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            {() => (
        <div className="min-h-full w-full bg-zinc-950 px-4 pb-28 pt-5 text-zinc-100 sm:px-6">
            <h1 className="mb-4 text-lg font-semibold text-zinc-100">Price Change History</h1>

            {error && (
                <div className="mb-4 rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="text-sm text-zinc-400">Loading…</div>
            ) : items.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
                    No price changes recorded yet.
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
                    <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                            <tr className="border-b border-zinc-800">
                                <th className="px-4 py-3 font-semibold">When</th>
                                <th className="px-4 py-3 font-semibold">Changed by</th>
                                <th className="px-4 py-3 font-semibold">Updates</th>
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {groupChanges(items).map((g) => {
                                const isOpen = expanded.has(g.key);
                                return (
                                    <Fragment key={g.key}>
                                        <tr
                                            onClick={() => toggleGroup(g.key)}
                                            className="cursor-pointer border-t border-zinc-800 hover:bg-zinc-800/40"
                                        >
                                            <td className="whitespace-nowrap px-4 py-3 text-zinc-300">
                                                {new Date(g.when).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 font-medium text-zinc-100">{g.adminName}</td>
                                            <td className="px-4 py-3 text-zinc-300">
                                                <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-semibold text-zinc-200">
                                                    {g.items.length} price{g.items.length === 1 ? '' : 's'} updated
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right text-zinc-500">
                                                <span
                                                    className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}
                                                    aria-hidden
                                                >
                                                    ▶
                                                </span>
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr key={`${g.key}-detail`} className="border-t border-zinc-800/60">
                                                <td colSpan={4} className="bg-zinc-950/40 px-4 py-3">
                                                    <table className="w-full text-sm">
                                                        <thead className="text-left text-xs uppercase tracking-wide text-zinc-600">
                                                            <tr>
                                                                <th className="px-2 py-2 font-semibold">Variant</th>
                                                                <th className="px-2 py-2 font-semibold">Channel</th>
                                                                <th className="px-2 py-2 font-semibold">Old</th>
                                                                <th className="px-2 py-2 font-semibold">New</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {g.items.map((it) => (
                                                                <tr key={it.id} className="border-t border-zinc-800/60">
                                                                    <td className="px-2 py-2 font-medium text-zinc-100">
                                                                        {it.variantName}
                                                                    </td>
                                                                    <td className="px-2 py-2 text-zinc-300">
                                                                        {it.channelName}
                                                                    </td>
                                                                    <td className="px-2 py-2 text-zinc-400">
                                                                        {it.oldPrice == null ? '—' : formatRupee(it.oldPrice)}
                                                                    </td>
                                                                    <td className="px-2 py-2 font-semibold text-zinc-100">
                                                                        {formatRupee(it.newPrice)}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="mt-8 mb-4 flex items-center gap-3">
                <h2 className="text-lg font-semibold text-zinc-100">Order Sync Activity</h2>
                <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        pendingInQueue > 0
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-emerald-500/15 text-emerald-300'
                    }`}
                >
                    {pendingInQueue} pending in queue
                </span>
            </div>

            {syncLoading ? (
                <div className="text-sm text-zinc-400">Loading…</div>
            ) : batches.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
                    No price-update syncs recorded yet.
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
                    <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                            <tr className="border-b border-zinc-800">
                                <th className="px-4 py-3 font-semibold">When</th>
                                <th className="px-4 py-3 font-semibold">Variants</th>
                                <th className="px-4 py-3 font-semibold">Orders affected</th>
                                <th className="px-4 py-3 font-semibold">Synced now</th>
                                <th className="px-4 py-3 font-semibold">Queued</th>
                            </tr>
                        </thead>
                        <tbody>
                            {batches.map((b) => (
                                <tr key={b.id} className="border-t border-zinc-800 hover:bg-zinc-800/40">
                                    <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                                        {new Date(b.createdAt).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-zinc-100">{b.variantCount}</td>
                                    <td className="px-4 py-3 font-semibold text-zinc-100">{b.affectedOrders}</td>
                                    <td className="px-4 py-3 text-emerald-300">{b.syncedNow}</td>
                                    <td className="px-4 py-3 text-amber-300">{b.queuedCount}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
            )}
        </DashboardLayout>
    );
}
