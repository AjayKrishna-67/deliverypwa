'use client';

/**
 * A dropdown of channels with a checkbox each — pick one, several, or none.
 *
 * Lifted out of the Reports screen, where it has been in daily use, so Goods Transfer
 * gets the same control rather than a second one that behaves almost the same. A row
 * of chips says the same thing but grows with the number of branches; this stays one
 * button wide however many there are.
 *
 * WHAT NOTHING-SELECTED MEANS is the caller's to say. On a report it means "all
 * channels", because a report with no filter shows everything. On an entry screen it
 * means nothing has been chosen yet and the form is not ready. Hence `emptyLabel`:
 * the same control, honest about two different defaults.
 *
 * The dropdown is positioned with fixed coordinates rather than absolutely, so it
 * escapes any parent with overflow:hidden — a card, a table, a scrolling filter bar.
 */

import { useEffect, useRef, useState } from 'react';

export interface ChannelMultiSelectProps {
    channels: Array<{ id: string; code: string }>;
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    /** Shown on the button when nothing is selected. */
    emptyLabel?: string;
    /** How the things being picked are named in the count, e.g. "3 branches". */
    noun?: string;
    /**
     * Ids that may not be UNSELECTED — already selected and now load-bearing.
     *
     * The transfer screen uses this for a branch that has products entered against
     * it: unticking would bin typed work, and the tick is a long way from the rows on
     * a phone, so there would be nothing on screen connecting the two. They are shown
     * dimmed and ignore clicks rather than disappearing, and Clear leaves them alone.
     */
    lockedIds?: string[];
}

export function ChannelMultiSelect({
    channels,
    selectedIds,
    onChange,
    emptyLabel = 'All channels',
    noun = 'channel',
    lockedIds = [],
}: ChannelMultiSelectProps) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    // position: fixed coords (escapes any parent overflow:hidden clipping)
    const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            const t = e.target as Node;
            if (
                buttonRef.current && !buttonRef.current.contains(t) &&
                dropdownRef.current && !dropdownRef.current.contains(t)
            ) {
                setOpen(false);
            }
        }
        if (open) document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    // Recompute position on open + window resize/scroll while open.
    useEffect(() => {
        if (!open) return;
        function reposition() {
            const r = buttonRef.current?.getBoundingClientRect();
            if (!r) return;
            setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }
        reposition();
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        return () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };
    }, [open]);

    /**
     * The selection as far as this control can actually SHOW it.
     *
     * `selectedIds` belongs to the caller and can name a channel that is no longer
     * offered — the Goods Transfer screens drop the branch you are working in from
     * the list, so switching branch mid-draft leaves its id selected with no row to
     * tick. The count used to come from the raw array while the ticks came from
     * `channels`, so the button read "2 branches" above a list showing one tick, and
     * picking one more said three.
     *
     * Everything the button says is derived from this instead. A control cannot
     * report a number it is not showing.
     */
    const visibleSelected = selectedIds.filter((id) => channels.some((c) => c.id === id));

    /**
     * Emit only ids this control offers, so a stale one cannot survive a click.
     *
     * The display fix above keeps the button honest; this keeps the caller's state
     * from quietly carrying an id that nothing on screen can reach — which is how an
     * unreachable branch ended up locked into a draft with no way to untick it.
     */
    function emit(ids: string[]) {
        onChange(ids.filter((id) => channels.some((c) => c.id === id)));
    }

    function toggle(id: string) {
        const selected = selectedIds.includes(id);
        if (selected && lockedIds.includes(id)) {
            return;
        }
        emit(selected ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
    }

    const label =
        visibleSelected.length === 0
            ? emptyLabel
            : visibleSelected.length === 1
              ? (channels.find((c) => c.id === visibleSelected[0])?.code ?? `1 ${noun}`)
              : `${visibleSelected.length} ${noun}s`;

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[0.75rem] cursor-pointer transition-all"
                style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                </svg>
                <span className="max-w-[140px] truncate">{label}</span>
                <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {open && pos && (
                <div
                    ref={dropdownRef}
                    className="rounded-xl overflow-hidden z-50"
                    style={{
                        position: 'fixed',
                        top: pos.top,
                        right: pos.right,
                        background: 'var(--surface)',
                        border: '1px solid rgb(var(--overlay-rgb)/0.12)',
                        boxShadow: 'var(--shadow-popover)',
                        minWidth: '220px',
                        maxHeight: '320px',
                    }}
                >
                    <div
                        className="flex items-center justify-between px-3 py-2 gap-2"
                        style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.08)' }}
                    >
                        <button
                            onClick={() => emit(channels.map((c) => c.id))}
                            className="text-[0.6875rem] font-medium cursor-pointer hover:underline"
                            style={{ color: 'var(--tone-indigo)' }}
                        >
                            Select all
                        </button>
                        <button
                            onClick={() => emit(selectedIds.filter((id) => lockedIds.includes(id)))}
                            className="text-[0.6875rem] font-medium cursor-pointer hover:underline"
                            style={{ color: 'var(--text-muted)' }}
                        >
                            Clear
                        </button>
                    </div>
                    <div className="overflow-y-auto py-1" style={{ maxHeight: '260px' }}>
                        {channels.length === 0 ? (
                            <p className="px-3 py-3 text-[0.75rem] text-[var(--text-muted)]">
                                No channels available.
                            </p>
                        ) : (
                            channels.map((ch) => {
                                const checked = selectedIds.includes(ch.id);
                                const locked = checked && lockedIds.includes(ch.id);
                                return (
                                    <button
                                        key={ch.id}
                                        onClick={() => toggle(ch.id)}
                                        disabled={locked}
                                        title={locked ? 'Remove this branch\u2019s products before unticking it' : undefined}
                                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                                            locked
                                                ? 'cursor-not-allowed opacity-60'
                                                : 'hover:bg-overlay/[0.04] cursor-pointer'
                                        }`}
                                    >
                                        <span
                                            className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                                            style={{
                                                background: checked ? '#6366f1' : 'rgb(var(--overlay-rgb)/0.06)',
                                                border: `1px solid ${checked ? '#6366f1' : 'rgb(var(--overlay-rgb)/0.2)'}`,
                                            }}
                                        >
                                            {checked && (
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            )}
                                        </span>
                                        <span className="text-[0.8125rem] font-medium truncate" style={{ color: 'var(--foreground)' }}>
                                            {ch.code}
                                        </span>
                                        {locked && (
                                            <span className="ml-auto shrink-0 text-[0.625rem] uppercase tracking-wider text-[var(--text-muted)]">
                                                in use
                                            </span>
                                        )}
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
