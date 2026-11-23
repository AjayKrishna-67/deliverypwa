'use client';

/**
 * New transfer — one lorry, one or several receiving branches.
 *
 * Ship-To comes first because the product list depends on it: the picker shows the
 * DESTINATION branch's catalogue, not this one's.
 *
 * SEVERAL BRANCHES MEANS SEVERAL TRANSFERS, and that is not a shortcut. Each branch
 * receives its own goods, signs for its own number and claims its own damage, so the
 * record has to be one transfer per branch however the load travels. What this screen
 * removes is the paperwork of entering the driver, the vehicle and the date twice.
 *
 * Each branch gets a section of its own, because the branches do not share a
 * catalogue — see the note on BranchSection below. A branch can be added at any time;
 * one can only be dropped while it still has no products, so typed work is never
 * thrown away by a stray tick.
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
import { openLoadingList, tripNoteUrl } from '@/lib/goods-transfer-run-print';
import {
    cleanPhone,
    cleanVehicle,
    isPhoneComplete,
    PHONE_DIGITS,
} from '@/lib/goods-transfer-format';
import { createTransfer } from '@/services/goods-transfer.service';
import type {
    DestinationProduct,
    DestinationVariant,
    DraftLine,
    TransferChannel,
} from '@/types/goods-transfer';

const DEFAULT_CHANNEL_CODE = '__default_channel__';

/**
 * A draft row, tagged with the branch it is going to.
 *
 * The branch lives on the LINE rather than on the screen, because one entry session
 * now produces several transfers and every row has to know which one it belongs to.
 * DraftLine itself is left alone — it describes a row of one transfer, which is still
 * what it is everywhere else.
 */
type BranchDraftLine = DraftLine & { destinationId: string };

let lineSeq = 1;

const FIELD_LABEL = 'mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';
/*
  16px on a phone, 13px from md up.

  Not a taste decision: iOS Safari zooms the whole page in when a focused input's
  text is smaller than 16px, and zooming does not undo itself. Someone entering ten
  products would be dragged in on the first one and left to pinch their way back out
  for the rest. The desktop size is restored at the breakpoint where no phone is
  looking. The taller padding below goes with it — a 30px-high box is a poor target
  for a thumb.
*/
const FIELD_INPUT =
    'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-[1rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)] disabled:cursor-not-allowed disabled:opacity-50 md:py-2 md:text-[0.8125rem]';
const BUTTON =
    'cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-4 py-2 text-[0.8125rem] font-medium text-[var(--foreground)] transition-colors hover:bg-overlay/[0.1] disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SOLID =
    'cursor-pointer rounded-lg border border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] px-4 py-2 text-[0.8125rem] font-semibold text-[var(--tone-indigo-soft)] transition-colors hover:bg-[rgba(99,102,241,0.25)] disabled:cursor-not-allowed disabled:opacity-50';

/** The dedupe key for a picked product — variant when there is one, product otherwise. */
function pickKey(product: DestinationProduct, variant?: DestinationVariant): string {
    return variant ? variant.id : `p${product.productId}`;
}


export function NewTransferForm({
    channelToken,
    channelId,
    branches: allBranches,
}: {
    channelToken: string;
    channelId: string;
    /** Every branch, read once by the section's shell. Filtered below. */
    branches: TransferChannel[];
}) {
    const router = useRouter();

    const [destinationIds, setDestinationIds] = useState<string[]>([]);
    const [remarks, setRemarks] = useState('');
    const [driverName, setDriverName] = useState('');
    const [driverPhone, setDriverPhone] = useState('');
    const [vehicleNumber, setVehicleNumber] = useState('');

    const [lines, setLines] = useState<BranchDraftLine[]>([]);
    /**
     * The drafts this screen just created, and the reason it does not walk away after
     * saving.
     *
     * Printing belongs to whoever knows which transfers make up the run, and that is
     * only ever this screen: a list filtered by date and branch would guess, and sweep
     * in whatever else went to the same branches earlier. So the screen stays, shows
     * what it made, and offers the two sheets for exactly those.
     */
    const [saved, setSaved] = useState<Array<{ id: string; transferNumber: string; code: string }>>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);
    const [names, setNames] = useState<LoadingListNames>('tamil');
    const [error, setError] = useState<string | null>(null);

    // Your own branch is never a destination. The server refuses it as well; this
    // just keeps it off the list so nobody picks it and waits for a rejection.
    const branches = useMemo(
        () =>
            allBranches.filter(
                (c) => String(c.id) !== String(channelId) && c.code !== DEFAULT_CHANNEL_CODE,
            ),
        [allBranches, channelId],
    );

    /** The branches ticked, in the order they are offered rather than ticked. */
    const chosenBranches = useMemo(
        () => branches.filter((b) => destinationIds.includes(String(b.id))),
        [branches, destinationIds],
    );

    /** Branches that already carry products — see the lock on the picker below. */
    const branchesWithLines = useMemo(
        () => destinationIds.filter((id) => lines.some((l) => l.destinationId === id)),
        [destinationIds, lines],
    );

    /**
     * Changing branch in the sidebar starts a different load, so this one is
     * discarded — but not without asking.
     *
     * A transfer is sent FROM a branch, and the branch you switch to drops off its
     * own Ship-To list. Rows already filed under it were left unreachable: counted on
     * the button, absent from the screen, and dropped in silence on save. The form is
     * keyed on the branch by its page, so agreeing here remounts it empty.
     */
    const switchPrompt = usePromptOnChannelSwitch(
        // Nothing left to lose once it is saved. The rows stay in state behind the
        // success screen until that screen's own button clears them, but they are on
        // the server by then — and that screen does not render the dialog, so asking
        // there would leave the picker waiting on an answer nobody could give.
        saved.length === 0 && (destinationIds.length > 0 || lines.length > 0),
    );

    const toggleBranch = useCallback((id: string) => {
        setDestinationIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    }, []);

    /**
     * Taken is asked PER BRANCH. The same product may go to two branches on one run —
     * that is two lines on two transfers, not a duplicate — so a key that ignored the
     * branch would refuse the second one.
     */
    const takenKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const line of lines) {
            keys.add(`${line.destinationId}|${line.productVariantId ?? `p${line.productId}`}`);
        }
        return keys;
    }, [lines]);

    const isTaken = useCallback(
        (destinationId: string, product: DestinationProduct, variant?: DestinationVariant) =>
            takenKeys.has(`${destinationId}|${pickKey(product, variant)}`),
        [takenKeys],
    );

    /**
     * The product just picked, waiting for its row to exist so the cursor can go in.
     *
     * Focusing cannot happen in `addLine` — at that moment the row is state, not yet
     * an element. The effect below runs after React has put it on the page, which is
     * the first instant there is anything to focus.
     */
    const [focusAfterRender, setFocusAfterRender] = useState<string | null>(null);

    useEffect(() => {
        if (!focusAfterRender) {
            return;
        }
        focusAmount(focusAfterRender);
        setFocusAfterRender(null);
    }, [focusAfterRender]);

    const addLine = useCallback(
        (destinationId: string, product: DestinationProduct, variant?: DestinationVariant) => {
        const key = pickKey(product, variant);
        setLines((prev) => [
            ...prev,
            {
                key: `${key}-${lineSeq++}`,
                destinationId,
                productId: product.productId,
                productVariantId: variant ? variant.id : null,
                /*
                  The VARIANT's own name, alone.

                  The product name was prepended, which read as "Naranga — Naranga
                  (Large 5nos)" for a catalogue that already names its variants in full.
                  Worse, that joined string is what the pack-size lookup searched for and
                  no master row carries it — so a line that should have been divided into
                  packets was saved as typed, and the screen then multiplied it up on the
                  way back. The server stores the variant's own name; matching it is what
                  keeps entry and display talking about the same thing.
                */
                productName: variant ? variant.name || product.productName : product.productName,
                sku: variant?.sku ?? '',
                isPooled: product.isPooled,
                // Copied off the product at pick time, so the row keeps asking in the
                // unit it was added in. Null on a variant line, which is pieces.
                poolUnit: variant ? null : product.poolUnit,
                // Both, for the reason spelled out in ProductPicker: a disabled
                // PRODUCT is off sale however enabled its variant is. Reading only the
                // variant here would have the picker say "disabled" and this table say
                // nothing, which is worse than neither saying it.
                enabled: variant ? product.enabled && variant.enabled : product.enabled,
                amount: '',
            },
        ]);
        // Pick, type, pick, type. Without this the person has to find the row they
        // just created and tap it — on a phone that means scrolling past everything
        // added before it, for every single product.
        setFocusAfterRender(`${destinationId}|${key}`);
        },
        [],
    );

    /**
     * The same product cannot appear twice — the server refuses it outright. Picking
     * it again therefore points at the row that exists rather than adding a second
     * one, which is what the person meant.
     */
    const onDuplicate = useCallback(
        (destinationId: string, product: DestinationProduct, variant?: DestinationVariant) => {
            toast.warning(`${product.productName} is already going to this branch`, {
                description: 'Its quantity box is ready below — type the new amount.',
            });
            focusAmount(`${destinationId}|${pickKey(product, variant)}`);
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
    // The phone is optional, but a half-typed one is not a phone. Blocking the save
    // is kinder than storing seven digits nobody can ring.
    const phoneOk = isPhoneComplete(driverPhone);
    /** A ticked branch with nothing on it would save no transfer at all, silently. */
    const emptyBranches = chosenBranches.filter(
        (b) => !lines.some((l) => l.destinationId === String(b.id)),
    );
    const canSave =
        destinationIds.length > 0 &&
        emptyBranches.length === 0 &&
        filled.length > 0 &&
        filled.length === lines.length &&
        phoneOk &&
        !isSaving;

    /**
     * Why the save is not available yet, in the order the person would fix them.
     *
     * A greyed-out button that will not say what it wants is the single most common
     * way a form wastes someone's time. On a phone it is worse than on a desktop,
     * because the thing that is missing is usually scrolled off the screen — and with
     * several branches on one screen it also has to say WHICH branch is short.
     */
    const blockedReason =
        destinationIds.length === 0
            ? 'Choose at least one receiving branch'
            : emptyBranches.length > 0
              ? `${emptyBranches.map((b) => b.code).join(' and ')} ${emptyBranches.length === 1 ? 'has' : 'have'} no products yet`
              : filled.length !== lines.length
                ? `${lines.length - filled.length} item${lines.length - filled.length === 1 ? '' : 's'} still need a quantity`
                : !phoneOk
                  ? `Driver phone needs ${PHONE_DIGITS - driverPhone.length} more digit${PHONE_DIGITS - driverPhone.length === 1 ? '' : 's'}`
                  : null;

    /**
     * One transfer per branch, saved one after another.
     *
     * Sent as separate createGoodsTransfer calls rather than through a batch mutation
     * of their own. Each is exactly the transfer that branch would have got if it had
     * been entered on its own, which means nothing downstream — receipt, damage,
     * documents, permissions — has to learn that this screen exists.
     *
     * They are therefore NOT one atomic write: if the second branch fails, the first
     * is already a draft. That is the honest trade and it is a safe one — a draft has
     * moved no stock, holds no document and can be deleted in a tap — but it must be
     * SAID rather than hidden, so a partial save names what was created and leaves the
     * screen alone for the rest to be retried.
     */
    async function save() {
        setError(null);

        setIsSaving(true);

        const done: Array<{ id: string; transferNumber: string; code: string }> = [];
        try {
            for (const branch of chosenBranches) {
                const id = String(branch.id);
                const forBranch = lines.filter((l) => l.destinationId === id);
                if (!forBranch.length) {
                    continue;
                }
                const created = await createTransfer(
                    {
                        destinationChannelId: id,
                        remarks: remarks.trim() || undefined,
                        driverName: driverName.trim() || undefined,
                        driverPhone: driverPhone.trim() || undefined,
                        vehicleNumber: vehicleNumber.trim() || undefined,
                        // Pooled products are entered and sent in the PRODUCT's own
                        // unit — kilograms, litres or a plain count — and the server
                        // converts to the base integer it stores. Pieces are
                        // variant-level and counted.
                        lines: forBranch.map((l) =>
                            l.isPooled
                                ? { productId: l.productId, poolQty: Number(l.amount) }
                                : {
                                      productVariantId: l.productVariantId ?? undefined,
                                      quantityPcs: Number(l.amount),
                                  },
                        ),
                    },
                    channelToken,
                );
                done.push({ id: created.id, transferNumber: created.transferNumber, code: branch.code });
            }
        } catch (err) {
            const reason = err instanceof Error ? err.message : 'Could not save the transfer';
            setError(
                done.length
                    ? `${reason} — ${done.map((d) => `${d.transferNumber} (${d.code})`).join(', ')} ${done.length === 1 ? 'was' : 'were'} already saved. ` +
                          'Remove the branches that saved and try the rest, or delete those drafts and start again.'
                    : reason,
            );
            setIsSaving(false);
            return;
        }

        toast.success(
            done.length === 1 ? `${done[0].transferNumber} saved as a draft` : `${done.length} drafts saved`,
        );
        setIsSaving(false);
        setSaved(done);
    }

    /*
      ── Saved: what was made, and the two sheets for it ──

      Shown INSTEAD of the form, not under it. The rows on the form are now drafts on
      the server, and leaving them on screen invites the same load to be entered
      twice — the one mistake this screen can make that nobody notices until the
      lorry is loaded.
    */
    if (saved.length > 0) {
        const transferIds = saved.map((d) => d.id);
        return (
            <div className="p-4 md:p-6">
                <h1 className="mb-1 text-[1.125rem] font-bold tracking-tight text-[var(--foreground)]">
                    {saved.length === 1 ? 'Draft saved' : `${saved.length} drafts saved`}
                </h1>
                <p className="mb-4 text-[0.8125rem] text-[var(--text-muted)]">
                    One transfer per branch. Each is signed for separately when it arrives.
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
                            className="flex items-center justify-between gap-3 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0"
                        >
                            <div>
                                <p className="text-[0.875rem] font-medium text-[var(--foreground)]">
                                    {d.code}
                                </p>
                                <p className="text-[0.75rem] tabular-nums text-[var(--text-muted)]">
                                    {d.transferNumber}
                                </p>
                            </div>
                            <button
                                className={BUTTON}
                                onClick={() => router.push(`/goods-transfer/${d.id}`)}
                            >
                                Open
                            </button>
                        </li>
                    ))}
                </ul>

                <div className="mb-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                    <h2 className="mb-1 text-[0.875rem] font-semibold text-[var(--foreground)]">
                        Print for this run
                    </h2>
                    <p className="mb-3 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                        Both cover exactly the {saved.length === 1 ? 'transfer' : `${saved.length} transfers`} above.
                    </p>
                    {/* Applies to the loading list only — the trip note is the
                        backend's PDF and carries the English names it snapshotted. */}
                    <LoadingListNamesSelect
                        id="gt-new-names"
                        className="mb-3 max-w-[15rem]"
                        value={names}
                        onChange={setNames}
                        disabled={isPrinting}
                    />
                    <div className="flex flex-wrap gap-2">
                        <button
                            className={BUTTON}
                            disabled={isPrinting}
                            onClick={async () => {
                                setIsPrinting(true);
                                setError(
                                    await openLoadingList(
                                        { channelToken, transferIds },
                                        { names },
                                    ),
                                );
                                setIsPrinting(false);
                            }}
                        >
                            {isPrinting ? 'Preparing…' : 'Loading list'}
                        </button>
                        {saved.length > 1 && (
                            <button
                                className={BUTTON}
                                disabled={isPrinting}
                                onClick={async () => {
                                    setIsPrinting(true);
                                    setError(
                                        await openLoadingList(
                                            { channelToken, transferIds },
                                            { perBranch: true, names },
                                        ),
                                    );
                                    setIsPrinting(false);
                                }}
                            >
                                Loading list, a page per branch
                            </button>
                        )}
                        {/*
                          A LINK, not a button that fetches. The address is known before
                          the click, so the browser's own PDF viewer opens inside the
                          gesture rather than being blocked afterwards.

                          It is offered even though these are drafts: the note says so
                          itself, refusing until each transfer is confirmed. Hiding it
                          would leave nothing on screen to explain where the driver's
                          paper comes from.
                        */}
                        <a
                            className={BUTTON}
                            href={tripNoteUrl({ channelToken, transferIds })}
                            target="_blank"
                            rel="noreferrer"
                        >
                            Trip note
                        </a>
                    </div>
                    <p className="mt-2 text-[0.75rem] text-[var(--text-muted)]">
                        The loading list is ready now. The trip note is the driver&rsquo;s paper and
                        appears once each transfer has been confirmed.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button className={BUTTON_SOLID} onClick={() => router.push('/goods-transfer')}>
                        Done
                    </button>
                    <button
                        className={BUTTON}
                        onClick={() => {
                            // A fresh run, not an edit of the one just saved.
                            setSaved([]);
                            setLines([]);
                            setDestinationIds([]);
                            setError(null);
                        }}
                    >
                        Start another transfer
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-[1.125rem] font-bold tracking-tight text-[var(--foreground)]">
                        New transfer
                    </h1>
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        Choose the receiving branches, then add what is going to each
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        className={BUTTON}
                        onClick={() => router.push('/goods-transfer')}
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    {/*
                      Hidden on a phone, where the sticky bar at the foot of the screen
                      carries this instead. Two save buttons on one short screen is one
                      too many, and the one up here scrolls away exactly when the form
                      becomes complete enough to use it.
                    */}
                    <button
                        className={`${BUTTON_SOLID} hidden md:inline-block`}
                        onClick={() => void save()}
                        disabled={!canSave}
                    >
                        {isSaving ? 'Saving…' : 'Save draft'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--error-bg)] px-4 py-3 text-[0.8125rem] text-[var(--tone-red)]">
                    {error}
                </div>
            )}

            {/* ── Heading fields ── */}
            <div className="mb-4 flex flex-wrap items-start gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <div className="w-full sm:w-auto">
                    <span className={FIELD_LABEL}>Ship to</span>
                    <ChannelMultiSelect
                        channels={branches.map((b) => ({ id: String(b.id), code: b.code }))}
                        selectedIds={destinationIds}
                        onChange={setDestinationIds}
                        emptyLabel="Choose branches…"
                        noun="branch"
                        /* A branch with products entered cannot be unticked: the tick
                           is a long way from its rows on a phone, so there would be
                           nothing on screen to connect the two. */
                        lockedIds={branchesWithLines}
                    />
                    {destinationIds.length > 1 && (
                        <span className="mt-1 block text-[0.6875rem] text-[var(--text-muted)]">
                            one transfer each, sharing the driver and vehicle
                        </span>
                    )}
                </div>
                <div className="w-full sm:w-[10rem]">
                    <label className={FIELD_LABEL} htmlFor="gt-vehicle">
                        Vehicle
                    </label>
                    <input
                        id="gt-vehicle"
                        className={`${FIELD_INPUT} uppercase`}
                        value={vehicleNumber}
                        placeholder="TN59AB1234"
                        autoCapitalize="characters"
                        onChange={(e) => setVehicleNumber(cleanVehicle(e.target.value))}
                    />
                </div>
                <div className="w-full sm:w-[10rem]">
                    <label className={FIELD_LABEL} htmlFor="gt-driver">
                        Driver
                    </label>
                    <input
                        id="gt-driver"
                        className={FIELD_INPUT}
                        value={driverName}
                        placeholder="Name"
                        onChange={(e) => setDriverName(e.target.value)}
                    />
                </div>
                <div className="w-full sm:w-[10rem]">
                    <label className={FIELD_LABEL} htmlFor="gt-phone">
                        Driver phone
                    </label>
                    <input
                        id="gt-phone"
                        className={FIELD_INPUT}
                        value={driverPhone}
                        placeholder="9876543210"
                        /*
                          `inputMode` is what raises the numeric keypad on a phone;
                          `type="tel"` alone would still accept letters, and stripping
                          them on the way in is what actually holds the rule.
                        */
                        type="tel"
                        inputMode="numeric"
                        maxLength={PHONE_DIGITS}
                        onChange={(e) => setDriverPhone(cleanPhone(e.target.value))}
                    />
                    {driverPhone.length > 0 && driverPhone.length < PHONE_DIGITS && (
                        <span className="mt-1 block text-[0.6875rem] text-[var(--tone-amber)]">
                            {PHONE_DIGITS - driverPhone.length} more digit
                            {PHONE_DIGITS - driverPhone.length === 1 ? '' : 's'}
                        </span>
                    )}
                </div>
                <div className="min-w-[12rem] flex-1">
                    <label className={FIELD_LABEL} htmlFor="gt-remarks">
                        Remarks
                    </label>
                    <input
                        id="gt-remarks"
                        className={FIELD_INPUT}
                        value={remarks}
                        placeholder="Optional"
                        onChange={(e) => setRemarks(e.target.value)}
                    />
                </div>
            </div>

            {destinationIds.length === 0 ? (
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-10 text-center">
                    <h3 className="mb-1 text-[0.9375rem] font-semibold text-[var(--foreground)]">
                        No branch chosen
                    </h3>
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        Tick the branches this load is going to, above.
                    </p>
                </div>
            ) : (
                chosenBranches.map((branch) => {
                    const id = String(branch.id);
                    const branchLines = lines.filter((l) => l.destinationId === id);
                    return (
                        <BranchSection
                            key={id}
                            branchId={id}
                            catalogueChannelId={id}
                            heading={`Ship to ${branch.code}`}
                            pickerLabel={`Add a product for ${branch.code}`}
                            channelToken={channelToken}
                            lines={branchLines}
                            isTaken={(product, variant) => isTaken(id, product, variant)}
                            addLine={(product, variant) => addLine(id, product, variant)}
                            onDuplicate={(product, variant) => onDuplicate(id, product, variant)}
                            removeLine={removeLine}
                            setAmount={setAmount}
                            canDrop={branchLines.length === 0}
                            onDropBranch={() => toggleBranch(id)}
                        />
                    );
                })
            )}

            {/*
              ── Phone: the save, kept within reach ──

              Sticks to the foot of the scrolling area rather than the page, so it
              stays put however far down the product list runs. `-mx-4` undoes this
              screen's padding so the bar reaches both edges, which is what stops it
              reading as one more card in the list.

              It says what it is waiting for. A disabled button that will not explain
              itself is the reason people re-tap and then go looking for someone to
              ask.
            */}
            <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-[var(--card-border)] bg-[var(--background)] px-4 py-3 md:hidden">
                <button
                    className={`${BUTTON_SOLID} min-h-[2.75rem] w-full`}
                    onClick={() => void save()}
                    disabled={!canSave}
                >
                    {isSaving
                        ? 'Saving…'
                        : `Save draft${filled.length ? ` · ${filled.length} item${filled.length === 1 ? '' : 's'}` : ''}`}
                </button>
                {blockedReason && !isSaving && (
                    <p className="mt-1.5 text-center text-[0.75rem] text-[var(--tone-amber)]">{blockedReason}</p>
                )}
            </div>

            {switchPrompt.pending && (
                <ConfirmDialog
                    title="Leave this transfer?"
                    body={
                        <>
                            <p>
                                {lines.length > 0
                                    ? `You have ${lines.length} product${lines.length === 1 ? '' : 's'} entered${
                                          chosenBranches.length > 0
                                              ? ` for ${chosenBranches.map((b) => b.code).join(' and ')}`
                                              : ''
                                      }.`
                                    : 'You have branches chosen but no products yet.'}
                            </p>
                            <p>
                                Switching branch starts a new transfer from the branch you are
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
