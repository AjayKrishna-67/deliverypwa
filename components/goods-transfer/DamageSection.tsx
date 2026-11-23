'use client';

/**
 * The damage claims on a transfer, shown on the transfer's own page.
 *
 * Not a page of its own: a claim only means anything next to the transfer it was
 * raised against — the lines, the stock and the decision belong together, and
 * sending someone elsewhere to approve makes them check the transfer twice.
 *
 * Who may decide is a CHANNEL question, not only a permission one. The branch that
 * SENT the goods approves; the branch that RECEIVED them reports. Holding
 * ApproveTransferDamage on some other branch does not make a claim between two
 * others yours to settle, and the server enforces exactly that — this only decides
 * what is worth showing.
 */

import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/goods-transfer/ConfirmDialog';
import {
    assetUrl,
    damageStateClasses,
    formatDamagedQuantity,
    formatState,
    longDate,
} from '@/lib/goods-transfer-format';
import { STOCK_UNITS, formatMeasured } from '@/lib/stock-units';
import { approveDamageRequest, rejectDamageRequest } from '@/services/goods-transfer.service';
import type { DamageRequestDetail } from '@/types/goods-transfer';

const TH = 'px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';

/**
 * What the transfer delivered of this product, in the unit the claim was made in.
 *
 * The snapshot is a base integer, and `poolUnit` — copied off the transfer line when
 * the claim was raised — says what it counts. A counted product reads as a count,
 * where scaling it as grams turned 30 lemons into "30 g".
 */
function receivedOf(line: {
    isPooled: boolean;
    poolUnit: string | null;
    receivedQtySnapshot: number;
}): string {
    if (!line.isPooled) {
        return `${line.receivedQtySnapshot} pcs`;
    }
    const base = STOCK_UNITS[line.poolUnit ?? '']?.baseUnit ?? 'piece';
    return base === 'piece'
        ? `${line.receivedQtySnapshot} pcs`
        : formatMeasured(line.receivedQtySnapshot, base);
}
const BUTTON =
    'cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-3 py-1.5 text-[0.75rem] font-medium text-[var(--foreground)] transition-colors hover:bg-overlay/[0.1] disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SOLID =
    'cursor-pointer rounded-lg border border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] px-3 py-1.5 text-[0.75rem] font-semibold text-[var(--tone-indigo-soft)] transition-colors hover:bg-[rgba(99,102,241,0.25)] disabled:cursor-not-allowed disabled:opacity-50';

export function DamageSection({
    claims,
    canApprove,
    channelToken,
    onDecided,
}: {
    claims: DamageRequestDetail[];
    canApprove: boolean;
    channelToken: string;
    onDecided: () => void;
}) {
    const [decision, setDecision] = useState<{
        claim: DamageRequestDetail;
        approve: boolean;
    } | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function decide() {
        if (!decision) {
            return;
        }
        const { claim, approve } = decision;
        setIsBusy(true);
        setError(null);
        try {
            if (approve) {
                await approveDamageRequest(claim.id, channelToken);
                toast.success(`${claim.damageNumber} approved — stock deducted at the destination`);
            } else {
                await rejectDamageRequest(claim.id, channelToken);
                toast.info(`${claim.damageNumber} rejected — stock unchanged`);
            }
            setDecision(null);
            onDecided();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not record the decision');
        } finally {
            setIsBusy(false);
        }
    }

    return (
        <>
            <h2 className="mb-3 mt-6 text-[0.9375rem] font-semibold text-[var(--foreground)]">Damage</h2>

            {error && (
                <div className="mb-4 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--error-bg)] px-4 py-3 text-[0.8125rem] text-[var(--tone-red)]">
                    {error}
                </div>
            )}

            {claims.map((claim) => (
                <div
                    key={claim.id}
                    className="mb-4 overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]"
                >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--card-border)] px-4 py-3">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold tabular-nums text-[var(--foreground)]">
                                    {claim.damageNumber}
                                </span>
                                <span
                                    className={`rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold ${damageStateClasses(claim.state)}`}
                                >
                                    {formatState(claim.state)}
                                </span>
                            </div>
                            <p className="mt-1 text-[0.75rem] text-[var(--text-muted)]">
                                Raised by {claim.createdByName} · {longDate(claim.createdAt)}
                                {claim.approvedByName && ` · decided by ${claim.approvedByName}`}
                            </p>
                            {claim.remarks && (
                                <p className="mt-1 text-[0.8125rem] text-[var(--foreground)]">
                                    {claim.remarks}
                                </p>
                            )}
                        </div>

                        {canApprove && claim.state === 'PENDING_APPROVAL' && (
                            <div className="flex gap-2">
                                <button
                                    className={BUTTON}
                                    disabled={isBusy}
                                    onClick={() => setDecision({ claim, approve: false })}
                                >
                                    Reject
                                </button>
                                <button
                                    className={BUTTON_SOLID}
                                    disabled={isBusy}
                                    onClick={() => setDecision({ claim, approve: true })}
                                >
                                    Approve
                                </button>
                            </div>
                        )}
                    </div>

                    {/*
                      ── Phone: one card per claimed product ──

                      Six columns in 46rem. The person deciding this claim is the
                      source branch, and what they decide on is the damage against
                      what was received plus the photograph — all of which lived past
                      the right-hand edge on a phone.
                    */}
                    <ul className="md:hidden">
                        {claim.lines.map((line) => (
                            <li
                                key={line.id}
                                className="border-b border-[var(--card-border)] p-3 last:border-b-0"
                            >
                                <p className="text-[0.875rem] font-medium text-[var(--foreground)]">
                                    {line.productName}
                                </p>
                                {line.sku && (
                                    <p className="mt-0.5 font-mono text-[0.75rem] text-[var(--text-muted)]">
                                        {line.sku}
                                    </p>
                                )}
                                <dl className="mt-1.5 grid grid-cols-3 gap-2">
                                    <div className="min-w-0">
                                        <dt className="text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                            Damaged
                                        </dt>
                                        <dd className="mt-0.5 text-[0.8125rem] tabular-nums text-[var(--foreground)]">
                                            {formatDamagedQuantity(line)}
                                        </dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className="text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                            Received
                                        </dt>
                                        <dd className="mt-0.5 text-[0.8125rem] tabular-nums text-[var(--text-muted)]">
                                            {receivedOf(line)}
                                        </dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className="text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                            Damage %
                                        </dt>
                                        <dd className="mt-0.5 text-[0.8125rem] tabular-nums text-[var(--tone-amber)]">
                                            {line.damagePercent ?? '—'}%
                                        </dd>
                                    </div>
                                </dl>
                                {line.note && (
                                    <p className="mt-1 text-[0.75rem] text-[var(--text-muted)]">
                                        {line.note}
                                    </p>
                                )}
                                {line.photos.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {line.photos.map((photo) => (
                                            <a
                                                key={photo.id}
                                                href={assetUrl({ source: photo.source })}
                                                target="_blank"
                                                rel="noreferrer"
                                                title={photo.name}
                                                className="block h-14 w-14 overflow-hidden rounded-lg border border-[var(--card-border)]"
                                            >
                                                {/* Plain <img> for the same reason as the
                                                    table below — a Vendure asset host that
                                                    next/image is not configured for. */}
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={photo.preview || assetUrl({ source: photo.source })}
                                                    alt={photo.name}
                                                    className="h-full w-full object-cover"
                                                />
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>

                    {/* ── md and up: the table ── */}
                    <div className="hidden overflow-x-auto md:block">
                        <table className="w-full min-w-[46rem] border-collapse text-[0.8125rem]">
                            <thead>
                                <tr className="border-b border-[var(--card-border)]">
                                    <th className={TH}>Item</th>
                                    <th className={`${TH} text-right`}>Damaged</th>
                                    <th className={`${TH} text-right`}>Received</th>
                                    <th className={`${TH} text-right`}>Damage %</th>
                                    <th className={TH}>Note</th>
                                    <th className={TH}>Photos</th>
                                </tr>
                            </thead>
                            <tbody>
                                {claim.lines.map((line) => (
                                    <tr
                                        key={line.id}
                                        className="border-b border-[var(--card-border)] last:border-b-0"
                                    >
                                        <td className="px-4 py-2.5 text-[var(--foreground)]">
                                            {line.productName}
                                            {line.sku && (
                                                <span className="ml-1 font-mono text-[0.75rem] text-[var(--text-muted)]">
                                                    · {line.sku}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--foreground)]">
                                            {formatDamagedQuantity(line)}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-muted)]">
                                            {/* The snapshot is stored the way the product is
                                                measured: base units when pooled — grams for a
                                                weighed one, pieces for a counted one. */}
                                            {receivedOf(line)}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--foreground)]">
                                            {line.damagePercent ?? '—'}%
                                        </td>
                                        <td className="px-4 py-2.5 text-[var(--text-muted)]">
                                            {line.note || '—'}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {line.photos.length === 0 ? (
                                                <span className="text-[var(--text-muted)]">—</span>
                                            ) : (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {line.photos.map((photo) => (
                                                        <a
                                                            key={photo.id}
                                                            href={assetUrl({ source: photo.source })}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            title={photo.name}
                                                            className="block h-10 w-10 overflow-hidden rounded-md border border-[var(--card-border)]"
                                                        >
                                                            {/*
                                                              A plain <img>, not next/image: these are
                                                              user-uploaded files on the Vendure asset
                                                              host, and next/image would need that host
                                                              added to images.remotePatterns in
                                                              next.config.ts — an existing file this
                                                              branch deliberately does not touch. They
                                                              are 40px thumbnails; there is nothing to
                                                              optimise.
                                                            */}
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img
                                                                src={assetUrl({ source: photo.preview })}
                                                                alt={photo.name}
                                                                className="h-full w-full object-cover"
                                                            />
                                                        </a>
                                                    ))}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}

            {decision && (
                <ConfirmDialog
                    tone={decision.approve ? 'primary' : 'danger'}
                    title={
                        decision.approve
                            ? `Approve ${decision.claim.damageNumber}?`
                            : `Reject ${decision.claim.damageNumber}?`
                    }
                    confirmLabel={
                        isBusy ? 'Working…' : decision.approve ? 'Approve claim' : 'Reject claim'
                    }
                    busy={isBusy}
                    onCancel={() => setDecision(null)}
                    onConfirm={() => void decide()}
                    body={
                        decision.approve ? (
                            <>
                                <p>
                                    Stock is deducted at the destination for every item on this claim. It
                                    cannot be undone.
                                </p>
                                <p className="text-[var(--foreground)]">
                                    {decision.claim.lines.length} item
                                    {decision.claim.lines.length === 1 ? '' : 's'} on this claim
                                </p>
                            </>
                        ) : (
                            <p>The claim is closed and stock is left exactly as it is.</p>
                        )
                    }
                />
            )}
        </>
    );
}
