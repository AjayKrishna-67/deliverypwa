'use client';

/**
 * Reporting damage at the destination.
 *
 * One claim covers every product found broken in a transfer — reporting a hundred
 * items is one submission, not a hundred. Quantities, notes and photos are per
 * product; the decision to approve is taken on the whole claim.
 *
 * The 5% photo rule is enforced by the SERVER. This screen shows the percentage as
 * it is typed and says when evidence becomes mandatory, so the requirement is
 * visible before the submission rather than after it — but the rule itself lives in
 * one place, and it is not here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ErrorNotice, NotAllowedNotice, PluginMissingNotice } from '@/components/goods-transfer/notices';
import { Spinner } from '@/components/ui/Spinner';
import { cleanAmount, unitPlaceholder, unitSuffix } from '@/lib/goods-transfer-format';
import { DEFAULT_STOCK_UNIT, STOCK_UNITS, formatMeasured, fromBase, toBase } from '@/lib/stock-units';
import type { Can } from '@/lib/goods-transfer-permissions';
import {
    createDamageRequest,
    fetchTransfer,
    isPluginMissingError,
} from '@/services/goods-transfer.service';
import type { DamageLineInput, TransferDetail } from '@/types/goods-transfer';

const PHOTO_THRESHOLD_PCT = 5;

interface Row {
    lineId: string;
    productName: string;
    sku: string;
    isPooled: boolean;
    /**
     * The unit the LINE was delivered in: 'kg', 'litre' or 'piece'. Null for a PCS
     * line, and for a pooled row saved before units were recorded.
     */
    poolUnit: string | null;
    /** What the destination holds now, in base units — the percentage is against it. */
    received: number;
    /** As typed, in the line's own unit — kg, litres, or a plain count. */
    amount: string;
    note: string;
    photos: File[];
}

/**
 * One attached photo: tap the picture to see it, tap the × to take it off.
 *
 * TWO SEPARATE TARGETS, deliberately. The whole thumbnail used to be one button that
 * removed the photo, so the natural thing — touching it to check what you had taken —
 * deleted it instead. On a phone that is the only way to look at a 56px image, which
 * made the obvious gesture the destructive one.
 *
 * THE BLOB URL IS SET ON THE ELEMENT, not held in state or derived with useMemo, and
 * the reason is React's StrictMode. It mounts, runs effects, runs the cleanups, and
 * runs the effects again — on purpose, to surface exactly this kind of bug. With the
 * URL built in `useMemo`, that middle cleanup revoked the one and only URL the memo
 * would ever produce: the second effect pass had nothing left to give the <img>, the
 * src pointed at a revoked blob, and the browser fell back to rendering the `alt`
 * text. Which is why a phone showed the FILE NAME where the photo should have been.
 *
 * Creating it inside the effect fixes it properly rather than by disabling StrictMode:
 * each pass makes its own URL and revokes its own, so the element always holds a live
 * one and nothing leaks.
 */
function PhotoThumb({
    file,
    onView,
    onRemove,
}: {
    file: File;
    onView: (url: string, name: string) => void;
    onRemove: () => void;
}) {
    const imgRef = useRef<HTMLImageElement>(null);
    // Kept so the viewer can be opened with the URL that is currently live.
    const urlRef = useRef<string>('');

    useEffect(() => {
        const objectUrl = URL.createObjectURL(file);
        urlRef.current = objectUrl;
        if (imgRef.current) {
            imgRef.current.src = objectUrl;
        }
        // A blob URL pins the whole image in memory until it is revoked, and a claim
        // can carry a dozen of them straight off a phone camera.
        return () => URL.revokeObjectURL(objectUrl);
    }, [file]);

    return (
        <div className="relative shrink-0">
            <button
                type="button"
                title={`${file.name} — tap to view`}
                aria-label={`View photo ${file.name}`}
                onClick={() => onView(urlRef.current, file.name)}
                className="block h-16 w-16 cursor-pointer overflow-hidden rounded-lg border border-[var(--card-border)] bg-overlay/[0.06]"
            >
                {/* A blob: URL straight from the camera, never a served asset — there is
                    nothing for next/image to optimise and it cannot load one. `src` is
                    set by the effect above, so none is given here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={imgRef} alt={file.name} className="h-full w-full object-cover" />
            </button>
            <button
                type="button"
                title={`Remove ${file.name}`}
                aria-label={`Remove photo ${file.name}`}
                onClick={onRemove}
                // Sits on the corner and overhangs it, so it is reachable without
                // covering the picture it belongs to. 1.5rem is small for a thumb, so
                // it is given a wide hit area with padding the border does not show.
                className="absolute -right-2 -top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-[rgba(239,68,68,0.5)] bg-[var(--surface)] text-[0.875rem] font-bold leading-none text-[var(--tone-red)] shadow-md transition-colors active:bg-[rgba(239,68,68,0.25)]"
            >
                ×
            </button>
        </div>
    );
}

/** The tapped photo, shown large enough to actually check. */
function PhotoViewer({
    photo,
    onClose,
}: {
    photo: { url: string; name: string };
    onClose: () => void;
}) {
    // Escape closes it, as it would any overlay. Tapping the backdrop does the same,
    // which is what a thumb reaches for.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                onClose();
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={photo.name}
            onClick={onClose}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={photo.url}
                alt={photo.name}
                className="max-h-[80vh] max-w-full rounded-lg object-contain"
            />
            <p className="max-w-full truncate text-[0.75rem] text-white/70">{photo.name}</p>
            <button
                type="button"
                onClick={onClose}
                className="min-h-[2.75rem] cursor-pointer rounded-lg border border-white/25 px-5 text-[0.875rem] font-medium text-white"
            >
                Close
            </button>
        </div>
    );
}

/**
 * More damage claimed than the transfer delivered.
 *
 * The server refuses this, but it only said so on SUBMIT — after the photos were
 * taken and the claim sent, in one message at the top of the page naming "line 1",
 * "line 2". By then the person had done all the work and had to count rows to find
 * out which product it meant. This is the same rule, said next to the box being
 * typed into, at the moment it stops being true.
 *
 * Compared in base units: `received` is grams for a weighed product, and the person
 * types kg, so the typed figure is converted before anything is compared.
 */
function exceedsReceived(row: Row): boolean {
    const typed = Number(row.amount);
    if (!typed || typed <= 0) {
        return false;
    }
    return damagedBaseOf(row) > row.received;
}

/**
 * What the typed figure is worth in the line's BASE unit.
 *
 * `toBase` reads the factor off the unit table, so a kilogram becomes 1000 g and a
 * piece stays itself. It used to multiply every pooled line by 1000, which made a
 * claim for 4 damaged lemons read as 4000 against a delivery of 30 — the cap
 * refused it, and the branch could not report damage on anything counted.
 */
function damagedBaseOf(row: Row): number {
    const typed = Number(row.amount);
    return row.isPooled ? toBase(typed, row.poolUnit ?? DEFAULT_STOCK_UNIT) : typed;
}

/** "Damage Qty (40) > received Qty (30)." — in the unit the person is typing in. */
function exceedMessage(row: Row): string {
    const typed = Number(row.amount);
    const unit = unitSuffix(row.isPooled ? row.poolUnit : null);
    // Received is stored in base units; shown back in the unit the box is asking
    // for, so the two numbers can actually be compared by eye.
    const received = row.isPooled
        ? fromBase(row.received, row.poolUnit ?? DEFAULT_STOCK_UNIT)
        : row.received;
    return `Damage Qty (${typed} ${unit}) > received Qty (${received} ${unit}).`;
}

/**
 * What this transfer delivered, written in the line's own unit.
 *
 * `received` is a base integer, so a weighed line reads "12.5 kg" and a counted one
 * reads "30 pcs" off the same field — the unit is the line's, never assumed.
 */
function receivedOf(row: Row): string {
    if (!row.isPooled) {
        return `${row.received} pcs`;
    }
    const base = STOCK_UNITS[row.poolUnit ?? '']?.baseUnit ?? 'piece';
    return base === 'piece' ? `${row.received} pcs` : formatMeasured(row.received, base);
}

/** Percentage of the received quantity, in the unit that line is measured in. */
function percentOf(row: Row): number | null {
    const typed = Number(row.amount);
    if (!typed || typed <= 0 || !row.received) {
        return null;
    }
    return (damagedBaseOf(row) / row.received) * 100;
}

const FIELD_INPUT =
    'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-[0.8125rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)]';
const BUTTON =
    'cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-4 py-2 text-[0.8125rem] font-medium text-[var(--foreground)] transition-colors hover:bg-overlay/[0.1] disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SOLID =
    'cursor-pointer rounded-lg border border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] px-4 py-2 text-[0.8125rem] font-semibold text-[var(--tone-indigo-soft)] transition-colors hover:bg-[rgba(99,102,241,0.25)] disabled:cursor-not-allowed disabled:opacity-50';
const TH = 'px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';

export function RaiseDamageForm({
    id,
    channelToken,
    channelId,
    channelCode,
    can,
}: {
    id: string;
    channelToken: string;
    channelId: string;
    channelCode: string;
    can: Can;
}) {
    const router = useRouter();

    const [transfer, setTransfer] = useState<TransferDetail | null>(null);
    const [rows, setRows] = useState<Row[]>([]);
    const [remarks, setRemarks] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pluginMissing, setPluginMissing] = useState(false);
    /** The photo being looked at, if any. One viewer serves every row. */
    const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null);

    const viewPhoto = useCallback((url: string, name: string) => setViewing({ url, name }), []);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const found = await fetchTransfer(id, channelToken);
            setTransfer(found);
            setRows(
                found.lines.map((line) => ({
                    lineId: line.id,
                    productName: line.productName,
                    sku: line.sku,
                    isPooled: line.isPooled,
                    // The LINE's unit, so the claim is made in whatever was delivered.
                    poolUnit: line.poolUnit,
                    /*
                      What THIS TRANSFER delivered — not what the branch happens to
                      hold.

                      `currentStock` was used here, and it is a different number
                      entirely: the destination's whole stock of that product,
                      everything it already had plus everything this transfer added.
                      Measuring the damage against it made every percentage far too
                      small — a line reported at 9.09% by the server was shown here as
                      0.99%, because the branch was holding about nine times what the
                      transfer brought.

                      That is worse than a cosmetic error. This figure decides what the
                      screen says about the photo rule, so a line that genuinely needed
                      evidence looked as though it did not, and the claim was refused
                      at submission with a percentage the person had never been shown.

                      DamageService computes the real one as
                      `line.isPooled ? weightGrams : quantityPcs` — the line quantity,
                      in base units. This is the same expression, so the two agree.
                    */
                    received: line.isPooled ? (line.weightGrams ?? 0) : (line.quantityPcs ?? 0),
                    amount: '',
                    note: '',
                    photos: [],
                })),
            );
        } catch (err) {
            if (isPluginMissingError(err)) {
                setPluginMissing(true);
                return;
            }
            setError(err instanceof Error ? err.message : 'Could not load this transfer');
        } finally {
            setIsLoading(false);
        }
    }, [id, channelToken]);

    useEffect(() => {
        void load();
    }, [load]);

    const claimed = useMemo(() => rows.filter((r) => Number(r.amount) > 0), [rows]);

    // Which lines the server will refuse for want of evidence. Computed here only to
    // say so early; the server decides.
    /**
     * Rows claiming more than arrived. While any exists the claim cannot be sent —
     * there is nothing to think about, the server would refuse it.
     */
    const overClaimed = useMemo(() => claimed.filter(exceedsReceived), [claimed]);

    const missingPhotos = useMemo(
        () =>
            claimed.filter((row) => {
                const pct = percentOf(row);
                return pct != null && pct >= PHOTO_THRESHOLD_PCT && row.photos.length === 0;
            }),
        [claimed],
    );

    function update(lineId: string, patch: Partial<Row>) {
        setRows((prev) => prev.map((r) => (r.lineId === lineId ? { ...r, ...patch } : r)));
    }

    function addPhotos(lineId: string, files: FileList | null) {
        if (!files?.length) {
            return;
        }
        /*
          Copied out of the FileList HERE, before the state update rather than inside
          it.

          A FileList is a live view of the input, and the caller clears that input
          immediately (so the same photo can be taken twice in a row). React runs a
          state updater during the render that follows the event, by which time the
          clearing has already happened and the list is empty — so reading it in there
          added nothing at all. The photo appeared to be taken and then vanished, and
          the claim could not be submitted because the server requires evidence.
        */
        const picked = Array.from(files);
        setRows((prev) =>
            prev.map((r) => (r.lineId === lineId ? { ...r, photos: [...r.photos, ...picked] } : r)),
        );
    }

    function dropPhoto(lineId: string, index: number) {
        setRows((prev) =>
            prev.map((r) =>
                r.lineId === lineId ? { ...r, photos: r.photos.filter((_, i) => i !== index) } : r,
            ),
        );
    }

    async function submit() {
        if (!transfer) {
            return;
        }
        setError(null);
        if (!claimed.length) {
            setError('Enter a damaged quantity against at least one item.');
            return;
        }

        // Photos go up as one flat list; each line names its own by position in it.
        // The order the rows are walked here IS the order of that list, so building
        // both in the same pass is what keeps the indexes honest.
        const files: File[] = [];
        const lines: DamageLineInput[] = claimed.map((row) => {
            const photoIndexes = row.photos.map((file) => {
                files.push(file);
                return files.length - 1;
            });
            const typed = Number(row.amount);
            return {
                lineId: row.lineId,
                // The pool quantity goes in the line's own unit and the server
                // converts. Sending damagedKg for a counted line is refused outright
                // there rather than being multiplied by a thousand.
                ...(row.isPooled ? { damagedPoolQty: typed } : { damagedPcs: typed }),
                ...(row.note.trim() ? { note: row.note.trim() } : {}),
                ...(photoIndexes.length ? { photoIndexes } : {}),
            };
        });

        setIsBusy(true);
        try {
            const created = await createDamageRequest(
                {
                    transferId: transfer.id,
                    ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
                    lines,
                },
                files,
                channelToken,
            );
            toast.success(`${created.damageNumber} submitted for approval`);
            router.replace(`/goods-transfer/${transfer.id}`);
        } catch (err) {
            // The server's wording names the line and the percentage — better than
            // anything this screen could summarise.
            setError(err instanceof Error ? err.message : 'Could not submit the damage claim');
            setIsBusy(false);
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

    // Damage belongs to the branch that RECEIVED the goods, and only once they are
    // actually here. Both are re-checked because a URL can be typed; the server
    // refuses it regardless.
    const atDestination = String(channelId) === String(transfer.destinationChannelId);
    if (!can.raiseDamage || !atDestination || transfer.state !== 'RECEIVED') {
        return <NotAllowedNotice action="report damage on this transfer" branch={channelCode} />;
    }

    return (
        <div className="p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <button
                        onClick={() => router.push(`/goods-transfer/${transfer.id}`)}
                        className="mb-1 cursor-pointer text-[0.75rem] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)]"
                    >
                        ← {transfer.transferNumber}
                    </button>
                    <h1 className="text-[1.125rem] font-bold tracking-tight text-[var(--foreground)]">
                        Report damage
                    </h1>
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        Enter what arrived broken. Everything from this transfer goes in one claim.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        className={BUTTON}
                        onClick={() => router.push(`/goods-transfer/${transfer.id}`)}
                        disabled={isBusy}
                    >
                        Cancel
                    </button>
                    <button
                        className={BUTTON_SOLID}
                        onClick={() => void submit()}
                        // Blocked while any row claims more than arrived. The server
                        // would refuse the whole claim, so letting it be pressed only
                        // buys a round trip and an error nobody can act on quickly.
                        disabled={isBusy || !claimed.length || overClaimed.length > 0}
                    >
                        {isBusy ? 'Submitting…' : 'Submit claim'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--error-bg)] px-4 py-3 text-[0.8125rem] text-[var(--tone-red)]">
                    {error}
                </div>
            )}

            {missingPhotos.length > 0 && (
                <div className="mb-4 rounded-lg border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.1)] px-4 py-3 text-[0.8125rem] text-[var(--tone-amber)]">
                    {missingPhotos.length} item{missingPhotos.length === 1 ? '' : 's'} at or above{' '}
                    {PHOTO_THRESHOLD_PCT}% need a photo before this can be submitted:{' '}
                    {missingPhotos.map((r) => r.productName).join(', ')}
                </div>
            )}

            <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <label
                    htmlFor="gt-dmg-remarks"
                    className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                >
                    Remarks for the whole claim
                </label>
                <input
                    id="gt-dmg-remarks"
                    className={FIELD_INPUT}
                    value={remarks}
                    placeholder="Optional"
                    onChange={(e) => setRemarks(e.target.value)}
                />
            </div>

            <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
                {/*
                  ── Phone: one card per product ──

                  The widest table in this section — 52rem against a phone's 23, so
                  more than half of every row was off-screen. The two things this
                  screen exists for were the worst affected: the share, which decides
                  whether a photo is required, and the camera button, both of which sat
                  in the columns furthest to the right.

                  The card puts them in the order the work happens: what it is, how
                  much is broken, what share that is, and then the evidence.
                */}
                <ul className="md:hidden">
                    {rows.map((row) => {
                        const pct = percentOf(row);
                        const needsPhoto = pct != null && pct >= PHOTO_THRESHOLD_PCT;
                        const isClaimed = Number(row.amount) > 0;
                        const over = exceedsReceived(row);
                        return (
                            <li
                                key={row.lineId}
                                className={`border-b border-[var(--card-border)] p-3 last:border-b-0 ${
                                    isClaimed ? 'bg-[rgba(245,158,11,0.05)]' : ''
                                }`}
                            >
                                <p className="text-[0.875rem] font-medium text-[var(--foreground)]">
                                    {row.productName}
                                </p>
                                <p className="mt-0.5 text-[0.75rem] text-[var(--text-muted)]">
                                    {row.sku && <span className="font-mono">{row.sku} · </span>}
                                    Received{' '}
                                    <span className="tabular-nums">
                                        {receivedOf(row)}
                                    </span>
                                </p>

                                <div className="mt-2.5 flex items-center gap-2">
                                    <input
                                        value={row.amount}
                                        inputMode="decimal"
                                        placeholder={unitPlaceholder(row.isPooled ? row.poolUnit : null)}
                                        aria-label={`Damaged quantity of ${row.productName}`}
                                        onChange={(e) =>
                                            update(row.lineId, {
                                                amount: cleanAmount(
                                                    e.target.value,
                                                    row.isPooled ? row.poolUnit : null,
                                                ),
                                            })
                                        }
                                        className={`min-h-[2.75rem] flex-1 rounded-lg border bg-[var(--input-bg)] px-3 text-right text-[1rem] tabular-nums text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)] ${
                                            over
                                                ? 'border-[var(--tone-red)]'
                                                : 'border-[var(--input-border)]'
                                        }`}
                                    />
                                    <span className="w-9 text-[0.8125rem] text-[var(--text-muted)]">
                                        {unitSuffix(row.isPooled ? row.poolUnit : null)}
                                    </span>
                                </div>

                                {/* Under the box being typed into, the moment it stops
                                    being true — not on submit, and not as "line 2". */}
                                {over && (
                                    <p className="mt-1.5 text-[0.75rem] font-medium text-[var(--tone-red)]">
                                        {exceedMessage(row)}
                                    </p>
                                )}

                                {/* Named, and directly under the number that produces
                                    it. This is what decides the photo rule, so it must
                                    not be something the person has to go and find —
                                    and it must be obvious WHAT it is a percentage of. */}
                                {pct != null && (
                                    <p
                                        className={`mt-1.5 text-[0.75rem] ${
                                            needsPhoto ? 'text-[var(--tone-amber)]' : 'text-[var(--text-muted)]'
                                        }`}
                                    >
                                        Damage %{' '}
                                        <span className="font-semibold tabular-nums">
                                            {pct.toFixed(2)}%
                                        </span>
                                    </p>
                                )}

                                {isClaimed && (
                                    <>
                                        <input
                                            value={row.note}
                                            placeholder="Note (optional)"
                                            aria-label={`Note about ${row.productName}`}
                                            onChange={(e) => update(row.lineId, { note: e.target.value })}
                                            className="mt-2 min-h-[2.75rem] w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-[1rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)]"
                                        />

                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            {row.photos.map((file, index) => (
                                                <PhotoThumb
                                                    key={`${file.name}-${file.lastModified}-${index}`}
                                                    file={file}
                                                    onView={viewPhoto}
                                                    onRemove={() => dropPhoto(row.lineId, index)}
                                                />
                                            ))}
                                            <label
                                                className={`flex min-h-[3.5rem] cursor-pointer items-center gap-2 rounded-lg border px-3 text-[0.8125rem] font-medium transition-colors ${
                                                    needsPhoto && !row.photos.length
                                                        ? 'border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.12)] text-[var(--tone-amber)]'
                                                        : 'border-[var(--card-border)] bg-overlay/[0.06] text-[var(--text-muted)]'
                                                }`}
                                            >
                                                <svg
                                                    width="18"
                                                    height="18"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                >
                                                    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                                                    <circle cx="12" cy="13" r="4" />
                                                </svg>
                                                {row.photos.length ? 'Add another' : 'Take photo'}
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    capture="environment"
                                                    multiple
                                                    hidden
                                                    onChange={(e) => {
                                                        addPhotos(row.lineId, e.target.files);
                                                        e.target.value = '';
                                                    }}
                                                />
                                            </label>
                                        </div>

                                        {needsPhoto && !row.photos.length && (
                                            <p className="mt-1.5 text-[0.75rem] text-[var(--tone-amber)]">
                                                At {PHOTO_THRESHOLD_PCT}% or more a photo is required
                                            </p>
                                        )}
                                    </>
                                )}
                            </li>
                        );
                    })}
                </ul>

                {/* ── md and up: the table ── */}
                <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[52rem] border-collapse text-[0.8125rem]">
                        <thead>
                            <tr className="border-b border-[var(--card-border)]">
                                <th className={TH}>Item</th>
                                {/* Renamed with the figure itself: this is what the
                                    transfer delivered, not what the branch holds. */}
                                <th className={`${TH} text-right`}>Received</th>
                                <th className={`${TH} text-right`}>Damaged</th>
                                <th className={`${TH} text-right`}>Damage %</th>
                                <th className={TH}>Note</th>
                                <th className={TH}>Photos</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const pct = percentOf(row);
                                const needsPhoto = pct != null && pct >= PHOTO_THRESHOLD_PCT;
                                const isClaimed = Number(row.amount) > 0;
                                const over = exceedsReceived(row);
                                return (
                                    <tr
                                        key={row.lineId}
                                        className={`border-b border-[var(--card-border)] last:border-b-0 ${
                                            isClaimed ? 'bg-[rgba(245,158,11,0.05)]' : ''
                                        }`}
                                    >
                                        <td className="px-4 py-2.5 text-[var(--foreground)]">
                                            {row.productName}
                                            {row.sku && (
                                                <span className="ml-1 font-mono text-[0.75rem] text-[var(--text-muted)]">
                                                    · {row.sku}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-muted)]">
                                            {receivedOf(row)}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center justify-end gap-1.5">
                                                <input
                                                    value={row.amount}
                                                    inputMode="decimal"
                                                    placeholder={unitPlaceholder(row.isPooled ? row.poolUnit : null)}
                                                    onChange={(e) =>
                                                        update(row.lineId, {
                                                            amount: cleanAmount(
                                                                e.target.value,
                                                                row.isPooled ? row.poolUnit : null,
                                                            ),
                                                        })
                                                    }
                                                    className={`w-24 rounded-lg border bg-[var(--input-bg)] px-2 py-1.5 text-right text-[0.8125rem] tabular-nums text-[var(--foreground)] outline-none focus:border-[var(--input-focus)] ${
                                                        over
                                                            ? 'border-[var(--tone-red)]'
                                                            : 'border-[var(--input-border)]'
                                                    }`}
                                                />
                                                <span className="w-8 text-[0.75rem] text-[var(--text-muted)]">
                                                    {unitSuffix(row.isPooled ? row.poolUnit : null)}
                                                </span>
                                            </div>
                                            {/* Under the box, same as on a phone. */}
                                            {over && (
                                                <p className="mt-1 text-right text-[0.75rem] font-medium text-[var(--tone-red)]">
                                                    {exceedMessage(row)}
                                                </p>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums">
                                            {pct == null ? (
                                                <span className="text-[var(--text-muted)]">—</span>
                                            ) : (
                                                <span
                                                    className={
                                                        needsPhoto
                                                            ? 'text-[var(--tone-amber)]'
                                                            : 'text-[var(--text-muted)]'
                                                    }
                                                >
                                                    {pct.toFixed(2)}%
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <input
                                                value={row.note}
                                                placeholder="Optional"
                                                onChange={(e) => update(row.lineId, { note: e.target.value })}
                                                className="w-40 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-[0.8125rem] text-[var(--foreground)] outline-none focus:border-[var(--input-focus)]"
                                            />
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                {row.photos.map((file, index) => (
                                                    <PhotoThumb
                                                        key={`${file.name}-${file.lastModified}-${index}`}
                                                        file={file}
                                                        onView={viewPhoto}
                                                        onRemove={() => dropPhoto(row.lineId, index)}
                                                    />
                                                ))}
                                                <label
                                                    title={`Take a photo of ${row.productName}`}
                                                    aria-label={`Take a photo of ${row.productName}`}
                                                    className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border transition-colors ${
                                                        needsPhoto && !row.photos.length
                                                            ? 'border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.12)] text-[var(--tone-amber)] hover:bg-[rgba(245,158,11,0.2)]'
                                                            : 'border-[var(--card-border)] bg-overlay/[0.06] text-[var(--text-muted)] hover:bg-overlay/[0.1] hover:text-[var(--foreground)]'
                                                    }`}
                                                >
                                                    <svg
                                                        width="16"
                                                        height="16"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    >
                                                        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                                                        <circle cx="12" cy="13" r="4" />
                                                    </svg>
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        /*
                                                          On a phone this opens the REAR camera straight
                                                          away rather than a file browser — damage is
                                                          photographed where it is found, and this app is
                                                          meant to be used standing in front of the goods.
                                                          Desktop browsers ignore `capture` and open the
                                                          usual file picker, so nothing is lost there and
                                                          `multiple` still applies.
                                                        */
                                                        capture="environment"
                                                        multiple
                                                        hidden
                                                        onChange={(e) => {
                                                            addPhotos(row.lineId, e.target.files);
                                                            e.target.value = '';
                                                        }}
                                                    />
                                                </label>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--card-border)] px-4 py-3 text-[0.75rem] text-[var(--text-muted)]">
                    <span>
                        {claimed.length} of {rows.length} item{rows.length === 1 ? '' : 's'} claimed
                    </span>
                    <span>A photo is required at {PHOTO_THRESHOLD_PCT}% or more</span>
                </div>
            </div>

            {/* One viewer for the whole screen, opened by whichever thumbnail was
                tapped. Mounted last so it lies over everything. */}
            {viewing && <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />}
        </div>
    );
}
