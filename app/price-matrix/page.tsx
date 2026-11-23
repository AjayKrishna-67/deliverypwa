'use client';

/**
 * Price Matrix — bulk-edit product prices across delivery channels by tag.
 *
 * Search a tag (e.g. "onion") -> grid of every matching variant x channel.
 * Edit cells, save only what changed. All API calls go to the DEFAULT channel
 * (tags + catalog live there); the matrix returns all channels as columns.
 *
 *   draft     — only the cells the operator edited (persists across pages)
 *   baseline  — original rupee value of every cell loaded so far (accumulates)
 *   dirty     — draft[key] !== baseline[key]  (survives pagination)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useAuth } from '@/providers/AuthProvider';
import { hasPermission } from '@/lib/is-superadmin';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { Spinner } from '@/components/ui/Spinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SearchIcon } from '@/components/icons';
import { PriceMatrixGrid } from '@/components/price-matrix/PriceMatrixGrid';
import {
    fetchTagSuggestions,
    fetchVariantPriceMatrix,
    saveVariantChannelPrices,
    type TagSuggestion,
    type VariantPriceMatrix,
    type PriceUpdate,
} from '@/services/price-matrix.service';
import { GraphQLOperationError } from '@/graphql/client';
import { cellKey, paiseToRupeeString, parseRupeeInput } from '@/lib/price';

const PAGE_SIZE = 25;
const DEFAULT_CHANNEL_CODE = '__default_channel__';

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
    return (
        <span className="flex items-baseline gap-1.5">
            <span
                className={`text-lg font-bold tabular-nums ${highlight ? 'text-amber-400' : 'text-zinc-100'}`}
            >
                {value}
            </span>
            <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
        </span>
    );
}

export default function PriceMatrixPage() {
    const { isLoading: authLoading, isAuthenticated } = useRequireAuth();
    const { currentUser } = useAuth();
    const router = useRouter();
    const allowed = hasPermission(currentUser, 'UpdateCatalog');
    useEffect(() => {
        if (!authLoading && isAuthenticated && currentUser && !allowed) {
            router.replace('/');
        }
    }, [authLoading, isAuthenticated, currentUser, allowed, router]);
    if (authLoading) return <LoadingScreen />;
    if (!isAuthenticated) return null;
    if (!allowed) return null;
    return (
        <DashboardLayout>
            {() => <PriceMatrixContent />}
        </DashboardLayout>
    );
}

function PriceMatrixContent() {
    // ── Tag search ────────────────────────────────────────────────────
    const [searchInput, setSearchInput] = useState('');
    const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
    const [selectedTag, setSelectedTag] = useState<TagSuggestion | null>(null);
    const [searchError, setSearchError] = useState('');
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);

    // ── Matrix + pagination ───────────────────────────────────────────
    const [matrix, setMatrix] = useState<VariantPriceMatrix | null>(null);
    const [page, setPage] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // ── Edit state (persists across pages) ────────────────────────────
    const baselineRef = useRef<Map<string, string>>(new Map());
    const [draft, setDraft] = useState<Map<string, string>>(new Map());
    const [isSaving, setIsSaving] = useState(false);
    const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [rejectedKey, setRejectedKey] = useState<string | null>(null);

    // ── Debounced suggestions ─────────────────────────────────────────
    useEffect(() => {
        if (searchInput.trim() === '') {
            setSuggestions([]);
            setSearchError('');
            setSearched(false);
            return;
        }
        // Don't re-search the value we just selected.
        if (selectedTag && searchInput.trim() === selectedTag.value) {
            return;
        }
        const t = setTimeout(() => {
            setSearching(true);
            setSearchError('');
            fetchTagSuggestions(searchInput.trim())
                .then((tags) => {
                    setSuggestions(tags);
                    setSearched(true);
                })
                .catch((e) => {
                    setSuggestions([]);
                    setSearchError(e instanceof Error ? e.message : 'Tag search failed');
                })
                .finally(() => setSearching(false));
        }, 300);
        return () => clearTimeout(t);
    }, [searchInput, selectedTag]);

    // ── Load matrix on (tag, page) ────────────────────────────────────
    const loadMatrix = useCallback(async (tagId: string, pageIndex: number) => {
        setIsLoading(true);
        setError('');
        try {
            const result = await fetchVariantPriceMatrix({
                tagIds: [tagId],
                matchMode: 'OR',
                skip: pageIndex * PAGE_SIZE,
                take: PAGE_SIZE,
            });
            // Accumulate baseline for every cell loaded (so dirty survives paging).
            for (const row of result.rows) {
                for (const cell of row.cells) {
                    if (!cell.assigned) continue;
                    const key = cellKey(row.variantId, cell.channelId);
                    if (!baselineRef.current.has(key)) {
                        baselineRef.current.set(key, paiseToRupeeString(cell.price));
                    }
                }
            }
            setMatrix(result);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load prices');
            setMatrix(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (selectedTag) {
            loadMatrix(selectedTag.id, page);
        }
    }, [selectedTag, page, loadMatrix]);

    function selectTag(tag: TagSuggestion) {
        setSelectedTag(tag);
        setSuggestions([]);
        setSearchInput(tag.value);
        setSearched(false);
        setSearchError('');
        setPage(0);
        baselineRef.current = new Map();
        setDraft(new Map());
        setRejectedKey(null);
    }

    // Only show the suggestion dropdown / "no match" banner while actively
    // searching a term that isn't the already-selected tag.
    const showSuggestionUi =
        searchInput.trim() !== '' &&
        (!selectedTag || searchInput.trim() !== selectedTag.value);

    // ── Cell helpers ──────────────────────────────────────────────────
    const getCellValue = useCallback(
        (variantId: string, channelId: string) => {
            const key = cellKey(variantId, channelId);
            if (draft.has(key)) return draft.get(key)!;
            return baselineRef.current.get(key) ?? '';
        },
        [draft],
    );

    const isDirty = useCallback(
        (variantId: string, channelId: string) => {
            const key = cellKey(variantId, channelId);
            return draft.has(key) && draft.get(key) !== (baselineRef.current.get(key) ?? '');
        },
        [draft],
    );

    const isInvalid = useCallback(
        (variantId: string, channelId: string) => {
            const key = cellKey(variantId, channelId);
            if (!draft.has(key)) return false;
            const value = draft.get(key)!;
            if (value === (baselineRef.current.get(key) ?? '')) return false;
            return !parseRupeeInput(value).ok;
        },
        [draft],
    );

    const onChange = useCallback((variantId: string, channelId: string, value: string) => {
        const key = cellKey(variantId, channelId);
        setRejectedKey(null);
        setDraft((prev) => {
            const next = new Map(prev);
            next.set(key, value);
            return next;
        });
    }, []);

    // ── Changed cells (across all pages) ──────────────────────────────
    const changed = useMemo(() => {
        const out: Array<{ key: string; value: string }> = [];
        for (const [key, value] of draft) {
            if (value !== (baselineRef.current.get(key) ?? '')) {
                out.push({ key, value });
            }
        }
        return out;
    }, [draft]);

    // ── Save (atomic; client-validate first) ──────────────────────────
    async function handleSave() {
        if (!changed.length || isSaving) return;
        // Validate every changed cell before sending — the server save is atomic,
        // so one bad cell would roll back the whole batch.
        const updates: PriceUpdate[] = [];
        for (const { key, value } of changed) {
            const parsed = parseRupeeInput(value);
            if (!parsed.ok) {
                setRejectedKey(key);
                setToast({ kind: 'err', text: `Fix the highlighted price (${parsed.error}).` });
                return;
            }
            const [variantId, channelId] = key.split(':');
            updates.push({ variantId, channelId, price: parsed.paise });
        }
        setIsSaving(true);
        setToast(null);
        try {
            const result = await saveVariantChannelPrices(updates);
            // Commit saved values into baseline, clear them from the draft.
            for (const { key, value } of changed) {
                baselineRef.current.set(key, value);
            }
            setDraft((prev) => {
                const next = new Map(prev);
                for (const { key } of changed) next.delete(key);
                return next;
            });
            setToast({ kind: 'ok', text: `${result.updatedCount} prices updated, live now.` });
        } catch (e) {
            const text =
                e instanceof GraphQLOperationError
                    ? e.message
                    : 'Save failed — no prices changed. Try again.';
            setToast({ kind: 'err', text });
        } finally {
            setIsSaving(false);
        }
    }

    // Auto-dismiss toast.
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    const dirtyCount = changed.length;
    const totalPages = matrix ? Math.max(1, Math.ceil(matrix.totalItems / PAGE_SIZE)) : 1;

    // Column visibility: hide the master/default channel, and hide any channel
    // no variant on this page is sold in (no all-"not sold" columns).
    const displayMatrix = useMemo(() => {
        if (!matrix) return null;
        const used = new Set<string>();
        for (const row of matrix.rows) {
            for (const cell of row.cells) {
                if (cell.assigned) used.add(`${cell.channelId}`);
            }
        }
        const visibleIds = new Set(
            matrix.channels
                .filter((c) => c.code !== DEFAULT_CHANNEL_CODE && used.has(`${c.id}`))
                .map((c) => `${c.id}`),
        );
        const channels = matrix.channels.filter((c) => visibleIds.has(`${c.id}`));
        const rows = matrix.rows.map((r) => ({
            ...r,
            cells: r.cells.filter((c) => visibleIds.has(`${c.channelId}`)),
        }));
        return { ...matrix, channels, rows };
    }, [matrix]);

    return (
        <div className="min-h-full w-full bg-zinc-950 px-4 pb-28 pt-5 text-zinc-100 sm:px-6">
            <h1 className="mb-4 text-lg font-semibold text-zinc-100">Price update</h1>

            {/* Tag search */}
            <div className="relative mb-4 max-w-2xl">
                <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 focus-within:border-indigo-500">
                    <SearchIcon className="h-5 w-5 text-zinc-500" />
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search a tag, e.g. onion"
                        className="w-full bg-transparent text-base text-zinc-100 outline-none placeholder:text-zinc-500"
                        aria-label="Search a product tag"
                    />
                </div>
                {showSuggestionUi && searchError && (
                    <div className="absolute z-30 mt-1 w-full rounded-xl border border-red-900 bg-red-950/80 px-3 py-2.5 text-sm text-red-300">
                        {searchError}
                    </div>
                )}
                {showSuggestionUi && !searchError && !searching && searched && suggestions.length === 0 && (
                    <div className="absolute z-30 mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-400">
                        No tags match that search.
                    </div>
                )}
                {showSuggestionUi && suggestions.length > 0 && (
                    <ul className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl shadow-black/40">
                        {suggestions.map((tag) => (
                            <li key={tag.id}>
                                <button
                                    type="button"
                                    onClick={() => selectTag(tag)}
                                    className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-zinc-800"
                                >
                                    <span className="font-medium text-zinc-100">{tag.value}</span>
                                    <span className="text-xs text-zinc-500">
                                        {tag.variantCount} variants
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {selectedTag && matrix && matrix.rows.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 px-3 py-1 text-sm font-semibold text-indigo-300">
                        # {selectedTag.value}
                    </span>
                    <Stat label="variants" value={matrix.totalItems} />
                    <Stat label="channels" value={displayMatrix?.channels.length ?? 0} />
                    <Stat label="unsaved" value={dirtyCount} highlight={dirtyCount > 0} />
                    <button
                        type="button"
                        onClick={() => {
                            setSelectedTag(null);
                            setMatrix(null);
                            setSearchInput('');
                            setDraft(new Map());
                            baselineRef.current = new Map();
                        }}
                        className="ml-auto text-sm text-zinc-500 hover:text-zinc-200"
                    >
                        Clear
                    </button>
                </div>
            )}

            {/* States */}
            {isLoading && (
                <div className="flex items-center justify-center py-16 text-zinc-500">
                    <Spinner /> <span className="ml-2">Loading prices…</span>
                </div>
            )}
            {!isLoading && error && (
                <div className="rounded-xl border border-red-900 bg-red-950/80 px-4 py-3 text-sm text-red-300">
                    {error}
                </div>
            )}
            {!isLoading && !error && selectedTag && matrix && matrix.rows.length === 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-10 text-center text-zinc-400">
                    No variants for <b>#{selectedTag.value}</b>. Check the tag is applied to some
                    products.
                </div>
            )}
            {!isLoading && !selectedTag && (
                <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-zinc-500">
                    Search a tag to load its product prices across channels.
                </div>
            )}

            {/* Grid */}
            {!isLoading && !error && displayMatrix && displayMatrix.rows.length > 0 && (
                <>
                    <PriceMatrixGrid
                        matrix={displayMatrix}
                        getCellValue={getCellValue}
                        isDirty={isDirty}
                        isInvalid={isInvalid}
                        onChange={onChange}
                        rejectedKey={rejectedKey}
                    />

                    {dirtyCount > 0 && (
                        <div className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs font-medium text-amber-300">
                            ⚠ {dirtyCount} unsaved edit{dirtyCount === 1 ? '' : 's'} kept across pages.
                            Save before you leave.
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="mt-3 flex items-center justify-center gap-4 text-sm text-zinc-400">
                            <button
                                type="button"
                                disabled={page === 0}
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                                className="disabled:opacity-40"
                            >
                                ‹ Prev
                            </button>
                            <span className="font-medium text-zinc-100">
                                Page {page + 1} / {totalPages}
                            </span>
                            <button
                                type="button"
                                disabled={page + 1 >= totalPages}
                                onClick={() => setPage((p) => p + 1)}
                                className="disabled:opacity-40"
                            >
                                Next ›
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* Sticky save bar */}
            {dirtyCount > 0 && (
                <div className="sticky bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:px-6">
                    <div className="w-full">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
                        >
                            {isSaving ? <Spinner /> : null}
                            {isSaving ? 'Saving…' : `Save ${dirtyCount} changed price${dirtyCount === 1 ? '' : 's'}`}
                        </button>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div
                    role="status"
                    className={`fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[90%] rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${
                        toast.kind === 'ok' ? 'bg-green-600' : 'bg-red-600'
                    }`}
                >
                    {toast.text}
                </div>
            )}
        </div>
    );
}
