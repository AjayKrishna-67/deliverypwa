'use client';

/**
 * The editing half of the detail screen.
 *
 * Kept apart from the read-only view because the two answer different questions:
 * one shows what the transfer IS, this one changes it. Mixing them would mean every
 * quantity on the page being an input box even when nobody is editing.
 *
 * Edits are allowed at DRAFT, CONFIRMED and DISPATCHED. That is not an oversight —
 * a load is corrected in place, never reversed, so the transfer number on the
 * driver's paper stays the number of the goods in the vehicle.
 *
 * Nothing here saves. It collects what changed into a PendingEdit and hands it up;
 * the detail screen decides what to send, and sends only that.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ProductPicker } from '@/components/goods-transfer/ProductPicker';
import { focusAmount } from '@/lib/goods-transfer-focus';
import {
    TAG_NEW,
    cleanAmount,
    unitLabel,
    unitPlaceholder,
    unitSuffix,
    unitTag,
} from '@/lib/goods-transfer-format';
import type { DestinationProduct, DestinationVariant, TransferLine } from '@/types/goods-transfer';

/** What the person has changed, before anything is sent. */
export interface PendingEdit {
    /** Existing line id → new amount as typed (kg for weighed, pieces otherwise). */
    amounts: Map<string, string>;
    /** Existing line ids the person removed. */
    removed: Set<string>;
    /** Products picked that are not on the transfer yet. */
    added: Array<{
        key: string;
        productId: string;
        productVariantId: string | null;
        productName: string;
        sku: string;
        isPooled: boolean;
        /** The pooled line's unit, copied off the product when it was picked. */
        poolUnit: string | null;
        amount: string;
    }>;
}

export const emptyEdit = (): PendingEdit => ({
    amounts: new Map(),
    removed: new Set(),
    added: [],
});

let addSeq = 1;

/**
 * How a product is recognised as already being on this transfer.
 *
 * By SKU, not by variant id: a line already saved on the transfer carries the SKU
 * it was created with, not the id of the variant behind it. Pooled products have no
 * SKU, so they are matched by name — which is what identifies them anyway, since the
 * whole product is one line.
 */
const takenKey = (sku: string, productName: string) => (sku ? `v${sku}` : `n${productName}`);

const TH = 'px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';
/** The section's primary button, so Add Qty reads as an action and not as disabled. */
const BULK_BUTTON =
    'cursor-pointer rounded-lg border border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] px-4 py-1.5 text-[0.8125rem] font-semibold text-[var(--tone-indigo-soft)] transition-colors hover:bg-[rgba(99,102,241,0.25)]';
const QTY_INPUT =
    'w-24 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-right text-[0.8125rem] tabular-nums text-[var(--foreground)] outline-none focus:border-[var(--input-focus)] disabled:cursor-not-allowed disabled:opacity-50';

export function EditLines({
    lines,
    destinationChannelId,
    channelToken,
    edit,
    onChange,
}: {
    lines: TransferLine[];
    destinationChannelId: string;
    channelToken: string;
    edit: PendingEdit;
    onChange: (next: PendingEdit) => void;
}) {
    // The server refuses the same product twice, so the picker has to know what is
    // already here — including rows added in this session but not yet saved.
    const taken = useMemo(() => {
        const keys = new Set<string>();
        for (const line of lines) {
            if (!edit.removed.has(line.id)) {
                keys.add(takenKey(line.sku, line.productName));
            }
        }
        for (const added of edit.added) {
            keys.add(takenKey(added.sku, added.productName));
        }
        return keys;
    }, [lines, edit]);

    const isTaken = useCallback(
        (product: DestinationProduct, variant?: DestinationVariant) =>
            taken.has(takenKey(variant?.sku ?? '', product.productName)),
        [taken],
    );

    /**
     * The row just added, waiting to exist before the cursor can go into it.
     *
     * Focusing cannot happen in `addProduct` — at that moment the row is state that
     * the parent has not re-rendered yet. The effect below runs once it has.
     */
    const [focusAfterRender, setFocusAfterRender] = useState<string | null>(null);

    useEffect(() => {
        if (!focusAfterRender) {
            return;
        }
        focusAmount(focusAfterRender);
        setFocusAfterRender(null);
    }, [focusAfterRender]);

    const addProduct = useCallback(
        (product: DestinationProduct, variant?: DestinationVariant) => {
            const key = `add-${addSeq++}`;
            // Pick, type, pick, type — without this the person has to find the row
            // they just made, which on a phone means scrolling past every row above it.
            setFocusAfterRender(key);
            onChange({
                ...edit,
                added: [
                    ...edit.added,
                    {
                        key,
                        productId: product.productId,
                        productVariantId: variant ? variant.id : null,
                        productName:
                            variant && variant.name !== product.productName
                                ? `${product.productName} — ${variant.name}`
                                : product.productName,
                        sku: variant?.sku ?? '',
                        isPooled: product.isPooled,
                        poolUnit: variant ? null : product.poolUnit,
                        amount: '',
                    },
                ],
            });
        },
        [edit, onChange],
    );

    /**
     * Picking something already here points at the row that exists, rather than
     * adding a second one the server would refuse.
     *
     * The row may be a saved line or one added in this session, and the two are keyed
     * differently — line id against `add-n` — so both are looked at. Whichever is
     * found is the box the cursor belongs in.
     */
    const onDuplicate = useCallback(
        (product: DestinationProduct, variant?: DestinationVariant) => {
            toast.warning(`${product.productName} is already on this transfer`, {
                description: 'Its quantity box is ready below — type the new amount.',
            });
            const key = takenKey(variant?.sku ?? '', product.productName);
            const saved = lines.find(
                (l) => !edit.removed.has(l.id) && takenKey(l.sku, l.productName) === key,
            );
            const justAdded = edit.added.find((a) => takenKey(a.sku, a.productName) === key);
            const target = saved?.id ?? justAdded?.key;
            if (target) {
                focusAmount(target);
            }
        },
        [lines, edit],
    );

    function setAmount(lineId: string, value: string, poolUnit: string | null) {
        const amounts = new Map(edit.amounts);
        // Measured lines may be fractional; counted ones cannot be half a thing. The
        // UNIT decides that, not the pool flag — a pooled product can be counted.
        amounts.set(lineId, cleanAmount(value, poolUnit));
        onChange({ ...edit, amounts });
    }

    function toggleRemoved(lineId: string) {
        const removed = new Set(edit.removed);
        if (removed.has(lineId)) {
            removed.delete(lineId);
        } else {
            removed.add(lineId);
        }
        onChange({ ...edit, removed });
    }

    function setAddedAmount(key: string, value: string, poolUnit: string | null) {
        onChange({
            ...edit,
            added: edit.added.map((a) =>
                a.key === key ? { ...a, amount: cleanAmount(value, poolUnit) } : a,
            ),
        });
    }

    function dropAdded(key: string) {
        onChange({ ...edit, added: edit.added.filter((a) => a.key !== key) });
    }

    const currentAmount = (line: TransferLine) =>
        edit.amounts.get(line.id) ??
        // poolQty, not weightKg: the line is read back in its own unit, and weightKg
        // is null on anything that is not actually weighed.
        String(line.isPooled ? (line.poolQty ?? 0) : (line.quantityPcs ?? 0));

    /**
     * Raise every quantity on the transfer by the same amount, in one go.
     *
     * Fifty lines that all need the same top-up is fifty taps and fifty chances to
     * mistype one of them. This types the number once and leaves it in the same
     * quantity boxes, still editable — it is a shortcut for filling them in, not a
     * separate kind of edit, so nothing is saved until Save is pressed and a line that
     * needed a different figure can still be corrected by hand afterwards.
     *
     * Applies to rows added in this session too: they are lines of this transfer as
     * much as the saved ones, and skipping them would be a rule nobody could guess.
     * Removed rows are left alone — they are on their way out.
     */
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkValue, setBulkValue] = useState('');

    function applyBulkAdd() {
        const delta = Number(bulkValue);
        if (!bulkValue.trim() || !Number.isFinite(delta) || delta === 0) {
            toast.warning('Type how much to add to every line');
            return;
        }
        // Pieces cannot be fractional and nothing can go below zero; a subtraction that
        // would take a line negative stops at zero rather than saving a nonsense figure.
        const bump = (base: string, pooled: boolean) => {
            const next = (Number(base) || 0) + delta;
            if (next <= 0) return '0';
            return pooled ? String(Math.round(next * 1000) / 1000) : String(Math.round(next));
        };

        const amounts = new Map(edit.amounts);
        let touched = 0;
        for (const line of lines) {
            if (edit.removed.has(line.id)) continue;
            amounts.set(line.id, bump(currentAmount(line), line.isPooled));
            touched += 1;
        }
        const added = edit.added.map((a) => {
            touched += 1;
            return { ...a, amount: bump(a.amount, a.isPooled) };
        });

        if (touched === 0) {
            toast.warning('There are no lines to add to');
            return;
        }
        onChange({ ...edit, amounts, added });
        setBulkValue('');
        setBulkOpen(false);
        toast.success(
            `${delta > 0 ? '+' : ''}${delta} applied to ${touched} line${touched === 1 ? '' : 's'}`,
            { description: 'Nothing is saved yet — check the amounts, then Save.' },
        );
    }

    return (
        <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                {bulkOpen ? (
                    <>
                        <input
                            autoFocus
                            inputMode="numeric"
                            value={bulkValue}
                            onChange={(e) => setBulkValue(e.target.value.replace(/[^\d.-]/g, ''))}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    applyBulkAdd();
                                }
                                if (e.key === 'Escape') {
                                    setBulkOpen(false);
                                    setBulkValue('');
                                }
                            }}
                            placeholder="e.g. 5"
                            aria-label="Amount to add to every line"
                            className={QTY_INPUT}
                        />
                        <button
                            type="button"
                            onClick={applyBulkAdd}
                            className={BULK_BUTTON}
                        >
                            Add
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setBulkOpen(false);
                                setBulkValue('');
                            }}
                            className="text-[0.8125rem] text-[var(--text-muted)] underline underline-offset-2"
                        >
                            Cancel
                        </button>
                        <span className="text-[0.75rem] text-[var(--text-muted)]">
                            Added to every line below
                        </span>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={() => setBulkOpen(true)}
                        className={BULK_BUTTON}
                    >
                        Add Qty
                    </button>
                )}
            </div>

            <ProductPicker
                destinationChannelId={destinationChannelId}
                channelToken={channelToken}
                label="Add another product"
                isTaken={isTaken}
                onPick={addProduct}
                onDuplicate={onDuplicate}
            />

            <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
                {/*
                  ── Phone: one card per line ──

                  Same reasoning as the new-transfer screen. The table wants 40rem and
                  a phone has about 23, which put the quantity box — the fifth column,
                  and the only thing anyone types into — permanently off-screen.

                  A removed line keeps its card and turns grey rather than vanishing,
                  because nothing is deleted until the save and "undo" has to stay
                  somewhere the thumb can reach it.
                */}
                <ul className="md:hidden">
                    {lines.map((line, index) => {
                        const gone = edit.removed.has(line.id);
                        return (
                            <li
                                key={line.id}
                                className={`border-b border-[var(--card-border)] p-3 last:border-b-0 ${
                                    gone ? 'opacity-50' : ''
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p
                                            className={`text-[0.875rem] font-medium text-[var(--foreground)] ${
                                                gone ? 'line-through' : ''
                                            }`}
                                        >
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
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        aria-label={
                                            gone ? `Keep ${line.productName}` : `Remove ${line.productName}`
                                        }
                                        onClick={() => toggleRemoved(line.id)}
                                        className="flex h-10 min-w-[2.5rem] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-2 text-[0.75rem] leading-none text-[var(--text-muted)] transition-colors active:bg-overlay/[0.12]"
                                    >
                                        {gone ? 'undo' : '×'}
                                    </button>
                                </div>
                                <div className="mt-2.5 flex items-center gap-2">
                                    <input
                                        data-amount-for={line.id}
                                        value={currentAmount(line)}
                                        inputMode="decimal"
                                        disabled={gone}
                                        onChange={(e) => setAmount(line.id, e.target.value, line.poolUnit)}
                                        className="min-h-[2.75rem] flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-right text-[1rem] tabular-nums text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                    <span className="w-9 text-[0.8125rem] text-[var(--text-muted)]">
                                        {unitSuffix(line.poolUnit)}
                                    </span>
                                </div>
                            </li>
                        );
                    })}

                    {edit.added.map((added, index) => (
                        <li
                            key={added.key}
                            className="border-b border-[var(--card-border)] bg-[rgba(34,197,94,0.04)] p-3 last:border-b-0"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-[0.875rem] font-medium text-[var(--foreground)]">
                                        <span className="mr-1.5 tabular-nums text-[var(--text-muted)]">
                                            {lines.length + index + 1}.
                                        </span>
                                        {added.productName}
                                        <span className={`${TAG_NEW} ml-2`}>new</span>
                                    </p>
                                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] text-[var(--text-muted)]">
                                        <span className="font-mono">{added.sku || '—'}</span>
                                        <span className={unitTag(added.poolUnit)}>
                                            {unitLabel(added.poolUnit)}
                                        </span>
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    aria-label={`Remove ${added.productName}`}
                                    onClick={() => dropAdded(added.key)}
                                    className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] text-[1.125rem] leading-none text-[var(--text-muted)] transition-colors active:bg-[rgba(239,68,68,0.12)] active:text-[var(--tone-red)]"
                                >
                                    ×
                                </button>
                            </div>
                            <div className="mt-2.5 flex items-center gap-2">
                                <input
                                    data-amount-for={added.key}
                                    value={added.amount}
                                    inputMode="decimal"
                                    placeholder={unitPlaceholder(added.poolUnit)}
                                    onChange={(e) =>
                                        setAddedAmount(added.key, e.target.value, added.poolUnit)
                                    }
                                    className={`min-h-[2.75rem] flex-1 rounded-lg border bg-[var(--input-bg)] px-3 text-right text-[1rem] tabular-nums text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)] ${
                                        // A new line with no amount is what stops the
                                        // save, so it is marked where the eye already is.
                                        Number(added.amount) > 0
                                            ? 'border-[var(--input-border)]'
                                            : 'border-[rgba(251,191,36,0.5)]'
                                    }`}
                                />
                                <span className="w-9 text-[0.8125rem] text-[var(--text-muted)]">
                                    {unitSuffix(added.poolUnit)}
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
                            {lines.map((line, index) => {
                                const gone = edit.removed.has(line.id);
                                return (
                                    <tr
                                        key={line.id}
                                        className={`border-b border-[var(--card-border)] last:border-b-0 ${
                                            gone ? 'opacity-40 line-through' : ''
                                        }`}
                                    >
                                        <td className="px-4 py-2.5 tabular-nums text-[var(--text-muted)]">
                                            {index + 1}
                                        </td>
                                        <td className="px-4 py-2.5 text-[var(--foreground)]">
                                            {line.productName}
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
                                                    data-amount-for={line.id}
                                                    value={currentAmount(line)}
                                                    inputMode="decimal"
                                                    disabled={gone}
                                                    className={QTY_INPUT}
                                                    onChange={(e) =>
                                                        setAmount(line.id, e.target.value, line.poolUnit)
                                                    }
                                                />
                                                <span className="w-8 text-[0.75rem] text-[var(--text-muted)]">
                                                    {unitSuffix(line.poolUnit)}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <button
                                                type="button"
                                                title={gone ? 'Keep this line' : 'Remove this line'}
                                                onClick={() => toggleRemoved(line.id)}
                                                className="cursor-pointer rounded-md border border-[var(--card-border)] bg-overlay/[0.06] px-2 py-1 text-[0.75rem] leading-none text-[var(--text-muted)] transition-colors hover:bg-overlay/[0.1] hover:text-[var(--foreground)]"
                                            >
                                                {gone ? 'undo' : '×'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}

                            {edit.added.map((added, index) => (
                                <tr
                                    key={added.key}
                                    className="border-b border-[var(--card-border)] bg-[rgba(34,197,94,0.04)] last:border-b-0"
                                >
                                    <td className="px-4 py-2.5 tabular-nums text-[var(--text-muted)]">
                                        {lines.length + index + 1}
                                    </td>
                                    <td className="px-4 py-2.5 text-[var(--foreground)]">
                                        {added.productName}
                                        <span className={`${TAG_NEW} ml-2`}>new</span>
                                    </td>
                                    <td className="px-4 py-2.5 font-mono text-[0.75rem] text-[var(--text-muted)]">
                                        {added.sku || '—'}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <span className={unitTag(added.poolUnit)}>
                                            {unitLabel(added.poolUnit)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center justify-end gap-1.5">
                                            <input
                                                data-amount-for={added.key}
                                                value={added.amount}
                                                inputMode="decimal"
                                                placeholder={unitPlaceholder(added.poolUnit)}
                                                className={QTY_INPUT}
                                                onChange={(e) =>
                                                    setAddedAmount(added.key, e.target.value, added.poolUnit)
                                                }
                                            />
                                            <span className="w-8 text-[0.75rem] text-[var(--text-muted)]">
                                                {unitSuffix(added.poolUnit)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <button
                                            type="button"
                                            aria-label={`Remove ${added.productName}`}
                                            onClick={() => dropAdded(added.key)}
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
            </div>
        </>
    );
}
