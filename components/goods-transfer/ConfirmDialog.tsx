'use client';

/**
 * A confirmation dialog for the two Goods Transfer actions that cannot be undone:
 * accepting goods into stock, and deleting a transfer.
 *
 * A dialog rather than a strip on the page, because both change something
 * permanently and the question deserves to be the only thing on screen. Escape and
 * a click on the backdrop both mean "no" — the safe answer is always the easy one —
 * and focus lands on Cancel, never on the destructive button.
 *
 * Rendered through the dashboard's existing ModalPortal so it escapes the table and
 * stacking contexts it may be opened from.
 */

import { useEffect, type ReactNode } from 'react';

import { ModalPortal } from '@/components/orders/ModalPortal';

interface ConfirmDialogProps {
    title: string;
    body: ReactNode;
    confirmLabel: string;
    cancelLabel?: string;
    tone?: 'primary' | 'danger';
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({
    title,
    body,
    confirmLabel,
    cancelLabel = 'Cancel',
    tone = 'primary',
    busy,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            if (event.key === 'Escape' && !busy) {
                onCancel();
            }
        }
        document.addEventListener('keydown', onKey);
        // The page behind must not scroll while a decision is pending.
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = previous;
        };
    }, [busy, onCancel]);

    return (
        <ModalPortal>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
                onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={title}
                    className="w-full max-w-md rounded-2xl border border-[var(--card-border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-modal)]"
                >
                    <h2 className="mb-3 text-[1rem] font-semibold text-[var(--foreground)]">{title}</h2>
                    <div className="space-y-2 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                        {body}
                    </div>
                    <div className="mt-6 flex justify-end gap-2">
                        <button
                            autoFocus
                            onClick={onCancel}
                            disabled={busy}
                            className="cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-4 py-2 text-[0.8125rem] font-medium text-[var(--foreground)] transition-colors hover:bg-overlay/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {cancelLabel}
                        </button>
                        <button
                            onClick={onConfirm}
                            disabled={busy}
                            className={`cursor-pointer rounded-lg border px-4 py-2 text-[0.8125rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                tone === 'danger'
                                    ? 'border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.18)] text-[var(--tone-red)] hover:bg-[rgba(239,68,68,0.28)]'
                                    : 'border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] text-[var(--tone-indigo-soft)] hover:bg-[rgba(99,102,241,0.25)]'
                            }`}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
}
