'use client';

/**
 * Transfer list.
 *
 * One read fills all of it. The tabs, the dates, the search box and the page number
 * are arguments to that read rather than separate screens, so the counts and the
 * rows are always the same answer and can never disagree with each other.
 *
 * Paging happens on the SERVER: skip and take go with the query, and totalItems
 * comes back as the count of everything matching, not the size of the page.
 *
 * WHAT THE PERSON CHOSE LIVES IN THE URL. In the app this was ported from, those
 * filters were held by a shell above the pages, so that opening a transfer and
 * coming back returned you to the Draft tab on page three rather than to the top of
 * an unfiltered list. Here the pages are real routes, and the URL does that job
 * better than any state could: the browser's own Back button restores it, and the
 * view can be sent to someone else as a link.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { ExpiringProducts } from '@/components/goods-transfer/ExpiringProducts';
import { LoadingListDialog } from '@/components/goods-transfer/LoadingListDialog';
import { PluginMissingNotice } from '@/components/goods-transfer/notices';
import { useGoodsTransferPushRefresh } from '@/hooks/useGoodsTransferPushRefresh';
import { ALERT_INTERVAL_MS } from '@/lib/goods-transfer-alert-marker';
import { Spinner } from '@/components/ui/Spinner';
import {
    fetchTransfers,
    isPluginMissingError,
} from '@/services/goods-transfer.service';
import {
    formatState,
    SELECT_OPTION,
    shortDate,
    transferStateClasses,
} from '@/lib/goods-transfer-format';
import type { Can } from '@/lib/goods-transfer-permissions';
import type {
    Alert,
    DamageState,
    ReportStatus,
    Summary,
    TransferChannel,
    TransferListResult,
    TransferRow,
} from '@/types/goods-transfer';

/**
 * The tabs and the count cards were the same eight things twice over — one row you
 * could press, another that only told you how many. They are one control now: the
 * card IS the filter, and it says what it will show you.
 *
 * "Expiring soon" counts PRODUCTS where the others count transfers — it opens a list
 * of products, so a count of transfers would answer a different question. The server
 * computes it from the very rows that page shows, so the two cannot drift apart.
 */
const FILTERS: Array<{
    status: ReportStatus;
    label: string;
    count?: keyof Summary;
    color: string;
}> = [
    { status: 'ALL', label: 'All transfers', count: 'all', color: 'var(--tone-indigo)' },
    /*
      The two request states come before Draft, because that is where they sit in
      time: a request is a transfer that has not yet been accepted into one.
      "Request draft" is this branch's own unsent asks; "Requested" is every ask still
      waiting on the other branch — the ones you raised AND the ones raised of you.
    */
    { status: 'REQUEST_DRAFT', label: 'Request draft', count: 'requestDraft', color: 'rgb(var(--overlay-rgb)/0.45)' },
    { status: 'REQUESTED', label: 'Requested', count: 'requested', color: 'var(--tone-purple)' },
    { status: 'DRAFT', label: 'Draft', count: 'draft', color: 'rgb(var(--overlay-rgb)/0.6)' },
    { status: 'CONFIRMED', label: 'Confirmed', count: 'confirmed', color: 'var(--tone-blue)' },
    { status: 'DISPATCHED', label: 'Dispatched', count: 'dispatched', color: 'var(--tone-amber-deep)' },
    { status: 'RECEIVED', label: 'Received', count: 'received', color: 'var(--tone-green)' },
    {
        status: 'EXPIRING_SOON',
        label: 'Expiring soon',
        // Counts products, where every other tab counts transfers. That is the honest
        // figure: this tab opens a list of products, and a count of the transfers they
        // happened to arrive on would answer a question nobody asked.
        count: 'expiringSoon',
        color: 'var(--tone-orange)',
    },
    { status: 'DAMAGE_PENDING', label: 'Damage pending', count: 'damagePending', color: 'var(--tone-amber)' },
    /*
      Approved AND rejected, in one tab.

      It matched approved alone, so a transfer whose only claim was rejected sat under
      no tab at all — decided, so not pending; refused, so not approved. The only way
      back to it was to already know its number. A decision is a decision either way,
      and both belong where someone goes looking for settled claims.

      The two outcomes are then separable — see DECIDED_OUTCOMES below.
    */
    {
        status: 'DAMAGE_DECIDED',
        label: 'Damage Approved & Rejected',
        count: 'damageDecided',
        color: 'var(--tone-red)',
    },
];

/**
 * Inside the decided tab, the outcomes can be looked at apart.
 *
 * A second row of filters rather than three top-level tabs: "was this settled" and
 * "how was it settled" are two questions, and the second only means anything once the
 * first is asked. Three peer tabs would also have put "approved" and "rejected"
 * beside a combined tab that contains both, which reads as three separate groups
 * rather than one group and its halves.
 */
const DECIDED_OUTCOMES: Array<{ status: ReportStatus; label: string; count: keyof Summary }> = [
    { status: 'DAMAGE_DECIDED', label: 'Both', count: 'damageDecided' },
    { status: 'DAMAGE_APPROVED', label: 'Approved only', count: 'damageApproved' },
    { status: 'DAMAGE_REJECTED', label: 'Rejected only', count: 'damageRejected' },
];

/**
 * How the claims against one transfer went, in a few words.
 *
 * Answers on the row what previously meant opening the transfer and scrolling: was
 * this one approved or refused? A transfer can carry several claims settled
 * differently, so the counts are kept apart rather than reduced to one verdict that
 * would have to lie about the other.
 *
 * Returns null when there are none, and the row then shows nothing at all — most
 * transfers never have a claim, and "Damage —" on all of them is noise.
 */
function damageSummary(
    row: TransferRow,
): Array<{ text: string; color: string }> | null {
    if (!row.damageRequests?.length) {
        return null;
    }
    const count = (state: DamageState) =>
        row.damageRequests.filter((d) => d.state === state).length;

    const parts: Array<{ text: string; color: string }> = [];
    const approved = count('APPROVED');
    const rejected = count('REJECTED');
    const pending = count('PENDING_APPROVAL');

    // Singular reads better when there is only one, and one is the common case:
    // "Approved" rather than "1 approved".
    if (approved) {
        parts.push({ text: approved === 1 ? 'Approved' : `${approved} approved`, color: 'var(--tone-green)' });
    }
    if (rejected) {
        parts.push({
            text: rejected === 1 ? 'Rejected' : `${rejected} rejected`,
            color: 'var(--tone-red)',
        });
    }
    if (pending) {
        parts.push({ text: pending === 1 ? 'Pending' : `${pending} pending`, color: 'var(--tone-amber)' });
    }
    return parts.length ? parts : null;
}

/** True for any of the three decided views, which share one card. */
function isDecidedView(status: ReportStatus): boolean {
    return (
        status === 'DAMAGE_DECIDED' || status === 'DAMAGE_APPROVED' || status === 'DAMAGE_REJECTED'
    );
}

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

/** Long enough that a burst of typing is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

function isoDay(offsetDays = 0): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

/**
 * A window of five page numbers around the current one, so the control stays the
 * same width whether there are three pages or three hundred.
 */
function pageWindow(current: number, total: number, span = 5): number[] {
    if (total <= span) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }
    let start = Math.max(1, current - Math.floor(span / 2));
    if (start + span - 1 > total) {
        start = total - span + 1;
    }
    return Array.from({ length: span }, (_, i) => start + i);
}

const FIELD_LABEL = 'mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]';
const FIELD_INPUT =
    'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-[0.8125rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--input-focus)]';
const BUTTON =
    'cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-4 py-2 text-[0.8125rem] font-medium text-[var(--foreground)] transition-colors hover:bg-overlay/[0.1] disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SOLID =
    'cursor-pointer rounded-lg border border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] px-4 py-2 text-[0.8125rem] font-semibold text-[var(--tone-indigo-soft)] transition-colors hover:bg-[rgba(99,102,241,0.25)] disabled:cursor-not-allowed disabled:opacity-50';

export function TransferList({
    channelToken,
    channelId,
    channelCode,
    can,
    branches,
    reportAlerts,
    alertsAfterId,
}: {
    channelToken: string;
    /** The branch being acted as — the loading list never lists it as one of the others. */
    channelId: string;
    channelCode: string;
    can: Can;
    /** Read once by the section's shell — see GoodsTransferContextValue. */
    branches: TransferChannel[];
    /**
     * This screen's read carries the alerts, so it hands them to the shell instead
     * of the shell polling for the same thing every twenty seconds.
     */
    reportAlerts: (alerts: Alert[]) => void;
    alertsAfterId: () => string | null;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // ── What the person chose, read from the URL ──────────────────────
    const status = (searchParams.get('status') as ReportStatus | null) ?? 'ALL';
    /*
      NULL until someone presses Apply, and that is the point.

      The dates are for FINDING a transfer, not for deciding which ones exist. A
      default window of the last thirty days meant the list quietly answered a
      question nobody asked — and a transfer created minutes ago could fall outside
      it and appear to have not been saved at all.

      Sending no window lets the server use its own, which is generous on both ends.
      Narrow it by choosing dates and pressing Apply; clear them to see everything
      again.
    */
    const appliedFrom = searchParams.get('from');
    const appliedTo = searchParams.get('to');
    const search = searchParams.get('q') ?? '';
    const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
    const perPage = Number(searchParams.get('perPage') ?? '10') || 10;

    /**
     * Writes the chosen filters back to the URL.
     *
     * `replace`, not `push`: typing in the search box would otherwise leave one
     * history entry per keystroke and make Back useless. `scroll: false` keeps the
     * page where it is — a filter change is not a new page.
     */
    const patch = useCallback(
        (next: Record<string, string | number | undefined>) => {
            const params = new URLSearchParams(searchParams.toString());
            for (const [key, value] of Object.entries(next)) {
                if (value === undefined || value === '' || value === null) {
                    params.delete(key);
                } else {
                    params.set(key, String(value));
                }
            }
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        },
        [router, pathname, searchParams],
    );

    // The date inputs are typed into freely; Apply is what moves them into the URL.
    // The boxes open on a sensible month so they are not empty to look at. Nothing
    // is filtered by them until Apply moves them into the URL.
    const [fromInput, setFromInput] = useState(appliedFrom ?? isoDay(-30));
    const [toInput, setToInput] = useState(appliedTo ?? isoDay());

    // Debounced from the box, so typing filters as it is typed without a request per
    // keystroke.
    const [searchInput, setSearchInput] = useState(search);
    useEffect(() => {
        const timer = window.setTimeout(() => {
            const trimmed = searchInput.trim();
            if (trimmed !== search) {
                patch({ q: trimmed || undefined, page: undefined });
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput, search, patch]);

    // ── The read ──────────────────────────────────────────────────────
    const [data, setData] = useState<TransferListResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pluginMissing, setPluginMissing] = useState(false);
    const [printingList, setPrintingList] = useState(false);

    /**
     * `silent` is for the background reads — the interval and the push.
     *
     * A live update should be the data CHANGING, not the screen announcing that it is
     * about to. With the loading flag set, every twenty seconds the pager said
     * "refreshing…" and the page read as though it were reloading itself, which is
     * both distracting and misleading: nothing was being waited for. Silent reads
     * touch no flag, so the rows simply become right.
     *
     * The first load is never silent — there, a spinner is the honest answer to an
     * empty screen. So is a refresh the person asked for by pressing something.
     */
    const load = useCallback(async (silent = false) => {
        if (!silent) {
            setIsLoading(true);
        }
        setError(null);
        try {
            const result = await fetchTransfers(
                status,
                {
                    // Left out entirely when no window was chosen — an absent bound
                    // is the server's cue to use its own, and undefined is dropped
                    // from the GraphQL variables rather than sent as null.
                    from: appliedFrom ? new Date(`${appliedFrom}T00:00:00`).toISOString() : undefined,
                    to: appliedTo ? new Date(`${appliedTo}T23:59:59`).toISOString() : undefined,
                    search: search || undefined,
                    skip: (page - 1) * perPage,
                    take: perPage,
                    // Alerts ride on this read. Sending the marker is what makes the
                    // shell's separate poll unnecessary while this screen is open.
                    alertsAfterId: alertsAfterId(),
                },
                channelToken,
            );
            setData(result);
            reportAlerts(result.alerts);
        } catch (err) {
            if (isPluginMissingError(err)) {
                setPluginMissing(true);
                return;
            }
            setError(err instanceof Error ? err.message : 'Could not load transfers');
        } finally {
            if (!silent) {
                setIsLoading(false);
            }
        }
    }, [
        status,
        appliedFrom,
        appliedTo,
        search,
        page,
        perPage,
        channelToken,
        alertsAfterId,
        reportAlerts,
    ]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Keep the list — and the alerts riding on it — current without being asked.
     *
     * The section's background poll stands down while this screen is open, because
     * this screen's own read already carries the alerts. That left a hole: nothing
     * re-read anything, so alerts only appeared when the page was reloaded or a
     * filter touched. This closes it, on the same cadence the poll would have used,
     * and keeps the rows and counts honest at the same time.
     *
     * `load` sets the loading flag, which the pager shows as "refreshing…" — the
     * table itself stays put, because only a first load with no data replaces it.
     */
    useEffect(() => {
        const timer = window.setInterval(() => void load(true), ALERT_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [load]);

    /**
     * …and at once, when a push says something happened.
     *
     * No filter: this screen shows every transfer on the branch, so every alert the
     * branch receives is about a row that is — or should now be — on it. A transfer
     * confirmed by another branch appears here the moment it is confirmed rather
     * than up to a poll later.
     */
    useGoodsTransferPushRefresh(() => void load(true));

    const branchNames = useMemo(
        () => new Map(branches.map((c) => [String(c.id), c.code])),
        [branches],
    );

    /**
     * Refresh drops the date window as well as re-reading.
     *
     * The window lives in the URL so it survives a reload — which is right while
     * you are looking for something, and wrong once you have finished: the list
     * stayed narrowed to dates chosen an hour ago with nothing on screen saying so.
     * This is the way back to everything.
     *
     * The boxes go back to their opening month too, so what they show is what
     * pressing Apply would do.
     */
    const refresh = useCallback(() => {
        setFromInput(isoDay(-30));
        setToInput(isoDay());
        if (appliedFrom || appliedTo) {
            // Clearing them changes the URL, and the read follows on its own.
            patch({ from: undefined, to: undefined, page: undefined });
            return;
        }
        // Nothing to clear — this is an ordinary re-read.
        void load();
    }, [appliedFrom, appliedTo, patch, load]);

    const branch = (id: string) => branchNames.get(String(id)) ?? `#${id}`;
    const rows = data?.items ?? [];
    const total = data?.totalItems ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / perPage));
    const firstOnPage = total === 0 ? 0 : (page - 1) * perPage + 1;
    const lastOnPage = Math.min(page * perPage, total);
    const pages = useMemo(() => pageWindow(page, pageCount), [page, pageCount]);

    if (pluginMissing) {
        return <PluginMissingNotice />;
    }

    return (
        <div className="p-4 md:p-6">
            {printingList && (
                <LoadingListDialog
                    channelToken={channelToken}
                    channelId={channelId}
                    channelCode={channelCode}
                    branches={branches}
                    /* The dates the list is showing, not the ones it has applied: the
                       boxes are what the person has been looking at, and an unapplied
                       range is still the range they mean. */
                    from={fromInput}
                    to={toInput}
                    onClose={() => setPrintingList(false)}
                />
            )}

            {/* ── Heading ── */}
            <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-[1.125rem] font-bold tracking-tight text-[var(--foreground)]">
                        Goods Transfer
                    </h1>
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        Stock moving between branches
                    </p>
                </div>
                <button
                    className={BUTTON}
                    onClick={refresh}
                    disabled={isLoading}
                    title="Re-read the list, and show every date again"
                >
                    {isLoading ? 'Refreshing…' : 'Refresh'}
                </button>
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--error-bg)] px-4 py-3 text-[0.8125rem] text-[var(--tone-red)]">
                    {error}
                </div>
            )}

            {/* ── Filters ── */}
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <div className="w-[9.5rem]">
                    <label className={FIELD_LABEL} htmlFor="gt-from">
                        From
                    </label>
                    <input
                        id="gt-from"
                        type="date"
                        className={FIELD_INPUT}
                        value={fromInput}
                        onChange={(e) => setFromInput(e.target.value)}
                    />
                </div>
                <div className="w-[9.5rem]">
                    <label className={FIELD_LABEL} htmlFor="gt-to">
                        To
                    </label>
                    <input
                        id="gt-to"
                        type="date"
                        className={FIELD_INPUT}
                        value={toInput}
                        onChange={(e) => setToInput(e.target.value)}
                    />
                </div>
                <button
                    className={BUTTON}
                    onClick={() => patch({ from: fromInput, to: toInput, page: undefined })}
                >
                    Apply
                </button>

                <div className="min-w-[14rem] flex-1">
                    <label className={FIELD_LABEL} htmlFor="gt-search">
                        Search — transfer number, driver name or phone
                    </label>
                    <div className="relative">
                        <input
                            id="gt-search"
                            className={FIELD_INPUT}
                            value={searchInput}
                            placeholder="Start typing…"
                            autoComplete="off"
                            onChange={(e) => setSearchInput(e.target.value)}
                        />
                        {searchInput && (
                            <button
                                type="button"
                                aria-label="Clear search"
                                onClick={() => setSearchInput('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded px-1.5 text-[1rem] leading-none text-[var(--text-muted)] hover:text-[var(--foreground)]"
                            >
                                ×
                            </button>
                        )}
                    </div>
                </div>

                {/*
                  Printing after the fact. The entry screens print for what they have
                  just made; this is for the run once the branches have acted on it,
                  or for a day's requests once they have been answered. Reading is
                  enough — anyone on this screen may already see every line of it.
                */}
                <button
                    className={BUTTON}
                    onClick={() => setPrintingList(true)}
                    title="One merged list across branches, or a page per branch"
                >
                    Loading list
                </button>

                {/*
                  Offered on `request`, not `create`. Asking is a receiving-side act
                  and the permissions split on that line: the branch that runs short
                  holds the receipt permission and no create, so gating this alongside
                  New transfer would hide it from the people it exists for.
                */}
                {can.request && (
                    <button
                        className={BUTTON}
                        onClick={() => router.push('/goods-transfer/request')}
                        title="Ask another branch to send goods here"
                    >
                        Product request
                    </button>
                )}

                {can.create && (
                    <button
                        className={BUTTON_SOLID}
                        onClick={() => router.push('/goods-transfer/new')}
                    >
                        New transfer
                    </button>
                )}
            </div>

            {/* ── Filters: the count IS the button ── */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5">
                {FILTERS.map((filter) => {
                    // The decided card stays lit while either half of it is being
                    // looked at, so narrowing to "Rejected only" does not make the tab
                    // you are standing in look unselected.
                    const on =
                        filter.status === 'DAMAGE_DECIDED'
                            ? isDecidedView(status)
                            : status === filter.status;
                    return (
                        <button
                            key={filter.status}
                            onClick={() => patch({ status: filter.status, page: undefined })}
                            aria-pressed={on}
                            className={`cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors ${
                                on
                                    ? 'border-[rgba(99,102,241,0.45)] bg-[rgba(99,102,241,0.12)]'
                                    : 'border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-overlay/[0.07]'
                            }`}
                        >
                            <span className="block truncate text-[0.6875rem] font-medium text-[var(--text-muted)]">
                                {filter.label}
                            </span>
                            <span
                                className="block text-[1.25rem] font-bold tabular-nums"
                                style={{ color: filter.color }}
                            >
                                {filter.count ? (data ? data.summary[filter.count] : '—') : '·'}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/*
              ── Approved / Rejected, apart ──

              Only while a decided view is open. A row of three that appears in one
              place and not others is easier to read than three permanent controls that
              are meaningless under every other tab.
            */}
            {isDecidedView(status) && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        Outcome
                    </span>
                    {DECIDED_OUTCOMES.map((outcome) => {
                        const on = status === outcome.status;
                        return (
                            <button
                                key={outcome.status}
                                onClick={() => patch({ status: outcome.status, page: undefined })}
                                aria-pressed={on}
                                className={`min-h-[2.25rem] cursor-pointer rounded-lg border px-3 text-[0.8125rem] font-medium transition-colors ${
                                    on
                                        ? 'border-[rgba(99,102,241,0.45)] bg-[rgba(99,102,241,0.12)] text-[var(--tone-indigo-soft)]'
                                        : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-muted)] hover:bg-overlay/[0.07]'
                                }`}
                            >
                                {outcome.label}
                                <span className="ml-1.5 tabular-nums">
                                    {data ? data.summary[outcome.count] : '—'}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {/*
              ── Rows ──

              Expiring soon is its own screen rather than a slice of this table, because
              it answers a different question about a different subject. Expiry belongs
              to a PRODUCT on a shelf; the transfer is only how it arrived. Listing
              transfers here made the reader open each one to find out which product was
              meant — every single time.

              The tab, the dates and the counts above stay where they are: this is still
              the place someone comes to, and stepping between the views should not feel
              like leaving.
            */}
            {status === 'EXPIRING_SOON' ? (
                <ExpiringProducts channelToken={channelToken} />
            ) : isLoading && !data ? (
                <div className="flex items-center justify-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-10 text-[0.8125rem] text-[var(--text-muted)]">
                    <Spinner size="md" />
                    Loading…
                </div>
            ) : rows.length === 0 ? (
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-10 text-center">
                    <h3 className="mb-1 text-[0.9375rem] font-semibold text-[var(--foreground)]">
                        {search ? `Nothing matches “${search}”` : 'Nothing in this range'}
                    </h3>
                    <p className="text-[0.8125rem] text-[var(--text-muted)]">
                        {search
                            ? 'Try part of the transfer number, the driver name, or the phone.'
                            : 'No transfers match the selected dates and tab.'}
                    </p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
                    {/*
                      ── Phone: one card per transfer ──

                      Seven columns in 46rem, against a phone's 23. The transfer
                      number and the state — the two things anyone scans a list like
                      this for — survived; the route, the count and the date did not.

                      The card is a real link rather than a row with an onClick, so a
                      long press offers "open in new tab" and the whole card is the
                      target rather than whatever the thumb happens to land on.
                    */}
                    <ul className="md:hidden">
                        {rows.map((row) => (
                            <li key={row.id} className="border-b border-[var(--card-border)] last:border-b-0">
                                <div className="flex items-center gap-2 p-3">
                                    <Link
                                        href={`/goods-transfer/${row.id}`}
                                        className="min-w-0 flex-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
                                    >
                                        <span className="flex flex-wrap items-center gap-2">
                                            <span className="text-[0.875rem] font-semibold tabular-nums text-[var(--foreground)]">
                                                {row.transferNumber}
                                            </span>
                                            <span
                                                className={`inline-block rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold ${transferStateClasses(row.state)}`}
                                            >
                                                {formatState(row.state)}
                                            </span>
                                        </span>
                                        <span className="mt-1 block text-[0.8125rem] text-[var(--text-muted)]">
                                            {branch(row.sourceChannelId)} → {branch(row.destinationChannelId)}
                                        </span>
                                        <span className="mt-0.5 block text-[0.75rem] text-[var(--text-muted)]">
                                            {row.itemCount} item{row.itemCount === 1 ? '' : 's'} ·{' '}
                                            {row.createdByName} · {shortDate(row.createdAt)}
                                        </span>
                                        {/* Only when there is damage — see damageSummary. */}
                                        {damageSummary(row) && (
                                            <span className="mt-0.5 block text-[0.75rem] text-[var(--text-muted)]">
                                                Damage:{' '}
                                                {damageSummary(row)!.map((part, i) => (
                                                    <span key={part.text}>
                                                        {i > 0 && ' · '}
                                                        <span style={{ color: part.color }}>
                                                            {part.text}
                                                        </span>
                                                    </span>
                                                ))}
                                            </span>
                                        )}
                                    </Link>
                                </div>
                            </li>
                        ))}
                    </ul>

                    {/* ── md and up: the table ── */}
                    <div className="hidden overflow-x-auto md:block">
                        <table className="w-full min-w-[46rem] border-collapse text-[0.8125rem]">
                            <thead>
                                <tr className="border-b border-[var(--card-border)]">
                                    <th className="px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                        Transfer no
                                    </th>
                                    <th className="px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                        State
                                    </th>
                                    <th className="px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                        Route
                                    </th>
                                    <th className="px-4 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                        Items
                                    </th>
                                    {/* Between the count and who made it: the outcome of
                                        any claim belongs with what was on the transfer,
                                        not tacked on after the dates. */}
                                    <th className="px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                        Damage
                                    </th>
                                    <th className="px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                        Created by
                                    </th>
                                    <th className="px-4 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                        Created
                                    </th>
                                    <th className="w-px px-4 py-2.5" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    /*
                                      The whole row opens the transfer. There is no
                                      "View" button any more: a row you can press and a
                                      button that does the one thing pressing it would
                                      do were the same control twice, and on a phone the
                                      button was the smaller of the two targets.

                                      Kept reachable from the keyboard — a div-with-an-
                                      onClick that Tab cannot land on is a control only
                                      some people have.
                                    */
                                    <tr
                                        key={row.id}
                                        tabIndex={0}
                                        role="link"
                                        aria-label={`Open ${row.transferNumber}`}
                                        onClick={() => router.push(`/goods-transfer/${row.id}`)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                router.push(`/goods-transfer/${row.id}`);
                                            }
                                        }}
                                        className="cursor-pointer border-b border-[var(--card-border)] transition-colors last:border-b-0 hover:bg-overlay/[0.05] focus:bg-overlay/[0.05] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
                                    >
                                        <td className="px-4 py-2.5 font-semibold tabular-nums text-[var(--foreground)]">
                                            {row.transferNumber}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <span
                                                className={`inline-block rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold ${transferStateClasses(row.state)}`}
                                            >
                                                {formatState(row.state)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-[var(--text-muted)]">
                                            {branch(row.sourceChannelId)} → {branch(row.destinationChannelId)}
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--foreground)]">
                                            {row.itemCount}
                                        </td>
                                        <td className="px-4 py-2.5 text-[0.75rem]">
                                            {damageSummary(row)?.map((part, i) => (
                                                <span key={part.text}>
                                                    {i > 0 && (
                                                        <span className="text-[var(--text-muted)]">
                                                            {' · '}
                                                        </span>
                                                    )}
                                                    <span style={{ color: part.color }}>{part.text}</span>
                                                </span>
                                            )) ?? <span className="text-[var(--text-muted)]">—</span>}
                                        </td>
                                        <td className="px-4 py-2.5 text-[var(--text-muted)]">
                                            {row.createdByName}
                                        </td>
                                        <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">
                                            {shortDate(row.createdAt)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* ── Pager ── */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--card-border)] px-4 py-3">
                        <select
                            aria-label="Rows per page"
                            value={perPage}
                            onChange={(e) => patch({ perPage: e.target.value, page: undefined })}
                            className="cursor-pointer rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-[0.75rem] text-[var(--foreground)] outline-none"
                        >
                            {PER_PAGE_OPTIONS.map((n) => (
                                <option key={n} value={n} className={SELECT_OPTION}>
                                    {n} per page
                                </option>
                            ))}
                        </select>

                        <span className="text-[0.75rem] tabular-nums text-[var(--text-muted)]">
                            {firstOnPage} - {lastOnPage} of {total}
                        </span>

                        <div className="flex items-center gap-1">
                            <PageButton
                                label="«"
                                ariaLabel="Previous page"
                                disabled={page === 1}
                                onClick={() => patch({ page: Math.max(1, page - 1) })}
                            />
                            {pages.map((n) => (
                                <PageButton
                                    key={n}
                                    label={String(n)}
                                    on={n === page}
                                    onClick={() => patch({ page: n })}
                                />
                            ))}
                            <PageButton
                                label="»"
                                ariaLabel="Next page"
                                disabled={page >= pageCount}
                                onClick={() => patch({ page: Math.min(pageCount, page + 1) })}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function PageButton({
    label,
    ariaLabel,
    on,
    disabled,
    onClick,
}: {
    label: string;
    ariaLabel?: string;
    on?: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={onClick}
            className={`min-w-[1.875rem] cursor-pointer rounded-md border px-2 py-1 text-[0.75rem] font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                on
                    ? 'border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.15)] text-[var(--tone-indigo-soft)]'
                    : 'border-[var(--card-border)] bg-overlay/[0.06] text-[var(--foreground)] hover:bg-overlay/[0.1]'
            }`}
        >
            {label}
        </button>
    );
}
