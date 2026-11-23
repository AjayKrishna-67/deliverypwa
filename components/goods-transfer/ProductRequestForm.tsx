'use client';

/**
 * Product request — asking another branch to send goods.
 *
 * THE OTHER DIRECTION. Every other entry screen here belongs to the branch that
 * SENDS. This one belongs to the branch that will receive: it lists what is wanted,
 * names who is being asked, and nothing moves until that branch acts on it. Nothing
 * is reserved either — a request is a question.
 *
 * A SECTION PER BRANCH, the same shape as the transfer screen. The products come from
 * the asking branch's OWN catalogue, because it is listing what can arrive here — so
 * every section searches the same list, and a grid with a quantity column per branch
 * would have worked. It briefly did. The two screens match now on purpose: someone
 * who has built a transfer already knows how to raise a request, and there is one
 * way of entering a load branch by branch rather than two that look almost alike.
 *
 * A branch with nothing asked of it raises no request, and the screen says so before
 * the save rather than quietly raising nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { BranchSection } from '@/components/goods-transfer/BranchSection';
import { ConfirmDialog } from '@/components/goods-transfer/ConfirmDialog';
import { usePromptOnChannelSwitch } from '@/components/layout/channel-switch-guard';
import { ChannelMultiSelect } from '@/components/ui/ChannelMultiSelect';
import { focusAmount } from '@/lib/goods-transfer-focus';
import { LoadingListNamesSelect } from '@/components/goods-transfer/LoadingListNamesSelect';
import type { LoadingListNames } from '@/lib/goods-transfer-loading-list-print';
import { openLoadingList } from '@/lib/goods-transfer-run-print';
import { createTransferRequest, sendTransferRequest } from '@/services/goods-transfer.service';
import type {
    DestinationProduct,
    DestinationVariant,
    DraftLine,
    TransferChannel,
} from '@/types/goods-transfer';

const DEFAULT_CHANNEL_CODE = '__default_channel__';

let lineSeq = 1;

/**
 * A draft row, tagged with the branch it is being asked of.
 *
 * The branch lives on the LINE rather than on the screen, because one entry session
 * raises several requests and every row has to know which one it belongs to.
 */
type BranchDraftLine = DraftLine & { branchId: string };

const FIELD_LABEL = 'mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';
const FIELD_INPUT =
    'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-[1rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)] md:py-2 md:text-[0.8125rem]';
const BUTTON =
    'cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-4 py-2 text-[0.8125rem] font-medium text-[var(--foreground)] transition-colors hover:bg-overlay/[0.1] disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SOLID =
    'cursor-pointer rounded-lg border border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] px-4 py-2 text-[0.8125rem] font-semibold text-[var(--tone-indigo-soft)] transition-colors hover:bg-[rgba(99,102,241,0.25)] disabled:cursor-not-allowed disabled:opacity-50';
/** The dedupe key for a picked product — variant when there is one, product otherwise. */
const pickKey = (product: DestinationProduct, variant?: DestinationVariant) =>
    variant ? variant.id : `p${product.productId}`;


export function ProductRequestForm({
    channelToken,
    channelId,
    channelCode,
    branches: allBranches,
}: {
    channelToken: string;
    /** The branch asking — its own catalogue is what can be requested. */
    channelId: string;
    channelCode: string;
    branches: TransferChannel[];
}) {
    const router = useRouter();

    const [askIds, setAskIds] = useState<string[]>([]);
    const [lines, setLines] = useState<BranchDraftLine[]>([]);
    const [remarks, setRemarks] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<
        Array<{ id: string; transferNumber: string; code: string; sent: boolean }>
    >([]);
    const [sending, setSending] = useState<string | null>(null);
    const [isPrinting, setIsPrinting] = useState(false);
    const [names, setNames] = useState<LoadingListNames>('tamil');

    // You cannot ask yourself, and the default channel is not a branch.
    const branches = useMemo(
        () =>
            allBranches.filter(
                (c) => String(c.id) !== String(channelId) && c.code !== DEFAULT_CHANNEL_CODE,
            ),
        [allBranches, channelId],
    );
    const asked = useMemo(
        () => branches.filter((b) => askIds.includes(String(b.id))),
        [branches, askIds],
    );

    /** Branches that already carry products — the dropdown will not let them be unticked. */
    const branchesWithLines = useMemo(
        () => askIds.filter((id) => lines.some((l) => l.branchId === id)),
        [askIds, lines],
    );

    /**
     * Changing branch in the sidebar starts a different request, so this one is
     * discarded — but not without asking.
     *
     * A request is written FROM a branch: the products come from that branch's
     * catalogue and the whole point of the screen is what it wants sent here. Keeping
     * the rows across a switch was worse than losing them, because the branch you
     * switched to drops off its own list and the rows filed under it became
     * unreachable — visible in the count, absent from the screen, and dropped in
     * silence on save. The form is keyed on the branch by its page, so agreeing here
     * remounts it empty.
     */
    const switchPrompt = usePromptOnChannelSwitch(
        // Nothing left to lose once it is saved. The rows stay in state behind the
        // success screen until that screen's own button clears them, but they are on
        // the server by then — and that screen does not render the dialog, so asking
        // there would leave the picker waiting on an answer nobody could give.
        saved.length === 0 && (askIds.length > 0 || lines.length > 0),
    );

    /**
     * Taken is asked PER BRANCH. The same product may be asked of two branches on one
     * run — that is two lines on two requests, not a duplicate — so a key that ignored
     * the branch would refuse the second one.
     */
    const takenKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const line of lines) {
            keys.add(`${line.branchId}|${line.productVariantId ?? `p${line.productId}`}`);
        }
        return keys;
    }, [lines]);
    const isTaken = useCallback(
        (branchId: string, product: DestinationProduct, variant?: DestinationVariant) =>
            takenKeys.has(`${branchId}|${pickKey(product, variant)}`),
        [takenKeys],
    );

    /** The row just added, waiting to exist so the cursor can go into its box. */
    const [focusAfterRender, setFocusAfterRender] = useState<string | null>(null);
    useEffect(() => {
        if (!focusAfterRender) {
            return;
        }
        focusAmount(focusAfterRender);
        setFocusAfterRender(null);
    }, [focusAfterRender]);

    const addLine = useCallback(
        (branchId: string, product: DestinationProduct, variant?: DestinationVariant) => {
            const key = pickKey(product, variant);
            setLines((prev) => [
                ...prev,
                {
                    key: `${key}-${lineSeq++}`,
                    branchId,
                    productId: product.productId,
                    productVariantId: variant ? variant.id : null,
                    productName: variant ? `${product.productName} — ${variant.name}` : product.productName,
                    sku: variant?.sku ?? '',
                    isPooled: product.isPooled,
                    // Copied off the product when it is picked, so the row keeps
                    // asking in the unit it was added in even if the picker's
                    // results are later replaced by another search.
                    poolUnit: variant ? null : product.poolUnit,
                    enabled: variant ? product.enabled && variant.enabled : product.enabled,
                    amount: '',
                },
            ]);
            setFocusAfterRender(`${branchId}|${key}`);
        },
        [],
    );

    const onDuplicate = useCallback(
        (branchId: string, product: DestinationProduct, variant?: DestinationVariant) => {
            toast.warning(`${product.productName} is already being asked of this branch`, {
                description: 'Its quantity box is ready below — type the new amount.',
            });
            focusAmount(`${branchId}|${pickKey(product, variant)}`);
        },
        [],
    );

    const setAmount = useCallback((key: string, amount: string) => {
        setLines((prev) => prev.map((l) => (l.key === key ? { ...l, amount } : l)));
    }, []);

    const removeLine = useCallback((key: string) => {
        setLines((prev) => prev.filter((l) => l.key !== key));
    }, []);

    const filled = lines.filter((l) => Number(l.amount) > 0);
    /** A ticked branch with nothing under it would raise no request, silently. */
    const emptyBranches = asked.filter((b) => !lines.some((l) => l.branchId === String(b.id)));
    const branchesWithLinesToAsk = asked.filter((b) => lines.some((l) => l.branchId === String(b.id)));

    const canSave =
        askIds.length > 0 &&
        emptyBranches.length === 0 &&
        filled.length > 0 &&
        filled.length === lines.length &&
        !isSaving;
    const blockedReason =
        askIds.length === 0
            ? 'Choose at least one branch to ask'
            : emptyBranches.length > 0
              ? `${emptyBranches.map((b) => b.code).join(' and ')} ${emptyBranches.length === 1 ? 'has' : 'have'} no products yet`
              : filled.length !== lines.length
                ? `${lines.length - filled.length} item${lines.length - filled.length === 1 ? '' : 's'} still need a quantity`
                : null;

    /**
     * One request per branch, saved one after another.
     *
     * The same shape as the transfer screen and for the same reason: each is exactly
     * the request that branch would have received on its own, so nothing downstream
     * has to know this screen exists. Not atomic — a failure part-way leaves the
     * earlier ones raised, which is said plainly rather than hidden, and a request
     * commits nothing until the branch being asked acts on it.
     */
    async function save(send: boolean) {
        setError(null);
        setIsSaving(true);
        const done: Array<{ id: string; transferNumber: string; code: string; sent: boolean }> = [];
        try {
            for (const branch of branchesWithLinesToAsk) {
                const id = String(branch.id);
                const created = await createTransferRequest(
                    {
                        sourceChannelId: id,
                        remarks: remarks.trim() || undefined,
                        // Pooled products are entered and sent in the PRODUCT's own
                        // unit — kilograms, litres or a plain count — and the server
                        // converts to the base integer it stores. Pieces are
                        // variant-level and counted.
                        //
                        // This used to send weightKg for every pooled line, so a
                        // request for 30 amlas arrived as 30 kg and became 30,000 in
                        // a pool that counts fruit.
                        lines: lines
                            .filter((l) => l.branchId === id)
                            .map((l) =>
                                l.isPooled
                                    ? { productId: l.productId, poolQty: Number(l.amount) }
                                    : {
                                          productVariantId: l.productVariantId ?? undefined,
                                          quantityPcs: Number(l.amount),
                                      },
                            ),
                        send,
                    },
                    channelToken,
                );
                done.push({
                    id: created.id,
                    transferNumber: created.transferNumber,
                    code: branch.code,
                    sent: created.state === 'REQUESTED',
                });
            }
        } catch (err) {
            const reason = err instanceof Error ? err.message : 'Could not raise the request';
            setError(
                done.length
                    ? `${reason} — ${done.map((d) => `${d.transferNumber} (${d.code})`).join(', ')} ${done.length === 1 ? 'was' : 'were'} already raised.`
                    : reason,
            );
            setIsSaving(false);
            return;
        }
        toast.success(
            done.length === 1
                ? `${done[0].transferNumber} ${send ? 'sent' : 'saved as a draft'}`
                : `${done.length} requests ${send ? 'sent' : 'saved as drafts'}`,
        );
        setIsSaving(false);
        setSaved(done);
    }

    /** Send one that was kept back — the shelves have been walked. */
    async function send(id: string) {
        setSending(id);
        setError(null);
        try {
            const sent = await sendTransferRequest(id, channelToken);
            setSaved((prev) =>
                prev.map((d) => (d.id === id ? { ...d, sent: sent.state === 'REQUESTED' } : d)),
            );
            toast.success(`${sent.transferNumber} sent`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not send the request');
        } finally {
            setSending(null);
        }
    }

    // ── Raised: what was asked, and of whom ──
    if (saved.length > 0) {
        return (
            <div className="p-4 md:p-6">
                <h1 className="mb-1 text-[1.125rem] font-bold tracking-tight text-[var(--foreground)]">
                    {saved.length === 1 ? 'Request raised' : `${saved.length} requests raised`}
                </h1>
                <p className="mb-4 text-[0.8125rem] text-[var(--text-muted)]">
                    Nothing is reserved. Each branch decides what it sends, and stock moves when it
                    arrives here.
                </p>
                {error && (
                    <div className="mb-4 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--error-bg)] px-4 py-3 text-[0.8125rem] text-[var(--tone-red)]">
                        {error}
                    </div>
                )}
                <ul className="mb-5 overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
                    {saved.map((d) => (
                        <li
                            key={d.id}
                            className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0"
                        >
                            <div>
                                <p className="text-[0.875rem] font-medium text-[var(--foreground)]">
                                    {d.code}
                                    <span className="ml-2 text-[0.75rem] font-normal text-[var(--text-muted)]">
                                        {d.sent ? 'sent' : 'draft — not yet visible to them'}
                                    </span>
                                </p>
                                <p className="text-[0.75rem] tabular-nums text-[var(--text-muted)]">
                                    {d.transferNumber}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                {!d.sent && (
                                    <button
                                        className={BUTTON_SOLID}
                                        disabled={sending === d.id}
                                        onClick={() => void send(d.id)}
                                    >
                                        {sending === d.id ? 'Sending…' : 'Send'}
                                    </button>
                                )}
                                <button
                                    className={BUTTON}
                                    onClick={() => router.push(`/goods-transfer/${d.id}`)}
                                >
                                    Open
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
                <div className="mb-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                    <h2 className="mb-1 text-[0.875rem] font-semibold text-[var(--foreground)]">
                        Print what was asked for
                    </h2>
                    <p className="mb-3 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                        One line per product across every branch asked, matched on the Local Name —
                        the same product from two branches adds up to one figure to expect.
                    </p>
                    <LoadingListNamesSelect
                        id="gt-request-names"
                        className="mb-3 max-w-[15rem]"
                        value={names}
                        onChange={setNames}
                        disabled={isPrinting}
                    />
                    <div className="flex flex-wrap gap-2">
                        {/*
                          Direction IN: these are requests, so this branch is the one
                          RECEIVING and the columns are the branches being asked. The
                          server scopes to the destination side for it.
                        */}
                        <button
                            className={BUTTON}
                            disabled={isPrinting}
                            onClick={async () => {
                                setIsPrinting(true);
                                setError(
                                    await openLoadingList(
                                        {
                                            channelToken,
                                            direction: 'IN',
                                            transferIds: saved.map((d) => d.id),
                                        },
                                        { names },
                                    ),
                                );
                                setIsPrinting(false);
                            }}
                        >
                            {isPrinting ? 'Preparing…' : 'Incoming list'}
                        </button>
                        {saved.length > 1 && (
                            <button
                                className={BUTTON}
                                disabled={isPrinting}
                                onClick={async () => {
                                    setIsPrinting(true);
                                    setError(
                                        await openLoadingList(
                                            {
                                                channelToken,
                                                direction: 'IN',
                                                transferIds: saved.map((d) => d.id),
                                            },
                                            { perBranch: true, names },
                                        ),
                                    );
                                    setIsPrinting(false);
                                }}
                            >
                                A page per branch
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button className={BUTTON_SOLID} onClick={() => router.push('/goods-transfer')}>
                        Done
                    </button>
                    <button
                        className={BUTTON}
                        onClick={() => {
                            setSaved([]);
                            setLines([]);
                            setAskIds([]);
                            setError(null);
                        }}
                    >
                        Ask for something else
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <button
                        onClick={() => router.push('/goods-transfer')}
                        className="mb-1 cursor-pointer text-[0.75rem] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)]"
                    >
                        ← Transfers
                    </button>
                    <h1 className="text-[1.125rem] font-bold tracking-tight text-[var(--foreground)]">
                        Product request
                    </h1>
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        Ask another branch to send goods to {channelCode}
                    </p>
                </div>
                <div className="hidden gap-2 md:flex">
                    <button className={BUTTON} onClick={() => router.push('/goods-transfer')} disabled={isSaving}>
                        Cancel
                    </button>
                    {/* Kept back on purpose: the branch prints it and walks the shelves first. */}
                    <button className={BUTTON} onClick={() => void save(false)} disabled={!canSave}>
                        Save as draft
                    </button>
                    <button className={BUTTON_SOLID} onClick={() => void save(true)} disabled={!canSave}>
                        {isSaving ? 'Sending…' : 'Send request'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--error-bg)] px-4 py-3 text-[0.8125rem] text-[var(--tone-red)]">
                    {error}
                </div>
            )}

            <div className="mb-4 flex flex-wrap items-start gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <div>
                    <span className={FIELD_LABEL}>Ask which branch</span>
                    <ChannelMultiSelect
                        channels={branches.map((b) => ({ id: String(b.id), code: b.code }))}
                        selectedIds={askIds}
                        onChange={setAskIds}
                        emptyLabel="Choose branches…"
                        noun="branch"
                        /* A branch already asked for something cannot be unticked by
                           accident — that would bin the rows under it. */
                        lockedIds={branchesWithLines}
                    />
                    {askIds.length > 1 && (
                        <span className="mt-1 block text-[0.6875rem] text-[var(--text-muted)]">
                            one request each, with only what you asked of that branch
                        </span>
                    )}
                </div>
                <div className="min-w-[12rem] flex-1">
                    <label className={FIELD_LABEL} htmlFor="gt-req-remarks">
                        Remarks
                    </label>
                    <input
                        id="gt-req-remarks"
                        className={FIELD_INPUT}
                        value={remarks}
                        placeholder="Optional"
                        onChange={(e) => setRemarks(e.target.value)}
                    />
                </div>
            </div>

            {askIds.length === 0 ? (
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-10 text-center">
                    <h3 className="mb-1 text-[0.9375rem] font-semibold text-[var(--foreground)]">
                        No branch chosen
                    </h3>
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        Choose the branches you want to ask, above.
                    </p>
                </div>
            ) : (
                asked.map((branch) => {
                    const id = String(branch.id);
                    const branchLines = lines.filter((l) => l.branchId === id);
                    return (
                        <BranchSection
                            key={id}
                            branchId={id}
                            /*
                              Every section searches THIS branch's own catalogue, not
                              the one being asked: a request lists what can arrive here,
                              and the server validates it the same way.
                            */
                            catalogueChannelId={channelId}
                            heading={`Ask ${branch.code}`}
                            pickerLabel={`Add a product to ask ${branch.code} for`}
                            channelToken={channelToken}
                            lines={branchLines}
                            isTaken={(product, variant) => isTaken(id, product, variant)}
                            addLine={(product, variant) => addLine(id, product, variant)}
                            onDuplicate={(product, variant) => onDuplicate(id, product, variant)}
                            removeLine={removeLine}
                            setAmount={setAmount}
                            canDrop={branchLines.length === 0}
                            onDropBranch={() => setAskIds((prev) => prev.filter((x) => x !== id))}
                        />
                    );
                })
            )}

            {/* ── Phone: the actions, kept within reach ── */}
            <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-[var(--card-border)] bg-[var(--background)] px-4 py-3 md:hidden">
                <div className="flex gap-2">
                    <button className={`${BUTTON} min-h-[2.75rem] flex-1`} onClick={() => void save(false)} disabled={!canSave}>
                        Draft
                    </button>
                    <button
                        className={`${BUTTON_SOLID} min-h-[2.75rem] flex-[2]`}
                        onClick={() => void save(true)}
                        disabled={!canSave}
                    >
                        {isSaving ? 'Sending…' : 'Send request'}
                    </button>
                </div>
                {blockedReason && !isSaving && (
                    <p className="mt-1.5 text-center text-[0.75rem] text-[var(--tone-amber)]">{blockedReason}</p>
                )}
            </div>

            {switchPrompt.pending && (
                <ConfirmDialog
                    title="Leave this request?"
                    body={
                        <>
                            <p>
                                {lines.length > 0
                                    ? `You have ${lines.length} product${lines.length === 1 ? '' : 's'} entered${
                                          asked.length > 0
                                              ? ` for ${asked.map((b) => b.code).join(' and ')}`
                                              : ''
                                      }.`
                                    : 'You have branches chosen but no products yet.'}
                            </p>
                            <p>
                                Switching branch starts a new request from the branch you are
                                moving to, and this one is discarded.
                            </p>
                        </>
                    }
                    confirmLabel="Discard and switch"
                    cancelLabel="Stay here"
                    tone="danger"
                    onConfirm={switchPrompt.confirm}
                    onCancel={switchPrompt.cancel}
                />
            )}
        </div>
    );
}
