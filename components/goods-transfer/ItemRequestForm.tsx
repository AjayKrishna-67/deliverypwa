'use client';

/**
 * Asking another branch to send products.
 *
 * The mirror of the new-transfer screen: there you say where goods are going, here you
 * say where they should come FROM. What it raises is an ordinary transfer sitting one
 * state earlier, so the branch being asked edits, confirms and dispatches it through
 * the screens it already uses, and the goods arrive through the same receipt.
 *
 * The two controls answer two different questions, which is worth being plain about:
 * the branch at the top is WHO IS BEING ASKED, and the list below is YOUR OWN
 * catalogue — what can arrive at this branch. It is not the other branch's shelf. A
 * transfer may only carry products the receiving branch stocks, and on this screen the
 * receiver is you.
 *
 * Laid out like the Purchase List, deliberately — branch picker, Apply, Print along one
 * bar, the action on the right. It is the same job done from the other end, the same
 * people do both, and a second arrangement of the same controls is a second thing to
 * learn for nothing.
 *
 * The whole catalogue is listed rather than picked one at a time. A branch restocking
 * asks for thirty things at once and knows them by sight; a search-and-add picker would
 * be thirty searches for a list it can already see. The search box filters what is
 * shown and never clears what is ticked — a tick made under one search survives the
 * next, because the ticks ARE the request and a filter is not an edit.
 *
 * No driver or vehicle here. Those describe a journey the source has not agreed to make
 * yet, and it fills them in when it dispatches.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
    PICKER_BUTTON,
    PICKER_BUTTON_STYLE,
    PICKER_OPTION,
    PICKER_PANEL_STYLE,
    PickerCaret,
    PickerTick,
    printLanguageLabel,
    PrintLanguageSelect,
    useAnchoredPanel,
} from '@/components/goods-transfer/PrintLanguageSelect';
import { TAG_OFF, unitLabel, unitSuffix } from '@/lib/goods-transfer-format';
import {
    printItemRequest,
    type RequestPrintLanguage,
    type RequestPrintLine,
} from '@/lib/goods-transfer-request-print';
import {
    createTransferRequest,
    fetchLocalNames,
    searchTransferProducts,
} from '@/services/goods-transfer.service';
import type {
    DestinationProduct,
    GoodsTransferLineInput,
    TransferChannel,
} from '@/types/goods-transfer';

const DEFAULT_CHANNEL_CODE = '__default_channel__';

/**
 * The branch requests go to unless someone changes it.
 *
 * Matched by code rather than by id: ids differ between this database and any other,
 * and a wrong id here would silently select nothing. A rename would too, which is why
 * an unmatched name leaves the picker empty rather than guessing at a branch.
 */
const MAIN_SOURCE_CODE = 'madurai';

const FIELD_LABEL =
    'mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';
/* 16px on a phone so iOS Safari does not zoom the page in on focus; 13px from md up. */
const FIELD_INPUT =
    'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-[1rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)] disabled:cursor-not-allowed disabled:opacity-50 md:py-2 md:text-[0.8125rem]';
const QTY_INPUT =
    'w-20 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-right text-[0.8125rem] tabular-nums text-[var(--foreground)] outline-none focus:border-[var(--input-focus)] disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON =
    'cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-3 py-1.5 text-[0.8125rem] font-medium text-[var(--foreground)] transition-colors hover:bg-overlay/[0.1] disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SOLID =
    'cursor-pointer rounded-lg border border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] px-4 py-1.5 text-[0.8125rem] font-semibold text-[var(--tone-indigo-soft)] transition-colors hover:bg-[rgba(99,102,241,0.25)] disabled:cursor-not-allowed disabled:opacity-50';
const TH =
    'px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';

/**
 * One requestable row — a variant of a PCS product, or a pooled product whole.
 *
 * Flattened out of the nested product/variant shape because that nesting answers a
 * question this screen never asks. Every line on the request names one thing with one
 * quantity, and a product with four variants is four of those.
 */
interface RequestRow {
    /** Stable across searches, which is what lets a tick outlive a filter. */
    key: string;
    productId: string;
    productVariantId: string | null;
    name: string;
    sku: string;
    isPooled: boolean;
    enabled: boolean;
    /** The catalogue’s own name for this line, when it has one. Beats the master. */
    localName: string | null;
    /** 'kg' | 'litre' | 'piece' for a pooled row; null for a per-variant row. */
    poolUnit: string | null;
}

function flatten(
    products: DestinationProduct[],
    localNames: { byProductId: Map<string, string>; byVariantId: Map<string, string> },
): RequestRow[] {
    const rows: RequestRow[] = [];
    for (const p of products) {
        if (p.isPooled || p.variants.length === 0) {
            rows.push({
                key: `p:${p.productId}`,
                productId: p.productId,
                productVariantId: null,
                name: p.productName,
                sku: '',
                isPooled: true,
                enabled: p.enabled,
                // A pooled line is the product, so the product’s own name is its name.
                localName: localNames.byProductId.get(String(p.productId)) ?? null,
                poolUnit: p.poolUnit,
            });
            continue;
        }
        for (const v of p.variants) {
            rows.push({
                key: `v:${v.id}`,
                productId: p.productId,
                productVariantId: v.id,
                /*
                  The VARIANT's own name, alone.

                  The product name was prepended, which read as "Naranga — Naranga
                  (Large 5nos)" for a catalogue that already names its variants in
                  full — and worse, that joined string is what the print looked up,
                  so it matched no master row and the line came out in English. The
                  variant is what a line carries; the variant name is what names it.
                */
                name: v.name || p.productName,
                sku: v.sku,
                isPooled: false,
                // The variant’s own, falling back to the product’s — a variant left blank
                // is still that product on a shelf.
                localName:
                    localNames.byVariantId.get(String(v.id)) ??
                    localNames.byProductId.get(String(p.productId)) ??
                    null,
                // A disabled PRODUCT is off sale however enabled the variant is, so both
                // are read — the same rule the new-transfer table applies.
                enabled: p.enabled && v.enabled,
                // Per-variant rows are counted in pieces; there is no pool to name.
                poolUnit: null,
            });
        }
    }
    return rows;
}

/**
 * The branch picker, in the shape the Purchase List's channel filter uses.
 *
 * One branch, not several — a request goes to somebody, so there is no Select all and
 * no Clear. A native <select> was tried first and looked like a form field on a screen
 * that is a toolbar; this reads as the same control the reports carry.
 */
function BranchSelect({
    branches,
    selectedId,
    onChange,
    disabled,
}: {
    branches: TransferChannel[];
    selectedId: string;
    onChange: (id: string) => void;
    disabled?: boolean;
}) {
    const { open, setOpen, buttonRef, panelRef, pos } = useAnchoredPanel();
    const selected = branches.find((b) => String(b.id) === String(selectedId));

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                type="button"
                disabled={disabled}
                onClick={() => setOpen((v) => !v)}
                className={PICKER_BUTTON}
                style={PICKER_BUTTON_STYLE}
            >
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                </svg>
                <span className="max-w-[160px] truncate">{selected?.code ?? 'Select a branch'}</span>
                <PickerCaret open={open} />
            </button>

            {open && pos && (
                <div
                    ref={panelRef}
                    className="z-50 overflow-hidden rounded-xl"
                    style={{
                        position: 'fixed',
                        top: pos.top,
                        left: pos.left,
                        minWidth: '220px',
                        ...PICKER_PANEL_STYLE,
                    }}
                >
                    <div className="overflow-y-auto py-1" style={{ maxHeight: '300px' }}>
                        {branches.length === 0 ? (
                            <p className="px-3 py-3 text-[0.75rem] text-[var(--text-muted)]">
                                No other branch to request from.
                            </p>
                        ) : (
                            branches.map((b) => {
                                const on = String(b.id) === String(selectedId);
                                return (
                                    <button
                                        key={b.id}
                                        type="button"
                                        onClick={() => {
                                            onChange(String(b.id));
                                            setOpen(false);
                                        }}
                                        className={PICKER_OPTION}
                                    >
                                        <PickerTick on={on} />
                                        <span
                                            className="truncate text-[0.8125rem] font-medium"
                                            style={{ color: 'var(--foreground)' }}
                                        >
                                            {b.code}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export function ItemRequestForm({
    channelToken,
    channelId,
    channelCode,
    branches: allBranches,
}: {
    channelToken: string;
    channelId: string;
    /** The branch being acted as — decides which local names the print carries. */
    channelCode: string;
    /** Every branch, read once by the section's shell. Filtered below. */
    branches: TransferChannel[];
}) {
    const router = useRouter();

    const branches = useMemo(
        () =>
            allBranches.filter(
                (c) => String(c.id) !== String(channelId) && c.code !== DEFAULT_CHANNEL_CODE,
            ),
        [allBranches, channelId],
    );

    /**
     * The branch being asked. Defaults to the main source branch below, because that is
     * where almost every request goes and making people pick it every time is a step
     * that is right by default. Still changeable — branches do ask each other.
     */
    const [sourceChannelId, setSourceChannelId] = useState('');
    const [remarks, setRemarks] = useState('');

    /** The branch the listed catalogue actually belongs to — set by Apply, not by the picker. */
    const [appliedChannelId, setAppliedChannelId] = useState('');
    const [rows, setRows] = useState<RequestRow[]>([]);
    const [loading, setLoading] = useState(false);

    const [search, setSearch] = useState('');
    /** key → amount as typed. Text, so a half-typed "1." is not rounded mid-keystroke. */
    const [picked, setPicked] = useState<Map<string, string>>(new Map());
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (sourceChannelId) return;
        const main = branches.find((b) => b.code.toLowerCase() === MAIN_SOURCE_CODE);
        if (main) setSourceChannelId(String(main.id));
    }, [branches, sourceChannelId]);

    const applyChannel = useCallback(async () => {
        if (!sourceChannelId) {
            toast.warning('Pick the branch you are requesting from');
            return;
        }
        setLoading(true);
        try {
            /*
              YOUR catalogue, not theirs.

              A transfer may only carry products the RECEIVING branch stocks — the rule
              that governs every transfer, and here you are the receiver. Listing the
              other branch's catalogue looked helpful and was not: it offered products
              your branch does not carry, and every one of them was refused on Send with
              a message about a screen the person was no longer on.

              So the branch above answers "who is being asked", and the list answers
              "what can arrive here". A product they hold and you do not is not
              requestable — it would have nowhere to land.

              Empty search: the whole catalogue, which is what this screen is for. The
              box below filters the loaded rows rather than asking the server again —
              typing must not cost a round trip when the answer is already here.
            */
            /*
              The catalogue and its own local names, together.

              `localName` is set on the product and on each variant, so where it is
              filled the printed sheet needs no matching at all — it beats the Excel
              master, which only ever guessed at which row described a line. Read once
              per Apply and carried on the rows; a branch that has not filled the field
              gets exactly what it got before.
            */
            const [products, localNames] = await Promise.all([
                searchTransferProducts(channelId, '', channelToken, 2000),
                fetchLocalNames(channelToken),
            ]);
            setRows(flatten(products, localNames));
            setAppliedChannelId(sourceChannelId);
            // A fresh load is a fresh sheet. The rows are your own products either way,
            // but half a list ticked under a previous load is not something anyone means
            // to keep.
            setPicked(new Map());
            setSearch('');
        } catch (err) {
            toast.error('Could not load your products', {
                description: err instanceof Error ? err.message : undefined,
            });
        } finally {
            setLoading(false);
        }
    }, [sourceChannelId, channelId, channelToken]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(
            (r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q),
        );
    }, [rows, search]);

    const clean = (value: string, pooled: boolean) =>
        pooled ? value.replace(/[^\d.]/g, '') : value.replace(/\D/g, '');

    function toggle(row: RequestRow) {
        const next = new Map(picked);
        if (next.has(row.key)) next.delete(row.key);
        else next.set(row.key, '');
        setPicked(next);
    }

    function setAmount(row: RequestRow, value: string) {
        const next = new Map(picked);
        next.set(row.key, clean(value, row.isPooled));
        setPicked(next);
    }

    /**
     * The header checkbox: ticks or unticks everything the search is currently showing.
     *
     * Showing is the only sensible scope. Under a search it would be a lie to tick the
     * rows scrolled away behind the filter, and with no search it is the whole list
     * anyway — which is what the box is for.
     */
    const allVisibleOn = visible.length > 0 && visible.every((r) => picked.has(r.key));
    function toggleAllVisible() {
        const next = new Map(picked);
        for (const r of visible) {
            if (allVisibleOn) next.delete(r.key);
            else if (!next.has(r.key)) next.set(r.key, '');
        }
        setPicked(next);
    }

    /**
     * Raise every ticked quantity by the same amount, the same control the edit screen
     * carries. Fifty lines that all need the same figure is fifty chances to mistype
     * one; this types it once and leaves the boxes editable afterwards.
     */
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkValue, setBulkValue] = useState('');

    /*
      Tamil unless someone says otherwise — it is the column every branch's master
      fills in, and the one the rest of the reports print from. Manglish is the
      answer to a person, not to a branch, so it is asked for each time rather than
      remembered against the login.
    */
    const [printLanguage, setPrintLanguage] = useState<RequestPrintLanguage>('tamil');

    function applyBulkAdd() {
        const delta = Number(bulkValue);
        if (!bulkValue.trim() || !Number.isFinite(delta) || delta === 0) {
            toast.warning('Type how much to add to every ticked line');
            return;
        }
        if (picked.size === 0) {
            toast.warning('Tick the products first');
            return;
        }
        const byKey = new Map(rows.map((r) => [r.key, r]));
        const next = new Map(picked);
        for (const [key, current] of picked) {
            const pooled = byKey.get(key)?.isPooled ?? false;
            const value = (Number(current) || 0) + delta;
            next.set(
                key,
                value <= 0
                    ? '0'
                    : pooled
                      ? String(Math.round(value * 1000) / 1000)
                      : String(Math.round(value)),
            );
        }
        setPicked(next);
        setBulkValue('');
        setBulkOpen(false);
        toast.success(
            `${delta > 0 ? '+' : ''}${delta} applied to ${picked.size} line${picked.size === 1 ? '' : 's'}`,
        );
    }

    /**
     * The ticked rows as lines, or null with a toast when something is not fillable.
     *
     * Shared by Print and Send on purpose: the sheet someone checks on paper has to be
     * the request that is about to go, and two readings of the same state would
     * eventually differ by exactly the row that mattered.
     */
    function collect(): Array<{ row: RequestRow; amount: number }> | null {
        const byKey = new Map(rows.map((r) => [r.key, r]));
        const out: Array<{ row: RequestRow; amount: number }> = [];
        for (const [key, amount] of picked) {
            const row = byKey.get(key);
            if (!row) continue;
            const value = Number(amount);
            if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
                toast.warning(`Enter a quantity for ${row.name}`);
                return null;
            }
            out.push({ row, amount: value });
        }
        if (out.length === 0) {
            toast.warning('Tick at least one product');
            return null;
        }
        return out;
    }

    function print() {
        const collected = collect();
        if (!collected) return;
        const lines: RequestPrintLine[] = collected.map(({ row, amount }) => ({
            productName: row.name,
            sku: row.sku,
            isPooled: row.isPooled,
            quantityPcs: row.isPooled ? null : Math.round(amount),
            weightKg: row.isPooled ? amount : null,
            localName: row.localName,
        }));
        // Opened synchronously: a window created after the await is no longer part of
        // the click, and every browser blocks it.
        const w = window.open('', '_blank');
        const label = printLanguageLabel(printLanguage);
        void printItemRequest({
            lines,
            ownerChannelCode: channelCode,
            language: printLanguage,
            windowRef: w,
        })
            .then((report) => {
                /*
                  Lines with no Local Name print the catalogue name instead, and on
                  paper that is invisible — the sheet looks the same whether the field
                  was filled or not. Naming them turns "the button does nothing" into
                  one product somebody can go and fix.
                */
                if (report.unnamed.length === 0) return;
                const missing = report.unnamed.length;
                toast.warning(
                    `${missing} of ${missing + report.named} line${missing + report.named === 1 ? '' : 's'} printed in English`,
                    {
                        description:
                            `No ${label} name is set on ` +
                            `${report.unnamed.slice(0, 3).join(', ')}` +
                            `${missing > 3 ? ` and ${missing - 3} more` : ''}.`,
                    },
                );
            })
            .catch((err) => {
                w?.close();
                toast.error('Could not open the request sheet', {
                    description: err instanceof Error ? err.message : undefined,
                });
            });
    }

    /**
     * Write the request, either sent or kept as a draft.
     *
     * A draft is the branch saying "not yet": it prints the sheet, walks the shelves
     * and comes back to correct it, and the branch being asked hears nothing until Send
     * Request. Both roads write the same row — the only difference is who can see it.
     */
    async function submit(send: boolean) {
        const collected = collect();
        if (!collected) return;
        /*
          What was typed is what is sent.

          A pooled product travels as a weight and a per-variant one as a count, and
          neither is converted on the way out — the branch being asked is asked for the
          number the person actually wrote down.
        */
        const lines: GoodsTransferLineInput[] = collected.map(({ row, amount }) =>
            row.isPooled
                ? { productId: row.productId, weightKg: amount }
                : {
                      productVariantId: row.productVariantId as string,
                      quantityPcs: Math.round(amount),
                  },
        );

        setSubmitting(true);
        try {
            const created = await createTransferRequest(
                { sourceChannelId: appliedChannelId, remarks: remarks.trim() || undefined, lines, send },
                channelToken,
            );
            toast.success(
                send ? `Request ${created.transferNumber} sent` : `Draft ${created.transferNumber} saved`,
                {
                    description: send
                        ? 'The branch you asked will see it under Requests.'
                        : 'Only this branch can see it. Send it when you are ready.',
                },
            );
            router.push(`/goods-transfer/${created.id}`);
        } catch (err) {
            toast.error(send ? 'Could not send the request' : 'Could not save the draft', {
                description: err instanceof Error ? err.message : undefined,
            });
            setSubmitting(false);
        }
    }

    /** Focus the search once a catalogue is on screen — the next thing anyone does. */
    const searchRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (appliedChannelId) searchRef.current?.focus();
    }, [appliedChannelId]);

    return (
        <div className="space-y-4">
            {/* ── One toolbar: where from, load it, print it, send it ── */}
            <div className="flex flex-wrap items-center gap-2">
                <span className={`${FIELD_LABEL} mb-0`}>Request from</span>
                <BranchSelect
                    branches={branches}
                    selectedId={sourceChannelId}
                    onChange={setSourceChannelId}
                    disabled={loading}
                />
                <button
                    type="button"
                    onClick={applyChannel}
                    disabled={loading || !sourceChannelId}
                    className={BUTTON}
                >
                    {loading ? 'Loading…' : 'Apply'}
                </button>
                {appliedChannelId && (
                    /*
                      The sheet before the send. The branch asking prints it, checks it
                      against the shelves, and only then commits — which is why Print
                      reads the same ticked rows Send does rather than the whole
                      catalogue.

                      The language sits to its left because it describes the sheet, and
                      the person walking the shelves is not always the person who ticked
                      the boxes: the same request gets printed in Tamil for one picker
                      and Manglish for the next.
                    */
                    <>
                        <PrintLanguageSelect value={printLanguage} onChange={setPrintLanguage} />
                        <button type="button" onClick={print} className={BUTTON}>
                            Print
                        </button>
                    </>
                )}

                {appliedChannelId && (
                    <div className="ml-auto flex items-center gap-2">
                        <span className="text-[0.75rem] text-[var(--text-muted)]">
                            {picked.size} ticked
                        </span>
                        {/*
                          Kept, not sent. The branch prints it, walks the shelves and
                          comes back to it — the other branch hears nothing until Send
                          Request.
                        */}
                        <button
                            type="button"
                            onClick={() => void submit(false)}
                            disabled={submitting || picked.size === 0}
                            className={BUTTON}
                        >
                            Save draft
                        </button>
                        <button
                            type="button"
                            onClick={() => void submit(true)}
                            disabled={submitting || picked.size === 0}
                            className={BUTTON_SOLID}
                        >
                            {submitting ? 'Sending…' : 'Send Request'}
                        </button>
                    </div>
                )}
            </div>

            {appliedChannelId ? (
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
                    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--card-border)] p-3">
                        <input
                            ref={searchRef}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search your products"
                            aria-label="Search products"
                            className={`${FIELD_INPUT} min-w-[9rem] flex-1`}
                        />
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
                                    aria-label="Amount to add to every ticked line"
                                    className={QTY_INPUT}
                                />
                                <button type="button" onClick={applyBulkAdd} className={BUTTON_SOLID}>
                                    Add
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setBulkOpen(true)}
                                className={BUTTON_SOLID}
                            >
                                Add Qty
                            </button>
                        )}
                        {/* Short on purpose: a remark is a line, not a paragraph, and a
                            full-width box invited one. */}
                        <input
                            value={remarks}
                            onChange={(e) => setRemarks(e.target.value)}
                            placeholder="Remarks (optional)"
                            aria-label="Remarks"
                            className={`${FIELD_INPUT} w-full sm:w-56`}
                        />
                    </div>

                    {/* Phone: one card per product. The table wants more width than a phone
                        has, and the quantity box is the only thing anyone types into. */}
                    <ul className="md:hidden">
                        <li className="border-b border-[var(--card-border)] px-3 py-2">
                            <label className="flex items-center gap-2 text-[0.75rem] text-[var(--text-muted)]">
                                <input
                                    type="checkbox"
                                    checked={allVisibleOn}
                                    onChange={toggleAllVisible}
                                />
                                Select all
                            </label>
                        </li>
                        {visible.map((row) => {
                            const on = picked.has(row.key);
                            return (
                                <li
                                    key={row.key}
                                    className="border-b border-[var(--card-border)] p-3 last:border-b-0"
                                >
                                    <label className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            checked={on}
                                            onChange={() => toggle(row)}
                                            className="mt-1"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-[0.875rem] font-medium text-[var(--foreground)]">
                                                {row.name}
                                            </span>
                                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.75rem] text-[var(--text-muted)]">
                                                {row.sku ? <span>{row.sku}</span> : null}
                                                <span>{unitLabel(row.poolUnit)}</span>
                                                {!row.enabled ? (
                                                    <span className={TAG_OFF}>disabled · not on sale</span>
                                                ) : null}
                                            </span>
                                        </span>
                                    </label>
                                    {on ? (
                                        <div className="mt-2 flex items-center justify-end gap-2">
                                            <input
                                                inputMode="decimal"
                                                value={picked.get(row.key) ?? ''}
                                                onChange={(e) => setAmount(row, e.target.value)}
                                                placeholder="0"
                                                aria-label={`Quantity for ${row.name}`}
                                                className={QTY_INPUT}
                                            />
                                            <span className="text-[0.75rem] text-[var(--text-muted)]">
                                                {unitSuffix(row.poolUnit)}
                                            </span>
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>

                    <div className="hidden md:block">
                        <table className="w-full">
                            <thead className="border-b border-[var(--card-border)]">
                                <tr>
                                    <th className={`${TH} w-10`}>
                                        <input
                                            type="checkbox"
                                            checked={allVisibleOn}
                                            onChange={toggleAllVisible}
                                            aria-label="Select all shown products"
                                        />
                                    </th>
                                    <th className={TH}>Item</th>
                                    <th className={TH}>SKU</th>
                                    <th className={`${TH} text-right`}>Qty</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((row) => {
                                    const on = picked.has(row.key);
                                    return (
                                        /*
                                          The whole row is the tick.

                                          A checkbox is a small target for a fast hand
                                          going down four hundred products, and the row
                                          beside it did nothing. The quantity cell stops
                                          the click before it gets here — typing into a
                                          box must not untick the line it belongs to.
                                        */
                                        <tr
                                            key={row.key}
                                            onClick={() => toggle(row)}
                                            className="cursor-pointer border-b border-[var(--card-border)] transition-colors last:border-b-0 hover:bg-overlay/[0.04]"
                                        >
                                            <td className="px-4 py-2">
                                                <input
                                                    type="checkbox"
                                                    checked={on}
                                                    onChange={() => toggle(row)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    aria-label={`Request ${row.name}`}
                                                />
                                            </td>
                                            <td className="px-4 py-2 text-[0.8125rem] text-[var(--foreground)]">
                                                {row.name}
                                                {!row.enabled ? (
                                                    <span className={`ml-2 ${TAG_OFF}`}>
                                                        disabled · not on sale
                                                    </span>
                                                ) : null}
                                            </td>
                                            {/* Pooled products have no SKU — the unit is
                                                already beside the quantity box, and
                                                repeating it here read as a SKU of "KG". */}
                                            <td className="px-4 py-2 text-[0.75rem] text-[var(--text-muted)]">
                                                {row.sku || '—'}
                                            </td>
                                            <td
                                                className="px-4 py-2 text-right"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    inputMode="decimal"
                                                    value={picked.get(row.key) ?? ''}
                                                    onChange={(e) => setAmount(row, e.target.value)}
                                                    disabled={!on}
                                                    placeholder="0"
                                                    aria-label={`Quantity for ${row.name}`}
                                                    className={QTY_INPUT}
                                                />
                                                <span className="ml-1.5 text-[0.75rem] text-[var(--text-muted)]">
                                                    {unitSuffix(row.poolUnit)}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {visible.length === 0 ? (
                        <p className="p-6 text-center text-[0.8125rem] text-[var(--text-muted)]">
                            {rows.length === 0
                                ? 'This branch has no products to request.'
                                : 'Nothing matches that search.'}
                        </p>
                    ) : null}
                </div>
            ) : (
                <p className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-center text-[0.8125rem] text-[var(--text-muted)]">
                    Pick the branch you are requesting from, then press Apply to list your products.
                </p>
            )}
        </div>
    );
}
