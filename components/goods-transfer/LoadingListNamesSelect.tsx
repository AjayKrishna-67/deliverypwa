'use client';

/**
 * Which name the loading list is printed under.
 *
 * The sheet carries both names for every line, so this is a display choice made at
 * print time rather than anything that changes what is fetched or how the lines are
 * merged — see LoadingListNames in lib/goods-transfer-loading-list-print.ts.
 *
 * The two names come straight off the catalogue: the Local Name is the Vendure field
 * of that name, written in Tamil, and the product name is the Vendure product's own
 * name — Manglish on the Kerala catalogue, English on the Tamil branches'.
 *
 * WHY IT IS ASKED AT ALL. The godown that picks a Kerala load does not necessarily
 * read the script the Local Name is written in, and the catalogue already spells the
 * same product in Latin letters — "Mathanga (cut) 250gm". One dropdown at the moment
 * of printing beats a second sheet, or a catalogue edited to suit whoever is on shift.
 *
 * Shared by the four screens that print the list — the transfer list's dialog, the two
 * entry screens and one transfer's own page — so the wording of the choice cannot
 * drift between them. `compact` drops the heading for the row of action buttons on
 * that last one, where a labelled field would sit a head taller than everything
 * beside it; the choice is still named, on the control itself.
 */

import type { LoadingListNames } from '@/lib/goods-transfer-loading-list-print';

/*
  Both options are named for the FIELD they read, because the language each one comes
  out in depends on the branch. "Manglish" is the product name on the Kerala
  catalogue — "Mathanga (cut) 250gm" — and plain English on the Tamil branches', and
  it is one field either way, so naming only the Kerala reading would leave a
  Coimbatore picker unable to recognise their own option.
*/
const OPTIONS: Array<{ value: LoadingListNames; label: string }> = [
    { value: 'tamil', label: 'Tamil — the Local Name' },
    { value: 'manglish', label: 'Manglish / English — the product name' },
];

const LABEL =
    'mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';
const SELECT =
    'w-full cursor-pointer rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-[1rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)] md:py-2 md:text-[0.8125rem]';
/** Button-shaped, to stand in a row of buttons without being a head taller. */
const SELECT_COMPACT =
    'cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-3 py-2 text-[0.8125rem] font-medium text-[var(--foreground)] outline-none transition-colors hover:bg-overlay/[0.1] focus:border-[var(--input-focus)] disabled:cursor-not-allowed disabled:opacity-50';

export function LoadingListNamesSelect({
    id,
    value,
    onChange,
    disabled,
    className,
    compact,
}: {
    /** Needed because the four screens can each show one of these. */
    id: string;
    value: LoadingListNames;
    onChange: (value: LoadingListNames) => void;
    disabled?: boolean;
    className?: string;
    /** No heading above it — for a row of action buttons. */
    compact?: boolean;
}) {
    const select = (
        <select
            id={id}
            className={compact ? SELECT_COMPACT : SELECT}
            value={value}
            disabled={disabled}
            aria-label="Print names in"
            title="Which name the loading list is printed under"
            onChange={(e) => onChange(e.target.value as LoadingListNames)}
        >
            {OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                    {compact ? option.label.split(' — ')[0] : option.label}
                </option>
            ))}
        </select>
    );

    if (compact) {
        return className ? <div className={className}>{select}</div> : select;
    }

    return (
        <div className={className}>
            <label className={LABEL} htmlFor={id}>
                Print names in
            </label>
            {select}
        </div>
    );
}
