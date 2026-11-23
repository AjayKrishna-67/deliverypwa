'use client';

/**
 * The product search used when building a transfer and when editing one.
 *
 * It shows the DESTINATION branch's catalogue, never this branch's — a line can
 * only name a product the receiving branch carries. Typing narrows as it is typed
 * and each pick becomes one row: the pattern from any cart, and the one the person
 * entering already knows.
 *
 * The two screens that use this had a copy each in the app this was ported from,
 * differing only in how they decide a product is already on the transfer. That one
 * difference is a callback here (`isTaken`), so the search, the debounce, the
 * dropdown and the outside-click handling exist once.
 *
 * Disabled products are returned by the server and stay selectable on purpose: this
 * picker is admin-only, and a product being off sale is no reason it cannot be moved
 * between branches. Stock posts for them exactly as for anything else. They are
 * labelled so whoever is sending knows the destination cannot sell them on.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { TAG_OFF, TAG_PCS, unitLabel, unitTag } from '@/lib/goods-transfer-format';
import { searchTransferProducts } from '@/services/goods-transfer.service';
import type { DestinationProduct, DestinationVariant } from '@/types/goods-transfer';

const SEARCH_DEBOUNCE_MS = 250;

/** Matches the server's own picker cap, so the count on screen is not a surprise. */
const PICKER_LIMIT = 25;

/**
 * One selectable row in the dropdown.
 *
 * Written out rather than inferred: a weighed product produces an entry with no
 * variant and a counted one produces several with a variant each, and TypeScript
 * reads those two branches as unrelated array types unless told they are the same
 * shape.
 */
interface PickerEntry {
    key: string;
    product: DestinationProduct;
    /** Absent for weighed products, which are chosen at product level. */
    variant?: DestinationVariant;
    /** Exactly what the row reads on screen — what the arrow keys walk. */
    name: string;
}

interface ProductPickerProps {
    /** Null until a branch is chosen; the picker stays disabled until then. */
    destinationChannelId: string | null;
    /**
     * The search box's id, so Enter in a quantity box can come back to THIS picker.
     *
     * Defaulted, because a screen with one picker has nothing to distinguish. The
     * new-transfer screen shows one per branch and must give each its own — duplicate
     * ids would put every Enter back in the first branch's box.
     */
    searchId?: string;
    channelToken: string;
    label: string;
    /** Shown in place of the label while no branch is chosen. */
    lockedLabel?: string;
    /**
     * Whether this product (or variant) is already on the transfer. The two callers
     * answer this differently: one has variant ids to compare, the other only the
     * SKUs carried by saved lines.
     */
    isTaken: (product: DestinationProduct, variant?: DestinationVariant) => boolean;
    onPick: (product: DestinationProduct, variant?: DestinationVariant) => void;
    /** Called instead of onPick when isTaken says so — the caller decides the wording. */
    onDuplicate: (product: DestinationProduct, variant?: DestinationVariant) => void;
}

export function ProductPicker({
    destinationChannelId,
    searchId = 'gt-product-search',
    channelToken,
    label,
    lockedLabel,
    isTaken,
    onPick,
    onDuplicate,
}: ProductPickerProps) {
    const [search, setSearch] = useState('');
    const [term, setTerm] = useState('');
    const [results, setResults] = useState<DestinationProduct[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const boxRef = useRef<HTMLDivElement | null>(null);

    /**
     * The branch and search term the results on screen were fetched for.
     *
     * `open` has to be an input to the search — there is no reason to fetch for a
     * dropdown nobody has opened — but it also flips every time the box is touched,
     * and picking a product closes it. Without this, the ordinary rhythm of adding
     * items (pick, type a quantity, click back into the search) asked the server the
     * same question again on every return. Results are kept while the picker is
     * closed, so reopening shows them at once and costs nothing.
     */
    const answered = useRef<string | null>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => setTerm(search.trim()), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        const channelId = destinationChannelId;
        if (!open || !channelId) {
            return;
        }

        // Same branch, same term — the answer is already on screen.
        const question = `${channelId}|${term}`;
        if (answered.current === question) {
            return;
        }

        let cancelled = false;

        // The work sits in a function rather than in the effect body so the "now
        // searching" state is not set synchronously as the effect runs — the same
        // shape services/location-stock.service.ts's callers use, and what this
        // project's lint asks for.
        // `channelId` is passed rather than closed over: a hoisted function
        // declaration can be called before the guard above runs, so TypeScript
        // will not carry the narrowing into it.
        async function run(branchId: string) {
            setIsSearching(true);
            setError(null);
            try {
                const found = await searchTransferProducts(branchId, term, channelToken);
                if (!cancelled) {
                    setResults(found);
                    // Only after it worked: a failed search should be retried on the
                    // next open, not remembered as answered.
                    answered.current = question;
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Product search failed');
                }
            } finally {
                if (!cancelled) {
                    setIsSearching(false);
                }
            }
        }

        void run(channelId);

        return () => {
            cancelled = true;
        };
    }, [open, destinationChannelId, term, channelToken]);

    // Clicking anywhere else closes the suggestions, which is what a dropdown is
    // expected to do and what stops it covering the rows underneath.
    useEffect(() => {
        function onDocumentClick(event: MouseEvent) {
            if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', onDocumentClick);
        return () => document.removeEventListener('mousedown', onDocumentClick);
    }, []);

    /**
     * The suggestions as ONE flat list, in the order they appear on screen.
     *
     * The rows are not one-per-result: a weighed product is a single row, while a
     * counted one contributes a row per variant. The arrow keys have to walk what the
     * eye walks, so the list is flattened once here and both the rendering and the
     * keyboard read from it. Deriving the two separately is how the highlight and the
     * thing Enter picks drift apart.
     */
    const entries = useMemo<PickerEntry[]>(
        () =>
            // Annotated on the callback, not just the memo: without it TypeScript
            // settles the ternary's two branches into unrelated array types before the
            // outer annotation is ever considered.
            results.flatMap((product): PickerEntry[] =>
                product.isPooled
                    ? [{ key: `p${product.productId}`, product, variant: undefined, name: product.productName }]
                    : product.variants.map((variant) => ({
                          key: variant.id,
                          product,
                          variant,
                          name:
                              variant.name && variant.name !== product.productName
                                  ? `${product.productName} — ${variant.name}`
                                  : product.productName,
                      })),
            ),
        [results],
    );

    /** Which row the arrows are on. -1 means none — Enter then does nothing. */
    const [activeIndex, setActiveIndex] = useState(-1);

    // Back to the top whenever the list changes underneath. Without this, typing one
    // more letter leaves the highlight on row 7 of a list that now has two rows.
    useEffect(() => {
        setActiveIndex(entries.length ? 0 : -1);
    }, [entries]);

    /**
     * Arrows walk the list, Enter takes the highlighted one.
     *
     * Typed in the SEARCH box, not in the list — the cursor never leaves the box, so
     * the person can keep typing to narrow the list and press Enter the moment they
     * see what they want. That is the whole loop: type, arrow, Enter, quantity, Enter,
     * type again.
     */
    function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (!open || !entries.length) {
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % entries.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => (i <= 0 ? entries.length - 1 : i - 1));
        } else if (e.key === 'Enter') {
            const entry = entries[activeIndex];
            if (entry) {
                // Only when something is actually highlighted, so Enter on an empty
                // search does not submit whatever form this sits in.
                e.preventDefault();
                choose(entry.product, entry.variant);
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    }

    function choose(product: DestinationProduct, variant?: DestinationVariant) {
        if (isTaken(product, variant)) {
            onDuplicate(product, variant);
            setOpen(false);
            setSearch('');
            return;
        }
        onPick(product, variant);
        setSearch('');
        setOpen(false);
        setError(null);
    }

    const locked = !destinationChannelId;

    return (
        <div
            ref={boxRef}
            className="relative mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4"
        >
            <label
                htmlFor="gt-product-search"
                className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
            >
                {locked ? (lockedLabel ?? label) : label}
            </label>
            <div className="relative">
                <input
                    id={searchId}
                    value={search}
                    disabled={locked}
                    placeholder="Start typing a product name or SKU…"
                    autoComplete="off"
                    onKeyDown={onSearchKeyDown}
                    onFocus={() => setOpen(true)}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setOpen(true);
                    }}
                    className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-[0.8125rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                />
                {search && (
                    <button
                        type="button"
                        aria-label="Clear"
                        onClick={() => setSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded px-1.5 text-[1rem] leading-none text-[var(--text-muted)] hover:text-[var(--foreground)]"
                    >
                        ×
                    </button>
                )}
            </div>

            {error && <p className="mt-2 text-[0.75rem] text-[var(--tone-red)]">{error}</p>}

            {open && !locked && (
                <div className="absolute left-4 right-4 top-full z-30 mt-1 max-h-[18rem] overflow-y-auto rounded-xl border border-[var(--card-border)] bg-[var(--surface)] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
                    {isSearching && <Note>Searching…</Note>}
                    {!isSearching && results.length === 0 && (
                        <Note>Nothing matches — try part of the name or SKU.</Note>
                    )}
                    {entries.map((entry, index) => {
                        const { product, variant } = entry;
                        return (
                            <Suggestion
                                key={entry.key}
                                name={entry.name}
                                active={index === activeIndex}
                                onClick={() => choose(product, variant)}
                            >
                                {variant ? (
                                    <>
                                        <span className="font-mono text-[0.6875rem] text-[var(--text-muted)]">
                                            {variant.sku}
                                        </span>
                                        <span className={TAG_PCS}>PCS</span>
                                    </>
                                ) : (
                                    /* The unit, not the storage model. "Pool" is how the
                                       code thinks about it; a branch manager only needs
                                       to know what to count out.

                                       Read off the product, never assumed: a pooled
                                       product is not necessarily a weighed one, and
                                       this said KG for every one of them until it
                                       asked. Amla is pooled and counted in pieces. */
                                    <>
                                        <span className={unitTag(product.poolUnit)}>
                                            {unitLabel(product.poolUnit)}
                                        </span>
                                    </>
                                )}
                                {/*
                                  The PRODUCT counts as much as the variant.

                                  Only the variant was checked, so a product that had
                                  been disabled while its variants stayed enabled looked
                                  perfectly ordinary here — and then posted no stock when
                                  the transfer was received, with nothing on screen having
                                  warned anyone. That is exactly how a live product and a
                                  disabled one sharing a SKU came to be picked by mistake.

                                  TransferStockService refuses on either count, so this
                                  now says what it will do.
                                */}
                                {(!product.enabled || (variant && !variant.enabled)) && (
                                    <span className={TAG_OFF}>disabled</span>
                                )}
                            </Suggestion>
                        );
                    })}
                    {results.length >= PICKER_LIMIT && (
                        <Note>Showing the first {PICKER_LIMIT}. Type more to narrow it down.</Note>
                    )}
                </div>
            )}
        </div>
    );
}

function Note({ children }: { children: React.ReactNode }) {
    return <p className="px-3 py-2 text-[0.75rem] text-[var(--text-muted)]">{children}</p>;
}

function Suggestion({
    name,
    children,
    active,
    onClick,
}: {
    name: string;
    children: React.ReactNode;
    /** Where the arrow keys currently are. */
    active?: boolean;
    onClick: () => void;
}) {
    const ref = useRef<HTMLButtonElement>(null);

    // Keep the highlighted row on screen as the arrows walk past the fold. `nearest`
    // rather than `center`: it moves the list only when it has to, so holding the
    // arrow key does not make the whole list jump about under the eye.
    useEffect(() => {
        if (active) {
            ref.current?.scrollIntoView({ block: 'nearest' });
        }
    }, [active]);

    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-overlay/[0.06] ${
                active ? 'bg-overlay/[0.09]' : ''
            }`}
        >
            <span className="truncate text-[0.8125rem] text-[var(--foreground)]">{name}</span>
            <span className="flex shrink-0 items-center gap-1.5">{children}</span>
        </button>
    );
}
