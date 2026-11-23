'use client';

/**
 * Responsive variant x channel price grid — dark theme, plain Tailwind.
 *
 *   < 640px (sm)  ─ card per variant, channels as ROWS (no horizontal scroll).
 *   >= 640px      ─ true matrix: frozen variant column + sticky header.
 *
 * Columns are the channels this tag's result actually uses (backend union),
 * so a 4-channel tag shows 4 columns even when the system has more. A variant
 * not in a column renders a locked "not sold" cell.
 *
 * Cell states: priced (editable) · empty ₹— (assigned, no price) ·
 * locked "not sold" (unassigned) · dirty (amber) · invalid/rejected (red).
 */

import { memo, useEffect, useMemo, useRef } from 'react';
import type { VariantPriceMatrix } from '@/services/price-matrix.service';
import { cellKey } from '@/lib/price';

const DEFAULT_CODE = '__default_channel__';

function prettyChannel(code: string): string {
    if (code === DEFAULT_CODE) return 'Master';
    return code
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

interface PriceMatrixGridProps {
    matrix: VariantPriceMatrix;
    getCellValue: (variantId: string, channelId: string) => string;
    isDirty: (variantId: string, channelId: string) => boolean;
    isInvalid: (variantId: string, channelId: string) => boolean;
    onChange: (variantId: string, channelId: string, value: string) => void;
    rejectedKey?: string | null;
}

export function PriceMatrixGrid({
    matrix,
    getCellValue,
    isDirty,
    isInvalid,
    onChange,
    rejectedKey,
}: PriceMatrixGridProps) {
    const channelById = useMemo(
        () => new Map(matrix.channels.map((c) => [c.id, c])),
        [matrix.channels],
    );
    return (
        <>
            {/* Phone: cards */}
            <div className="space-y-3 sm:hidden">
                {matrix.rows.map((row) => (
                    <div
                        key={row.variantId}
                        className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
                    >
                        <div className="border-b border-zinc-800 bg-zinc-800/40 px-3.5 py-2.5">
                            <div className="font-semibold text-zinc-100">{row.name}</div>
                            <div className="text-xs text-zinc-500">{row.sku}</div>
                        </div>
                        {row.cells.map((cell) => {
                            const channel = channelById.get(cell.channelId);
                            const isMaster = channel?.code === DEFAULT_CODE;
                            return (
                                <div
                                    key={cell.channelId}
                                    className={`flex items-center justify-between border-b border-zinc-800/60 px-3.5 py-2 last:border-b-0 ${
                                        isMaster ? 'bg-indigo-500/10' : ''
                                    }`}
                                >
                                    <span className="text-sm font-medium text-zinc-400">
                                        {prettyChannel(channel?.code ?? cell.channelId)}
                                    </span>
                                    <PriceCell
                                        variantId={row.variantId}
                                        variantName={row.name}
                                        channelLabel={prettyChannel(channel?.code ?? cell.channelId)}
                                        cell={cell}
                                        value={getCellValue(row.variantId, cell.channelId)}
                                        dirty={isDirty(row.variantId, cell.channelId)}
                                        invalid={isInvalid(row.variantId, cell.channelId)}
                                        rejected={rejectedKey === cellKey(row.variantId, cell.channelId)}
                                        onChange={onChange}
                                    />
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>

            {/* Tablet/desktop: matrix */}
            <div className="hidden overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900 sm:block">
                <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                        <tr>
                            <th className="sticky left-0 top-0 z-20 border-b border-zinc-800 bg-zinc-900 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.5)]">
                                Variant
                            </th>
                            {matrix.channels.map((channel) => {
                                const isMaster = channel.code === DEFAULT_CODE;
                                return (
                                    <th
                                        key={channel.id}
                                        className={`sticky top-0 z-10 border-b border-zinc-800 px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide ${
                                            isMaster
                                                ? 'bg-indigo-500/15 text-indigo-300'
                                                : 'bg-zinc-900 text-zinc-400'
                                        }`}
                                    >
                                        {prettyChannel(channel.code)}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {matrix.rows.map((row, i) => (
                            <tr key={row.variantId} className="group">
                                <td
                                    className={`sticky left-0 z-10 border-b border-zinc-800 px-4 py-2.5 text-left align-middle shadow-[2px_0_6px_-2px_rgba(0,0,0,0.5)] ${
                                        i % 2 ? 'bg-zinc-900' : 'bg-zinc-900/60'
                                    } group-hover:bg-zinc-800/70`}
                                >
                                    <div className="font-medium text-zinc-100">{row.name}</div>
                                    <div className="text-xs text-zinc-500">{row.sku}</div>
                                </td>
                                {row.cells.map((cell) => {
                                    const channel = channelById.get(cell.channelId);
                                    const isMaster = channel?.code === DEFAULT_CODE;
                                    return (
                                        <td
                                            key={cell.channelId}
                                            className={`border-b border-zinc-800 px-2.5 py-2 text-right align-middle group-hover:bg-zinc-800/40 ${
                                                isMaster
                                                    ? 'bg-indigo-500/10'
                                                    : i % 2
                                                      ? 'bg-zinc-900'
                                                      : 'bg-zinc-900/60'
                                            }`}
                                        >
                                            <PriceCell
                                                variantId={row.variantId}
                                                variantName={row.name}
                                                channelLabel={prettyChannel(
                                                    channel?.code ?? cell.channelId,
                                                )}
                                                cell={cell}
                                                value={getCellValue(row.variantId, cell.channelId)}
                                                dirty={isDirty(row.variantId, cell.channelId)}
                                                invalid={isInvalid(row.variantId, cell.channelId)}
                                                rejected={
                                                    rejectedKey ===
                                                    cellKey(row.variantId, cell.channelId)
                                                }
                                                onChange={onChange}
                                            />
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ─── Single editable / locked cell ───────────────────────────────────

interface PriceCellProps {
    variantId: string;
    variantName: string;
    channelLabel: string;
    cell: VariantPriceMatrix['rows'][number]['cells'][number];
    value: string;
    dirty: boolean;
    invalid: boolean;
    rejected: boolean;
    onChange: (variantId: string, channelId: string, value: string) => void;
}

const PriceCell = memo(function PriceCell({
    variantId,
    variantName,
    channelLabel,
    cell,
    value,
    dirty,
    invalid,
    rejected,
    onChange,
}: PriceCellProps) {
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (rejected && ref.current) {
            ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            ref.current.focus();
        }
    }, [rejected]);

    if (!cell.assigned) {
        return (
            <span
                aria-disabled="true"
                aria-label={`${variantName}, ${channelLabel}: not sold`}
                className="ml-auto inline-flex h-10 w-[96px] items-center justify-center rounded-lg bg-[repeating-linear-gradient(45deg,var(--color-zinc-800),var(--color-zinc-800)_6px,var(--color-zinc-700)_6px,var(--color-zinc-700)_12px)] text-[11px] font-medium text-zinc-500"
            >
                not sold
            </span>
        );
    }

    const state =
        invalid || rejected
            ? 'border-2 border-red-500 bg-red-500/10 text-red-300 focus:border-red-400'
            : dirty
              ? 'border-2 border-amber-500 bg-amber-500/10 text-amber-200 focus:border-amber-400'
              : 'border border-zinc-700 bg-zinc-950 text-zinc-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30';

    return (
        <span className="relative ml-auto inline-flex items-center">
            <span className="pointer-events-none absolute left-2.5 text-xs text-zinc-500">₹</span>
            <input
                ref={ref}
                type="text"
                inputMode="decimal"
                aria-label={`${variantName}, ${channelLabel} price in rupees`}
                aria-invalid={invalid || rejected}
                value={value}
                placeholder="—"
                onChange={(e) => onChange(variantId, cell.channelId, e.target.value)}
                className={`h-10 w-[96px] rounded-lg pl-6 pr-2.5 text-right text-[15px] font-semibold tabular-nums outline-none transition-colors placeholder:text-zinc-600 ${state}`}
            />
            {dirty && !invalid && !rejected && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-zinc-900 bg-amber-500" />
            )}
        </span>
    );
});
