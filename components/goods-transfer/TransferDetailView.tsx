'use client';

/**
 * Transfer detail — reading it, editing it, and moving it forward.
 *
 * The whole page is one read. Lines carry the destination's live stock and anything
 * already claimed as damaged, so the figures are the real ones rather than a copy
 * taken when the transfer was written.
 *
 * Editing is allowed at DRAFT, CONFIRMED and DISPATCHED. A load is corrected in
 * place, never reversed, so the number printed on the driver's paper stays the
 * number of the goods in the vehicle. Once RECEIVED the stock has moved and the
 * transfer is closed.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/goods-transfer/ConfirmDialog';
import { DamageSection } from '@/components/goods-transfer/DamageSection';
import { EditLines, emptyEdit, type PendingEdit } from '@/components/goods-transfer/EditLines';
import { LoadingListNamesSelect } from '@/components/goods-transfer/LoadingListNamesSelect';
import { ErrorNotice, PluginMissingNotice } from '@/components/goods-transfer/notices';
import { Spinner } from '@/components/ui/Spinner';
import { useGoodsTransferPushRefresh } from '@/hooks/useGoodsTransferPushRefresh';
import { ALERT_INTERVAL_MS } from '@/lib/goods-transfer-alert-marker';
import {
    printLanguageLabel,
    PrintLanguageSelect,
} from '@/components/goods-transfer/PrintLanguageSelect';
import { printTransferDocument } from '@/lib/goods-transfer-document';
import {
    printItemRequest,
    type RequestPrintLanguage,
} from '@/lib/goods-transfer-request-print';
import {
    cleanPhone,
    cleanVehicle,
    formatQuantity,
    formatState,
    isPhoneComplete,
    longDate,
    PHONE_DIGITS,
    transferStateClasses,
} from '@/lib/goods-transfer-format';
import type { LoadingListNames } from '@/lib/goods-transfer-loading-list-print';
import type { Can } from '@/lib/goods-transfer-permissions';
import { openLoadingList } from '@/lib/goods-transfer-run-print';
import { STOCK_UNITS, formatMeasured } from '@/lib/stock-units';
import {
    confirmTransfer,
    deleteTransfer,
    dispatchTransfer,
    fetchLocalNames,
    fetchTransfer,
    isPluginMissingError,
    receiveTransfer,
    sendTransferRequest,
    updateTransfer,
    updateTransferRequest,
} from '@/services/goods-transfer.service';
import type {
    GoodsTransferLineInput,
    TransferChannel,
    TransferDetail,
    TransferLine,
} from '@/types/goods-transfer';

interface HeadFields {
    driverName: string;
    driverPhone: string;
    vehicleNumber: string;
    remarks: string;
}

const EMPTY_HEAD: HeadFields = { driverName: '', driverPhone: '', vehicleNumber: '', remarks: '' };

const FIELD_LABEL = 'mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';
const FIELD_INPUT =
    'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-[0.8125rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)]';
const BUTTON =
    'cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-4 py-2 text-[0.8125rem] font-medium text-[var(--foreground)] transition-colors hover:bg-overlay/[0.1] disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SOLID =
    'cursor-pointer rounded-lg border border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] px-4 py-2 text-[0.8125rem] font-semibold text-[var(--tone-indigo-soft)] transition-colors hover:bg-[rgba(99,102,241,0.25)] disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_DANGER =
    'cursor-pointer rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] px-4 py-2 text-[0.8125rem] font-medium text-[var(--tone-red)] transition-colors hover:bg-[rgba(239,68,68,0.2)] disabled:cursor-not-allowed disabled:opacity-50';
const TH = 'px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';

function when(iso: string | null): string {
    return iso ? longDate(iso) : '—';
}

/**
 * Live stock at the destination.
 *
 * Held in base units for pooled products — grams for a weighed one, pieces for a
 * counted one. Showing 29800 to someone thinking in kilos is a conversion they
 * should not have to do in their head; showing 0.03 kg to someone counting lemons
 * is worse still, which is why the line's own unit decides.
 */
function stockOf(line: TransferLine): string {
    if (line.currentStock == null) {
        return '—';
    }
    if (!line.isPooled) {
        return `${line.currentStock} pcs`;
    }
    const base = STOCK_UNITS[line.poolUnit ?? '']?.baseUnit ?? 'piece';
    return base === 'piece'
        ? `${line.currentStock} pcs`
        : formatMeasured(line.currentStock, base);
}

type Action = 'confirm' | 'dispatch' | 'receive' | 'send' | 'delete' | 'save';

export function TransferDetailView({
    id,
    channelToken,
    channelId,
    branches,
    can,
}: {
    id: string;
    channelToken: string;
    /** The branch being acted as — decides who may report damage and who may approve it. */
    channelId: string;
    /** Every branch, so another one’s catalogue can be read for its local names. */
    branches: TransferChannel[];
    can: Can;
}) {
    const router = useRouter();

    const [transfer, setTransfer] = useState<TransferDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [acting, setActing] = useState<Action | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pluginMissing, setPluginMissing] = useState(false);

    /*
      The language the P.List comes out in.

      Without it this sheet printed the names as typed whenever the branch looking was
      the branch the goods are for — which is every request a branch reads back on its
      own screen, and so looked exactly like the language picker being ignored.
    */
    const [printLanguage, setPrintLanguage] = useState<RequestPrintLanguage>('tamil');

    /*
      The catalogue's own local names for this branch, read once.

      Where a product carries one it names the printed line outright — no SKU to match
      and no master row to find. Read separately from the transfer because it belongs to
      the catalogue rather than to the transfer, and failing is survivable: the master
      still names what it can.
    */
    const [localNames, setLocalNames] = useState<{
        byProductId: Map<string, string>;
        byVariantId: Map<string, string>;
    }>({ byProductId: new Map(), byVariantId: new Map() });

    /*
      Read under the DESTINATION branch's token, not the viewer's.

      A transfer only ever carries products the receiving branch stocks, so those names
      live in that branch's catalogue — and the viewer is as often as not the other side
      of the transfer. Asking under the viewer's token returned nothing at all for every
      Madurai reader of an Idukki transfer, which looked exactly like the field being
      ignored. Falls back to the viewer's own token while the branch list is still
      loading, or when that branch is not in it.
    */
    const ownerToken =
        branches.find((b) => String(b.id) === String(transfer?.destinationChannelId))?.token ??
        channelToken;

    useEffect(() => {
        let cancelled = false;
        void fetchLocalNames(ownerToken).then((names) => {
            if (!cancelled) setLocalNames(names);
        });
        return () => {
            cancelled = true;
        };
    }, [ownerToken]);

    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmReceive, setConfirmReceive] = useState(false);

    const [names, setNames] = useState<LoadingListNames>('tamil');
    const [isPrinting, setIsPrinting] = useState(false);

    const [isEditing, setIsEditing] = useState(false);
    const [edit, setEdit] = useState<PendingEdit>(emptyEdit);
    const [head, setHead] = useState<HeadFields>(EMPTY_HEAD);

    /** `silent` for the interval and the push — a live update is the data changing,
     *  not the screen announcing it. The first load still shows its spinner. */
    const load = useCallback(async (silent = false) => {
        if (!silent) {
            setIsLoading(true);
        }
        setError(null);
        try {
            setTransfer(await fetchTransfer(id, channelToken));
        } catch (err) {
            if (isPluginMissingError(err)) {
                setPluginMissing(true);
                return;
            }
            setError(err instanceof Error ? err.message : 'Could not load this transfer');
        } finally {
            if (!silent) {
                setIsLoading(false);
            }
        }
    }, [id, channelToken]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * A background re-read, if now is a safe moment for one.
     *
     * It is not safe while the person is editing: `load` replaces `transfer`, and the
     * editor reads its "was" values from that object, so a refresh mid-edit would
     * silently re-base every unsaved change against different numbers. Nor while an
     * action is in flight, which is about to reload anyway.
     *
     * Skipping is the right answer rather than queuing. The next tick is twenty
     * seconds away and the save reloads regardless, so nothing is lost by waiting.
     */
    const refreshIfIdle = useCallback(() => {
        if (isEditing || acting) {
            return;
        }
        void load(true);
    }, [isEditing, acting, load]);

    /**
     * Keep the page true to the transfer while it sits open.
     *
     * This screen showed whatever was true when it was opened and nothing after. The
     * source branch watching a load they had just dispatched saw DISPATCHED for as
     * long as they left it there — the destination could accept the goods, the stock
     * could move, and the screen in front of them still said it had not happened.
     *
     * The same interval the list uses, for the same reason: it is the rate the alerts
     * arrive at, so nothing on screen is ever more stale than an alert would be.
     */
    useEffect(() => {
        const timer = window.setInterval(refreshIfIdle, ALERT_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [refreshIfIdle]);

    /**
     * …and immediately, when a push says this very transfer changed.
     *
     * The poll above is the guarantee; this is the part that feels live. The server
     * tags every push with what it is about, so `transfer-42` is recognisable to the
     * page showing transfer 42 and ignored by every other screen.
     */
    useGoodsTransferPushRefresh(refreshIfIdle, (alert) => alert.tag === `transfer-${id}`);

    function startEditing() {
        if (!transfer) {
            return;
        }
        setHead({
            driverName: transfer.driverName ?? '',
            driverPhone: transfer.driverPhone ?? '',
            vehicleNumber: transfer.vehicleNumber ?? '',
            remarks: transfer.remarks ?? '',
        });
        setEdit(emptyEdit());
        setError(null);
        setIsEditing(true);
    }

    function cancelEditing() {
        setIsEditing(false);
        setEdit(emptyEdit());
        setError(null);
    }

    /**
     * Sends only what changed.
     *
     * Lines the person did not touch are left out entirely — the API leaves an unsent
     * line alone, so there is no need to resend nine rows to change one.
     */
    async function saveEdit() {
        if (!transfer) {
            return;
        }

        const changedLines: GoodsTransferLineInput[] = transfer.lines
            .filter((line) => !edit.removed.has(line.id) && edit.amounts.has(line.id))
            .filter((line) => {
                const typed = edit.amounts.get(line.id)!;
                const was = String(line.isPooled ? (line.poolQty ?? 0) : (line.quantityPcs ?? 0));
                return typed !== was && Number(typed) > 0;
            })
            .map((line) =>
                line.isPooled
                    ? { id: line.id, poolQty: Number(edit.amounts.get(line.id)) }
                    : { id: line.id, quantityPcs: Number(edit.amounts.get(line.id)) },
            );

        const newLines: GoodsTransferLineInput[] = [];
        for (const added of edit.added) {
            if (!(Number(added.amount) > 0)) continue;
            newLines.push(
                added.isPooled
                    ? { productId: added.productId, poolQty: Number(added.amount) }
                    : {
                          productVariantId: added.productVariantId ?? undefined,
                          quantityPcs: Math.round(Number(added.amount)),
                      },
            );
        }

        const removeLineIds = [...edit.removed];
        const headChanged =
            head.driverName !== (transfer.driverName ?? '') ||
            head.driverPhone !== (transfer.driverPhone ?? '') ||
            head.vehicleNumber !== (transfer.vehicleNumber ?? '') ||
            head.remarks !== (transfer.remarks ?? '');

        if (!changedLines.length && !newLines.length && !removeLineIds.length && !headChanged) {
            toast.info('Nothing changed');
            setIsEditing(false);
            return;
        }

        // Removing every line would leave a transfer of nothing, which the server
        // refuses. Saying so here costs one fewer round trip and one fewer error.
        if (removeLineIds.length >= transfer.lines.length && !newLines.length) {
            setError('A transfer must keep at least one item. Delete the whole transfer instead.');
            return;
        }

        setActing('save');
        setError(null);
        try {
            // An unsent request is corrected through its own call, which carries the
            // request permission rather than Update — the branch that may ask is the
            // branch that may fix what it asked for, whether or not it may edit loads.
            const save = transfer.state === 'REQUEST_DRAFT' ? updateTransferRequest : updateTransfer;
            await save(
                {
                    id,
                    // null, not undefined: an emptied box means "clear this", and a
                    // field left out of the input means "leave it alone". Sending
                    // undefined for a cleared box would keep the old value and make
                    // the save look as though it had silently failed.
                    ...(headChanged
                        ? {
                              driverName: head.driverName.trim() || null,
                              driverPhone: head.driverPhone.trim() || null,
                              vehicleNumber: head.vehicleNumber.trim() || null,
                              remarks: head.remarks.trim() || null,
                          }
                        : {}),
                    ...(changedLines.length || newLines.length
                        ? { lines: [...changedLines, ...newLines] }
                        : {}),
                    ...(removeLineIds.length ? { removeLineIds } : {}),
                },
                channelToken,
            );
            toast.success('Saved');
            setIsEditing(false);
            setEdit(emptyEdit());
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the changes');
        } finally {
            setActing(null);
        }
    }

    async function act(what: 'confirm' | 'dispatch' | 'receive' | 'send') {
        setActing(what);
        setError(null);
        try {
            if (what === 'send') {
                await sendTransferRequest(id, channelToken);
                toast.success(`Sent — ${transfer?.sourceChannelCode ?? 'the branch'} has been asked`);
            } else if (what === 'confirm') {
                await confirmTransfer(id, channelToken);
                // Confirming a REQUESTED transfer is the source ACCEPTING it — one act,
                // not two, and the wording says so.
                toast.success(
                    transfer?.state === 'REQUESTED'
                        ? 'Accepted and confirmed — the transfer document is ready'
                        : 'Confirmed — the transfer document is ready',
                );
            } else if (what === 'dispatch') {
                await dispatchTransfer(id, channelToken);
                toast.success('Dispatched — the destination has been told');
            } else {
                await receiveTransfer(id, channelToken);
                setConfirmReceive(false);
                toast.success('Received — stock has been added at this branch');
            }
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : `Could not ${what} this transfer`);
        } finally {
            setActing(null);
        }
    }

    async function remove() {
        setActing('delete');
        setError(null);
        try {
            await deleteTransfer(id, channelToken);
            toast.success(`${transfer?.transferNumber ?? 'Transfer'} deleted`);
            router.replace('/goods-transfer');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete this transfer');
            setActing(null);
            setConfirmDelete(false);
        }
    }

    if (pluginMissing) {
        return <PluginMissingNotice />;
    }

    if (isLoading && !transfer) {
        return (
            <div className="flex items-center justify-center gap-3 p-10 text-[0.8125rem] text-[var(--text-muted)]">
                <Spinner size="md" />
                Loading…
            </div>
        );
    }

    if (!transfer) {
        return (
            <ErrorNotice
                message={error ?? 'This transfer could not be loaded.'}
                onRetry={() => void load()}
            />
        );
    }

    /** What was SENT, exactly as the line stores it. */
    const sentQuantity = (line: TransferLine): string => formatQuantity(line);

    // Each action is offered only where the state allows it AND the role does. The
    // server checks both again; this decides what is worth showing.
    const here = String(channelId);
    const atDestination = here === String(transfer.destinationChannelId);
    const atSource = here === String(transfer.sourceChannelId);

    /*
      A REQUEST runs the other way round, and the buttons have to follow.

      Until it is sent (REQUEST_DRAFT) it is the DESTINATION's own row: the branch that
      wrote it corrects it, sends it, or withdraws it, and the source cannot see it.
      Once sent (REQUESTED) it is on the source's desk — saving an edit or confirming
      it IS the acceptance, there is no separate accept — while the destination can
      still withdraw it. Every later state is an ordinary transfer and belongs to the
      source, as before.
    */
    const isRequestDraft = transfer.state === 'REQUEST_DRAFT';
    const isRequested = transfer.state === 'REQUESTED';
    const open = transfer.state !== 'RECEIVED';

    const showEdit =
        !isEditing &&
        (isRequestDraft
            ? can.request && atDestination
            : isRequested
              ? can.update && atSource
              : can.update && open);
    const showSend = can.request && isRequestDraft && atDestination && !isEditing;
    const showConfirm =
        can.update && (transfer.state === 'DRAFT' || (isRequested && atSource)) && !isEditing;
    const showDispatch = can.update && transfer.state === 'CONFIRMED' && !isEditing;
    const showDelete =
        can.delete &&
        open &&
        !isEditing &&
        // A pending request is the destination's to withdraw; the source cannot.
        (isRequestDraft || isRequested ? atDestination : true);
    // Receiving belongs to the branch the goods are going TO. The button appears for
    // whoever holds the permission; the server refuses it from the wrong channel.
    const showReceive = can.receive && transfer.state === 'DISPATCHED' && !isEditing;

    // Damage is a channel question, not only a permission one. The branch that
    // RECEIVED the goods reports; the branch that SENT them decides. Holding the
    // permission on some other branch settles nothing here, and the server agrees:
    // raising checks destinationChannelId, approving checks sourceChannelId.
    const showRaiseDamage =
        can.raiseDamage && atDestination && transfer.state === 'RECEIVED' && !isEditing;
    const canApproveHere = can.approveDamage && atSource;
    const showDamage = transfer.damageRequests.length > 0 && !isEditing;

    return (
        <div className="p-4 md:p-6">
            {/* ── Heading ── */}
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <button
                        onClick={() => router.push('/goods-transfer')}
                        className="mb-1 cursor-pointer text-[0.75rem] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)]"
                    >
                        ← Transfers
                    </button>
                    <h1 className="text-[1.125rem] font-bold tabular-nums tracking-tight text-[var(--foreground)]">
                        {transfer.transferNumber}
                    </h1>
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        {transfer.sourceChannelCode} → {transfer.destinationChannelCode}
                    </p>
                    {/*
                      A request waits on somebody, and the page says who. Without this
                      the branch that asked sees a row with no buttons and no
                      explanation, and the branch being asked sees "Requested" with
                      nothing to say that the next move is theirs.
                    */}
                    {isRequestDraft && (
                        <p className="mt-1 text-[0.75rem] text-[var(--tone-amber)]">
                            Not sent yet — {transfer.sourceChannelCode} cannot see this until you send it.
                        </p>
                    )}
                    {isRequested && (
                        <p className="mt-1 text-[0.75rem] text-[var(--tone-amber)]">
                            {atSource
                                ? `${transfer.destinationChannelCode} is asking for these — accept by confirming, or edit first.`
                                : `Waiting for ${transfer.sourceChannelCode} to accept.`}
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap gap-2">
                    {isEditing ? (
                        <>
                            <button className={BUTTON} onClick={cancelEditing} disabled={!!acting}>
                                Cancel
                            </button>
                            <button
                                className={BUTTON_SOLID}
                                onClick={() => void saveEdit()}
                                // A half-typed phone is not a phone. Blocking the save
                                // is kinder than storing seven digits nobody can ring.
                                disabled={!!acting || !isPhoneComplete(head.driverPhone)}
                            >
                                {acting === 'save' ? 'Saving…' : 'Save changes'}
                            </button>
                        </>
                    ) : (
                        <>
                            {/*
                              The name the sheet is headed by. It governs the LOADING
                              LIST beside it, and nothing else on this page: the PDF is
                              a file the backend rendered when the transfer was
                              confirmed, drawn with pdfkit in Helvetica, which has no
                              Tamil glyphs at all — it carries the product name already
                              and cannot be made to carry anything else at open time.

                              Offered only at one END of the transfer, because the server
                              scopes the sheet by the branch asking: from a channel that
                              is neither the source nor the destination the query matches
                              nothing, and the button would hand back a blank sheet
                              rather than say so.
                            */}
                            {(atSource || atDestination) && (
                                <>
                                    <LoadingListNamesSelect
                                        id="gt-detail-names"
                                        compact
                                        value={names}
                                        onChange={setNames}
                                        disabled={isPrinting}
                                    />
                                    <button
                                        className={BUTTON}
                                        disabled={isPrinting}
                                        title="One line per product, in the name chosen beside this"
                                        onClick={async () => {
                                            setIsPrinting(true);
                                            /*
                                              Direction is read from where the viewer
                                              stands, the same test the buttons below
                                              use. Getting it wrong does not merely
                                              mislabel the sheet — the server scopes the
                                              selection by it and would find nothing.
                                            */
                                            const message = await openLoadingList(
                                                {
                                                    channelToken,
                                                    direction: atDestination ? 'IN' : 'OUT',
                                                    transferIds: [String(transfer.id)],
                                                },
                                                { names },
                                            );
                                            if (message) {
                                                setError(message);
                                            }
                                            setIsPrinting(false);
                                        }}
                                    >
                                        {isPrinting ? 'Preparing…' : 'Loading list'}
                                    </button>
                                </>
                            )}
                            {transfer.pdfAsset && (
                                /*
                                  The transfer document, drawn here and printed by the
                                  browser.

                                  It used to be the PDF the server made at Confirm, which
                                  meant the paper only existed once the transfer had been
                                  confirmed and, on a phone, arrived as a download to go
                                  and find rather than something to look at. Built from
                                  the lines on screen it is always there and always
                                  current — an edit is on the paper the moment it is on
                                  the page. The server still keeps its own copy as the
                                  record.

                                  Shown from CONFIRMED onward, on requests and ordinary
                                  transfers alike. Before that there is nothing to print:
                                  a request is still being answered and a draft still
                                  being written, and the lines that finally travel are the
                                  ones left after the source has taken some off.
                                */
                                <button
                                    className={BUTTON}
                                    onClick={() => {
                                        // Opened inside the click: a window created after
                                        // any await is no longer part of the gesture and
                                        // every browser blocks it.
                                        const w = window.open('', '_blank');
                                        try {
                                            printTransferDocument(
                                                {
                                                    transferNumber: transfer.transferNumber,
                                                    createdAt: transfer.createdAt,
                                                    sourceChannelCode: transfer.sourceChannelCode,
                                                    destinationChannelCode:
                                                        transfer.destinationChannelCode,
                                                    driverName: transfer.driverName,
                                                    driverPhone: transfer.driverPhone,
                                                    vehicleNumber: transfer.vehicleNumber,
                                                    lines: transfer.lines,
                                                    logoUrl: `${window.location.origin}/kaaikani_logo.png`,
                                                },
                                                w,
                                            );
                                        } catch (err) {
                                            w?.close();
                                            toast.error('Could not open the document', {
                                                description:
                                                    err instanceof Error ? err.message : undefined,
                                            });
                                        }
                                    }}
                                >
                                    Open PDF
                                </button>
                            )}
                            {
                                /*
                                  Which language the P.List below comes out in.

                                  It used to be decided FOR the reader: translate for the
                                  other branch, hand a branch its own request back in the
                                  words it typed. That second half is why a branch reading
                                  its own request always got English — reasonable as a
                                  default, wrong as a rule, because the person walking the
                                  shelves is not always the person who typed it.

                                  Offered on every transfer, not only on ones raised as a
                                  request. The picking list is useful to whoever is doing
                                  the picking, and a load the source started itself is
                                  loaded off a shelf exactly like one that was asked for.
                                */
                                <PrintLanguageSelect
                                    value={printLanguage}
                                    onChange={setPrintLanguage}
                                />
                            }
                            {
                                <button
                                    className={BUTTON}
                                    onClick={() => {
                                        // Opened synchronously: a window created after
                                        // the await is no longer part of the click, and
                                        // every browser blocks it.
                                        const w = window.open('', '_blank');
                                        void printItemRequest({
                                            // Each line carries the catalogue's own name
                                            // where this branch has one, which the sheet
                                            // prefers over anything the master could be
                                            // made to match.
                                            lines: transfer.lines.map((l) => ({
                                                ...l,
                                                localName:
                                                    (l.productVariantId
                                                        ? localNames.byVariantId.get(
                                                              String(l.productVariantId),
                                                          )
                                                        : undefined) ??
                                                    localNames.byProductId.get(
                                                        String(l.productId),
                                                    ) ??
                                                    null,
                                            })),
                                            // The branch that ASKED — printed in the
                                            // header so two sheets on one desk can be
                                            // told apart. Its catalogue is also where
                                            // the local names come from, which is why
                                            // the names are read under its token.
                                            ownerChannelCode: transfer.destinationChannelCode,
                                            language: printLanguage,
                                            windowRef: w,
                                        })
                                            .then((report) => {
                                                /*
                                                  A line with no Local Name prints the
                                                  catalogue name, which is invisible on
                                                  paper — the sheet looks the same either
                                                  way. Naming those lines turns it into
                                                  one product somebody can go and fix.
                                                */
                                                if (!report.unnamed.length) return;
                                                const missing = report.unnamed.length;
                                                const total = missing + report.named;
                                                toast.warning(
                                                    `${missing} of ${total} lines printed in English`,
                                                    {
                                                        description: `No ${printLanguageLabel(printLanguage)} name is set on ${report.unnamed.slice(0, 3).join(', ')}${missing > 3 ? ` and ${missing - 3} more` : ''}.`,
                                                    },
                                                );
                                            })
                                            .catch((err) => {
                                                w?.close();
                                                toast.error('Could not open the request sheet', {
                                                    description:
                                                        err instanceof Error ? err.message : undefined,
                                                });
                                            });
                                    }}
                                >
                                    P.List
                                </button>
                            }
                            {showDelete && (
                                <button
                                    className={BUTTON_DANGER}
                                    onClick={() => setConfirmDelete(true)}
                                    disabled={!!acting}
                                >
                                    Delete
                                </button>
                            )}
                            {showEdit && (
                                <button className={BUTTON} onClick={startEditing}>
                                    Edit
                                </button>
                            )}
                            {showSend && (
                                <button
                                    className={BUTTON_SOLID}
                                    onClick={() => void act('send')}
                                    disabled={!!acting}
                                    title={`Make this request visible to ${transfer.sourceChannelCode}`}
                                >
                                    {acting === 'send' ? 'Sending…' : 'Send request'}
                                </button>
                            )}
                            {showConfirm && (
                                <button
                                    className={BUTTON_SOLID}
                                    onClick={() => void act('confirm')}
                                    disabled={!!acting}
                                >
                                    {acting === 'confirm'
                                        ? 'Confirming…'
                                        : isRequested
                                          ? 'Accept & confirm'
                                          : 'Confirm'}
                                </button>
                            )}
                            {showDispatch && (
                                <button
                                    className={BUTTON_SOLID}
                                    onClick={() => void act('dispatch')}
                                    disabled={!!acting}
                                >
                                    {acting === 'dispatch' ? 'Dispatching…' : 'Dispatch'}
                                </button>
                            )}
                            {showRaiseDamage && (
                                <button
                                    className={BUTTON}
                                    onClick={() => router.push(`/goods-transfer/${id}/damage`)}
                                >
                                    Report damage
                                </button>
                            )}
                            {showReceive && (
                                /*
                                  Pressed from the WRONG branch, this says so at once.

                                  Receiving belongs to the destination; the server checks
                                  the channel and refuses anyone else. The button showed
                                  wherever the permission was held, so the source branch
                                  got a confirmation dialog — "Accept these goods into
                                  Idukki?" — accepted it, waited, and was handed a server
                                  error. Three steps to be told something that was known
                                  before the first one.

                                  It is still SHOWN from the source, rather than hidden.
                                  A "Received Goods" button that quietly is not there is
                                  the harder thing to understand: nothing on screen would
                                  explain that the goods are waiting on the other branch,
                                  or which branch that is.
                                */
                                <button
                                    className={BUTTON_SOLID}
                                    onClick={() => {
                                        if (!atDestination) {
                                            // Only names the branch it can verify. `atSource`
                                            // is known; standing on some third branch is not
                                            // worth guessing about.
                                            setError(
                                                `Only ${transfer.destinationChannelCode} can receive these goods.` +
                                                    (atSource
                                                        ? ` You are acting as ${transfer.sourceChannelCode}.`
                                                        : '') +
                                                    ` Switch branch in the sidebar to accept them.`,
                                            );
                                            return;
                                        }
                                        setConfirmReceive(true);
                                    }}
                                    disabled={!!acting}
                                >
                                    Received Goods
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--error-bg)] px-4 py-3 text-[0.8125rem] text-[var(--tone-red)]">
                    {error}
                </div>
            )}

            {confirmDelete && (
                <ConfirmDialog
                    tone="danger"
                    title={`Delete ${transfer.transferNumber}?`}
                    confirmLabel={acting === 'delete' ? 'Deleting…' : 'Delete permanently'}
                    cancelLabel="Keep it"
                    busy={!!acting}
                    onCancel={() => setConfirmDelete(false)}
                    onConfirm={() => void remove()}
                    body={
                        <>
                            <p>
                                This cannot be undone. The number is used up and will never be reissued.
                            </p>
                            {transfer.state !== 'DRAFT' &&
                                transfer.state !== 'REQUESTED' &&
                                transfer.state !== 'REQUEST_DRAFT' && (
                                <p>
                                    {transfer.destinationChannelCode} has already been told about this
                                    transfer and will be told it is cancelled
                                    {transfer.state === 'DISPATCHED' &&
                                        ' — the printed document is already in the vehicle'}
                                    .
                                </p>
                            )}
                        </>
                    }
                />
            )}

            {confirmReceive && (
                <ConfirmDialog
                    title={`Accept these goods into ${transfer.destinationChannelCode}?`}
                    confirmLabel={acting === 'receive' ? 'Receiving…' : 'Accept goods'}
                    cancelLabel="Not yet"
                    busy={!!acting}
                    onCancel={() => setConfirmReceive(false)}
                    onConfirm={() => void act('receive')}
                    body={
                        <>
                            <p>
                                Stock is added the moment you accept, and this is the only step that
                                changes it.
                            </p>
                            <p>
                                It cannot be undone — anything that arrived broken is reported afterwards
                                as damage.
                            </p>
                            <p className="text-[var(--foreground)]">
                                {transfer.lines.length} item{transfer.lines.length === 1 ? '' : 's'} on
                                this transfer
                            </p>
                        </>
                    }
                />
            )}

            {/* ── Facts, or the head fields while editing ── */}
            {isEditing ? (
                <div className="mb-4 flex flex-wrap items-start gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                    <div className="w-[10rem]">
                        <label className={FIELD_LABEL} htmlFor="gt-e-vehicle">
                            Vehicle
                        </label>
                        <input
                            id="gt-e-vehicle"
                            className={`${FIELD_INPUT} uppercase`}
                            value={head.vehicleNumber}
                            autoCapitalize="characters"
                            onChange={(e) =>
                                setHead({ ...head, vehicleNumber: cleanVehicle(e.target.value) })
                            }
                        />
                    </div>
                    <div className="w-[10rem]">
                        <label className={FIELD_LABEL} htmlFor="gt-e-driver">
                            Driver
                        </label>
                        <input
                            id="gt-e-driver"
                            className={FIELD_INPUT}
                            value={head.driverName}
                            onChange={(e) => setHead({ ...head, driverName: e.target.value })}
                        />
                    </div>
                    <div className="w-[10rem]">
                        <label className={FIELD_LABEL} htmlFor="gt-e-phone">
                            Driver phone
                        </label>
                        <input
                            id="gt-e-phone"
                            className={FIELD_INPUT}
                            value={head.driverPhone}
                            type="tel"
                            inputMode="numeric"
                            maxLength={PHONE_DIGITS}
                            onChange={(e) =>
                                setHead({ ...head, driverPhone: cleanPhone(e.target.value) })
                            }
                        />
                        {!isPhoneComplete(head.driverPhone) && (
                            <span className="mt-1 block text-[0.6875rem] text-[var(--tone-amber)]">
                                {PHONE_DIGITS - head.driverPhone.length} more digit
                                {PHONE_DIGITS - head.driverPhone.length === 1 ? '' : 's'}
                            </span>
                        )}
                    </div>
                    <div className="min-w-[12rem] flex-1">
                        <label className={FIELD_LABEL} htmlFor="gt-e-remarks">
                            Remarks
                        </label>
                        <input
                            id="gt-e-remarks"
                            className={FIELD_INPUT}
                            value={head.remarks}
                            onChange={(e) => setHead({ ...head, remarks: e.target.value })}
                        />
                    </div>
                </div>
            ) : (
                <div className="mb-4 grid grid-cols-2 gap-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:grid-cols-3 lg:grid-cols-4">
                    <Fact label="State">
                        <span
                            className={`inline-block rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold ${transferStateClasses(transfer.state)}`}
                        >
                            {formatState(transfer.state)}
                        </span>
                    </Fact>
                    <Fact label="Created">
                        {transfer.createdByName}
                        <Muted> · {when(transfer.createdAt)}</Muted>
                    </Fact>
                    <Fact label="Confirmed">
                        {transfer.confirmedByName ?? '—'}
                        {transfer.confirmedAt && <Muted> · {when(transfer.confirmedAt)}</Muted>}
                    </Fact>
                    <Fact label="Dispatched">
                        {transfer.dispatchedByName ?? '—'}
                        {transfer.dispatchedAt && <Muted> · {when(transfer.dispatchedAt)}</Muted>}
                    </Fact>
                    <Fact label="Received">
                        {transfer.receivedByName ?? '—'}
                        {transfer.receivedAt && <Muted> · {when(transfer.receivedAt)}</Muted>}
                    </Fact>
                    {/*
                      The damage outcome, up here with the other facts.

                      Every claim already carries its own state further down the page,
                      but the top of the screen said only "Received" — so a transfer
                      whose claim had been approved and one whose claim had been
                      refused read identically until you scrolled. This is the
                      one-line answer: how many claims, and how they went.

                      Only shown when there are claims, because "Damage —" on the
                      hundreds of transfers that never had any is noise.
                    */}
                    {transfer.damageRequests.length > 0 && (
                        <Fact label="Damage">
                            {(
                                [
                                    ['APPROVED', 'approved', 'var(--tone-red)'],
                                    ['REJECTED', 'rejected', 'var(--text-muted)'],
                                    ['PENDING_APPROVAL', 'pending', 'var(--tone-amber)'],
                                ] as const
                            )
                                .map(([state, word, color]) => {
                                    const n = transfer.damageRequests.filter(
                                        (d) => d.state === state,
                                    ).length;
                                    return n ? (
                                        <span key={state} style={{ color }}>
                                            {n} {word}
                                        </span>
                                    ) : null;
                                })
                                .filter(Boolean)
                                .reduce<ReactNode[]>(
                                    (out, part, i) => (i ? [...out, ' · ', part] : [part]),
                                    [],
                                )}
                        </Fact>
                    )}
                    <Fact label="Vehicle">{transfer.vehicleNumber ?? '—'}</Fact>
                    <Fact label="Driver">
                        {transfer.driverName ?? '—'}
                        {transfer.driverPhone && <Muted> · {transfer.driverPhone}</Muted>}
                    </Fact>
                    <Fact label="Remarks">{transfer.remarks ?? '—'}</Fact>
                </div>
            )}

            <h2 className="mb-3 text-[0.9375rem] font-semibold text-[var(--foreground)]">Items</h2>

            {isEditing ? (
                <EditLines
                    lines={transfer.lines}
                    destinationChannelId={transfer.destinationChannelId}
                    channelToken={channelToken}
                    edit={edit}
                    onChange={setEdit}
                />
            ) : (
                <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
                    {/*
                      ── Phone: one card per item ──

                      44rem of table on a 23rem screen put the three numbers that
                      matter — what was sent, what the destination holds, what is
                      claimed as damaged — off to the right of what fits. They are a
                      three-up row here, side by side, where they can be compared at
                      a glance rather than by dragging.
                    */}
                    <ul className="md:hidden">
                        {transfer.lines.map((line, index) => (
                            <li
                                key={line.id}
                                className="border-b border-[var(--card-border)] p-3 last:border-b-0"
                            >
                                <p className="text-[0.875rem] font-medium text-[var(--foreground)]">
                                    <span className="mr-1.5 tabular-nums text-[var(--text-muted)]">
                                        {index + 1}.
                                    </span>
                                    {line.productName}
                                </p>
                                {line.sku && (
                                    <p className="mt-0.5 font-mono text-[0.75rem] text-[var(--text-muted)]">
                                        {line.sku}
                                    </p>
                                )}
                                <dl className="mt-2 grid grid-cols-3 gap-2">
                                    <MobileFigure label="Sent" value={sentQuantity(line)} />
                                    <MobileFigure
                                        label={`At ${transfer.destinationChannelCode}`}
                                        value={stockOf(line)}
                                    />
                                    <MobileFigure
                                        label="Damaged"
                                        value={line.damagedQty > 0 ? String(line.damagedQty) : '—'}
                                        tone={line.damagedQty > 0 ? 'warn' : undefined}
                                    />
                                </dl>
                            </li>
                        ))}
                    </ul>

                    {/* ── md and up: the table ── */}
                    <div className="hidden overflow-x-auto md:block">
                        <table className="w-full min-w-[44rem] border-collapse text-[0.8125rem]">
                            <thead>
                                <tr className="border-b border-[var(--card-border)]">
                                    <th className={`${TH} w-px`}>#</th>
                                    <th className={TH}>Item</th>
                                    <th className={TH}>SKU</th>
                                    <th className={`${TH} text-right`}>Sent</th>
                                    <th className={`${TH} text-right`}>
                                        Stock at {transfer.destinationChannelCode}
                                    </th>
                                    <th className={`${TH} text-right`}>Damaged</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transfer.lines.map((line, index) => (
                                    <tr
                                        key={line.id}
                                        className="border-b border-[var(--card-border)] last:border-b-0"
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
                                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--foreground)]">
                                            {sentQuantity(line)}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-muted)]">
                                            {stockOf(line)}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums">
                                            {line.damagedQty > 0 ? (
                                                <span className="text-[var(--tone-amber)]">{line.damagedQty}</span>
                                            ) : (
                                                <span className="text-[var(--text-muted)]">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--card-border)] px-4 py-3 text-[0.75rem] text-[var(--text-muted)]">
                        <span>
                            {transfer.lines.length} item{transfer.lines.length === 1 ? '' : 's'}
                        </span>
                        {(transfer.state === 'DRAFT' ||
                            transfer.state === 'REQUESTED' ||
                            transfer.state === 'REQUEST_DRAFT') && (
                            <span>Stock shows once the transfer is confirmed</span>
                        )}
                    </div>
                </div>
            )}

            {showDamage && (
                <DamageSection
                    claims={transfer.damageRequests}
                    canApprove={canApproveHere}
                    channelToken={channelToken}
                    onDecided={() => void load()}
                />
            )}

            {!isEditing && (
                <>
                    <h2 className="mb-3 mt-6 text-[0.9375rem] font-semibold text-[var(--foreground)]">
                        History
                    </h2>
                    <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
                        <ol>
                            {transfer.audit.items.map((entry) => (
                                <li
                                    key={entry.id}
                                    className="flex flex-wrap items-baseline gap-x-2 border-b border-[var(--card-border)] px-4 py-2.5 text-[0.8125rem] last:border-b-0"
                                >
                                    <span className="font-medium text-[var(--foreground)]">
                                        {entry.action}
                                    </span>
                                    {(entry.fromState || entry.toState) && (
                                        <span className="text-[var(--text-muted)]">
                                            {entry.fromState ?? '—'} → {entry.toState ?? '—'}
                                        </span>
                                    )}
                                    <span className="ml-auto text-[0.75rem] text-[var(--text-muted)]">
                                        {entry.userName} · {when(entry.createdAt)}
                                    </span>
                                </li>
                            ))}
                        </ol>
                        {transfer.audit.totalItems > transfer.audit.items.length && (
                            <div className="border-t border-[var(--card-border)] px-4 py-3 text-[0.75rem] text-[var(--text-muted)]">
                                Showing {transfer.audit.items.length} of {transfer.audit.totalItems}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

/** One of the three figures on a phone's item card: label above, number below. */
function MobileFigure({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: 'warn';
}) {
    return (
        <div className="min-w-0">
            <dt className="truncate text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {label}
            </dt>
            <dd
                className={`mt-0.5 text-[0.8125rem] tabular-nums ${
                    tone === 'warn' ? 'text-[var(--tone-amber)]' : 'text-[var(--foreground)]'
                }`}
            >
                {value}
            </dd>
        </div>
    );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <span className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {label}
            </span>
            <span className="block text-[0.8125rem] text-[var(--foreground)]">{children}</span>
        </div>
    );
}

function Muted({ children }: { children: ReactNode }) {
    return <span className="text-[var(--text-muted)]">{children}</span>;
}
