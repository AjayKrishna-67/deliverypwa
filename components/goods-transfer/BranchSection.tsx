'use client';

/**
 * One branch's section of an entry screen: its own search, its own products, its
 * own quantities.
 *
 * Shared by the two screens that build a load branch by branch — the transfer, where
 * each section searches the RECEIVING branch's catalogue, and the product request,
 * where every section searches the asking branch's own. Which catalogue is the
 * caller's to say (`catalogueChannelId`); the section only knows which branch it
 * belongs to (`branchId`) so that its search box and its quantity boxes can be told
 * apart from the next section's.
 *
 * A SECTION PER BRANCH rather than one list with a column per branch, because on a
 * transfer the branches do not share a catalogue: Kochi holds 339 products and
 * Coimbatore holds 339, and exactly ONE product row belongs to both. There is no such
 * thing as picking a product and sending it to two branches. The request screen could
 * have used a grid — its catalogue is the same for every branch — and briefly did;
 * the two screens now match on purpose, so someone who knows one knows the other.
 */

import type { KeyboardEvent } from 'react';

import { ProductPicker } from '@/components/goods-transfer/ProductPicker';
import { focusSearch } from '@/lib/goods-transfer-focus';
import {
    TAG_OFF,
    cleanAmount,
    unitLabel,
    unitPlaceholder,
    unitSuffix,
    unitTag,
} from '@/lib/goods-transfer-format';
import type { DestinationProduct, DestinationVariant, DraftLine } from '@/types/goods-transfer';

const TH = 'px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';

export function BranchSection({
    branchId,
    catalogueChannelId,
    heading,
    pickerLabel,
    channelToken,
    lines,
    isTaken,
    addLine,
    onDuplicate,
    removeLine,
    setAmount,
    onDropBranch,
    canDrop,
}: {
    /** The branch this section is for — keys its search box and quantity boxes. */
    branchId: string;
    /** Whose products the search offers. The receiving branch's on a transfer; your own on a request. */
    catalogueChannelId: string;
    /** "Ship to Idukki", "Ask Madurai" — the caller says what the section means. */
    heading: string;
    pickerLabel: string;
    channelToken: string;
    lines: DraftLine[];
    isTaken: (product: DestinationProduct, variant?: DestinationVariant) => boolean;
    addLine: (product: DestinationProduct, variant?: DestinationVariant) => void;
    onDuplicate: (product: DestinationProduct, variant?: DestinationVariant) => void;
    removeLine: (key: string) => void;
    setAmount: (key: string, amount: string) => void;
    onDropBranch: () => void;
    canDrop: boolean;
}) {
    const filled = lines.filter((l) => Number(l.amount) > 0);
    /** This branch's own picker, so Enter comes back here and not to the first one. */
    const searchId = `gt-product-search-${branchId}`;

    /**
     * Enter in a quantity box goes back to THIS branch's search box.
     *
     * That closes the loop: search, tap the product, type the amount, Enter, search
     * again — a whole branch entered without the hand leaving the keyboard, or on a
     * phone without hunting for the search field between every product.
     *
     * preventDefault because this screen's inputs sit inside a form on some browsers,
     * where Enter would otherwise submit it.
     */
    const onAmountKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            focusSearch(searchId);
        }
    };

    return (
        <section className="mb-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[0.9375rem] font-semibold text-[var(--foreground)]">
                    {heading}
                    <span className="ml-2 text-[0.75rem] font-normal text-[var(--text-muted)]">
                        {lines.length} item{lines.length === 1 ? '' : 's'}
                    </span>
                </h2>
                {/*
                  A branch can be dropped only while it is empty. Removing one that has
                  products would throw away typed work silently — and the branch tick is
                  a long way from the rows on a phone, so there would be nothing on
                  screen to connect the two.
                */}
                {canDrop && (
                    <button
                        type="button"
                        onClick={onDropBranch}
                        className="cursor-pointer text-[0.75rem] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--tone-red)]"
                    >
                        Remove this branch
                    </button>
                )}
            </div>
            <ProductPicker
                destinationChannelId={catalogueChannelId}
                searchId={searchId}
                channelToken={channelToken}
                label={pickerLabel}
                isTaken={isTaken}
                onPick={addLine}
                onDuplicate={onDuplicate}
            />

            {/* ── Lines ── */}
            {lines.length === 0 ? (
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-10 text-center">
                    <h3 className="mb-1 text-[0.9375rem] font-semibold text-[var(--foreground)]">
                        No items yet
                    </h3>
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        Search above and pick what belongs in this section.
                    </p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
                    {/*
                      ── Phone: one card per product ──

                      The table below needs 40rem to lay out, and a phone has about 23.
                      Everything past the second column therefore sat off-screen — and
                      the quantity box is the FIFTH column, so entering an amount meant
                      dragging the table sideways for every product on the transfer.

                      The card carries the same five facts in reading order instead:
                      what it is, then what identifies it, then how much. The quantity
                      box is full width because it is the only thing on this screen
                      anyone actually types into.
                    */}
                    <ul className="md:hidden">
                        {lines.map((line, index) => (
                            <li
                                key={line.key}
                                className="border-b border-[var(--card-border)] p-3 last:border-b-0"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-[0.875rem] font-medium text-[var(--foreground)]">
                                            <span className="mr-1.5 tabular-nums text-[var(--text-muted)]">
                                                {index + 1}.
                                            </span>
                                            {line.productName}
                                        </p>
                                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] text-[var(--text-muted)]">
                                            <span className="font-mono">{line.sku || '—'}</span>
                                            <span className={unitTag(line.poolUnit)}>
                                                {unitLabel(line.poolUnit)}
                                            </span>
                                            {!line.enabled && (
                                                <span className={TAG_OFF}>disabled · not on sale</span>
                                            )}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        aria-label={`Remove ${line.productName}`}
                                        onClick={() => removeLine(line.key)}
                                        // 2.5rem square: the smallest thing a thumb hits
                                        // reliably, and far enough from the input that
                                        // reaching for one never catches the other.
                                        className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] text-[1.125rem] leading-none text-[var(--text-muted)] transition-colors active:bg-[rgba(239,68,68,0.12)] active:text-[var(--tone-red)]"
                                    >
                                        ×
                                    </button>
                                </div>
                                <div className="mt-2.5 flex items-center gap-2">
                                    <input
                                        data-amount-for={`${branchId}|${line.productVariantId ?? `p${line.productId}`}`}
                                        value={line.amount}
                                        inputMode="decimal"
                                        placeholder={unitPlaceholder(line.poolUnit)}
                                        onKeyDown={onAmountKeyDown}
                                        onChange={(e) =>
                                            setAmount(line.key, cleanAmount(e.target.value, line.poolUnit))
                                        }
                                        className={`min-h-[2.75rem] flex-1 rounded-lg border bg-[var(--input-bg)] px-3 text-right text-[1rem] tabular-nums text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)] ${
                                            // An amount still to be entered is the one
                                            // thing stopping the save, so it says so
                                            // where the eye already is rather than only
                                            // in a count at the bottom.
                                            Number(line.amount) > 0
                                                ? 'border-[var(--input-border)]'
                                                : 'border-[rgba(251,191,36,0.5)]'
                                        }`}
                                    />
                                    <span className="w-9 text-[0.8125rem] text-[var(--text-muted)]">
                                        {unitSuffix(line.poolUnit)}
                                    </span>
                                </div>
                            </li>
                        ))}
                    </ul>

                    {/* ── md and up: the table, unchanged ── */}
                    <div className="hidden overflow-x-auto md:block">
                        <table className="w-full min-w-[40rem] border-collapse text-[0.8125rem]">
                            <thead>
                                <tr className="border-b border-[var(--card-border)]">
                                    <th className={`${TH} w-px`}>#</th>
                                    <th className={TH}>Item</th>
                                    <th className={TH}>SKU</th>
                                    <th className={TH}>Type</th>
                                    <th className={`${TH} text-right`}>Quantity</th>
                                    <th className="w-px px-4 py-2.5" />
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((line, index) => (
                                    <tr
                                        key={line.key}
                                        className="border-b border-[var(--card-border)] last:border-b-0"
                                    >
                                        <td className="px-4 py-2.5 tabular-nums text-[var(--text-muted)]">
                                            {index + 1}
                                        </td>
                                        <td className="px-4 py-2.5 text-[var(--foreground)]">
                                            {line.productName}
                                            {!line.enabled && (
                                                <span className={`${TAG_OFF} ml-2`}>
                                                    disabled · not on sale
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 font-mono text-[0.75rem] text-[var(--text-muted)]">
                                            {line.sku || '—'}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <span className={unitTag(line.poolUnit)}>
                                                {unitLabel(line.poolUnit)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center justify-end gap-1.5">
                                                <input
                                                    data-amount-for={`${branchId}|${
                                                        line.productVariantId ?? `p${line.productId}`
                                                    }`}
                                                    onKeyDown={onAmountKeyDown}
                                                    value={line.amount}
                                                    inputMode="decimal"
                                                    placeholder={unitPlaceholder(line.poolUnit)}
                                                    onChange={(e) =>
                                                        // Measured lines may be fractional;
                                                        // counted ones cannot be half a thing.
                                                        // The unit decides, not the pool flag —
                                                        // a pooled product can be counted.
                                                        setAmount(
                                                            line.key,
                                                            cleanAmount(e.target.value, line.poolUnit),
                                                        )
                                                    }
                                                    className="w-24 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-right text-[0.8125rem] tabular-nums text-[var(--foreground)] outline-none focus:border-[var(--input-focus)]"
                                                />
                                                <span className="w-8 text-[0.75rem] text-[var(--text-muted)]">
                                                    {unitSuffix(line.poolUnit)}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <button
                                                type="button"
                                                aria-label={`Remove ${line.productName}`}
                                                onClick={() => removeLine(line.key)}
                                                className="cursor-pointer rounded-md border border-[var(--card-border)] bg-overlay/[0.06] px-2 py-1 text-[0.875rem] leading-none text-[var(--text-muted)] transition-colors hover:bg-[rgba(239,68,68,0.12)] hover:text-[var(--tone-red)]"
                                            >
                                                ×
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="border-t border-[var(--card-border)] px-4 py-3 text-[0.75rem] text-[var(--text-muted)]">
                        {lines.length} item{lines.length === 1 ? '' : 's'}
                        {filled.length !== lines.length && (
                            <span className="text-[var(--tone-amber)]">
                                {' '}
                                · {lines.length - filled.length} without a quantity
                            </span>
                        )}
                    </div>
                </div>
            )}

        </section>
    );
}
