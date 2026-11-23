'use client';

/**
 * Printing the loading list from the transfer list — after the fact.
 *
 * The entry screens print the list for what they have just created. This is for
 * LATER: the branches have accepted, the day has moved on, and somebody wants the
 * sheet for the run again, or for the requests that have since been answered. The
 * selection is the same one the list itself understands — a direction, some
 * branches, a date window — so what prints is what the screen was showing.
 *
 * Direction is explicit because the same branch does both. Idukki sends loads to
 * Coimbatore AND asks Madurai for stock, and one sheet that added those together
 * would add outgoing goods to incoming ones. OUT is what this branch is sending; IN
 * is what is coming to it, its own requests included.
 *
 * Combined or per branch: the same merge rule, applied across the run or within each
 * branch. Per branch is one print job with a page each — not a window per branch for
 * a pop-up blocker to eat.
 */

import { useEffect, useMemo, useState } from 'react';

import { ModalPortal } from '@/components/orders/ModalPortal';
import { ChannelMultiSelect } from '@/components/ui/ChannelMultiSelect';
import { LoadingListNamesSelect } from '@/components/goods-transfer/LoadingListNamesSelect';
import type { LoadingListNames } from '@/lib/goods-transfer-loading-list-print';
import { openLoadingList } from '@/lib/goods-transfer-run-print';
import type { TransferChannel, TransferDirection } from '@/types/goods-transfer';

const DEFAULT_CHANNEL_CODE = '__default_channel__';

const FIELD_LABEL = 'mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';
const FIELD_INPUT =
    'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-[1rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)] md:py-2 md:text-[0.8125rem]';
const BUTTON =
    'cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-4 py-2 text-[0.8125rem] font-medium text-[var(--foreground)] transition-colors hover:bg-overlay/[0.1] disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SOLID =
    'cursor-pointer rounded-lg border border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] px-4 py-2 text-[0.8125rem] font-semibold text-[var(--tone-indigo-soft)] transition-colors hover:bg-[rgba(99,102,241,0.25)] disabled:cursor-not-allowed disabled:opacity-50';

export function LoadingListDialog({
    channelToken,
    channelId,
    channelCode,
    branches: allBranches,
    from: initialFrom,
    to: initialTo,
    onClose,
}: {
    channelToken: string;
    channelId: string;
    channelCode: string;
    branches: TransferChannel[];
    /** The range the list is showing, so the sheet covers what was being looked at. */
    from: string;
    to: string;
    onClose: () => void;
}) {
    const branches = useMemo(
        () =>
            allBranches
                .filter((c) => String(c.id) !== String(channelId) && c.code !== DEFAULT_CHANNEL_CODE)
                .map((c) => ({ id: String(c.id), code: c.code })),
        [allBranches, channelId],
    );

    const [direction, setDirection] = useState<TransferDirection>('OUT');
    // Empty means every branch — the dropdown says so on its face.
    const [branchIds, setBranchIds] = useState<string[]>([]);
    const [from, setFrom] = useState(initialFrom);
    const [to, setTo] = useState(initialTo);
    const [names, setNames] = useState<LoadingListNames>('tamil');
    const [busy, setBusy] = useState<'combined' | 'perBranch' | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            if (event.key === 'Escape' && !busy) {
                onClose();
            }
        }
        document.addEventListener('keydown', onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = previous;
        };
    }, [busy, onClose]);

    async function print(perBranch: boolean) {
        setBusy(perBranch ? 'perBranch' : 'combined');
        setError(null);
        setError(
            await openLoadingList(
                {
                    channelToken,
                    direction,
                    branchIds,
                    // Converted the way the transfer list converts them, so both
                    // screens select the same transfers from the same two dates.
                    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
                    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
                },
                { perBranch, names },
            ),
        );
        setBusy(null);
    }

    const chosen = branchIds.length
        ? branches.filter((b) => branchIds.includes(b.id)).map((b) => b.code)
        : [];

    return (
        <ModalPortal>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
                onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Print a loading list"
                    className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--card-border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-modal)]"
                >
                    <h2 className="mb-1 text-[1rem] font-semibold text-[var(--foreground)]">
                        Print a loading list
                    </h2>
                    <p className="mb-5 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                        One line per product, matched on the Local Name: the same product across
                        branches adds up to one figure, and anything named differently stays on its
                        own line.
                    </p>

                    {error && (
                        <p className="mb-4 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--error-bg)] px-4 py-3 text-[0.8125rem] text-[var(--tone-red)]">
                            {error}
                        </p>
                    )}

                    <span className={FIELD_LABEL}>Which way</span>
                    <div className="mb-4 flex gap-2">
                        {(
                            [
                                ['OUT', `Sending from ${channelCode}`],
                                ['IN', `Coming to ${channelCode}`],
                            ] as Array<[TransferDirection, string]>
                        ).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setDirection(value)}
                                className={`flex-1 rounded-lg border px-3 py-2.5 text-[0.8125rem] transition-colors md:py-2 ${
                                    direction === value
                                        ? 'border-[rgba(99,102,241,0.4)] bg-[rgba(99,102,241,0.15)] text-[var(--tone-indigo-soft)]'
                                        : 'cursor-pointer border-[var(--card-border)] bg-overlay/[0.04] text-[var(--text-muted)] hover:bg-overlay/[0.08]'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="mb-4 flex flex-wrap items-end gap-3">
                        <div>
                            <span className={FIELD_LABEL}>
                                {direction === 'OUT' ? 'Going to' : 'Coming from'}
                            </span>
                            <ChannelMultiSelect
                                channels={branches}
                                selectedIds={branchIds}
                                onChange={setBranchIds}
                                emptyLabel="All branches"
                                noun="branch"
                            />
                        </div>
                        <div className="w-[9.5rem]">
                            <label className={FIELD_LABEL} htmlFor="gt-ll-from">
                                From
                            </label>
                            <input
                                id="gt-ll-from"
                                type="date"
                                className={FIELD_INPUT}
                                value={from}
                                onChange={(e) => setFrom(e.target.value)}
                            />
                        </div>
                        <div className="w-[9.5rem]">
                            <label className={FIELD_LABEL} htmlFor="gt-ll-to">
                                To
                            </label>
                            <input
                                id="gt-ll-to"
                                type="date"
                                className={FIELD_INPUT}
                                value={to}
                                onChange={(e) => setTo(e.target.value)}
                            />
                        </div>
                        <LoadingListNamesSelect
                            id="gt-ll-names"
                            className="w-[15rem]"
                            value={names}
                            onChange={setNames}
                            disabled={!!busy}
                        />
                    </div>

                    <p className="mb-5 text-[0.75rem] text-[var(--text-muted)]">
                        {direction === 'OUT' ? 'Transfers sent' : 'Transfers coming'}
                        {chosen.length ? ` — ${chosen.join(', ')}` : ' — every branch'}
                        {from || to ? `, ${from || 'any date'} to ${to || 'any date'}` : ''}.
                        Drafts and unsent requests are included: this is the picking sheet, wanted
                        before anything is confirmed.
                    </p>

                    <div className="flex flex-wrap justify-end gap-2">
                        <button className={BUTTON} onClick={onClose} disabled={!!busy}>
                            Close
                        </button>
                        <button className={BUTTON} onClick={() => void print(true)} disabled={!!busy}>
                            {busy === 'perBranch' ? 'Preparing…' : 'A page per branch'}
                        </button>
                        <button className={BUTTON_SOLID} onClick={() => void print(false)} disabled={!!busy}>
                            {busy === 'combined' ? 'Preparing…' : 'One combined list'}
                        </button>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
}
