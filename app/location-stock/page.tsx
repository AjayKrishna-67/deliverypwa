'use client';

/**
 * Location Stock — location-first stock editor in the PWA.
 *
 * Pick a stock location -> see its items -> edit on-hand per row and save that
 * one row. Two tabs split by stock kind:
 *   Variant  — normal per-variant stock (counts: piece/packet/dozen)
 *   Product  — weight-pool products (kg), one pool number per product
 *
 * All calls go to the DEFAULT channel (a location shows products across every
 * channel it serves). There is NO bulk save — each row is written on its own
 * explicit save (anti-Excel). Stock crosses the wire as a base-unit integer.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useAuth } from '@/providers/AuthProvider';
import { hasPermissionAnyChannel } from '@/lib/is-superadmin';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { Spinner } from '@/components/ui/Spinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { GraphQLOperationError } from '@/graphql/client';
import {
    fetchProductPoolStock,
    fetchStockLocations,
    fetchStockTags,
    fetchVariantStock,
    saveProductPoolStock,
    saveVariantStock,
    type CatalogTagOption,
    type ProductPoolStockRow,
    type StockLocationOption,
    type VariantStockRow,
} from '@/services/location-stock.service';
import { fromBase, toBase, toGrams, toKg, formatMeasured, STOCK_UNITS } from '@/lib/stock-units';
import { fetchDefaultChannelToken } from '@/services/price-matrix.service';

type Tab = 'variant' | 'pool';

export default function LocationStockPage() {
    const { isLoading: authLoading, isAuthenticated } = useRequireAuth();
    const { currentUser } = useAuth();
    const router = useRouter();
    // Global (channel-agnostic) gate: this tool scopes by stock location + tag,
    // not by channel, so permission is checked across ALL the user's channels.
    const canRead =
        hasPermissionAnyChannel(currentUser, 'ReadProduct') &&
        hasPermissionAnyChannel(currentUser, 'ReadStockLocation');
    const canWrite =
        hasPermissionAnyChannel(currentUser, 'UpdateProduct') &&
        hasPermissionAnyChannel(currentUser, 'UpdateStockLocation');
    useEffect(() => {
        if (!authLoading && isAuthenticated && currentUser && !canRead) {
            router.replace('/');
        }
    }, [authLoading, isAuthenticated, currentUser, canRead, router]);
    if (authLoading) return <LoadingScreen />;
    if (!isAuthenticated) return null;
    if (!canRead) return null;
    return (
        <DashboardLayout>
            {() => <LocationStockContent canWrite={canWrite} />}
        </DashboardLayout>
    );
}

function LocationStockContent({ canWrite }: { canWrite: boolean }) {
    // Run under the DEFAULT (master) channel, NOT the sidebar city channel.
    // Catalog tags are now GLOBAL and every product lives on the default channel,
    // so scoping to the selected city channel would hide any product not assigned
    // to it (bug S1). Mirrors price-matrix, which pins to the default channel.
    const [channelToken, setChannelToken] = useState<string | null>(null);
    const [locations, setLocations] = useState<StockLocationOption[]>([]);
    const [tags, setTags] = useState<CatalogTagOption[]>([]);
    const [locationId, setLocationId] = useState('');
    const [tagId, setTagId] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<Tab>('variant');

    const [variantRows, setVariantRows] = useState<VariantStockRow[]>([]);
    const [poolRows, setPoolRows] = useState<ProductPoolStockRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const [draft, setDraft] = useState<Map<string, string>>(new Map());
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    // Resolve the default channel token once (tags are global; see note above).
    useEffect(() => {
        fetchDefaultChannelToken()
            .then(setChannelToken)
            .catch((e) => setError(e instanceof Error ? e.message : 'Failed to resolve channel'));
    }, []);

    // Load locations + tags under the default channel (tags are global).
    useEffect(() => {
        if (!channelToken) return;
        fetchStockLocations(channelToken)
            .then(setLocations)
            .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load locations'));
        fetchStockTags(channelToken)
            .then(setTags)
            .catch(() => { /* tag filter is optional */ });
    }, [channelToken]);

    // Debounce the search box.
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const tagIds = tagId ? [tagId] : undefined;

    const load = useCallback(async () => {
        if (!locationId || !channelToken) return;
        setIsLoading(true);
        setError('');
        try {
            const filter = { stockLocationId: locationId, tagIds, search };
            if (tab === 'variant') {
                setVariantRows(await fetchVariantStock(filter, channelToken));
            } else {
                setPoolRows(await fetchProductPoolStock(filter, channelToken));
            }
            setDraft(new Map());
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load stock');
        } finally {
            setIsLoading(false);
        }
    }, [locationId, tab, tagId, search, channelToken]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    function setDraftValue(key: string, value: string) {
        setDraft((prev) => {
            const next = new Map(prev);
            next.set(key, value);
            return next;
        });
    }

    async function saveVariant(row: VariantStockRow) {
        const key = `v:${row.variantId}`;
        const raw = draft.get(key);
        if (raw === undefined) return;
        const value = Number(raw || 0);
        if (Number.isNaN(value) || value < 0) {
            setToast({ kind: 'err', text: 'Enter a valid non-negative number.' });
            return;
        }
        if (!channelToken) return;
        setSavingKey(key);
        try {
            await saveVariantStock(
                {
                    variantId: row.variantId,
                    stockLocationId: locationId,
                    stockOnHand: toBase(value, row.stockUnit),
                },
                channelToken,
            );
            setToast({ kind: 'ok', text: `${row.name} stock saved.` });
            // Drop only THIS row's draft + reflect the saved value locally. Calling
            // load() here would reset the whole draft Map and silently discard every
            // other row's unsaved edit (W6).
            setDraft((prev) => {
                const next = new Map(prev);
                next.delete(key);
                return next;
            });
            setVariantRows((prev) =>
                prev.map((r) =>
                    r.variantId === row.variantId
                        ? { ...r, stockOnHand: toBase(value, row.stockUnit) }
                        : r,
                ),
            );
        } catch (e) {
            setToast({ kind: 'err', text: errText(e) });
        } finally {
            setSavingKey(null);
        }
    }

    async function savePool(row: ProductPoolStockRow) {
        const key = `p:${row.productId}`;
        const raw = draft.get(key);
        if (raw === undefined) return;
        const value = Number(raw || 0);
        if (Number.isNaN(value) || value < 0) {
            setToast({ kind: 'err', text: 'Enter a valid non-negative number.' });
            return;
        }
        if (!channelToken) return;
        setSavingKey(key);
        try {
            await saveProductPoolStock(
                {
                    productId: row.productId,
                    stockLocationId: locationId,
                    stockOnHand: toGrams(value),
                },
                channelToken,
            );
            setToast({ kind: 'ok', text: `${row.name} pool saved.` });
            // Targeted update, not a full load() — preserves other rows' drafts (W6).
            setDraft((prev) => {
                const next = new Map(prev);
                next.delete(key);
                return next;
            });
            setPoolRows((prev) =>
                prev.map((r) =>
                    r.productId === row.productId
                        ? { ...r, hasPoolHere: true, stockOnHand: toGrams(value) }
                        : r,
                ),
            );
        } catch (e) {
            setToast({ kind: 'err', text: errText(e) });
        } finally {
            setSavingKey(null);
        }
    }

    const showRows = locationId && !isLoading && !error;

    return (
        <div className="min-h-full w-full bg-zinc-950 px-4 pb-16 pt-5 text-zinc-100 sm:px-6">
            <h1 className="mb-4 text-lg font-semibold text-zinc-100">Location Stock</h1>

            {/* Filters */}
            <div className="mb-4 flex flex-wrap items-end gap-3">
                <Field label="Stock Location">
                    <select
                        value={locationId}
                        onChange={(e) => setLocationId(e.target.value)}
                        className="h-10 w-56 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-indigo-500"
                    >
                        <option value="">Select a location…</option>
                        {locations.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                    </select>
                </Field>
                <Field label="Tag (optional)">
                    <select
                        value={tagId}
                        onChange={(e) => setTagId(e.target.value)}
                        className="h-10 w-48 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-indigo-500"
                    >
                        <option value="">All tags</option>
                        {tags.map((t) => (
                            <option key={t.id} value={t.id}>{t.value}</option>
                        ))}
                    </select>
                </Field>
                <Field label="Search">
                    <input
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Name or SKU…"
                        className="h-10 w-56 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500"
                    />
                </Field>
            </div>

            {/* Tabs */}
            <div className="mb-4 flex gap-1 border-b border-zinc-800">
                <TabButton active={tab === 'variant'} onClick={() => setTab('variant')} label="Variant Stock" />
                <TabButton active={tab === 'pool'} onClick={() => setTab('pool')} label="Product (Weight) Stock" />
            </div>

            {!locationId && (
                <Empty text="Pick a stock location to begin." />
            )}
            {locationId && isLoading && (
                <div className="flex items-center justify-center py-16 text-zinc-500">
                    <Spinner /> <span className="ml-2">Loading stock…</span>
                </div>
            )}
            {error && (
                <div className="rounded-xl border border-red-900 bg-red-950/80 px-4 py-3 text-sm text-red-300">
                    {error}
                </div>
            )}

            {showRows && tab === 'variant' && (
                <VariantTable
                    rows={variantRows}
                    draft={draft}
                    savingKey={savingKey}
                    canWrite={canWrite}
                    onChange={setDraftValue}
                    onSave={saveVariant}
                />
            )}
            {showRows && tab === 'pool' && (
                <PoolTable
                    rows={poolRows}
                    draft={draft}
                    savingKey={savingKey}
                    canWrite={canWrite}
                    onChange={setDraftValue}
                    onSave={savePool}
                />
            )}

            {toast && (
                <div
                    role="status"
                    className={`fixed inset-x-0 bottom-10 z-50 mx-auto w-fit max-w-[90%] rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${
                        toast.kind === 'ok' ? 'bg-green-600' : 'bg-red-600'
                    }`}
                >
                    {toast.text}
                </div>
            )}
        </div>
    );
}

function VariantTable({
    rows,
    draft,
    savingKey,
    canWrite,
    onChange,
    onSave,
}: {
    rows: VariantStockRow[];
    draft: Map<string, string>;
    savingKey: string | null;
    canWrite: boolean;
    onChange: (key: string, value: string) => void;
    onSave: (row: VariantStockRow) => void;
}) {
    if (!rows.length) return <Empty text="No variant-wise products match." />;
    return (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
                <thead className="bg-zinc-900 text-zinc-400">
                    <tr>
                        <Th>Item</Th>
                        <Th>SKU</Th>
                        <Th>Unit</Th>
                        <Th right>Available</Th>
                        <Th>On hand</Th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const key = `v:${r.variantId}`;
                        const seeded = String(fromBase(r.stockOnHand, r.stockUnit));
                        const value = draft.has(key) ? draft.get(key)! : seeded;
                        const dirty = draft.has(key) && value !== seeded;
                        const step = (STOCK_UNITS[r.stockUnit]?.decimals ?? 0) > 0 ? '0.001' : '1';
                        return (
                            <tr key={key} className="border-t border-zinc-800">
                                <Td className="font-medium text-zinc-100">{r.name}</Td>
                                <Td className="text-zinc-500">{r.sku}</Td>
                                <Td><span className="rounded bg-zinc-800 px-2 py-0.5 text-xs">{STOCK_UNITS[r.stockUnit]?.label ?? r.stockUnit}</span></Td>
                                <Td right className="tabular-nums text-zinc-300">
                                    {fromBase(r.stockOnHand - r.stockAllocated, r.stockUnit)} Stock
                                </Td>
                                <Td>
                                    <RowEditor
                                        value={value}
                                        step={step}
                                        dirty={dirty}
                                        saving={savingKey === key}
                                        canWrite={canWrite}
                                        onChange={(v) => onChange(key, v)}
                                        onSave={() => onSave(r)}
                                    />
                                </Td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function PoolTable({
    rows,
    draft,
    savingKey,
    canWrite,
    onChange,
    onSave,
}: {
    rows: ProductPoolStockRow[];
    draft: Map<string, string>;
    savingKey: string | null;
    canWrite: boolean;
    onChange: (key: string, value: string) => void;
    onSave: (row: ProductPoolStockRow) => void;
}) {
    if (!rows.length) return <Empty text="No weight-pool products match." />;
    return (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
                <thead className="bg-zinc-900 text-zinc-400">
                    <tr>
                        <Th>Product</Th>
                        <Th right>Allocated</Th>
                        <Th right>Remaining</Th>
                        <Th>Pool on hand (kg)</Th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const key = `p:${r.productId}`;
                        const seeded = r.hasPoolHere && r.stockOnHand != null ? String(toKg(r.stockOnHand)) : '';
                        const value = draft.has(key) ? draft.get(key)! : seeded;
                        const dirty = draft.has(key) && value !== seeded;
                        return (
                            <tr key={key} className="border-t border-zinc-800">
                                <Td className="font-medium text-zinc-100">{r.name}</Td>
                                <Td right className="tabular-nums text-zinc-300">
                                    {formatMeasured(r.stockAllocated, 'g')}
                                </Td>
                                <Td right className="tabular-nums text-zinc-300">
                                    {r.hasPoolHere ? formatMeasured((r.stockOnHand ?? 0) - r.stockAllocated, 'g') : '—'}
                                </Td>
                                <Td>
                                    <RowEditor
                                        value={value}
                                        step="0.001"
                                        dirty={dirty}
                                        saving={savingKey === key}
                                        placeholder={r.hasPoolHere ? '' : 'No pool here — set to create'}
                                        canWrite={canWrite}
                                        onChange={(v) => onChange(key, v)}
                                        onSave={() => onSave(r)}
                                    />
                                </Td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function RowEditor({
    value,
    step,
    dirty,
    saving,
    canWrite,
    placeholder,
    onChange,
    onSave,
}: {
    value: string;
    step: string;
    dirty: boolean;
    saving: boolean;
    canWrite: boolean;
    placeholder?: string;
    onChange: (v: string) => void;
    onSave: () => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <input
                type="number"
                min="0"
                step={step}
                value={value}
                placeholder={placeholder}
                disabled={saving || !canWrite}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && dirty && canWrite) onSave();
                }}
                className="h-9 w-32 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-indigo-500 disabled:opacity-60"
            />
            {dirty && canWrite && (
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saving}
                    className="flex h-9 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                    {saving ? <Spinner /> : 'Save'}
                </button>
            )}
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
            {children}
        </label>
    );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                active ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
        >
            {label}
        </button>
    );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
    return <th className={`px-3 py-2.5 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function Td({ children, right, className = '' }: { children: ReactNode; right?: boolean; className?: string }) {
    return <td className={`px-3 py-2.5 ${right ? 'text-right' : ''} ${className}`}>{children}</td>;
}

function Empty({ text }: { text: string }) {
    return (
        <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-12 text-center text-sm text-zinc-500">
            {text}
        </div>
    );
}

function errText(e: unknown): string {
    if (e instanceof GraphQLOperationError) return e.message;
    return e instanceof Error ? e.message : 'Save failed. Try again.';
}
