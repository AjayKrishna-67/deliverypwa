'use client';

/**
 * The toolbar pickers the goods-transfer screens share, and the language one itself.
 *
 * Pulled out of the request form when the transfer detail screen needed the same
 * control: the P.List printed there and the sheet printed from the request form are the
 * same sheet, so the choice of what language it comes out in has to look and behave the
 * same in both places.
 */

import { useEffect, useRef, useState } from 'react';

import type { RequestPrintLanguage } from '@/lib/goods-transfer-request-print';

/**
 * A panel that hangs under its button and closes when you click away.
 *
 * Positioned in viewport coordinates rather than against a parent, so it escapes
 * anything that clips its overflow, and re-measured on scroll and resize because fixed
 * coordinates go stale the moment the page moves under them.
 */
export function useAnchoredPanel() {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            const t = e.target as Node;
            if (
                buttonRef.current &&
                !buttonRef.current.contains(t) &&
                panelRef.current &&
                !panelRef.current.contains(t)
            ) {
                setOpen(false);
            }
        }
        if (open) document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        function reposition() {
            const r = buttonRef.current?.getBoundingClientRect();
            if (!r) return;
            setPos({ top: r.bottom + 4, left: r.left });
        }
        reposition();
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        return () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };
    }, [open]);

    return { open, setOpen, buttonRef, panelRef, pos };
}

/** The shell every toolbar picker wears: the button's chrome and the panel's. */
export const PICKER_BUTTON =
    'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[0.8125rem] transition-all disabled:cursor-not-allowed disabled:opacity-50';
export const PICKER_BUTTON_STYLE = {
    background: 'rgb(var(--overlay-rgb)/0.04)',
    border: '1px solid rgb(var(--overlay-rgb)/0.12)',
    color: 'var(--foreground)',
} as const;
export const PICKER_PANEL_STYLE = {
    background: 'var(--surface)',
    border: '1px solid rgb(var(--overlay-rgb)/0.12)',
    boxShadow: 'var(--shadow-popover)',
    maxHeight: '320px',
} as const;
export const PICKER_OPTION =
    'flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-overlay/[0.04]';

/** The tick beside the chosen row, filled when it is the chosen one. */
export function PickerTick({ on }: { on: boolean }) {
    return (
        <span
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
            style={{
                background: on ? '#6366f1' : 'rgb(var(--overlay-rgb)/0.06)',
                border: `1px solid ${on ? '#6366f1' : 'rgb(var(--overlay-rgb)/0.2)'}`,
            }}
        >
            {on && (
                <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            )}
        </span>
    );
}

/** The caret, turned over while the panel is open. */
export function PickerCaret({ open }: { open: boolean }) {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
                transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
            }}
        >
            <polyline points="6 9 12 15 18 9" />
        </svg>
    );
}

/**
 * What the printed sheet calls the products.
 *
 * Both names come out of the same master row, so the sheet is the same sheet either
 * way — same products, same order, same quantities — and only the script changes.
 * Manglish is the master's Product Name column: Malayalam written in English letters,
 * which is what somebody who cannot read Tamil script picks goods by.
 */
export const PRINT_LANGUAGES: ReadonlyArray<{ value: RequestPrintLanguage; label: string }> = [
    { value: 'tamil', label: 'Tamil' },
    { value: 'manglish', label: 'Manglish' },
];

/** How a language is named in a message to the person who picked it. */
export function printLanguageLabel(value: RequestPrintLanguage): string {
    return PRINT_LANGUAGES.find((l) => l.value === value)?.label ?? value;
}

/**
 * Which language the printed sheet is in.
 *
 * Sits beside the print button rather than inside it because it is a property of the
 * sheet, not of the pressing: the same request gets printed twice, once for each
 * picker, and a choice buried in a menu on the button would make that two menus deep.
 */
export function PrintLanguageSelect({
    value,
    onChange,
}: {
    value: RequestPrintLanguage;
    onChange: (value: RequestPrintLanguage) => void;
}) {
    const { open, setOpen, buttonRef, panelRef, pos } = useAnchoredPanel();
    const selected = PRINT_LANGUAGES.find((l) => l.value === value);

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label="Language of the printed sheet"
                className={PICKER_BUTTON}
                style={PICKER_BUTTON_STYLE}
            >
                {/* A letter, because this control picks a script. */}
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
                    <polyline points="4 7 4 4 20 4 20 7" />
                    <line x1="9" y1="20" x2="15" y2="20" />
                    <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
                <span className="truncate">{selected?.label ?? 'Tamil'}</span>
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
                        minWidth: '160px',
                        ...PICKER_PANEL_STYLE,
                    }}
                >
                    <div className="py-1">
                        {PRINT_LANGUAGES.map((l) => (
                            <button
                                key={l.value}
                                type="button"
                                onClick={() => {
                                    onChange(l.value);
                                    setOpen(false);
                                }}
                                className={PICKER_OPTION}
                            >
                                <PickerTick on={l.value === value} />
                                <span
                                    className="truncate text-[0.8125rem] font-medium"
                                    style={{ color: 'var(--foreground)' }}
                                >
                                    {l.label}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
