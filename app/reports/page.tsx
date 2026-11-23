'use client';

/**
 * Delivery Reports page — shows delivery summaries and payment collection analytics.
 * - DP role: sees own delivery summary + fulfillment list
 * - Admin/Accountant: sees all DPs overview, click to drill down
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useAuth } from '@/providers/AuthProvider';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { Spinner } from '@/components/ui/Spinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { ExpiryDaysReportView } from '@/components/reports/ExpiryDaysReport';
import {
    fetchDeliveryReport,
    type DeliveryReportData,
    type DeliveryPersonSummary,
    type DeliveryFulfillmentDetailItem,
} from '@/services/reports.service';
import {
    fetchSalesReport,
    type SalesReport,
    type SalesReportRow,
} from '@/services/business-reports.service';
import {
    fetchMonthlyProductSales,
    type MonthlyProductSales,
    type MonthlyProductSalesRow,
} from '@/services/monthly-product-sales.service';
import {
    fetchBillPrintReport,
    groupBills,
    type BillPrintRow,
    type GroupedBill,
} from '@/services/bill-print.service';
import {
    fetchPurchaseListReport,
    orderKeeraiCutBelowWhole,
    type PurchaseListReport,
    type PurchaseListRow,
} from '@/services/purchase-list.service';
import {
    fetchVariantNames,
    type VariantNames,
    type VariantNameMap,
} from '@/services/product-names.service';
import { formatCurrency, getStateBadgeClasses, formatState } from '@/lib/formatters';
import { browserPrintDate } from '@/lib/purchase-list-document';
import { computeBillFigures } from '@/lib/bill-figures';
import { mergeTaggedBills, planBillFetches } from '@/lib/gst-invoice';
import { buildGstInvoiceDocument, buildGstInvoiceHtml, GST_INVOICE_CSS } from '@/lib/gst-invoice-document';
import { ChannelMultiSelect } from '@/components/ui/ChannelMultiSelect';
import { CHANNEL_PRODUCT_MASTERS } from '@/lib/product-master-channels';

// ─── Report result cache (module-level) ──────────────────────────────
// Report resolvers scan the production DB, so we never want to re-run one
// unless the user explicitly asks. Results are cached here keyed by a
// per-view filter signature and survive a view unmount/remount, so
// re-opening a report tab shows the last result instantly WITHOUT hitting
// the DB again. A cached entry is only replaced when the user clicks the
// report's Run/Load button (an explicit refresh).
const reportResultCache = new Map<string, unknown>();

function getCachedReport<T>(key: string): T | undefined {
    return reportResultCache.get(key) as T | undefined;
}
function setCachedReport(key: string, value: unknown): void {
    reportResultCache.set(key, value);
}

export default function ReportsPage() {
    const { isLoading, isAuthenticated } = useRequireAuth();

    if (isLoading) return <LoadingScreen />;
    if (!isAuthenticated) return null;

    return (
        <DashboardLayout>
            {({ channelToken }) => (
                <ReportsContent channelToken={channelToken} />
            )}
        </DashboardLayout>
    );
}

function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString('en-IN', {
        // Vendure stores UTC; force IST display so it matches what Vendure
        // admin shows the store team, regardless of the browser's timezone.
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
    });
}

/** Color config for payment collection methods */
const COLLECTION_COLORS: Record<string, { bg: string; text: string }> = {
    Cash: { bg: 'rgba(251,191,36,0.14)', text: 'var(--tone-amber)' },
    QR: { bg: 'rgba(167,139,250,0.14)', text: 'var(--tone-violet)' },
    'Cash+QR': { bg: 'rgba(251,146,60,0.14)', text: 'var(--tone-orange)' },
    Online: { bg: 'rgba(74,222,128,0.14)', text: 'var(--tone-green)' },
    PaymentLink: { bg: 'rgba(56,189,248,0.14)', text: 'var(--tone-sky)' },
};

/** Available report types — add more entries here as new reports are built */
type ReportType = 'delivery' | 'sales-menu' | 'business' | 'monthly-product' | 'daily-sales' | 'daily-sales-invoice' | 'daily-sales-purchase' | 'daily-sales-whole-veg' | 'daily-sales-cut-veg' | 'daily-sales-dp-bill' | 'product-names' | 'tamil-names' | 'expiry-days';

interface ReportCard {
    type: ReportType;
    label: string;
    description: string;
    icon: string;
    color: string;
    requirePermission?: string[];
    /** Cards that open their own route instead of rendering a report inline.
     *  Also the React key, so several cards can share one `type`. */
    href?: string;
}

const REPORT_CARDS: ReportCard[] = [
    { type: 'delivery', label: 'Delivery Reports', description: 'Delivery summaries & payment collection analytics', icon: '\u{1F69A}', color: 'var(--tone-indigo)' },
    {
        type: 'sales-menu',
        label: 'Sales Reports',
        description: 'Sales report & monthly product sales',
        icon: '\u{1F4CA}',
        color: 'var(--tone-green)',
        requirePermission: ['ViewMonthlySalesReport', 'ViewBusinessReports', 'SuperAdmin'],
    },
    {
        type: 'daily-sales',
        label: 'Daily Sales Report',
        description: 'Per-day operations: invoice prints, etc.',
        icon: '\u{1F5C2}',
        color: 'var(--tone-sky)',
        requirePermission: ['ViewDailyInvoiceReport', 'ViewBusinessReports', 'SuperAdmin'],
    },
    {
        type: 'product-names',
        label: 'Product Names',
        description: 'Upload the Excel masters that name products on reports',
        icon: '\u{1F310}',
        color: '#ec4899',
        requirePermission: ['ManageProductTamilNames', 'ViewBusinessReports', 'SuperAdmin'],
    },
    {
        type: 'expiry-days',
        label: 'Expiry Days',
        description: 'Product variants by shelf life — red, yellow, green',
        icon: '\u{23F3}',
        color: '#f87171',
        requirePermission: ['ReadCatalog', 'ReadProduct', 'SuperAdmin'],
    },
];

/**
 * Sub-cards shown inside the Product Names view — one upload button per
 * master, all in one place.
 *
 * The shared master comes first, then a card for every channel that sells its
 * own catalogue. They belong side by side because choosing between them is the
 * whole decision: the wrong one rewrites the wrong channel's product names.
 */
const PRODUCT_NAME_SUB_CARDS: ReportCard[] = [
    {
        type: 'tamil-names',
        label: 'Product Tamil Names',
        description: 'Shared master — every channel without one of its own',
        icon: '\u{1F310}',
        color: '#ec4899',
        href: '/admin/tamil-names',
    },
    ...CHANNEL_PRODUCT_MASTERS.map((ch) => ({
        type: 'tamil-names' as const,
        label: `Product Names — ${ch.label}`,
        description: `${ch.label} master — ${ch.localName.label} column, used only by ${ch.label} reports`,
        icon: '\u{1F310}',
        color: '#f97316',
        href: `/admin/tamil-names?channel=${encodeURIComponent(ch.code)}`,
    })),
];

/** Sub-cards shown inside the Sales Reports menu view. */
const SALES_SUB_CARDS: ReportCard[] = [
    {
        type: 'business',
        label: 'Sales Report',
        description: 'Delivered orders — amount, channel & status',
        icon: '\u{1F4CA}',
        color: 'var(--tone-green)',
    },
    {
        type: 'monthly-product',
        label: 'Monthly Product Sales',
        description: 'Quantity & revenue grouped by product',
        icon: '\u{1F4E6}',
        color: 'var(--tone-orange)',
    },
];

/** Sub-cards shown inside the Daily Sales Report view. */
const DAILY_SALES_SUB_CARDS: ReportCard[] = [
    {
        type: 'daily-sales-invoice',
        label: 'Invoice Report',
        description: 'Print bills (PDF) for delivered orders',
        icon: '\u{1F9FE}',
        color: 'var(--tone-violet)',
    },
    {
        type: 'daily-sales-purchase',
        label: 'Purchase List',
        description: 'Aggregate qty/kg per product to plan purchases',
        icon: '\u{1F33F}',
        color: 'var(--tone-cyan)',
    },
    {
        type: 'daily-sales-whole-veg',
        label: 'Whole Vegetable List',
        description: 'Per-bill packing list of veg/fruit/juice (excludes Cut Veg)',
        icon: '\u{1F955}',
        color: '#84cc16',
    },
    {
        type: 'daily-sales-cut-veg',
        label: 'Cut Vegetable List',
        description: 'Per-bill packing list — Cut Vegetables only',
        icon: '\u{1F52A}',
        color: '#f97316',
    },
    {
        type: 'daily-sales-dp-bill',
        label: 'DP Bill Report',
        description: 'Delivery Partner Bill — payment status & notes',
        icon: '\u{1F9FE}',
        color: '#f59e0b',
    },
];

/**
 * The card grid every Reports screen draws. A card with an `href` navigates to
 * its own route; the rest hand their type back so the caller renders them
 * inline. Permission filtering lives here so no screen can forget it.
 */
function ReportCardGrid({
    cards,
    onOpenReport,
}: {
    cards: ReportCard[];
    onOpenReport: (type: ReportType) => void;
}) {
    const router = useRouter();
    const { permissions } = useAuth();
    const visibleCards = cards.filter(
        (c) => !c.requirePermission || c.requirePermission.some((p) => permissions.includes(p)),
    );

    return (
        <div className="flex flex-wrap gap-4">
            {visibleCards.map((card) => (
                <button
                    key={card.href ?? card.type}
                    onClick={() => (card.href ? router.push(card.href) : onOpenReport(card.type))}
                    className="flex flex-col items-center justify-center gap-3 w-[160px] h-[140px] rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--foreground)] transition-all duration-200 cursor-pointer hover:border-[var(--accent)] hover:bg-indigo-500/8 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                >
                    <span className="text-3xl">{card.icon}</span>
                    <span className="text-[0.8125rem] font-semibold">{card.label}</span>
                    <span className="text-[0.625rem] text-[var(--text-muted)] text-center px-2 leading-tight">{card.description}</span>
                </button>
            ))}
        </div>
    );
}

/** A menu screen: back link, title, card grid. Sales Reports, Daily Sales
 *  Report and Product Names are each just this with a different card list. */
function ReportMenuView({
    title,
    cards,
    onBack,
    onOpenSubReport,
}: {
    title: string;
    cards: ReportCard[];
    onBack: () => void;
    onOpenSubReport: (type: ReportType) => void;
}) {
    return (
        <>
            <div className="px-4 sm:px-6 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                <button
                    onClick={onBack}
                    className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline mr-1"
                >
                    ← Reports
                </button>
                <h1 className="text-[1rem] font-semibold text-[var(--foreground)]">{title}</h1>
            </div>
            <div className="flex-1 overflow-auto px-4 sm:px-6 py-6">
                <ReportCardGrid cards={cards} onOpenReport={onOpenSubReport} />
            </div>
        </>
    );
}

function ReportsContent({ channelToken }: { channelToken: string | null }) {
    const [activeReport, setActiveReport] = useState<ReportType | null>(null);

    return (
        <main className="flex-1 flex flex-col overflow-hidden">
            {!activeReport && (
                <>
                    {/* ── Header ── */}
                    <div
                        className="px-4 sm:px-6 py-3"
                        style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
                    >
                        <h1 className="text-[1rem] font-semibold text-[var(--foreground)]">Reports</h1>
                    </div>

                    {/* ── Report cards grid ── */}
                    <div className="flex-1 overflow-auto px-4 sm:px-6 py-6">
                        <ReportCardGrid cards={REPORT_CARDS} onOpenReport={setActiveReport} />
                    </div>
                </>
            )}

            {activeReport === 'delivery' && (
                <DeliveryReportView channelToken={channelToken} onBack={() => setActiveReport(null)} />
            )}

            {activeReport === 'sales-menu' && (
                <ReportMenuView
                    title="Sales Reports"
                    cards={SALES_SUB_CARDS}
                    onBack={() => setActiveReport(null)}
                    onOpenSubReport={setActiveReport}
                />
            )}

            {activeReport === 'product-names' && (
                <ReportMenuView
                    title="Product Names"
                    cards={PRODUCT_NAME_SUB_CARDS}
                    onBack={() => setActiveReport(null)}
                    onOpenSubReport={setActiveReport}
                />
            )}

            {activeReport === 'expiry-days' && (
                <ExpiryDaysReportView channelToken={channelToken} onBack={() => setActiveReport(null)} />
            )}

            {activeReport === 'business' && (
                <BusinessReportView channelToken={channelToken} onBack={() => setActiveReport('sales-menu')} />
            )}

            {activeReport === 'monthly-product' && (
                <MonthlyProductSalesView channelToken={channelToken} onBack={() => setActiveReport('sales-menu')} />
            )}

            {activeReport === 'daily-sales' && (
                <ReportMenuView
                    title="Daily Sales Report"
                    cards={DAILY_SALES_SUB_CARDS}
                    onBack={() => setActiveReport(null)}
                    onOpenSubReport={setActiveReport}
                />
            )}

            {activeReport === 'daily-sales-invoice' && (
                <InvoiceReportView channelToken={channelToken} onBack={() => setActiveReport('daily-sales')} />
            )}

            {activeReport === 'daily-sales-purchase' && (
                <PurchaseListView channelToken={channelToken} onBack={() => setActiveReport('daily-sales')} />
            )}

            {activeReport === 'daily-sales-whole-veg' && (
                <PackingReportView mode="whole-veg" channelToken={channelToken} onBack={() => setActiveReport('daily-sales')} />
            )}

            {activeReport === 'daily-sales-cut-veg' && (
                <PackingReportView mode="cut-veg" channelToken={channelToken} onBack={() => setActiveReport('daily-sales')} />
            )}

            {activeReport === 'daily-sales-dp-bill' && (
                <DPBillReportView channelToken={channelToken} onBack={() => setActiveReport('daily-sales')} />
            )}
        </main>
    );
}

// ── Delivery Report View ──────────────────────────────────────────────

function DeliveryReportView({ channelToken, onBack }: { channelToken: string | null; onBack: () => void }) {
    // Today 00:00:00 → 23:59:59 IST, same as every other report.
    const [dateFrom, setDateFrom] = useState(() => defaultTodayTimeRange()[0]);
    const [dateTo, setDateTo] = useState(() => defaultTodayTimeRange()[1]);
    const [report, setReport] = useState<DeliveryReportData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedDPId, setSelectedDPId] = useState<string | null>(null);
    const [drillDownData, setDrillDownData] = useState<DeliveryReportData | null>(null);
    const [drillDownLoading, setDrillDownLoading] = useState(false);
    const [drillDownError, setDrillDownError] = useState('');

    const loadReport = useCallback(async () => {
        if (!channelToken) return;
        setLoading(true);
        setError('');
        setSelectedDPId(null);
        setDrillDownData(null);
        try {
            const from = istLocalToIso(dateFrom);
            const to = istLocalToIso(dateTo, true);
            const data = await fetchDeliveryReport(from, to, undefined, 0, 100, channelToken);
            setReport(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load report');
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo, channelToken]);

    useEffect(() => {
        loadReport();
    }, [loadReport]);

    async function handleDrillDown(dpId: string) {
        setSelectedDPId(dpId);
        setDrillDownLoading(true);
        setDrillDownError('');
        try {
            const from = istLocalToIso(dateFrom);
            const to = istLocalToIso(dateTo, true);
            const data = await fetchDeliveryReport(from, to, dpId, 0, 100, channelToken ?? undefined);
            setDrillDownData(data);
        } catch (err) {
            setDrillDownData(null);
            setDrillDownError(err instanceof Error ? err.message : 'Failed to load details');
        } finally {
            setDrillDownLoading(false);
        }
    }

    const isDP = report?.callerRole === 'DELIVERY_PERSON';
    const fmt = (paise: number) => formatCurrency(paise, 'INR');

    return (
        <>
            {/* ── Header bar ── */}
            <div
                className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3"
                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
            >
                <button
                    onClick={onBack}
                    className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline mr-1"
                >
                    ← Reports
                </button>
                <h1 className="text-[1rem] font-semibold text-[var(--foreground)] mr-auto">Delivery Reports</h1>
                <div className="flex items-center gap-2">
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <span className="text-[var(--text-muted)] text-[0.75rem]">to</span>
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <button
                        onClick={loadReport}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all"
                        style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', color: 'var(--tone-indigo)' }}
                    >
                        {loading ? 'Loading...' : 'Load'}
                    </button>
                </div>
            </div>

            {/* ── Content ── */}
            <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
                {loading && !report && (
                    <div className="flex items-center justify-center py-16"><Spinner /></div>
                )}

                {error && (
                    <div className="px-3 py-2 rounded-lg mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                        <p className="text-[0.75rem] text-red-400">{error}</p>
                    </div>
                )}

                {report && (
                    <>
                        {/* ── Grand totals cards ── */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
                            <SummaryCard label="Total Deliveries" value={String(report.grandTotalDeliveries)} color="var(--tone-indigo)" />
                            <SummaryCard label="Cash" value={fmt(report.grandTotalCashAmount)} sub={`${report.grandTotalCashCount} orders`} color="var(--tone-amber)" />
                            <SummaryCard label="QR" value={fmt(report.grandTotalQrAmount)} sub={`${report.grandTotalQrCount} orders`} color="var(--tone-violet)" />
                            <SummaryCard label="Online" value={fmt(report.grandTotalOnlineAmount)} sub={`${report.grandTotalOnlineCount} orders`} color="var(--tone-green)" />
                            <SummaryCard label="Payment Link" value={fmt(report.grandTotalPaymentLinkAmount)} sub={`${report.grandTotalPaymentLinkCount} orders`} color="var(--tone-sky)" />
                        </div>

                        {/* ── DP Self-view: show own fulfillments directly ── */}
                        {isDP && report.summaries.length > 0 && (
                            <FulfillmentTable fulfillments={report.summaries[0].fulfillments} />
                        )}

                        {/* ── Admin/Accountant: Per-DP summary table ── */}
                        {!isDP && report.summaries.length > 0 && !selectedDPId && (
                            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr style={{ background: 'rgb(var(--overlay-rgb)/0.02)', borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                            <th className="px-4 py-3 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Delivery Person</th>
                                            <th className="px-4 py-3 text-center text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Deliveries</th>
                                            <th className="hidden sm:table-cell px-4 py-3 text-center text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Cash</th>
                                            <th className="hidden sm:table-cell px-4 py-3 text-center text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">QR</th>
                                            <th className="hidden sm:table-cell px-4 py-3 text-center text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Online</th>
                                            <th className="hidden sm:table-cell px-4 py-3 text-center text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Pay Link</th>
                                            <th className="px-4 py-3 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Total Collected</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.summaries.map((s) => (
                                            <DPSummaryRow
                                                key={s.deliveryPersonId}
                                                summary={s}
                                                onSelect={() => handleDrillDown(s.deliveryPersonId)}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* ── Drill-down detail for Admin/Accountant ── */}
                        {!isDP && selectedDPId && (
                            <div>
                                <div className="flex items-center gap-3 mb-4">
                                    <button
                                        onClick={() => { setSelectedDPId(null); setDrillDownData(null); setDrillDownError(''); }}
                                        className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline"
                                    >
                                        ← Back to overview
                                    </button>
                                    <span className="text-[0.875rem] font-semibold text-[var(--foreground)]">
                                        {report.summaries.find((s) => s.deliveryPersonId === selectedDPId)?.deliveryPersonName}
                                    </span>
                                </div>
                                {/* Drill-down summary cards */}
                                {drillDownData?.summaries?.[0] && (
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                                        <SummaryCard label="Deliveries" value={String(drillDownData.summaries[0].totalDeliveries)} color="var(--tone-indigo)" />
                                        <SummaryCard label="Cash" value={fmt(drillDownData.summaries[0].totalCashAmount)} sub={`${drillDownData.summaries[0].cashCount} orders`} color="var(--tone-amber)" />
                                        <SummaryCard label="QR" value={fmt(drillDownData.summaries[0].totalQrAmount)} sub={`${drillDownData.summaries[0].qrCount} orders`} color="var(--tone-violet)" />
                                        <SummaryCard label="Online" value={fmt(drillDownData.summaries[0].totalOnlineAmount)} sub={`${drillDownData.summaries[0].onlineCount} orders`} color="var(--tone-green)" />
                                        <SummaryCard label="Payment Link" value={fmt(drillDownData.summaries[0].totalPaymentLinkAmount)} sub={`${drillDownData.summaries[0].paymentLinkCount} orders`} color="var(--tone-sky)" />
                                    </div>
                                )}
                                {drillDownError && (
                                    <div className="px-3 py-2 rounded-lg mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                                        <p className="text-[0.75rem] text-red-400">{drillDownError}</p>
                                    </div>
                                )}
                                {drillDownLoading ? (
                                    <div className="flex items-center justify-center py-8"><Spinner /></div>
                                ) : drillDownData?.summaries?.[0]?.fulfillments ? (
                                    <FulfillmentTable fulfillments={drillDownData.summaries[0].fulfillments} />
                                ) : (
                                    <p className="text-[0.75rem] text-[var(--text-muted)]">No fulfillment details available.</p>
                                )}
                            </div>
                        )}

                        {report.summaries.length === 0 && !loading && (
                            <p className="text-center text-[var(--text-muted)] text-[0.8125rem] py-8">
                                No deliveries found for this date range.
                            </p>
                        )}
                    </>
                )}
            </div>
        </>
    );
}

// ── Sub-components ──

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
    return (
        <div
            className="rounded-xl px-4 py-3 flex flex-col gap-1"
            style={{
                background: `color-mix(in srgb, ${color} 6%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
            }}
        >
            <span className="text-[0.625rem] font-semibold uppercase tracking-widest" style={{ color: `color-mix(in srgb, ${color} 70%, var(--foreground))` }}>
                {label}
            </span>
            <span className="text-[1.125rem] font-bold tabular-nums" style={{ color }}>{value}</span>
            {sub && <span className="text-[0.6875rem]" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
        </div>
    );
}

function CollectionBadge({ method }: { method: string }) {
    const colors = COLLECTION_COLORS[method] || COLLECTION_COLORS.Online;
    return (
        <span
            className="inline-block px-2 py-0.5 rounded-full text-[0.625rem] font-semibold"
            style={{ background: colors.bg, color: colors.text }}
        >
            {method}
        </span>
    );
}

function DPSummaryRow({
    summary: s,
    onSelect,
}: {
    summary: DeliveryPersonSummary;
    onSelect: () => void;
}) {
    const fmt = (paise: number) => formatCurrency(paise, 'INR');
    const totalCollected = s.totalCashAmount + s.totalQrAmount + s.totalOnlineAmount + s.totalPaymentLinkAmount;
    return (
        <tr
            onClick={onSelect}
            className="cursor-pointer transition-all hover:bg-overlay/[0.03]"
            style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.04)' }}
        >
            <td className="px-4 py-3">
                <p className="text-[0.8125rem] font-medium text-[var(--foreground)]">{s.deliveryPersonName}</p>
                {s.deliveryPersonPhone && (
                    <p className="text-[0.6875rem] text-[var(--text-muted)]">{s.deliveryPersonPhone}</p>
                )}
            </td>
            <td className="px-4 py-3 text-center">
                <span className="text-[0.875rem] font-semibold tabular-nums">{s.totalDeliveries}</span>
            </td>
            <td className="hidden sm:table-cell px-4 py-3 text-center">
                <span className="text-[0.75rem] tabular-nums" style={{ color: 'var(--tone-amber)' }}>{fmt(s.totalCashAmount)}</span>
                <span className="block text-[0.625rem] text-[var(--text-muted)]">{s.cashCount} orders</span>
            </td>
            <td className="hidden sm:table-cell px-4 py-3 text-center">
                <span className="text-[0.75rem] tabular-nums" style={{ color: 'var(--tone-violet)' }}>{fmt(s.totalQrAmount)}</span>
                <span className="block text-[0.625rem] text-[var(--text-muted)]">{s.qrCount} orders</span>
            </td>
            <td className="hidden sm:table-cell px-4 py-3 text-center">
                <span className="text-[0.75rem] tabular-nums" style={{ color: 'var(--tone-green)' }}>{fmt(s.totalOnlineAmount)}</span>
                <span className="block text-[0.625rem] text-[var(--text-muted)]">{s.onlineCount} orders</span>
            </td>
            <td className="hidden sm:table-cell px-4 py-3 text-center">
                <span className="text-[0.75rem] tabular-nums" style={{ color: 'var(--tone-sky)' }}>{fmt(s.totalPaymentLinkAmount)}</span>
                <span className="block text-[0.625rem] text-[var(--text-muted)]">{s.paymentLinkCount} orders</span>
            </td>
            <td className="px-4 py-3 text-right">
                <span className="text-[0.875rem] font-semibold tabular-nums">{fmt(totalCollected)}</span>
            </td>
        </tr>
    );
}

function FulfillmentTable({ fulfillments }: { fulfillments: DeliveryFulfillmentDetailItem[] }) {
    const fmt = (paise: number) => formatCurrency(paise, 'INR');

    if (fulfillments.length === 0) {
        return <p className="text-[0.75rem] text-[var(--text-muted)] py-4">No fulfillment details.</p>;
    }

    return (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
            <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[700px]">
                    <thead>
                        <tr style={{ background: 'rgb(var(--overlay-rgb)/0.02)', borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                            <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Order</th>
                            <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Order Total</th>
                            <th className="px-3 py-2.5 text-center text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Method</th>
                            <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Collected</th>
                            <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Customer</th>
                            <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Delivered At</th>
                        </tr>
                    </thead>
                    <tbody>
                        {fulfillments.map((f, idx) => {
                            const method = f.paymentCollectionMethod || 'Online';
                            const collected = f.collectedAmount ?? 0;
                            const hasMismatch = collected > 0 && f.orderTotal > 0 && collected !== f.orderTotal;
                            return (
                                <tr
                                    key={f.orderCode + idx}
                                    className="transition-colors hover:bg-overlay/[0.02]"
                                    style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.04)' }}
                                >
                                    <td className="px-3 py-2.5">
                                        <span className="text-[0.75rem] font-mono text-[var(--accent)]">{f.orderCode}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right">
                                        <span className="text-[0.8125rem] font-semibold tabular-nums">{fmt(f.orderTotal)}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                        <CollectionBadge method={method} />
                                    </td>
                                    <td className="px-3 py-2.5 text-right">
                                        <span
                                            className="text-[0.8125rem] tabular-nums font-semibold"
                                            style={{ color: hasMismatch ? 'var(--tone-red)' : undefined }}
                                        >
                                            {collected > 0 ? fmt(collected) : '—'}
                                        </span>
                                        {method === 'Cash+QR' && (f.qrCashAmount > 0 || f.qrAmount > 0) && (
                                            <p className="text-[0.5625rem] mt-0.5 leading-tight text-[var(--text-muted)]">
                                                Cash {fmt(f.qrCashAmount)} + QR {fmt(f.qrAmount)}
                                            </p>
                                        )}
                                        {hasMismatch && f.collectionNote && (
                                            <p
                                                className="text-[0.5625rem] mt-0.5 leading-tight"
                                                style={{ color: 'var(--tone-orange)' }}
                                                title={f.collectionNote}
                                            >
                                                {f.collectionNote}
                                            </p>
                                        )}
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <span className="text-[0.75rem] text-[var(--text-muted)]">{f.customerName ?? '—'}</span>
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <span className="text-[0.6875rem] text-[var(--text-muted)] tabular-nums">
                                            {f.deliveredAt ? formatDateTime(f.deliveredAt) : '—'}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Business (Sales) Report View ──────────────────────────────────────

const BUSINESS_PAGE_SIZE = 50;

// ── IST timezone helpers ──────────────────────────────────────────────
// Vendure stores timestamps in UTC but the store operates in IST. All reports
// treat datetime-local inputs as IST and display backend timestamps in IST,
// regardless of the browser's local timezone.
// Every range input runs with step="1", so the bounds are second-precise:
// "from" starts at the chosen second, "to" includes all of it (…:59.999Z).

const IST_TZ = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';

/** Normalize a datetime-local value to "YYYY-MM-DDTHH:MM:SS". The inputs run
 *  with step="1" so the user can pick seconds, but browsers drop the seconds
 *  part from the value string when it is zero — pad it back. */
function withSeconds(localDateTime: string): string {
    const [datePart, timePart] = localDateTime.split('T');
    if (!timePart) return localDateTime;
    const parts = timePart.split(':');
    while (parts.length < 3) parts.push('00');
    return `${datePart}T${parts.slice(0, 3).join(':')}`;
}

/** Parse a fully-qualified datetime string to a UTC ISO string, with a readable
 *  error when the range inputs are empty or half-filled (a partially typed
 *  second/minute makes the value string empty). */
function toIso(dateTimeString: string): string {
    const d = new Date(dateTimeString);
    if (Number.isNaN(d.getTime())) {
        throw new Error('Pick a complete From and To date & time (including seconds)');
    }
    return d.toISOString();
}

/** Convert a datetime-local input value ("YYYY-MM-DDTHH:MM[:SS]") to a UTC ISO
 *  string, interpreting the input as IST (not the browser's local time).
 *  Pass inclusive=true for the "to" bound so the chosen second is fully
 *  included (23:59:59 → …:59.999Z) instead of cut off at its start. */
function istLocalToIso(localDateTime: string, inclusive = false): string {
    const ms = inclusive ? '.999' : '.000';
    return toIso(`${withSeconds(localDateTime)}${ms}${IST_OFFSET}`);
}

/** Today's date in IST as YMD parts, regardless of the browser timezone. */
function todayInIst(): { y: number; m: number; d: number } {
    // en-CA locale produces YYYY-MM-DD format.
    const istDateStr = new Date().toLocaleDateString('en-CA', { timeZone: IST_TZ });
    const [y, m, d] = istDateStr.split('-').map(Number);
    return { y, m, d };
}

/** Default datetime range for every report: today 00:00:00 IST → today
 *  23:59:59 IST — both bounds land on the same day, so a report opens on the
 *  current day in full and the range is then narrowed by hand. Computed in IST
 *  regardless of the browser timezone. Used by Delivery Reports, Sales Report,
 *  Invoice Report, Purchase List, Whole/Cut Veg and DP Bill; Monthly Product
 *  Sales opens month-to-date instead (see defaultCurrentMonthRange). */
function defaultTodayTimeRange(): [string, string] {
    const ist = todayInIst();
    const tm = String(ist.m).padStart(2, '0');
    const td = String(ist.d).padStart(2, '0');
    return [`${ist.y}-${tm}-${td}T00:00:00`, `${ist.y}-${tm}-${td}T23:59:59`];
}

/** Default datetime range for the Monthly Product Sales report: 1st of the
 *  current month 00:00 IST → today 23:59 IST (month-to-date). A monthly report
 *  should open on the whole month, not a single day, so its totals line up with
 *  a month's worth of orders in the Vendure admin. Computed in IST. */
function defaultCurrentMonthRange(): [string, string] {
    const ist = todayInIst();
    const tm = String(ist.m).padStart(2, '0');
    const td = String(ist.d).padStart(2, '0');
    return [`${ist.y}-${tm}-01T00:00:00`, `${ist.y}-${tm}-${td}T23:59:59`];
}

/** Compact period for filenames: "Apr2026" if same month, else "YYYY-MM-DD_to_YYYY-MM-DD". */
function filenamePeriod(from: string, to: string): string {
    if (from.slice(0, 7) === to.slice(0, 7)) {
        const d = new Date(from.slice(0, 10) + 'T00:00:00');
        return d.toLocaleString('en-US', { month: 'short' }) + d.getFullYear();
    }
    return `${from}_to_${to}`;
}

/** Channel slug for filenames — full code for single, 3-letter abbreviations
 *  joined for multi (e.g. "mad-che-ban"), count fallback for very many. */
function filenameChannelSlug(
    selectedChannelIds: string[],
    availableChannels: Array<{ id: string; code: string }>,
    activeChannelCode: string | null,
): string {
    const shortOf = (code: string) =>
        code.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 3);

    if (selectedChannelIds.length === 0) return activeChannelCode ?? 'all';
    if (selectedChannelIds.length === 1) {
        return availableChannels.find((c) => c.id === selectedChannelIds[0])?.code ?? selectedChannelIds[0];
    }
    if (selectedChannelIds.length > 8) return `${selectedChannelIds.length}ch`;

    const codes = selectedChannelIds
        .map((id) => availableChannels.find((c) => c.id === id)?.code)
        .filter((c): c is string => !!c)
        .map(shortOf);
    return codes.join('-');
}

function BusinessReportView({ channelToken, onBack }: { channelToken: string | null; onBack: () => void }) {
    const { currentUser } = useAuth();
    const availableChannels = useMemo(() => {
        const list = currentUser?.channels ?? [];
        return list
            .filter((ch) => ch.code !== '__default_channel__')
            .map((ch) => ({ id: ch.id, code: ch.code }));
    }, [currentUser]);

    const [dateFrom, setDateFrom] = useState(() => defaultTodayTimeRange()[0]);
    const [dateTo, setDateTo] = useState(() => defaultTodayTimeRange()[1]);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    const [report, setReport] = useState<SalesReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [page, setPage] = useState(0);
    // Backend row count before client-side deduplication. When this is
    // larger than `report.totalItems`, the backend resolver returned
    // duplicate rows for the same orderCode — typically one per channel
    // the order is associated with — and we surface that to the user.
    const [rawBackendCount, setRawBackendCount] = useState(0);

    // Concurrency guard — ignore a Run click while a fetch is still in flight
    // so double-clicks / rapid re-runs can't stack overlapping DB scans.
    const runningRef = useRef(false);
    // Per-filter cache signature (see reportResultCache).
    const cacheKey = `business:${channelToken ?? ''}:${dateFrom}:${dateTo}:${[...selectedChannelIds].sort().join(',')}`;

    // Bill-print cache: lazy-fetched on first Print click for the current
    // filter (date range + channels). Cleared when the filter changes so
    // we never print stale invoices.
    const [bills, setBills] = useState<PrintableBills | null>(null);
    const [printing, setPrinting] = useState(false);
    const [printingCode, setPrintingCode] = useState<string | null>(null);

    // Catalogue names (Tamil under English) are fetched with the bills — same
    // source the Invoice Report uses so PDFs render identically.
    const catalogueToken = useCatalogueToken(channelToken);

    // Fetch the full result set for the current filter, dedupe by
    // orderCode (the backend's salesReport resolver can return one row
    // per (order × channel) tuple, inflating counts and totals), and
    // recompute aggregates from the deduplicated rows. The visible
    // table then paginates over the deduped list client-side.
    const loadReport = useCallback(
        async () => {
            if (!channelToken) return;
            if (runningRef.current) return;
            runningRef.current = true;
            setLoading(true);
            setError('');
            try {
                const from = istLocalToIso(dateFrom);
                const to = istLocalToIso(dateTo, true);
                const channelIdsFilter = selectedChannelIds.length > 0 ? selectedChannelIds : undefined;
                const FETCH_BATCH = 1000; // backend's max `take`
                const MAX_BATCHES = 10;   // safety cap → 10k raw rows

                const rawRows: SalesReportRow[] = [];
                let skip = 0;
                let backendTotalItems = 0;
                for (let i = 0; i < MAX_BATCHES; i++) {
                    const data = await fetchSalesReport(
                        { from, to, channelIds: channelIdsFilter, skip, take: FETCH_BATCH },
                        channelToken,
                    );
                    backendTotalItems = data.totalItems;
                    rawRows.push(...data.items);
                    if (data.items.length === 0 || rawRows.length >= data.totalItems) break;
                    skip += data.items.length;
                }

                // Dedupe by orderCode (first occurrence wins) and recompute totals.
                const seen = new Set<string>();
                const uniqueRows: SalesReportRow[] = [];
                let totalOrderAmount = 0;
                let totalNetAmount = 0;
                for (const row of rawRows) {
                    if (seen.has(row.orderCode)) continue;
                    seen.add(row.orderCode);
                    uniqueRows.push(row);
                    totalOrderAmount += row.orderAmount;
                    totalNetAmount += row.netAmount;
                }

                const nextReport: SalesReport = {
                    items: uniqueRows,
                    totalItems: uniqueRows.length,
                    totalOrderAmount,
                    totalNetAmount,
                };
                setReport(nextReport);
                setRawBackendCount(backendTotalItems);
                setPage(0);
                setCachedReport(cacheKey, { report: nextReport, rawBackendCount: backendTotalItems });
            } catch (err) {
                setReport(null);
                setRawBackendCount(0);
                setError(err instanceof Error ? err.message : 'Failed to load report');
            } finally {
                setLoading(false);
                runningRef.current = false;
            }
        },
        [dateFrom, dateTo, channelToken, selectedChannelIds, cacheKey],
    );

    // Do NOT auto-run the report — the resolver scans the production DB, so a
    // run must be explicit (the "Load Report" button). On mount / filter
    // change we only hydrate from cache if a result for this exact filter is
    // already available; otherwise we show the empty state until the user runs.
    useEffect(() => {
        const cached = getCachedReport<{ report: SalesReport; rawBackendCount: number }>(cacheKey);
        if (cached) {
            setReport(cached.report);
            setRawBackendCount(cached.rawBackendCount);
            setPage(0);
        } else {
            setReport(null);
            setRawBackendCount(0);
        }
    }, [cacheKey]);

    // Invalidate bills cache whenever the filter changes.
    useEffect(() => { setBills(null); }, [dateFrom, dateTo, selectedChannelIds, channelToken]);

    /** Fetch all delivered bills for the current filter (paginated). Cached
     *  for subsequent print clicks. Returns the Map of code → bill. */
    async function ensureBillsLoaded(): Promise<PrintableBills | null> {
        if (bills) return bills;
        if (!channelToken) return null;
        const token = channelToken;
        const from = istLocalToIso(dateFrom);
        const to = istLocalToIso(dateTo, true);
        const BATCH = 1000;
        const MAX_BATCHES = 20; // hard cap → 20k rows; prevents an unbounded scan
        const fetchRows = async (channelIds: string[] | undefined) => {
            const allRows: BillPrintRow[] = [];
            let skip = 0;
            for (let i = 0; i < MAX_BATCHES; i++) {
                const batch = await fetchBillPrintReport(
                    { from, to, channelIds, states: ['Delivered'], skip, take: BATCH },
                    token,
                );
                allRows.push(...batch.items);
                if (batch.items.length < BATCH) break;
                skip += batch.items.length;
            }
            return allRows;
        };
        // A GST-invoice channel (NEXT_PUBLIC_SOUTH_MITHAI_INVOICE_CHANNELS) is fetched
        // on its own so its bills print as tax invoices — lib/gst-invoice.ts.
        const activeChannelId = (currentUser?.channels ?? []).find((c) => c.token === token)?.id ?? null;
        const fetched = [];
        for (const plan of planBillFetches(selectedChannelIds, activeChannelId)) {
            fetched.push({ bills: groupBills(await fetchRows(plan.channelIds)), gstChannelId: plan.gstChannelId });
        }
        const grouped = mergeTaggedBills(fetched);
        const names = await loadVariantNames(grouped, catalogueToken);
        const loaded: PrintableBills = {
            byCode: new Map(grouped.map((b) => [b.code, b])),
            names: names.map,
        };
        setBills(loaded);
        return loaded;
    }

    async function handlePrintAll() {
        if (!report || report.totalItems === 0) return;
        setPrinting(true);
        setError('');
        try {
            const loaded = await ensureBillsLoaded();
            if (!loaded || loaded.byCode.size === 0) {
                setError('No delivered invoices found for this filter.');
                return;
            }
            openPrintWindow(buildPrintDocument(Array.from(loaded.byCode.values()), loaded.names));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load invoices for printing');
        } finally {
            setPrinting(false);
        }
    }

    async function handlePrintRow(orderCode: string) {
        setPrintingCode(orderCode);
        setError('');
        try {
            const loaded = await ensureBillsLoaded();
            const bill = loaded?.byCode.get(orderCode);
            if (!loaded || !bill) {
                setError(`Invoice not found for order ${orderCode}.`);
                return;
            }
            openPrintWindow(buildPrintDocument([bill], loaded.names));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load invoice for printing');
        } finally {
            setPrintingCode(null);
        }
    }

    const totalItems = report?.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / BUSINESS_PAGE_SIZE));
    const fmt = (paise: number) => formatCurrency(paise, 'INR');
    const rangeStart = totalItems === 0 ? 0 : page * BUSINESS_PAGE_SIZE + 1;
    const rangeEnd = Math.min(totalItems, (page + 1) * BUSINESS_PAGE_SIZE);
    const pagedItems = useMemo(
        () => (report?.items ?? []).slice(page * BUSINESS_PAGE_SIZE, (page + 1) * BUSINESS_PAGE_SIZE),
        [report, page],
    );

    return (
        <>
            {/* ── Header bar ── */}
            <div
                className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3"
                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
            >
                <button
                    onClick={onBack}
                    className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline mr-1"
                >
                    ← Sales Reports
                </button>
                <h1 className="text-[1rem] font-semibold text-[var(--foreground)] mr-auto">Sales Report</h1>
                <div className="flex flex-wrap items-center gap-2">
                    <ChannelMultiSelect
                        channels={availableChannels}
                        selectedIds={selectedChannelIds}
                        onChange={setSelectedChannelIds}
                    />
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <span className="text-[var(--text-muted)] text-[0.75rem]">to</span>
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <button
                        onClick={() => loadReport()}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all"
                        style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', color: 'var(--tone-indigo)' }}
                    >
                        {loading ? 'Loading...' : 'Apply'}
                    </button>
                    <button
                        onClick={handlePrintAll}
                        disabled={!report || report.totalItems === 0 || printing}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--tone-green)' }}
                    >
                        {printing ? 'Loading...' : `Print All${totalItems > 0 ? ` (${totalItems})` : ''}`}
                    </button>
                </div>
            </div>

            {/* ── Content ── */}
            <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
                {loading && !report && (
                    <div className="flex items-center justify-center py-16"><Spinner /></div>
                )}

                {error && (
                    <div className="px-3 py-2 rounded-lg mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                        <p className="text-[0.75rem] text-red-400">{error}</p>
                    </div>
                )}

                {report && (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                            <SummaryCard label="Delivered Orders" value={String(totalItems)} color="var(--tone-indigo)" />
                            <SummaryCard label="Subtotal (with tax)" value={fmt(report.totalOrderAmount)} color="var(--tone-amber)" />
                            <SummaryCard label="Shipping (with tax)" value={fmt(report.totalNetAmount - report.totalOrderAmount)} color="var(--tone-sky)" />
                            <SummaryCard label="Net Amount" value={fmt(report.totalNetAmount)} color="var(--tone-green)" />
                        </div>

                        {rawBackendCount > totalItems && (
                            <div
                                className="px-3 py-2 rounded-lg mb-3"
                                style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.22)' }}
                            >
                                <p className="text-[0.6875rem] text-[var(--tone-amber)] leading-snug">
                                    Backend returned <b>{rawBackendCount}</b> rows for this filter, but only{' '}
                                    <b>{totalItems}</b> distinct orders. The duplicates (typically one extra row
                                    per channel an order belongs to) have been removed and totals recomputed.
                                </p>
                            </div>
                        )}

                        <div className="flex items-center justify-between mb-3">
                            <p className="text-[0.75rem] text-[var(--text-muted)]">
                                {totalItems > 0
                                    ? <>Showing <span className="text-[var(--foreground)] font-medium">{rangeStart}&ndash;{rangeEnd}</span> of <span className="text-[var(--foreground)] font-medium">{totalItems}</span> orders</>
                                    : 'Total: 0 orders'}
                            </p>
                        </div>

                        {report.items.length === 0 ? (
                            <p className="text-center text-[var(--text-muted)] text-[0.8125rem] py-10">
                                No delivered orders in this date range.
                            </p>
                        ) : (
                            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse min-w-[1020px]">
                                        <thead>
                                            <tr style={{ background: 'rgb(var(--overlay-rgb)/0.02)', borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Delivered</th>
                                                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Order Code</th>
                                                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Invoice No</th>
                                                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Channel</th>
                                                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Status</th>
                                                <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Order Amt</th>
                                                <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Net Amt</th>
                                                <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pagedItems.map((row) => (
                                                <SalesReportTableRow
                                                    key={row.orderCode}
                                                    row={row}
                                                    onPrint={() => handlePrintRow(row.orderCode)}
                                                    printing={printingCode === row.orderCode}
                                                />
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ background: 'rgb(var(--overlay-rgb)/0.03)', borderTop: '1px solid rgb(var(--overlay-rgb)/0.08)' }}>
                                                <td colSpan={5} className="px-3 py-2.5 text-[0.75rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
                                                    Totals (all {totalItems} orders)
                                                </td>
                                                <td className="px-3 py-2.5 text-right text-[0.8125rem] font-bold tabular-nums" style={{ color: 'var(--tone-amber)' }}>
                                                    {fmt(report.totalOrderAmount)}
                                                </td>
                                                <td className="px-3 py-2.5 text-right text-[0.8125rem] font-bold tabular-nums" style={{ color: 'var(--tone-green)' }}>
                                                    {fmt(report.totalNetAmount)}
                                                </td>
                                                <td />
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        )}

                        {totalItems > BUSINESS_PAGE_SIZE && (
                            <div className="flex items-center justify-end gap-2 mt-4">
                                <span className="text-[0.6875rem] text-[var(--text-muted)] mr-2">
                                    Page {page + 1} of {totalPages}
                                </span>
                                <button
                                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                                    disabled={loading || page === 0}
                                    className="px-3 py-1.5 rounded-lg text-[0.75rem] font-medium cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                                    disabled={loading || page >= totalPages - 1}
                                    className="px-3 py-1.5 rounded-lg text-[0.75rem] font-medium cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
}

function SalesReportTableRow({
    row,
    onPrint,
    printing,
}: {
    row: SalesReportRow;
    onPrint: () => void;
    printing: boolean;
}) {
    const fmt = (paise: number) => formatCurrency(paise, 'INR');
    return (
        <tr
            className="transition-colors hover:bg-overlay/[0.02]"
            style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.04)' }}
        >
            <td className="px-3 py-2.5">
                <span className="text-[0.75rem] text-[var(--text-muted)] tabular-nums">
                    {formatDateTime(row.deliveredAt)}
                </span>
            </td>
            <td className="px-3 py-2.5">
                <span className="text-[0.75rem] font-mono text-[var(--accent)]">{row.orderCode}</span>
            </td>
            <td className="px-3 py-2.5">
                <span className="text-[0.75rem] font-mono text-[var(--foreground)]">{row.invoiceNo ?? '—'}</span>
            </td>
            <td className="px-3 py-2.5">
                <span className="text-[0.75rem] text-[var(--foreground)]">{row.channelCode}</span>
            </td>
            <td className="px-3 py-2.5">
                <span className={`inline-block px-2 py-0.5 rounded-full text-[0.625rem] font-semibold ${getStateBadgeClasses(row.orderStatus)}`}>
                    {formatState(row.orderStatus)}
                </span>
            </td>
            <td className="px-3 py-2.5 text-right">
                <span className="text-[0.8125rem] tabular-nums">{fmt(row.orderAmount)}</span>
            </td>
            <td className="px-3 py-2.5 text-right">
                <span className="text-[0.8125rem] font-semibold tabular-nums">{fmt(row.netAmount)}</span>
            </td>
            <td className="px-3 py-2.5 text-right">
                <button
                    onClick={onPrint}
                    disabled={printing}
                    className="px-2.5 py-1 rounded-md text-[0.6875rem] font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(167,139,250,0.14)', border: '1px solid rgba(167,139,250,0.35)', color: 'var(--tone-violet)' }}
                >
                    {printing ? '...' : 'Print PDF'}
                </button>
            </td>
        </tr>
    );
}

// ── Monthly Product Sales View ─────────────────────────────────────────

const MP_PAGE_SIZE = 50;

/** Merge facet entries from a batch of rows into an existing dropdown list.
 *  Each row carries every facet its product belongs to, so we flatten across
 *  rows and de-duplicate by id. Sorted by name for stable display. */
function mergeFacets(
    prev: Array<{ id: string; name: string }>,
    rows: ReadonlyArray<{ facets: ReadonlyArray<{ id: string; name: string }> }>,
): Array<{ id: string; name: string }> {
    const map = new Map(prev.map((f) => [f.id, f.name]));
    let added = false;
    for (const row of rows) {
        for (const f of row.facets) {
            if (!map.has(f.id)) {
                map.set(f.id, f.name);
                added = true;
            }
        }
    }
    if (!added) return prev;
    return Array.from(map, ([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function MonthlyProductSalesView({ channelToken, onBack }: { channelToken: string | null; onBack: () => void }) {
    const { currentUser } = useAuth();
    const availableChannels = useMemo(() => {
        const list = currentUser?.channels ?? [];
        return list
            .filter((ch) => ch.code !== '__default_channel__')
            .map((ch) => ({ id: ch.id, code: ch.code }));
    }, [currentUser]);
    const activeChannelCode = useMemo(() => {
        const ch = (currentUser?.channels ?? []).find((c) => c.token === channelToken);
        return ch?.code ?? null;
    }, [currentUser, channelToken]);

    const [dateFrom, setDateFrom] = useState(() => defaultCurrentMonthRange()[0]);
    const [dateTo, setDateTo] = useState(() => defaultCurrentMonthRange()[1]);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    const [selectedFacetIds, setSelectedFacetIds] = useState<string[]>([]);
    const [availableFacets, setAvailableFacets] = useState<Array<{ id: string; name: string }>>([]);
    const [report, setReport] = useState<MonthlyProductSales | null>(null);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState('');
    const [page, setPage] = useState(0);

    // Concurrency guard + per-filter cache signature (see reportResultCache).
    const runningRef = useRef(false);
    const cacheKey = `monthly:${channelToken ?? ''}:${dateFrom}:${dateTo}:${[...selectedChannelIds].sort().join(',')}:${[...selectedFacetIds].sort().join(',')}`;

    const loadReport = useCallback(
        async (targetPage: number) => {
            if (!channelToken) return;
            if (runningRef.current) return;
            runningRef.current = true;
            setLoading(true);
            setError('');
            try {
                const from = istLocalToIso(dateFrom);
                const to = istLocalToIso(dateTo, true);
                const data = await fetchMonthlyProductSales(
                    {
                        from,
                        to,
                        channelIds: selectedChannelIds.length > 0 ? selectedChannelIds : undefined,
                        facetIds: selectedFacetIds.length > 0 ? selectedFacetIds : undefined,
                        skip: targetPage * MP_PAGE_SIZE,
                        take: MP_PAGE_SIZE,
                    },
                    channelToken,
                );
                setReport(data);
                setPage(targetPage);
                // Only cache page 0 as the hydration snapshot for this filter.
                if (targetPage === 0) setCachedReport(cacheKey, data);
            } catch (err) {
                setReport(null);
                setError(err instanceof Error ? err.message : 'Failed to load report');
            } finally {
                setLoading(false);
                runningRef.current = false;
            }
        },
        [dateFrom, dateTo, channelToken, selectedChannelIds, selectedFacetIds, cacheKey],
    );

    // Do NOT auto-run — this resolver runs a full product-sales aggregation on
    // the DB. Hydrate from cache on mount / filter change; otherwise wait for
    // the explicit "Load Report" click.
    useEffect(() => {
        const cached = getCachedReport<MonthlyProductSales>(cacheKey);
        setReport(cached ?? null);
        setPage(0);
    }, [cacheKey]);

    // Clear dropdown options whenever the filter changes so stale facets
    // from a previous filter don't bleed into the new one. The two effects
    // below repopulate from (a) the currently-loaded page and (b) a
    // background full-range fetch.
    useEffect(() => {
        setAvailableFacets([]);
    }, [dateFrom, dateTo, channelToken, selectedChannelIds]);

    // Primary source: seed the dropdown from the currently-loaded report
    // page. Guarantees the dropdown is never empty when the table has rows,
    // even if the secondary background fetch is slow or fails.
    useEffect(() => {
        if (!report) return;
        setAvailableFacets((prev) => mergeFacets(prev, report.items));
    }, [report]);

    // Secondary source: page through the full result set to surface facets
    // beyond MP_PAGE_SIZE. Merges into whatever the primary source has
    // populated; never clears on failure. Skipped when the user already
    // has a facet filter active (so the dropdown doesn't shrink to just
    // the selected facet).
    const facetHarvestKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!channelToken) return;
        // Only harvest facets AFTER the user has explicitly run the report,
        // and only once per filter — so merely opening the report (or paging)
        // never fires these extra full aggregations against the DB.
        if (!report) return;
        if (selectedFacetIds.length > 0) return;
        if (facetHarvestKeyRef.current === cacheKey) return;
        facetHarvestKeyRef.current = cacheKey;
        let cancelled = false;
        (async () => {
            try {
                const from = istLocalToIso(dateFrom);
                const to = istLocalToIso(dateTo, true);
                const channelIdsFilter = selectedChannelIds.length > 0 ? selectedChannelIds : undefined;
                const BATCH = 1000;
                // Each batch re-runs the FULL product-sales aggregation on the
                // backend purely to harvest facet names for the dropdown. Facets
                // are a tiny shared set (a handful of categories), so the first
                // few thousand product rows already contain essentially all of
                // them — capping at 4 batches cuts this background load ~80% vs
                // the old 20 without losing facets in practice.
                const MAX_BATCHES = 4;
                let skip = 0;
                for (let i = 0; i < MAX_BATCHES; i++) {
                    if (cancelled) return;
                    const data = await fetchMonthlyProductSales(
                        { from, to, channelIds: channelIdsFilter, skip, take: BATCH },
                        channelToken,
                    );
                    if (cancelled) return;
                    setAvailableFacets((prev) => mergeFacets(prev, data.items));
                    const fetched = skip + data.items.length;
                    if (data.items.length === 0 || fetched >= data.totalItems) break;
                    skip += BATCH;
                }
            } catch (err) {
                // Background enhancement only — log so the failure isn't
                // invisible during debugging, but keep what the primary
                // source populated.
                console.error('[MonthlyProductSales] Facet background fetch failed:', err);
            }
        })();
        return () => { cancelled = true; };
    }, [report, channelToken, selectedFacetIds.length, cacheKey, dateFrom, dateTo, selectedChannelIds]);

    async function handleDownloadCsv() {
        if (!report || report.totalItems === 0 || !channelToken) return;
        setExporting(true);
        setError('');
        try {
            const from = istLocalToIso(dateFrom);
            const to = istLocalToIso(dateTo, true);
            const channelIdsFilter = selectedChannelIds.length > 0 ? selectedChannelIds : undefined;
            const facetIdsFilter = selectedFacetIds.length > 0 ? selectedFacetIds : undefined;
            const EXPORT_BATCH = 1000;

            const all: MonthlyProductSalesRow[] = [];
            let skip = 0;
            const total = report.totalItems;
            while (skip < total) {
                const batch = await fetchMonthlyProductSales(
                    { from, to, channelIds: channelIdsFilter, facetIds: facetIdsFilter, skip, take: EXPORT_BATCH },
                    channelToken,
                );
                all.push(...batch.items);
                if (batch.items.length === 0) break;
                skip += batch.items.length;
            }

            const header = ['Facets', 'Product', 'Quantity Sold', 'Sales Amount (INR)'];
            const rows = all.map((r) => [
                r.facets.map((f) => f.name).join(', '),
                r.productName,
                String(r.totalQuantitySold),
                (r.totalSalesAmount / 100).toFixed(2),
            ]);
            const escape = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const chSlug = filenameChannelSlug(selectedChannelIds, availableChannels, activeChannelCode);
            a.download = `${chSlug}-products-${filenamePeriod(dateFrom, dateTo)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to export CSV');
        } finally {
            setExporting(false);
        }
    }

    const totalItems = report?.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / MP_PAGE_SIZE));
    const fmt = (paise: number) => formatCurrency(paise, 'INR');
    const rangeStart = totalItems === 0 ? 0 : page * MP_PAGE_SIZE + 1;
    const rangeEnd = Math.min(totalItems, (page + 1) * MP_PAGE_SIZE);

    return (
        <>
            {/* ── Header bar ── */}
            <div
                className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3"
                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
            >
                <button
                    onClick={onBack}
                    className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline mr-1"
                >
                    ← Sales Reports
                </button>
                <h1 className="text-[1rem] font-semibold text-[var(--foreground)] mr-auto">Monthly Product Sales</h1>
                <div className="flex flex-wrap items-center gap-2">
                    <ChannelMultiSelect
                        channels={availableChannels}
                        selectedIds={selectedChannelIds}
                        onChange={setSelectedChannelIds}
                    />
                    <FacetMultiSelect
                        facets={availableFacets}
                        selected={selectedFacetIds}
                        onChange={setSelectedFacetIds}
                    />
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <span className="text-[var(--text-muted)] text-[0.75rem]">to</span>
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <button
                        onClick={() => loadReport(0)}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all"
                        style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', color: 'var(--tone-indigo)' }}
                    >
                        {loading ? 'Loading...' : 'Apply'}
                    </button>
                    <button
                        onClick={handleDownloadCsv}
                        disabled={!report || report.totalItems === 0 || exporting}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--tone-green)' }}
                    >
                        {exporting ? 'Exporting...' : 'Download CSV'}
                    </button>
                </div>
            </div>

            {/* ── Content ── */}
            <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
                {loading && !report && (
                    <div className="flex items-center justify-center py-16"><Spinner /></div>
                )}

                {error && (
                    <div className="px-3 py-2 rounded-lg mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                        <p className="text-[0.75rem] text-red-400">{error}</p>
                    </div>
                )}

                {report && (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                            <SummaryCard label="Products" value={String(totalItems)} color="var(--tone-indigo)" />
                            <SummaryCard label="Total Quantity Sold" value={String(report.totalQuantitySold)} color="var(--tone-amber)" />
                            <SummaryCard label="Total Sales Amount" value={fmt(report.totalSalesAmount)} color="var(--tone-green)" />
                        </div>

                        <div className="flex items-center justify-between mb-3">
                            <p className="text-[0.75rem] text-[var(--text-muted)]">
                                {totalItems > 0
                                    ? <>Showing <span className="text-[var(--foreground)] font-medium">{rangeStart}&ndash;{rangeEnd}</span> of <span className="text-[var(--foreground)] font-medium">{totalItems}</span> products</>
                                    : 'Total: 0 products'}
                            </p>
                        </div>

                        {report.items.length === 0 ? (
                            <p className="text-center text-[var(--text-muted)] text-[0.8125rem] py-10">
                                No product sales in this date range.
                            </p>
                        ) : (
                            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse min-w-[680px]">
                                        <thead>
                                            <tr style={{ background: 'rgb(var(--overlay-rgb)/0.02)', borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Facets</th>
                                                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Product</th>
                                                <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Quantity</th>
                                                <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Sales Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {report.items.map((row) => (
                                                <MonthlyProductRow key={row.productId} row={row} />
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ background: 'rgb(var(--overlay-rgb)/0.03)', borderTop: '1px solid rgb(var(--overlay-rgb)/0.08)' }}>
                                                <td colSpan={2} className="px-3 py-2.5 text-[0.75rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
                                                    Totals (all {totalItems} products)
                                                </td>
                                                <td className="px-3 py-2.5 text-right text-[0.8125rem] font-bold tabular-nums" style={{ color: 'var(--tone-amber)' }}>
                                                    {report.totalQuantitySold}
                                                </td>
                                                <td className="px-3 py-2.5 text-right text-[0.8125rem] font-bold tabular-nums" style={{ color: 'var(--tone-green)' }}>
                                                    {fmt(report.totalSalesAmount)}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        )}

                        {totalItems > MP_PAGE_SIZE && (
                            <div className="flex items-center justify-end gap-2 mt-4">
                                <span className="text-[0.6875rem] text-[var(--text-muted)] mr-2">
                                    Page {page + 1} of {totalPages}
                                </span>
                                <button
                                    onClick={() => loadReport(page - 1)}
                                    disabled={loading || page === 0}
                                    className="px-3 py-1.5 rounded-lg text-[0.75rem] font-medium cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() => loadReport(page + 1)}
                                    disabled={loading || page >= totalPages - 1}
                                    className="px-3 py-1.5 rounded-lg text-[0.75rem] font-medium cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
}

function MonthlyProductRow({ row }: { row: MonthlyProductSalesRow }) {
    const fmt = (paise: number) => formatCurrency(paise, 'INR');
    const facetLabel = row.facets.length > 0
        ? row.facets.map((f) => f.name).join(', ')
        : '—';
    return (
        <tr
            className="transition-colors hover:bg-overlay/[0.02]"
            style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.04)' }}
        >
            <td className="px-3 py-2.5">
                <span className="text-[0.75rem] text-[var(--text-muted)]">{facetLabel}</span>
            </td>
            <td className="px-3 py-2.5">
                <span className="text-[0.8125rem] font-medium text-[var(--foreground)]">{row.productName}</span>
            </td>
            <td className="px-3 py-2.5 text-right">
                <span className="text-[0.8125rem] tabular-nums">{row.totalQuantitySold}</span>
            </td>
            <td className="px-3 py-2.5 text-right">
                <span className="text-[0.8125rem] font-semibold tabular-nums">{fmt(row.totalSalesAmount)}</span>
            </td>
        </tr>
    );
}

// ── Facet Multi-Select ────────────────────────────────────────────────

function FacetMultiSelect({
    facets,
    selected,
    onChange,
}: {
    facets: Array<{ id: string; name: string }>;
    selected: string[];
    onChange: (ids: string[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
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

    function toggle(id: string) {
        onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    }

    const label = selected.length === 0
        ? 'All facets'
        : selected.length === 1
            ? (facets.find((f) => f.id === selected[0])?.name ?? '1 facet')
            : `${selected.length} facets`;

    const filtered = filter
        ? facets.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()))
        : facets;

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[0.75rem] cursor-pointer transition-all"
                style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
                <span className="max-w-[160px] truncate">{label}</span>
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
                        minWidth: '260px',
                        maxHeight: '380px',
                    }}
                >
                    <div className="p-2" style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.08)' }}>
                        <input
                            type="text"
                            placeholder="Search facets..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-md text-[0.75rem] outline-none"
                            style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                        />
                    </div>
                    <div
                        className="flex items-center justify-between px-3 py-2 gap-2"
                        style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.08)' }}
                    >
                        <button
                            onClick={() => onChange(filtered.map((f) => f.id))}
                            className="text-[0.6875rem] font-medium cursor-pointer hover:underline"
                            style={{ color: 'var(--tone-indigo)' }}
                        >
                            Select {filter ? 'matching' : 'all'}
                        </button>
                        <button
                            onClick={() => onChange([])}
                            className="text-[0.6875rem] font-medium cursor-pointer hover:underline"
                            style={{ color: 'var(--text-muted)' }}
                        >
                            Clear
                        </button>
                    </div>
                    <div className="overflow-y-auto py-1" style={{ maxHeight: '280px' }}>
                        {filtered.length === 0 ? (
                            <p className="px-3 py-3 text-[0.75rem] text-[var(--text-muted)]">
                                {facets.length === 0 ? 'No facets in current results.' : 'No matches.'}
                            </p>
                        ) : (
                            filtered.map((f) => {
                                const checked = selected.includes(f.id);
                                return (
                                    <button
                                        key={f.id}
                                        onClick={() => toggle(f.id)}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-overlay/[0.04] cursor-pointer"
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
                                            {f.name}
                                        </span>
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

// ── Invoice Report View ───────────────────────────────────────────────

// Page size when fetching invoice rows. NOTE: one row = one order LINE, not one
// invoice (the UI groups rows into bills by order code). The backend caps a page
// at 1000 rows, so we request that and loop on `totalItems` to pull every page —
// otherwise a busy channel whose order-lines exceed one page would have invoices
// dropped or truncated mid-bill.
const INVOICE_FETCH_TAKE = 1000;

/** Vendure order states the Invoice Report asks for. NOTE: the backend does
 *  not implement a `states` input — it applies one hard-coded exclusion list
 *  to every billPrintReport caller, so results are effectively narrowed to
 *  PaymentAuthorized, PaymentSettled and Modifying regardless of this list. */
const INVOICE_INCLUDED_STATES: string[] = [
    'ArrangingPayment',
    'PaymentAuthorized',
    'PaymentSettled',
    'PartiallyShipped',
    'Shipped',
    'Modifying',
    'ArrangingAdditionalPayment',
];

function InvoiceReportView({ channelToken, onBack }: { channelToken: string | null; onBack: () => void }) {
    const { currentUser } = useAuth();
    const availableChannels = useMemo(() => {
        const list = currentUser?.channels ?? [];
        return list
            .filter((ch) => ch.code !== '__default_channel__')
            .map((ch) => ({ id: ch.id, code: ch.code }));
    }, [currentUser]);

    const [dateFrom, setDateFrom] = useState(() => defaultTodayTimeRange()[0]);
    const [dateTo, setDateTo] = useState(() => defaultTodayTimeRange()[1]);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    const [loaded, setLoaded] = useState<LoadedBills | null>(null);
    const bills = loaded?.bills ?? null;
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Concurrency guard + per-filter cache signature (see reportResultCache).
    const runningRef = useRef(false);
    const cacheKey = `invoice:${channelToken ?? ''}:${dateFrom}:${dateTo}:${[...selectedChannelIds].sort().join(',')}`;

    // The Tamil name under each English one is the variant's localName in the
    // catalogue, read once per load alongside the bills.
    const catalogueToken = useCatalogueToken(channelToken);

    const loadReport = useCallback(async () => {
        if (!channelToken) return;
        if (runningRef.current) return;
        runningRef.current = true;
        setLoading(true);
        setError('');
        try {
            const from = istLocalToIso(dateFrom);
            const to = istLocalToIso(dateTo, true);
            // Page through every order-line row. The backend LIMITs rows (= order
            // lines), so a single fetch truncates busy channels — keep fetching
            // until we've collected all `totalItems` rows, then group into bills.
            const MAX_BATCHES = 30; // hard cap; prevents an unbounded scan on count drift
            const fetchRows = async (channelIds: string[] | undefined) => {
                const allRows: BillPrintRow[] = [];
                let skip = 0;
                let totalItems = Infinity;
                for (let i = 0; i < MAX_BATCHES; i++) {
                    const data = await fetchBillPrintReport(
                        {
                            from,
                            to,
                            channelIds,
                            // Always include the same fixed list — excludes Created, Draft,
                            // AddingItems, PartiallyDelivered, Delivered, Cancelled, CancellationRequested.
                            states: INVOICE_INCLUDED_STATES,
                            skip,
                            take: INVOICE_FETCH_TAKE,
                        },
                        channelToken,
                    );
                    allRows.push(...data.items);
                    totalItems = data.totalItems;
                    skip += INVOICE_FETCH_TAKE;
                    // Stop if a page came back short (defensive against count drift).
                    if (data.items.length < INVOICE_FETCH_TAKE) break;
                    if (allRows.length >= totalItems) break;
                }
                return allRows;
            };
            // A GST-invoice channel (NEXT_PUBLIC_SOUTH_MITHAI_INVOICE_CHANNELS) is fetched
            // on its own so its bills print as tax invoices — lib/gst-invoice.ts.
            const activeChannelId = (currentUser?.channels ?? []).find((c) => c.token === channelToken)?.id ?? null;
            const fetched = [];
            for (const plan of planBillFetches(selectedChannelIds, activeChannelId)) {
                fetched.push({ bills: groupBills(await fetchRows(plan.channelIds)), gstChannelId: plan.gstChannelId });
            }
            const next = await loadBillsWithNames(mergeTaggedBills(fetched), catalogueToken);
            setLoaded(next);
            setCachedReport(cacheKey, next);
        } catch (err) {
            setLoaded(null);
            setError(err instanceof Error ? err.message : 'Failed to load invoices');
        } finally {
            setLoading(false);
            runningRef.current = false;
        }
    }, [dateFrom, dateTo, channelToken, selectedChannelIds, cacheKey, catalogueToken, currentUser]);

    // Do NOT auto-run — hydrate from cache on mount / filter change; a fresh
    // fetch happens only on the explicit "Load Report" click.
    useEffect(() => {
        setLoaded(getCachedReport<LoadedBills>(cacheKey) ?? null);
    }, [cacheKey]);

    function handlePrintOne(bill: GroupedBill) {
        openPrintWindow(buildPrintDocument([bill], loaded?.names ?? null));
    }

    // Grouped bills — by delivery slot (1 DAT-morning → 2 Tomorrow-morning →
    // 3 DAT-evening → 4 Tomorrow-evening → 5 Other). Insertion order within each
    // slot is preserved so bills appear in the same time-wise order returned by
    // the backend (matches the Delivery Partner Report).
    const groups = useMemo(() => {
        if (!bills) return [];
        const map = new Map<DeliverySlot, GroupedBill[]>();
        for (const b of bills) {
            const s = deliverySlot(b.deliveryTime);
            if (!map.has(s)) map.set(s, []);
            map.get(s)!.push(b);
        }
        return SLOT_ORDER
            .map((slot) => ({ slot, label: SLOT_LABEL[slot], items: map.get(slot) ?? [] }))
            .filter((g) => g.items.length > 0);
    }, [bills]);

    function handlePrintAll() {
        const flat = groups.flatMap((g) => g.items);
        if (flat.length === 0) return;
        openPrintWindow(buildPrintDocument(flat, loaded?.names ?? null));
    }

    const totalCount = bills?.length ?? 0;
    const inr = (paise: number) => formatCurrency(paise, 'INR');

    return (
        <>
            <div
                className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3"
                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
            >
                <button
                    onClick={onBack}
                    className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline mr-1"
                >
                    ← Daily Sales
                </button>
                <h1 className="text-[1rem] font-semibold text-[var(--foreground)] mr-auto">Invoice Report</h1>
                <div className="flex flex-wrap items-center gap-2">
                    <ChannelMultiSelect
                        channels={availableChannels}
                        selectedIds={selectedChannelIds}
                        onChange={setSelectedChannelIds}
                    />
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <span className="text-[var(--text-muted)] text-[0.75rem]">to</span>
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <button
                        onClick={loadReport}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all"
                        style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', color: 'var(--tone-indigo)' }}
                    >
                        {loading ? 'Loading...' : 'Apply'}
                    </button>
                    <button
                        onClick={handlePrintAll}
                        disabled={totalCount === 0}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--tone-green)' }}
                    >
                        Print All ({totalCount})
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
                {/* Show the loader on EVERY fetch (first load and every re-filter)
                    and hide the previous results while it runs, so the old date's
                    data is never visible alongside a new filter. */}
                {loading && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <Spinner />
                        <p className="text-[0.8125rem] text-[var(--text-muted)]">Loading invoices… please wait</p>
                    </div>
                )}

                {!loading && error && (
                    <div className="px-3 py-2 rounded-lg mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                        <p className="text-[0.75rem] text-red-400">{error}</p>
                    </div>
                )}

                {!loading && loaded?.namesError && (
                    <NamesWarning error={loaded.namesError} />
                )}

                {!loading && bills && bills.length === 0 && (
                    <p className="text-center text-[var(--text-muted)] text-[0.8125rem] py-10">
                        No invoices in this date range.
                    </p>
                )}

                {!loading && bills && bills.length > 0 && (
                    <>
                        <p className="text-[0.75rem] text-[var(--text-muted)] mb-3">
                            <span className="text-[var(--foreground)] font-medium">{totalCount}</span> invoice{totalCount === 1 ? '' : 's'} across <span className="text-[var(--foreground)] font-medium">{groups.length}</span> delivery slot{groups.length === 1 ? '' : 's'}
                        </p>
                        {groups.map((g) => (
                            <div key={g.slot} className="mb-6">
                                <h3 className="text-[0.8125rem] font-semibold mb-2 flex items-center gap-2">
                                    <span style={{ color: 'var(--foreground)' }}>{g.label}</span>
                                    <span className="text-[var(--text-muted)] font-normal text-[0.75rem]">({g.items.length})</span>
                                </h3>
                                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                    <div className="overflow-x-auto">
                                        <table className="w-full border-collapse min-w-[720px]">
                                            <thead>
                                                <tr style={{ background: 'rgb(var(--overlay-rgb)/0.02)', borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                                    <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Invoice No</th>
                                                    <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Order Code</th>
                                                    <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Date / Time</th>
                                                    <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Items</th>
                                                    <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Net Total</th>
                                                    <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {g.items.map((b) => (
                                                    <tr
                                                        key={b.code}
                                                        className="transition-colors hover:bg-overlay/[0.02]"
                                                        style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.04)' }}
                                                    >
                                                        <td className="px-3 py-2.5">
                                                            <span className="text-[0.75rem] font-mono text-[var(--foreground)]">{b.invoiceNo || '—'}</span>
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            <span className="text-[0.75rem] font-mono text-[var(--accent)]">{b.code}</span>
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            <span className="text-[0.75rem] text-[var(--text-muted)] tabular-nums">{b.date} {b.time}</span>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right">
                                                            <span className="text-[0.8125rem] tabular-nums">{b.lines.reduce((s, l) => s + l.qty, 0)}</span>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right">
                                                            <span className="text-[0.8125rem] font-semibold tabular-nums">{inr(b.netTotal)}</span>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right">
                                                            <button
                                                                onClick={() => handlePrintOne(b)}
                                                                className="px-2.5 py-1 rounded-md text-[0.6875rem] font-semibold cursor-pointer transition-all"
                                                                style={{ background: 'rgba(167,139,250,0.14)', border: '1px solid rgba(167,139,250,0.35)', color: 'var(--tone-violet)' }}
                                                            >
                                                                Print PDF
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </>
    );
}

// ── Bill print HTML helpers ───────────────────────────────────────────

function escapeHtml(s: string | null | undefined): string {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => {
        switch (c) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return c;
        }
    });
}

function paiseToInr(p: number): string {
    return (p / 100).toFixed(2);
}

/** Backend's shadowPrice (MRP) is already in rupees, NOT paise like rate/total/etc.
 *  So we format it directly without the /100 division. */
function rupeesToInr(r: number | null | undefined): string {
    if (r == null) return '0.00';
    return Number(r).toFixed(2);
}

// ── Catalogue names (ProductVariant.localName via the Admin API) ──────
//
// Every name a Daily Sales report prints beside the English one now comes
// from Vendure: the variant's `localName` custom field (Tamil, or Malayalam on
// Idukki's catalogue), the product's facet values and their `purchaseOrdNo`.
// The Excel master under /excel/ is no longer read by these reports.

/** Bills plus the catalogue names their lines print with. Cached together, so
 *  a re-opened report shows the same names it loaded with. */
interface LoadedBills {
    bills: GroupedBill[];
    /** SKU → catalogue entry. A SKU that is missing prints without a local name. */
    names: VariantNameMap;
    /** Set when the name lookup failed. The bills still print, in English only. */
    namesError: string | null;
}

/** Same pairing for the Sales Report, which prints by order code. */
interface PrintableBills {
    byCode: Map<string, GroupedBill>;
    names: VariantNameMap;
}

/**
 * Which channel to read catalogue names through.
 *
 * A local name is a translation, not channel data, so any channel that carries
 * the variant answers the same. The default channel carries every variant, so
 * it is asked first; an admin scoped to a single channel asks that one instead.
 */
function useCatalogueToken(channelToken: string | null): string | null {
    const { currentUser } = useAuth();
    return useMemo(
        () => currentUser?.channels.find((c) => c.code === '__default_channel__')?.token ?? channelToken,
        [currentUser, channelToken],
    );
}

/**
 * Catalogue entries for every SKU on the given bills.
 *
 * Never throws: a bill without Tamil names is still a bill the customer can be
 * handed, so a failed lookup (no ReadCatalog permission, backend hiccup) is
 * reported beside the report rather than replacing it.
 */
async function loadVariantNames(
    bills: GroupedBill[],
    catalogueToken: string | null,
): Promise<{ map: VariantNameMap; error: string | null }> {
    const skus = new Set<string>();
    for (const bill of bills) {
        for (const line of bill.lines) {
            const sku = line.pCode ? String(line.pCode).trim() : '';
            if (sku) skus.add(sku);
        }
    }
    try {
        return { map: await fetchVariantNames(skus, catalogueToken ?? undefined), error: null };
    } catch (err) {
        console.error('[VariantNames] catalogue lookup failed:', err);
        return { map: new Map(), error: err instanceof Error ? err.message : String(err) };
    }
}

async function loadBillsWithNames(
    bills: GroupedBill[],
    catalogueToken: string | null,
): Promise<LoadedBills> {
    const names = await loadVariantNames(bills, catalogueToken);
    return { bills, names: names.map, namesError: names.error };
}

/** The catalogue entry behind a bill line, by SKU (`pCode`). */
function variantNamesFor(
    line: { pCode: string | null },
    names: VariantNameMap | null,
): VariantNames | null {
    if (!names) return null;
    const sku = line.pCode ? String(line.pCode).trim() : '';
    return (sku && names.get(sku)) || null;
}

/** Picks the print font stack. Malayalam has its own Unicode block
 *  (U+0D00–U+0D7F); everything else the catalogue holds is Tamil. */
function localNameScript(text: string): 'tamil' | 'malayalam' {
    return /[ഀ-ൿ]/.test(text) ? 'malayalam' : 'tamil';
}

/** Bills loaded but the catalogue lookup did not: say so above a report that
 *  is about to print English-only names, instead of printing them silently. */
function NamesWarning({ error }: { error: string }) {
    return (
        <div className="px-3 py-2 rounded-lg mb-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <p className="text-[0.75rem] text-amber-400">
                Tamil names could not be loaded from the catalogue — bills will print with English names only. {error}
            </p>
        </div>
    );
}

/** Convert "15:25:09.000000" or "15:25:09" → "3:25:09 PM" (12-hour). */
function formatBillTime(t: string | null | undefined): string {
    if (!t) return '';
    const trimmed = String(t).split('.')[0]; // strip microseconds
    const parts = trimmed.split(':');
    if (parts.length < 2) return String(t);
    let h = parseInt(parts[0], 10);
    if (isNaN(h)) return String(t);
    const m = parts[1] ?? '00';
    const s = parts[2] ?? '00';
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m}:${s} ${ampm}`;
}

// ── Delivery-slot grouping (used by Invoice Report) ──────────────────

type DeliverySlot = 'dat-morning' | 'tomorrow-morning' | 'dat-evening' | 'tomorrow-evening' | 'other';

/** Order in which slots are rendered/printed:
 *  1. Day After Tomorrow Morning   2. Tomorrow Morning
 *  3. Day After Tomorrow Evening   4. Tomorrow Evening   5. Other */
const SLOT_ORDER: DeliverySlot[] = [
    'dat-morning',
    'tomorrow-morning',
    'dat-evening',
    'tomorrow-evening',
    'other',
];

const SLOT_LABEL: Record<DeliverySlot, string> = {
    'dat-morning': 'Day After Tomorrow — Morning Delivery',
    'tomorrow-morning': 'Tomorrow — Morning Delivery',
    'dat-evening': 'Day After Tomorrow — Evening Delivery',
    'tomorrow-evening': 'Tomorrow — Evening Delivery',
    'other': 'Other Deliveries',
};

function deliverySlot(deliveryTime: string | null | undefined): DeliverySlot {
    if (!deliveryTime) return 'other';
    const lc = deliveryTime.toLowerCase();
    const isDAT = /day\s*after\s*tomorrow/.test(lc);
    const isTomorrow = !isDAT && /tomorrow/.test(lc);
    const isMorning = /morning/.test(lc);
    const isEvening = /evening/.test(lc);
    if (isDAT && isMorning) return 'dat-morning';
    if (isTomorrow && isMorning) return 'tomorrow-morning';
    if (isDAT && isEvening) return 'dat-evening';
    if (isTomorrow && isEvening) return 'tomorrow-evening';
    return 'other';
}

/** Compact delivery-time label: "Tomorrow Morning Delivery (Rs.40 incl.Tax)" → "Morning Delivery". */
function simplifyDeliveryTime(s: string | null | undefined): string {
    if (!s) return '';
    const slot = s.match(/morning|afternoon|evening|night/i);
    if (slot) {
        const word = slot[0];
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() + ' Delivery';
    }
    // Fallback: just strip the parenthetical (e.g. "(Rs.40 incl.Tax)") and any leading day word
    return String(s)
        .replace(/\s*\([^)]*\)\s*/g, '')
        .replace(/^(today|tomorrow|same\s*day)\s+/i, '')
        .trim();
}

/** Parse Vendure billingAddress JSON into customer/phone/address parts. */
function parseBillingAddress(raw: string | null | undefined): {
    customer: string;
    phone: string;
    address: string;
} {
    if (!raw) return { customer: '', phone: '', address: '' };
    try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        const customer = String(obj.fullName ?? '');
        const phone = String(obj.phoneNumber ?? '');
        const parts = [
            obj.streetLine1,
            obj.streetLine2,
            obj.city,
            obj.postalCode,
            obj.country ?? obj.countryCode,
        ]
            .map((p) => (p == null ? '' : String(p).trim()))
            .filter((p) => p.length > 0);
        return { customer, phone, address: parts.join(', ') };
    } catch {
        // Not JSON — show raw string as address, leave customer/phone blank
        return { customer: '', phone: '', address: String(raw) };
    }
}

function buildBillHtml(bill: GroupedBill, index: number, names: VariantNameMap | null): string {
    const totalQty = bill.lines.reduce((s, l) => s + l.qty, 0);

    // Coupon layout matches the customer's own invoice (app / website): a gift
    // product is a FREE line, an item-level coupon discount lowers its line,
    // and only the order-level part of the coupon is a discount line below.
    // See lib/bill-figures.ts.
    const fig = computeBillFigures(bill);

    // Tax-INCLUSIVE line rendering — matches the prices shown in Vendure.
    // Rate = per-unit list price incl. GST (backend `rate` = OrderLine.listPrice);
    // Amount = qty × Rate, also incl. GST. The GST column shows the tax that is
    // ALREADY included in those figures (not added on top); it is broken out again
    // as CGST/SGST in the totals purely as an informational sub-line.
    // The variant's catalogue localName goes under the English name: Tamil on
    // most bills, Malayalam on Idukki's — same slot, font stack picked per line.
    const lineRows = bill.lines.map((l, i) => {
        const localName = variantNamesFor(l, names)?.localName ?? null;
        const localScript = localName ? localNameScript(localName) : 'tamil';
        const lf = fig.lines[i];
        // Rate: list price incl. GST; struck through with the coupon price
        // beside it when the coupon lowered the line (0.00 for a FREE item).
        const rateCell = lf.isDiscounted
            ? `<s>${paiseToInr(l.rate)}</s><br/>${paiseToInr(lf.unitAmount)}`
            : paiseToInr(l.rate);
        // CGST/SGST split per line (50:50 of the stored rate / amount).
        const halfRate = (l.taxRate ?? 0) / 2;
        const halfRateStr = halfRate.toFixed(halfRate % 1 === 0 ? 0 : 1);
        const taxCell = l.taxRate > 0
            ? `CGST ${halfRateStr}%<br/>SGST ${halfRateStr}%`
            : '&mdash;';
        const halfTaxAmt = (l.taxAmount ?? 0) / 2;
        const gstCell = l.taxAmount > 0
            ? `CGST ${paiseToInr(halfTaxAmt)}<br/>SGST ${paiseToInr(halfTaxAmt)}`
            : '&mdash;';
        const lineSaving = lf.saving;
        return `
        <tr>
            <td class="td num idx">${i + 1}</td>
            <td class="td item">
                <div class="item-en">${escapeHtml(l.itemName)}${lf.isFree ? ' <span class="free-tag">(FREE - coupon)</span>' : ''}</div>
                ${localName ? `<div class="item-ta ${localScript}">${escapeHtml(localName)}</div>` : ''}
            </td>
            <td class="td num hsn">${escapeHtml(l.hsnCode ?? '')}</td>
            <td class="td num">${l.qty}</td>
            <td class="td num">${rupeesToInr(l.shadowPrice)}</td>
            <td class="td num">${rateCell}</td>
            <td class="td tax-split">${taxCell}</td>
            <td class="td tax-split">${gstCell}</td>
            <td class="td num">
                <b>${lf.isFree ? 'FREE' : paiseToInr(lf.amount)}</b>
                ${lineSaving > 0 ? `<div class="line-saving">save ${paiseToInr(lineSaving)}</div>` : ''}
            </td>
        </tr>
        `;
    }).join('');

    const time12h = formatBillTime(bill.time);
    const addr = parseBillingAddress(bill.billingAddress);
    const deliveryText = simplifyDeliveryTime(bill.deliveryTime);
    const cgst = bill.totalTaxAmount / 2;
    const sgst = bill.totalTaxAmount / 2;

    const couponCodesText = bill.couponCode
        ? (() => {
            try {
                const parsed = JSON.parse(bill.couponCode) as unknown;
                return Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
            } catch {
                return bill.couponCode;
            }
        })()
        : '';

    return `
<section class="bill">
    <!-- ── Top band: centered logo + store address ── -->
    <header class="bill-hdr">
        <div class="bill-hdr-left">
            <div class="brand-row"></div>
            <div class="bill-hdr-addr">
                Kovil Papakudi, Madurai-625018<br/>
                Toll Free: 1800 309 4983
            </div>
        </div>
    </header>

    <!-- ── Order meta: invoice/date/payment + customer ── -->
    <table class="bill-info">
        <tr>
            <td>
                <div class="info-grid">
                    <div><span class="lbl">Invoice No:</span> <span class="val">${escapeHtml(bill.invoiceNo)}</span></div>
                    <div><span class="lbl">SNo:</span> <span class="val">${index + 1}</span></div>
                    <div><span class="lbl">Date:</span> <span class="val">${escapeHtml(bill.date)} ${escapeHtml(time12h)}</span></div>
                    <div><span class="lbl">Order:</span> <span class="val mono">${escapeHtml(bill.code)}</span></div>
                    <div><span class="lbl">Payment:</span> <span class="val">${bill.paymentType === 'ONLINE' ? 'Online Payment' : 'Cash on Delivery'}</span></div>
                    <div><span class="lbl">Delivery:</span> <span class="val">${escapeHtml(deliveryText)}</span></div>
                </div>
            </td>
            <td class="bill-customer">
                <div class="lbl">BILL TO</div>
                <div class="cust-name"><b>${escapeHtml(addr.customer)}</b>${addr.phone ? ` &middot; ${escapeHtml(addr.phone)}` : ''}</div>
                <div class="cust-addr">${escapeHtml(addr.address)}</div>
                ${bill.cuttingInstructions ? `<div class="cust-note"><b>Note:</b> ${escapeHtml(bill.cuttingInstructions)}</div>` : ''}
            </td>
        </tr>
    </table>

    <!-- ── Items table ── -->
    <table class="bill-items">
        <thead>
            <tr>
                <th class="num">#</th>
                <th>Item Description</th>
                <th class="num">HSN</th>
                <th class="num">Qty</th>
                <th class="num">MRP</th>
                <th class="num">Rate</th>
                <th class="num">Tax</th>
                <th class="num">GST</th>
                <th class="num">Amount</th>
            </tr>
        </thead>
        <tbody>${lineRows}</tbody>
    </table>

    <!-- ── Footer band: notes left, totals right ── -->
    <div class="bill-footer">
        <div class="bill-footer-left">
            ${couponCodesText ? `<div><span class="lbl">Coupon:</span> ${escapeHtml(couponCodesText)}</div>` : ''}
            ${bill.loyaltyPointsUsed && bill.loyaltyPointsUsed > 0 ? `<div><span class="lbl">Loyalty points used:</span> ${bill.loyaltyPointsUsed}</div>` : ''}
            <div><span class="lbl">Total items:</span> ${totalQty}</div>
            ${fig.totalSavings > 0 ? `<div class="savings"><b>You saved ${paiseToInr(fig.totalSavings)} on this order</b></div>` : ''}
        </div>
        <div class="bill-footer-right">
            <table class="bill-totals">
                <tr>
                    <td class="lbl">Subtotal (incl. GST)</td>
                    <td class="num">${paiseToInr(fig.subtotal)}</td>
                </tr>
                ${cgst > 0 ? `
                <tr class="incl">
                    <td class="lbl">Incl. CGST</td>
                    <td class="num">${paiseToInr(cgst)}</td>
                </tr>
                <tr class="incl">
                    <td class="lbl">Incl. SGST</td>
                    <td class="num">${paiseToInr(sgst)}</td>
                </tr>` : ''}
                <tr>
                    <td class="lbl">Shipping${fig.shippingSavings > 0 ? ` <span class="hint">(saved ${paiseToInr(fig.shippingSavings)})</span>` : ''}</td>
                    <td class="num">${fig.shipping > 0 ? paiseToInr(fig.shipping) : 'Free'}</td>
                </tr>
                ${fig.couponDiscount > 0 ? `
                <tr>
                    <td class="lbl">${escapeHtml(fig.couponLabel)}</td>
                    <td class="num">&minus;${paiseToInr(fig.couponDiscount)}</td>
                </tr>` : ''}
                ${fig.loyaltyDiscount > 0 ? `
                <tr>
                    <td class="lbl">Loyalty Points Discount</td>
                    <td class="num">&minus;${paiseToInr(fig.loyaltyDiscount)}</td>
                </tr>` : ''}
                <tr class="grand">
                    <td class="lbl"><b>NET TOTAL</b></td>
                    <td class="num"><b>${paiseToInr(bill.netTotal)}</b></td>
                </tr>
            </table>
        </div>
    </div>

    <p class="bill-finis">${(bill.loyaltyPointsAvailable ?? 0) > 0
        ? `Thank you for choosing Kaaikani! You have ${bill.loyaltyPointsAvailable} Reward Points in your account. Redeem them on your next purchase and enjoy extra savings.`
        : `Thank you for choosing Kaaikani!`}</p>
</section>
`;
}

function buildPrintDocument(bills: GroupedBill[], names: VariantNameMap | null): string {
    // Bills of a GST-invoice channel (South Mithai) print as tax invoices —
    // lib/gst-invoice-document.ts. A mixed batch puts those sheets first in
    // this same window; the paginator below only touches #src.
    const gstBills = bills.filter((b) => b.gstInvoiceChannelId);
    if (gstBills.length > 0 && gstBills.length === bills.length) {
        return buildGstInvoiceDocument(gstBills, window.location.origin);
    }
    const gstSheets = gstBills.map((b) => buildGstInvoiceHtml(b, window.location.origin)).join('\n');
    const body = bills
        .filter((b) => !b.gstInvoiceChannelId)
        .map((b, i) => buildBillHtml(b, i, names))
        .join('\n');
    const logoUrl = `${window.location.origin}/kaaikani_logo.png`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>KAAIKANI</title>
<style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
        font-family: Arial, "Segoe UI", "Noto Sans Tamil", "Latha", "Tamil MN", "Mangal", "Noto Sans Malayalam", "Manjari", "Meera", "Rachana", "Kartika", "Nirmala UI", sans-serif;
        font-size: 8.5pt;
        color: #000;
        background: #fff;
        line-height: 1.2;
    }
    .tamil { font-family: "Noto Sans Tamil", "Latha", "Tamil MN", "Mangal", Arial, sans-serif; }
    .malayalam { font-family: "Noto Sans Malayalam", "Manjari", "Meera", "Rachana", "Kartika", "Nirmala UI", Arial, sans-serif; }

    /* Orders flow CONTINUOUSLY (Crystal-Reports style): the paginator below
       packs each sheet full and splits a long order's item rows across sheets,
       repeating the column header — so almost no paper is wasted. No min-height
       (that triggers Chrome's exact-fit blank-page bug); the paginator keeps
       each .page under one sheet so it renders as exactly one physical page. */
    .page { width: 210mm; padding: 8mm 10mm; position: relative; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    /* Dashed separator before an order that shares a sheet with the one above. */
    .sep { margin-top: 5mm; padding-top: 5mm; border-top: 1.5pt dashed #999; }
    /* Small, unobtrusive page number in the bottom-right corner. */
    .page-num { position: absolute; right: 10mm; bottom: 4mm; font-size: 8pt; color: #000; }

    /* ── Top header band ── */
    .bill-hdr {
        display: flex; justify-content: center; align-items: center;
        padding-bottom: 4px; border-bottom: 1.5pt solid #000;
    }
    .bill-hdr-left { display: flex; flex-direction: column; gap: 3px; align-items: center; text-align: center; }
    .brand-row { line-height: 0; }
    .brand-logo { display: block; height: 34px; width: auto; }
    .bill-hdr-addr { font-size: 8.5pt; color: #000; line-height: 1.3; text-align: center; }
    .bill-hdr-right { text-align: right; }
    .bill-title { font-size: 13pt; font-weight: bold; letter-spacing: 1px; }
    .bill-subtitle { font-size: 8pt; color: #000; font-style: italic; }

    /* ── Order info block ── */
    .bill-info { width: 100%; border-collapse: collapse; margin-top: 3px; }
    .bill-info > tbody > tr > td { border: 1px solid #000; padding: 4px 8px; vertical-align: top; width: 50%; }
    .info-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 3px 12px; font-size: 8.5pt;
    }
    .info-grid .lbl, .bill-customer .lbl {
        color: #000; font-size: 8pt; font-weight: bold; text-transform: uppercase;
        letter-spacing: 0.4px;
    }
    .info-grid .val { color: #000; }
    .info-grid .mono { font-family: monospace; }
    .bill-customer .cust-name { font-size: 10pt; font-weight: bold; margin-top: 3px; }
    .bill-customer .cust-addr { font-size: 9pt; line-height: 1.45; margin-top: 2px; color: #000; }
    .bill-customer .cust-note { font-size: 8.5pt; margin-top: 4px; color: #000; }

    /* ── Items table ── */
    .bill-items { width: 100%; border-collapse: collapse; margin-top: 3px; }
    .bill-items th { background: #fff; border: 1px solid #000; padding: 4px 6px;
        font-size: 8.5pt; font-weight: bold; text-align: left; text-transform: uppercase;
        letter-spacing: 0.3px; }
    .bill-items td.td { border: 1px solid #000; padding: 3px 6px; font-size: 8.5pt; vertical-align: top; }
    .bill-items .num { text-align: right; }
    .bill-items th.num { text-align: right; }
    .bill-items .idx { width: 26px; text-align: center; }
    .bill-items .item { width: 36%; }
    .bill-items .item-en { font-weight: 600; line-height: 1.15; }
    .bill-items .free-tag { font-weight: 700; font-style: italic; }
    .bill-items .item-ta { font-size: 9.5pt; color: #000; font-weight: 700; line-height: 1.15; margin-top: 1px; }
    .bill-items .hsn { font-family: monospace; font-size: 8.5pt; text-align: center; }
    .bill-items .tax-split { text-align: center; font-size: 8pt; line-height: 1.25; white-space: nowrap; }
    .bill-items .line-saving {
        font-size: 8pt; color: #000; font-style: italic; margin-top: 2px;
        white-space: nowrap;
    }

    /* ── Footer band ── */
    .bill-footer {
        display: flex; justify-content: space-between; gap: 12px; margin-top: 3px;
    }
    .bill-footer-left { flex: 1; font-size: 8.5pt; padding: 3px 0; }
    .bill-footer-left .lbl { color: #000; font-weight: bold; }
    .bill-footer-left .savings {
        margin-top: 6px; padding: 5px 8px;
        background: #fff; border: 1px dashed #000; color: #000; font-weight: bold;
        font-size: 9pt;
    }
    .bill-footer-right { min-width: 270px; }

    .bill-totals { width: 100%; border-collapse: collapse; font-size: 9pt; }
    .bill-totals td { padding: 3px 8px; border-bottom: 1px solid #000; }
    .bill-totals .lbl { color: #000; }
    .bill-totals .num { text-align: right; white-space: nowrap; }
    .bill-totals .hint { color: #000; font-size: 8pt; font-style: italic; }
    /* GST sub-lines: tax already included in "Subtotal (incl. GST)", shown only
       as an informational breakdown — greyed + indented so it never reads as
       being added on top of the subtotal. */
    .bill-totals tr.incl td { color: #000; font-size: 8pt; font-style: italic;
        border-bottom: none; padding-top: 1px; padding-bottom: 1px; }
    .bill-totals tr.incl .lbl { padding-left: 16px; }
    .bill-totals tr.grand td {
        background: #fff; border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000;
        font-size: 11pt; font-weight: bold; padding: 7px 8px;
    }

    .bill-finis {
        margin-top: 5px; padding-top: 4px;
        border-top: 1px dashed #000;
        text-align: center; font-size: 8pt; color: #000; font-style: italic;
    }

    /* margin: 0 on @page suppresses Chrome's default URL/title/date headers + footers. */
    @page { size: A4; margin: 0; }
    /* Force pure black-and-white output: the report content is already colourless,
       and this strips any colour from the logo/images so the printer never pulls
       the colour cartridge — even if the print dialog is left on "Colour". */
    .brand-logo, img { filter: grayscale(100%); }
    /* NOTE: do NOT put a CSS filter on html/body here. A filter on a page
       container forces the browser to rasterize the whole page to a bitmap when
       printing -- the PDF then looks identical but its text is an image, so it
       cannot be searched or selected (in every browser). The report content is
       already black-and-white and the logo is greyscaled via the rule above, so
       only the color-adjust hints are needed. */
    @media print { html { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    ${gstSheets ? GST_INVOICE_CSS : ''}
</style>
</head>
<body data-logo="${logoUrl}">
${gstSheets}
<div id="src">${body}</div>
<script>
    (function(){
        // Inject the logo into every bill's brand-row (keeps buildBillHtml clean).
        var url = document.body.getAttribute('data-logo');
        if (url) {
            document.querySelectorAll('.brand-row').forEach(function(row){
                var img = document.createElement('img');
                img.className = 'brand-logo';
                img.src = url;
                img.alt = 'KAAIKANI';
                row.insertBefore(img, row.firstChild);
            });
        }

        // Continuous-flow paginator. Orders pack back-to-back onto each sheet;
        // a long order's item rows split across sheets with the column header
        // repeated. Because we build the sheets ourselves, the "X / Y" page
        // number is always exact and the top/bottom margins stay clean.
        function paginate(){
            var src = document.getElementById('src');
            if (!src) return;
            var bills = Array.prototype.slice.call(src.querySelectorAll('.bill'));
            if (!bills.length) return;

            // Measure exact pixels-per-mm at the current print scale.
            var probe = document.createElement('div');
            probe.style.cssText = 'width:100mm;height:100mm;position:absolute;left:-9999px;top:0;visibility:hidden;';
            document.body.appendChild(probe);
            var pxPerMm = probe.offsetHeight / 100;
            document.body.removeChild(probe);
            // A .page's scrollHeight includes its 8mm top+bottom padding (16mm).
            // Cap at 294mm (297 sheet − ~3mm slack) so content never overflows
            // onto a sliver page; one .page === one physical sheet.
            var MAX = pxPerMm * 294;

            var pages = [];
            function newPage(){
                var p = document.createElement('div');
                p.className = 'page';
                document.body.appendChild(p);
                pages.push(p);
                return p;
            }
            var cur = newPage();
            function fits(){ return cur.scrollHeight <= MAX; }
            // Append a block; if it overflows a sheet that already has content,
            // move it to a fresh sheet.
            function place(node){
                cur.appendChild(node);
                if (!fits() && cur.childNodes.length > 1) { cur = newPage(); cur.appendChild(node); }
            }

            bills.forEach(function(bill){
                var hdr = bill.querySelector('.bill-hdr');
                var info = bill.querySelector('.bill-info');
                var itemsTable = bill.querySelector('.bill-items');
                var footer = bill.querySelector('.bill-footer');
                var finis = bill.querySelector('.bill-finis');

                // Header + order info are kept together as one block.
                var grp = document.createElement('div');
                grp.className = 'grp';
                if (cur.childNodes.length > 0) grp.className += ' sep';
                if (hdr) grp.appendChild(hdr);
                if (info) grp.appendChild(info);
                place(grp);

                // Item rows — split across sheets, repeating the <thead>.
                if (itemsTable) {
                    var thead = itemsTable.querySelector('thead');
                    var rows = Array.prototype.slice.call(itemsTable.querySelectorAll('tbody > tr'));
                    function newTbl(){
                        var t = document.createElement('table');
                        t.className = 'bill-items';
                        if (thead) t.appendChild(thead.cloneNode(true));
                        t.appendChild(document.createElement('tbody'));
                        return t;
                    }
                    var tbl = newTbl();
                    cur.appendChild(tbl);
                    if (!fits() && cur.childNodes.length > 1) { cur = newPage(); cur.appendChild(tbl); }
                    var tb = tbl.querySelector('tbody');
                    rows.forEach(function(r){
                        tb.appendChild(r);
                        if (!fits()) {
                            tb.removeChild(r);
                            cur = newPage();
                            tbl = newTbl();
                            cur.appendChild(tbl);
                            tb = tbl.querySelector('tbody');
                            tb.appendChild(r);
                        }
                    });
                }

                // Totals + thank-you/reward line, kept together.
                var foot = document.createElement('div');
                if (footer) foot.appendChild(footer);
                if (finis) foot.appendChild(finis);
                place(foot);
            });

            src.remove();
            pages.forEach(function(p, i){
                var n = document.createElement('div');
                n.className = 'page-num';
                n.textContent = (i + 1) + ' / ' + pages.length;
                p.appendChild(n);
            });
        }

        window.addEventListener('load', function(){
            paginate();
            setTimeout(function(){ window.print(); }, 250);
        });
    })();
</script>
</body>
</html>`;
}

function openPrintWindow(html: string) {
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) {
        alert('Could not open print window. Please allow popups for this site.');
        return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
}

// ── Purchase List View ────────────────────────────────────────────────
//
// Rendered straight from `purchaseListReport`. The backend does the whole job
// from the catalogue — Tamil label (localName), section order (facet
// purchaseOrdNo), quantity maths (option measurement × ordered qty, in kg / l /
// Pcs) — so there is nothing to look up, sum or sort here.

/** Row key: product and variant ids come from different sequences, so the
 *  scope prefix keeps a variant row from colliding with a product row. */
function purchaseRowKey(r: PurchaseListRow): string {
    return `${r.scope}:${r.variantId ?? r.productId}:${r.unitKind}`;
}

/** Quantity as the sheet reads it: kilograms and litres to three decimals,
 *  counted packs as whole numbers. */
function formatPurchaseQty(r: PurchaseListRow): string {
    return r.unitKind === 'COUNT' ? String(Math.round(r.totalQty)) : r.totalQty.toFixed(3);
}

function PurchaseListView({ channelToken, onBack }: { channelToken: string | null; onBack: () => void }) {
    const { currentUser } = useAuth();
    const availableChannels = useMemo(() => {
        const list = currentUser?.channels ?? [];
        return list
            .filter((ch) => ch.code !== '__default_channel__')
            .map((ch) => ({ id: ch.id, code: ch.code }));
    }, [currentUser]);

    const [dateFrom, setDateFrom] = useState(() => defaultTodayTimeRange()[0]);
    const [dateTo, setDateTo] = useState(() => defaultTodayTimeRange()[1]);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    /**
     * Show ONLY orders still being added to, instead of the usual set.
     *
     * The two are deliberately exclusive. An AddingItems order is a basket nobody
     * has finished, so its quantities are still moving; folding them into the normal
     * list would inflate a purchase plan with vegetables that may never be ordered.
     * Off, they stay excluded exactly as before.
     */
    const [onlyAddingItems, setOnlyAddingItems] = useState(false);
    const [report, setReport] = useState<PurchaseListReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Concurrency guard + per-filter cache signature (see reportResultCache).
    const runningRef = useRef(false);
    // The flag is part of the signature: the two views return different rows for
    // the same channels and dates, and without it one would be served the other's
    // cached result.
    const cacheKey = `purchase:${channelToken ?? ''}:${dateFrom}:${dateTo}:${[...selectedChannelIds].sort().join(',')}:${onlyAddingItems ? 'adding' : 'default'}`;

    const loadReport = useCallback(async () => {
        if (!channelToken) return;
        if (runningRef.current) return;
        runningRef.current = true;
        setLoading(true);
        setError('');
        try {
            const from = istLocalToIso(dateFrom);
            const to = istLocalToIso(dateTo, true);
            const data = await fetchPurchaseListReport(
                {
                    from,
                    to,
                    channelIds: selectedChannelIds.length > 0 ? selectedChannelIds : undefined,
                    // Named explicitly, or left out entirely. Sending the list makes
                    // the server match those states; omitting it keeps its own
                    // default, which already excludes AddingItems along with
                    // Delivered and the cancelled ones — so an unticked box behaves
                    // exactly as it did before this existed.
                    states: onlyAddingItems ? ['AddingItems'] : undefined,
                },
                channelToken,
            );
            setReport(data);
            setCachedReport(cacheKey, data);
        } catch (err) {
            setReport(null);
            setError(err instanceof Error ? err.message : 'Failed to load purchase list');
        } finally {
            setLoading(false);
            runningRef.current = false;
        }
    }, [dateFrom, dateTo, channelToken, selectedChannelIds, onlyAddingItems, cacheKey]);

    // Do NOT auto-run — hydrate from cache on mount / filter change; a fresh
    // fetch happens only on the explicit "Load Report" click.
    useEffect(() => {
        setReport(getCachedReport<PurchaseListReport>(cacheKey) ?? null);
    }, [cacheKey]);

    // Already aggregated and sorted (OrdNo, then Tamil collation) by the backend;
    // the only reorder here puts each cut keerai (ஆய்ந்தது) row under its uncut one.
    const rows = useMemo(() => orderKeeraiCutBelowWhole(report?.rows ?? []), [report]);
    const incompleteCount = report?.incompleteCount ?? 0;

    function handlePrint() {
        if (rows.length === 0) return;
        openPrintWindow(buildPurchaseListDocument(rows));
    }

    return (
        <>
            <div
                className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3"
                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
            >
                <button
                    onClick={onBack}
                    className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline mr-1"
                >
                    ← Daily Sales
                </button>
                <h1 className="text-[1rem] font-semibold text-[var(--foreground)] mr-auto">Purchase List</h1>
                <div className="flex flex-wrap items-center gap-2">
                    {/*
                      Left of the channel picker, and it changes nothing until Apply is
                      pressed — the same as the channels and the dates beside it.
                    */}
                    <label
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.75rem] cursor-pointer select-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                        title="Show only orders still being added to. Unticked, they are left out as before."
                    >
                        <input
                            type="checkbox"
                            checked={onlyAddingItems}
                            onChange={(e) => setOnlyAddingItems(e.target.checked)}
                            className="cursor-pointer"
                        />
                        AddingItems
                    </label>
                    <ChannelMultiSelect
                        channels={availableChannels}
                        selectedIds={selectedChannelIds}
                        onChange={setSelectedChannelIds}
                    />
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <span className="text-[var(--text-muted)] text-[0.75rem]">to</span>
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <button
                        onClick={loadReport}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all"
                        style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', color: 'var(--tone-indigo)' }}
                    >
                        {loading ? 'Loading...' : 'Apply'}
                    </button>
                    <button
                        onClick={handlePrint}
                        disabled={rows.length === 0}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--tone-green)' }}
                    >
                        Print PDF
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
                {loading && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <Spinner />
                        <p className="text-[0.8125rem] text-[var(--text-muted)]">Loading… please wait</p>
                    </div>
                )}

                {!loading && error && (
                    <div className="px-3 py-2 rounded-lg mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                        <p className="text-[0.75rem] text-red-400">{error}</p>
                    </div>
                )}

                {!loading && report && rows.length === 0 && (
                    <p className="text-center text-[var(--text-muted)] text-[0.8125rem] py-10">
                        No products to purchase in this date range.
                    </p>
                )}

                {!loading && rows.length > 0 && (
                    <>
                        <p className="text-[0.75rem] text-[var(--text-muted)] mb-3">
                            <span className="text-[var(--foreground)] font-medium">{rows.length}</span> row{rows.length === 1 ? '' : 's'} aggregated from <span className="text-[var(--foreground)] font-medium">{report?.orderCount ?? 0}</span> order{(report?.orderCount ?? 0) === 1 ? '' : 's'}
                            {incompleteCount > 0 && (
                                <> &middot; <span className="text-amber-400 font-medium">{incompleteCount}</span> with an unmeasured variant (part of the number is an ordered count)</>
                            )}
                        </p>
                        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse min-w-[520px]">
                                    <thead>
                                        <tr style={{ background: 'rgb(var(--overlay-rgb)/0.02)', borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                            <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] w-[60px]">OrdNo</th>
                                            <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Item Name</th>
                                            <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Qty</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r) => (
                                            <tr
                                                key={purchaseRowKey(r)}
                                                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.04)' }}
                                            >
                                                <td className="px-3 py-2.5">
                                                    <span className="text-[0.75rem] text-[var(--text-muted)] tabular-nums">
                                                        {r.ordNo ?? '—'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    <span className="text-[0.875rem] text-[var(--foreground)]">
                                                        {r.label}
                                                    </span>
                                                    {r.variantCount > 1 && (
                                                        <span className="ml-2 text-[0.625rem] text-[var(--text-muted)]">
                                                            ({r.variantCount} variants)
                                                        </span>
                                                    )}
                                                    {r.incomplete && (
                                                        <span
                                                            className="ml-2 text-[0.625rem] text-amber-400"
                                                            title="A variant in this row has no measurement on its option, so part of this number is the ordered count, not a measured quantity. Set one under Catalog › Option Groups."
                                                        >
                                                            unmeasured
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                                    <span className="text-[0.875rem] font-semibold tabular-nums">{formatPurchaseQty(r)}</span>
                                                    <span className="ml-1 text-[0.75rem] text-[var(--text-muted)]">{r.unitLabel}</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </>
    );
}

// ── Purchase List print template ──────────────────────────────────────

/** Continuous-flow paginator (Crystal-Reports style), shared by the Purchase
 *  List and Packing (Whole/Cut Veg) PDFs. Packs each A4 sheet full: a one-time
 *  `.report-hdr` block is placed on page 1, then every `table.flow` has its rows
 *  flowed across sheets with the <thead> repeated. Because we build the sheets
 *  ourselves (each `.page` === one physical sheet, @page margin:0), the top/
 *  bottom margins stay clean and the "X / Y" page number is always exact. */
const FLOW_PAGINATOR_SCRIPT = `
<script>
(function(){
    function paginate(){
        var src = document.getElementById('src');
        if (!src) return;
        var probe = document.createElement('div');
        probe.style.cssText = 'width:100mm;height:100mm;position:absolute;left:-9999px;top:0;visibility:hidden;';
        document.body.appendChild(probe);
        var pxPerMm = probe.offsetHeight / 100;
        document.body.removeChild(probe);
        // A .page's scrollHeight includes its 8mm top+bottom padding (16mm).
        // Cap at 294mm (297 sheet − ~3mm slack) so content never spills onto a
        // sliver page; one .page === one physical sheet.
        var MAX = pxPerMm * 294;

        var pages = [];
        function newPage(){
            var p = document.createElement('div');
            p.className = 'page';
            document.body.appendChild(p);
            pages.push(p);
            return p;
        }
        var cur = newPage();
        function fits(){ return cur.scrollHeight <= MAX; }
        function place(node){
            cur.appendChild(node);
            if (!fits() && cur.childNodes.length > 1) { cur = newPage(); cur.appendChild(node); }
        }

        Array.prototype.slice.call(src.children).forEach(function(node){
            if (node.tagName === 'TABLE') {
                var thead = node.querySelector('thead');
                var rows = Array.prototype.slice.call(node.querySelectorAll('tbody > tr'));
                var cls = node.className;
                function newTbl(){
                    var t = document.createElement('table');
                    t.className = cls;
                    if (thead) t.appendChild(thead.cloneNode(true));
                    t.appendChild(document.createElement('tbody'));
                    return t;
                }
                var tbl = newTbl();
                cur.appendChild(tbl);
                if (!fits() && cur.childNodes.length > 1) { cur = newPage(); cur.appendChild(tbl); }
                var tb = tbl.querySelector('tbody');
                rows.forEach(function(r){
                    tb.appendChild(r);
                    if (!fits()) {
                        tb.removeChild(r);
                        cur = newPage();
                        tbl = newTbl();
                        cur.appendChild(tbl);
                        tb = tbl.querySelector('tbody');
                        tb.appendChild(r);
                    }
                });
            } else {
                place(node);
            }
        });

        src.remove();
        pages.forEach(function(p, i){
            var n = document.createElement('div');
            n.className = 'page-num';
            n.textContent = (i + 1) + ' / ' + pages.length;
            p.appendChild(n);
        });
    }
    window.addEventListener('load', function(){
        paginate();
        setTimeout(function(){ window.print(); }, 250);
    });
})();
</script>`;

function buildPurchaseListDocument(rows: PurchaseListRow[]): string {
    // Header date is TODAY (when the report is printed), independent of filter range.
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const headerDate = `${dd}-${mm}-${yyyy}`;

    const logoUrl = `${window.location.origin}/kaaikani_logo.png`;
    const hasIncomplete = rows.some((r) => r.incomplete);
    const rowsHtml = rows.map((r) => `
            <tr>
                <td class="td tamil">${escapeHtml(r.label)}</td>
                <td class="td num"><b>${formatPurchaseQty(r)}</b> ${escapeHtml(r.unitLabel)}${r.incomplete ? ' *' : ''}</td>
            </tr>`).join('');
    // Inside the table (not after it) so the flow paginator carries it along.
    const noteHtml = hasIncomplete ? `
            <tr>
                <td class="td note" colspan="2">* A variant in this row has no measurement on its option — part of the number is the ordered count, not a measured quantity.</td>
            </tr>` : '';

    return `<!DOCTYPE html>
<html lang="ta">
<head>
<meta charset="utf-8" />
<title>KAAIKANI</title>
<style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
        font-family: Arial, "Segoe UI", "Noto Sans Tamil", "Latha", "Tamil MN", "Mangal", "Noto Sans Malayalam", "Manjari", "Meera", "Rachana", "Kartika", "Nirmala UI", sans-serif;
        font-size: 9.5pt;
        color: #000;
        background: #fff;
    }
    .page { width: 210mm; padding: 8mm 10mm; position: relative; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .page-num { position: absolute; right: 10mm; bottom: 4mm; font-size: 8pt; color: #000; }
    .report-hdr { padding-bottom: 4px; border-bottom: 1.5pt solid #000; margin-bottom: 6px; }
    .brand-row { display: flex; align-items: center; justify-content: center; margin: 0; line-height: 0; }
    .brand-logo { display: block; height: 34px; width: auto; margin: 0; }
    .report-hdr .row { text-align: center; margin-top: 4px; font-size: 10pt; }
    table.purchase { width: 100%; border-collapse: collapse; }
    .purchase .th, .purchase .td { border: 1px solid #000; padding: 5px 6px; }
    .purchase .th { background: #fff; font-weight: bold; text-align: left; font-size: 10pt; }
    .purchase .item { width: 70%; }
    .purchase .qty { width: 30%; text-align: center; }
    .purchase .num { text-align: center; font-size: 9.5pt; white-space: nowrap; }
    .purchase .note { font-size: 8pt; text-align: left; }
    .tamil { font-family: "Noto Sans Tamil", "Latha", "Tamil MN", "Mangal", "Noto Sans Malayalam", "Manjari", "Meera", "Rachana", "Kartika", "Nirmala UI", Arial, sans-serif; font-size: 10pt; }
    /* margin: 0 on @page suppresses Chrome's default URL/title/date headers + footers. */
    @page { size: A4; margin: 0; }
    /* Force pure black-and-white output: the report content is already colourless,
       and this strips any colour from the logo/images so the printer never pulls
       the colour cartridge — even if the print dialog is left on "Colour". */
    .brand-logo, img { filter: grayscale(100%); }
    /* NOTE: do NOT put a CSS filter on html/body here. A filter on a page
       container forces the browser to rasterize the whole page to a bitmap when
       printing -- the PDF then looks identical but its text is an image, so it
       cannot be searched or selected (in every browser). The report content is
       already black-and-white and the logo is greyscaled via the rule above, so
       only the color-adjust hints are needed. */
    @media print { html { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div id="src">
    <header class="report-hdr">
        <div class="brand-row">
            <img class="brand-logo" src="${logoUrl}" alt="KAAIKANI" />
        </div>
        <div class="row"><b>Purchase Product List on ${headerDate}</b></div>
    </header>
    <table class="purchase flow">
        <thead>
            <tr>
                <th class="th item">Item Name</th>
                <th class="th qty">Qty</th>
            </tr>
        </thead>
        <tbody>${rowsHtml}${noteHtml}</tbody>
    </table>
</div>
${FLOW_PAGINATOR_SCRIPT}
</body>
</html>`;
}
// ── Packing Reports (Whole Veg + Cut Veg) ─────────────────────────────

/**
 * Which list a product packs on is decided by its facet values in Vendure
 * (Catalog › Facets), which replaced the spreadsheet's Category column.
 *
 *   Cut Veg    products tagged with any "cut vegetables" facet value — every
 *              spelling of it across the channel facets ("Cut Vegetables",
 *              "cut Vegetables", Idukki's "cut  vegtables") and "cut vegetable
 *              combo" — plus the prepared items packed with them: "juice" and
 *              "fruit salad".
 *   Whole Veg  everything else: Fruits, Vegetables, Exotic Vegetables, Dairy
 *              Products, keerai/Greenleaves, Healthy choices, Eggs,
 *              Ready-to-Eat, Millets, Flowers, promotions and the seasonal
 *              specials — and products with no facets at all, so a data gap
 *              shows up on a list rather than vanishing.
 *
 * Matched by name, case-insensitively: anything that starts with "cut veg",
 * "juice" or "fruit salad" (singular or plural). Re-tag the product in Vendure
 * to move it between lists.
 */
const CUT_VEG_FACET = /^(cut\s+veg|juices?\b|fruit\s+salads?\b)/i;

function isCutListProduct(entry: VariantNames | null): boolean {
    if (!entry) return false;
    return entry.facetValues.some((fv) => CUT_VEG_FACET.test(fv.name.trim()));
}

type PackingMode = 'whole-veg' | 'cut-veg';

interface PackingConfig {
    screenTitle: string;
    pdfTitle: string;
    emptyMessage: string;
    /** Predicate: does this product belong in this report?
     *  `null` means the SKU was not found in the catalogue. */
    includeProduct: (entry: VariantNames | null) => boolean;
}

const PACKING_CONFIG: Record<PackingMode, PackingConfig> = {
    'whole-veg': {
        screenTitle: 'Whole Vegetable List',
        pdfTitle: 'Packing Vegitables Product List Report',
        emptyMessage: 'No items to pack in this date range.',
        // Unmatched → keep visible so admin can spot data gaps.
        includeProduct: (entry) => !isCutListProduct(entry),
    },
    'cut-veg': {
        screenTitle: 'Cut Vegetable List',
        pdfTitle: 'Packing Cut Vegetables Product List Report',
        emptyMessage: 'No cut vegetables to pack in this date range.',
        // Only explicitly-tagged prepared items; unmatched are excluded.
        includeProduct: (entry) => isCutListProduct(entry),
    },
};

interface WholeVegItem {
    sku: string | null;
    itemName: string;     // English variant name (raw from billPrintReport)
    localName: string;    // ProductVariant.localName from the catalogue ('' when unset)
    qty: number;          // Sum of customer-order quantities for this variant
    /** Per-SNo quantity: invoice SNo → qty ordered by that single bill.
     *  Lets packers distinguish "SNo 5 needs 1" from "SNo 7 needs 3". */
    snoQty: Map<number, number>;
    /** Lowest FacetValue.purchaseOrdNo on the product — primary sort key
     *  (Vegetables → Fruits → ...). Untagged → Number.MAX_SAFE_INTEGER so it
     *  falls to the bottom. */
    ordNo: number;
}

/** Render an SNo→qty map by repeating each SNo `qty` times.
 *  Example: { 2: 1, 5: 3, 7: 1 } → "2, 5, 5, 5, 7"
 *  Packing team counts occurrences — no symbols or notation to learn. */
function formatSnoQty(snoQty: Map<number, number>): string {
    const expanded: number[] = [];
    Array.from(snoQty.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([sno, qty]) => {
            for (let i = 0; i < qty; i++) expanded.push(sno);
        });
    return expanded.join(', ');
}

interface WholeVegSection {
    deliveryTimeRaw: string;
    slot: DeliverySlot;
    items: WholeVegItem[];
    totalQty: number;
}

function PackingReportView({
    mode,
    channelToken,
    onBack,
}: {
    mode: PackingMode;
    channelToken: string | null;
    onBack: () => void;
}) {
    const config = PACKING_CONFIG[mode];
    const { currentUser } = useAuth();
    const availableChannels = useMemo(() => {
        const list = currentUser?.channels ?? [];
        return list
            .filter((ch) => ch.code !== '__default_channel__')
            .map((ch) => ({ id: ch.id, code: ch.code }));
    }, [currentUser]);

    const activeChannelCode = useMemo(() => {
        const ch = (currentUser?.channels ?? []).find((c) => c.token === channelToken);
        return ch?.code ?? null;
    }, [currentUser, channelToken]);

    const [dateFrom, setDateFrom] = useState(() => defaultTodayTimeRange()[0]);
    const [dateTo, setDateTo] = useState(() => defaultTodayTimeRange()[1]);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    const [loaded, setLoaded] = useState<LoadedBills | null>(null);
    const bills = loaded?.bills ?? null;
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Concurrency guard + per-filter cache signature (see reportResultCache).
    const runningRef = useRef(false);
    const cacheKey = `packing:${mode}:${channelToken ?? ''}:${dateFrom}:${dateTo}:${[...selectedChannelIds].sort().join(',')}`;

    // Tamil name, section order and the cut/whole split all come from the
    // catalogue entry behind each SKU.
    const catalogueToken = useCatalogueToken(channelToken);

    const loadReport = useCallback(async () => {
        if (!channelToken) return;
        if (runningRef.current) return;
        runningRef.current = true;
        setLoading(true);
        setError('');
        try {
            const from = istLocalToIso(dateFrom);
            const to = istLocalToIso(dateTo, true);
            const data = await fetchBillPrintReport(
                {
                    from,
                    to,
                    channelIds: selectedChannelIds.length > 0 ? selectedChannelIds : undefined,
                    skip: 0,
                    take: 1000,
                },
                channelToken,
            );
            const grouped = groupBills(data.items);
            const next = await loadBillsWithNames(grouped, catalogueToken);
            setLoaded(next);
            setCachedReport(cacheKey, next);
        } catch (err) {
            setLoaded(null);
            setError(err instanceof Error ? err.message : 'Failed to load whole-veg list');
        } finally {
            setLoading(false);
            runningRef.current = false;
        }
    }, [dateFrom, dateTo, channelToken, selectedChannelIds, cacheKey, catalogueToken]);

    // Do NOT auto-run — hydrate from cache on mount / filter change; a fresh
    // fetch happens only on the explicit "Load Report" click.
    useEffect(() => {
        setLoaded(getCachedReport<LoadedBills>(cacheKey) ?? null);
    }, [cacheKey]);

    /** Build sections — same SNo numbering as Invoice Report (slot-priority,
     *  backend time order within each slot). Array.sort is stable, so dropping
     *  the secondary key preserves backend insertion order inside a slot. */
    const sections: WholeVegSection[] = useMemo(() => {
        if (!bills || bills.length === 0) return [];
        const sorted = [...bills].sort((a, b) => {
            const ka = SLOT_ORDER.indexOf(deliverySlot(a.deliveryTime));
            const kb = SLOT_ORDER.indexOf(deliverySlot(b.deliveryTime));
            return ka - kb;
        });
        const codeToSno = new Map<string, number>();
        sorted.forEach((b, i) => codeToSno.set(b.code, i + 1));

        const byDelivery = new Map<string, GroupedBill[]>();
        for (const bill of sorted) {
            const key = (bill.deliveryTime ?? '').trim() || '— No delivery time —';
            if (!byDelivery.has(key)) byDelivery.set(key, []);
            byDelivery.get(key)!.push(bill);
        }

        const result: WholeVegSection[] = [];
        for (const [deliveryTimeRaw, billsInSection] of byDelivery.entries()) {
            const itemMap = new Map<string, WholeVegItem>();

            for (const bill of billsInSection) {
                const sno = codeToSno.get(bill.code) ?? 0;
                for (const line of bill.lines) {
                    const entry = variantNamesFor(line, loaded?.names ?? null);
                    if (!config.includeProduct(entry)) continue;
                    const sku = line.pCode ? String(line.pCode).trim() : null;
                    const key = sku ?? line.itemName;

                    const existing = itemMap.get(key);
                    if (existing) {
                        existing.qty += line.qty;
                        existing.snoQty.set(sno, (existing.snoQty.get(sno) ?? 0) + line.qty);
                    } else {
                        const snoQty = new Map<number, number>();
                        snoQty.set(sno, line.qty);
                        itemMap.set(key, {
                            sku,
                            // English name comes from Vendure's order line (what the
                            // customer actually ordered, including any variant info);
                            // the Tamil one is the variant's localName in the catalogue.
                            itemName: line.itemName,
                            localName: entry?.localName ?? '',
                            qty: line.qty,
                            snoQty,
                            ordNo: entry?.purchaseOrdNo ?? Number.MAX_SAFE_INTEGER,
                        });
                    }
                }
            }

            const items = Array.from(itemMap.values());
            // Sort: 1) OrdNo asc (Vegetables → Fruits → ...) 2) ItemName asc.
            items.sort((a, b) => {
                if (a.ordNo !== b.ordNo) return a.ordNo - b.ordNo;
                return a.itemName.localeCompare(b.itemName);
            });

            const totalQty = items.reduce((s, x) => s + x.qty, 0);
            const slot = deliverySlot(deliveryTimeRaw);
            if (items.length > 0) {
                result.push({ deliveryTimeRaw, slot, items, totalQty });
            }
        }

        result.sort((a, b) => {
            const ka = SLOT_ORDER.indexOf(a.slot);
            const kb = SLOT_ORDER.indexOf(b.slot);
            if (ka !== kb) return ka - kb;
            return a.deliveryTimeRaw.localeCompare(b.deliveryTimeRaw);
        });
        return result;
    }, [bills, loaded, config]);

    const totalAcrossSections = sections.reduce((s, sec) => s + sec.totalQty, 0);

    const channelDisplay = useMemo(() => {
        if (selectedChannelIds.length === 0) return activeChannelCode ?? '';
        return selectedChannelIds
            .map((id) => availableChannels.find((c) => c.id === id)?.code ?? id)
            .join(', ');
    }, [selectedChannelIds, availableChannels, activeChannelCode]);

    function handlePrint() {
        if (sections.length === 0) return;
        openPrintWindow(buildPackingDocument(sections, totalAcrossSections, channelDisplay, config.screenTitle));
    }

    return (
        <>
            <div
                className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3"
                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
            >
                <button
                    onClick={onBack}
                    className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline mr-1"
                >
                    ← Daily Sales
                </button>
                <h1 className="text-[1rem] font-semibold text-[var(--foreground)] mr-auto">{config.screenTitle}</h1>
                <div className="flex flex-wrap items-center gap-2">
                    <ChannelMultiSelect
                        channels={availableChannels}
                        selectedIds={selectedChannelIds}
                        onChange={setSelectedChannelIds}
                    />
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <span className="text-[var(--text-muted)] text-[0.75rem]">to</span>
                    <input
                        type="datetime-local"
                        step="1"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[0.75rem] outline-none"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                    />
                    <button
                        onClick={loadReport}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all"
                        style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', color: 'var(--tone-indigo)' }}
                    >
                        {loading ? 'Loading...' : 'Apply'}
                    </button>
                    <button
                        onClick={handlePrint}
                        disabled={sections.length === 0}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--tone-green)' }}
                    >
                        Print PDF
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
                {loading && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <Spinner />
                        <p className="text-[0.8125rem] text-[var(--text-muted)]">Loading… please wait</p>
                    </div>
                )}

                {!loading && error && (
                    <div className="px-3 py-2 rounded-lg mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                        <p className="text-[0.75rem] text-red-400">{error}</p>
                    </div>
                )}

                {!loading && loaded?.namesError && (
                    <NamesWarning error={loaded.namesError} />
                )}

                {!loading && bills && sections.length === 0 && (
                    <p className="text-center text-[var(--text-muted)] text-[0.8125rem] py-10">
                        {config.emptyMessage}
                    </p>
                )}

                {!loading && sections.length > 0 && (
                    <>
                        <p className="text-[0.75rem] text-[var(--text-muted)] mb-3">
                            <span className="text-[var(--foreground)] font-medium">{sections.length}</span> delivery slot{sections.length === 1 ? '' : 's'} &middot; <span className="text-[var(--foreground)] font-medium">{totalAcrossSections}</span> items total
                            {channelDisplay && <> &middot; <span className="text-[var(--foreground)] font-medium">{channelDisplay}</span></>}
                        </p>
                        {sections.map((section) => (
                            <div key={section.deliveryTimeRaw} className="mb-6">
                                <h3 className="text-[0.8125rem] font-semibold mb-2 flex items-center gap-2">
                                    <span style={{ color: 'var(--foreground)' }}>{section.deliveryTimeRaw}</span>
                                    <span className="text-[var(--text-muted)] font-normal text-[0.75rem]">({section.items.length} items)</span>
                                </h3>
                                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                    <div className="overflow-x-auto">
                                        <table className="w-full border-collapse min-w-[720px]">
                                            <thead>
                                                <tr style={{ background: 'rgb(var(--overlay-rgb)/0.02)', borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                                    <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">ItemName</th>
                                                    <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">TamilName</th>
                                                    <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] w-[70px]">Qty</th>
                                                    <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">SNo</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {section.items.map((it, i) => (
                                                    <tr
                                                        key={(it.sku ?? it.itemName) + i}
                                                        style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.04)' }}
                                                    >
                                                        <td className="px-3 py-2.5">
                                                            <span className="text-[0.8125rem] text-[var(--foreground)]">{it.itemName}</span>
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            <span className="text-[0.875rem] text-[var(--foreground)]">{it.localName || '—'}</span>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right">
                                                            <span className="text-[0.875rem] font-semibold tabular-nums">{it.qty}</span>
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            <span className="text-[0.75rem] text-[var(--text-muted)] tabular-nums">{formatSnoQty(it.snoQty)}</span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </>
    );
}

// ── Packing print template (Whole Veg + Cut Veg) ─────────────────────

function buildPackingDocument(
    sections: WholeVegSection[],
    grandTotalQty: number,
    cityName: string,
    title: string,
): string {
    const logoUrl = `${window.location.origin}/kaaikani_logo.png`;
    // Title-case the channel/city so "madurai" prints as "Madurai".
    const cityTitle = (cityName || 'All Channels').replace(/\b\w/g, (c) => c.toUpperCase());
    // TODAY, when the sheet is printed — same as the Purchase List header.
    const headerDate = browserPrintDate();

    // One continuous table: each slot contributes a divider row (its delivery
    // time) followed by its item rows; the grand total closes the list. The
    // paginator flows these across sheets, repeating the column <thead>.
    const bodyRows = sections.map((section) => `
            <tr class="slot-row"><td class="slot" colspan="4">${escapeHtml(section.deliveryTimeRaw)}</td></tr>
            ${section.items.map((it) => `
            <tr>
                <td class="td">${escapeHtml(it.itemName)}</td>
                <td class="td tamil">${escapeHtml(it.localName || '—')}</td>
                <td class="td num"><b>${it.qty}</b></td>
                <td class="td snos">${escapeHtml(formatSnoQty(it.snoQty))}</td>
            </tr>`).join('')}`).join('') + `
            <tr class="grand-total-row">
                <td class="td" colspan="2"><b>Grand Total Quantity</b></td>
                <td class="td num"><b>${grandTotalQty}</b></td>
                <td class="td"></td>
            </tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>KAAIKANI</title>
<style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
        font-family: Arial, "Segoe UI", "Noto Sans Tamil", "Latha", "Tamil MN", "Mangal", "Noto Sans Malayalam", "Manjari", "Meera", "Rachana", "Kartika", "Nirmala UI", sans-serif;
        font-size: 9pt;
        color: #000;
        background: #fff;
    }
    .page { width: 210mm; padding: 8mm 10mm; position: relative; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .page-num { position: absolute; right: 10mm; bottom: 4mm; font-size: 8pt; color: #000; }
    .report-hdr { padding-bottom: 4px; border-bottom: 1.5pt solid #000; margin-bottom: 6px; }
    .brand-row { display: flex; align-items: center; justify-content: center; margin: 0; line-height: 0; }
    .brand-logo { display: block; height: 34px; width: auto; margin: 0; }
    /* City name (channel) shown as the report title so each printout is
       identifiable at a glance — e.g. "Madurai". */
    .rpt-title { text-align: center; margin-top: 5px; font-size: 13pt; font-weight: bold; }
    .rpt-date { text-align: center; margin-top: 4px; font-size: 10pt; }
    table.veg { width: 100%; border-collapse: collapse; }
    .veg .th, .veg .td { border: 1px solid #000; padding: 5px 6px; vertical-align: middle; }
    .veg .th { background: #fff; font-weight: bold; text-align: center; font-size: 9.5pt; }
    .veg .item { width: 30%; text-align: center; }
    .veg .tname { width: 45%; text-align: center; }
    .veg .qty { width: 10%; text-align: center; }
    .veg .sno { width: 15%; text-align: center; }
    .veg .num { text-align: center; }
    .veg .snos { text-align: center; }
    .veg .slot {
        background: #fff;
        border: 1px solid #000;
        font-weight: bold;
        font-size: 9.5pt;
        text-align: center;
        padding: 4px 6px;
    }
    .tamil { font-family: "Noto Sans Tamil", "Latha", "Tamil MN", "Mangal", "Noto Sans Malayalam", "Manjari", "Meera", "Rachana", "Kartika", "Nirmala UI", Arial, sans-serif; font-size: 9.5pt; }
    .grand-total-row .td { background: #fff; font-weight: bold; font-size: 9.5pt; padding: 5px 8px; }
    /* margin: 0 on @page suppresses Chrome's default URL/title/date headers + footers. */
    @page { size: A4; margin: 0; }
    /* Force pure black-and-white output: the report content is already colourless,
       and this strips any colour from the logo/images so the printer never pulls
       the colour cartridge — even if the print dialog is left on "Colour". */
    .brand-logo, img { filter: grayscale(100%); }
    /* NOTE: do NOT put a CSS filter on html/body here. A filter on a page
       container forces the browser to rasterize the whole page to a bitmap when
       printing -- the PDF then looks identical but its text is an image, so it
       cannot be searched or selected (in every browser). The report content is
       already black-and-white and the logo is greyscaled via the rule above, so
       only the color-adjust hints are needed. */
    @media print { html { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div id="src">
    <header class="report-hdr">
        <div class="brand-row">
            <img class="brand-logo" src="${logoUrl}" alt="KAAIKANI" />
        </div>
        <div class="rpt-date"><b>${escapeHtml(title)} on ${escapeHtml(headerDate)}</b></div>
        <div class="rpt-title">${escapeHtml(cityTitle)}</div>
    </header>
    <table class="veg flow">
        <thead>
            <tr>
                <th class="th item">ItemName</th>
                <th class="th tname">TamilName</th>
                <th class="th qty">Qty</th>
                <th class="th sno">SNo</th>
            </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
    </table>
</div>
${FLOW_PAGINATOR_SCRIPT}
</body>
</html>`;
}

// ── Delivery Partner Bill Report ───────────────────────────────────────

function DPBillReportView({ channelToken, onBack }: { channelToken: string | null; onBack: () => void }) {
    const { currentUser } = useAuth();
    const availableChannels = useMemo(() => {
        const list = currentUser?.channels ?? [];
        return list
            .filter((ch) => ch.code !== '__default_channel__')
            .map((ch) => ({ id: ch.id, code: ch.code }));
    }, [currentUser]);

    const [dateFrom, setDateFrom] = useState(() => defaultTodayTimeRange()[0]);
    const [dateTo, setDateTo] = useState(() => defaultTodayTimeRange()[1]);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    const [bills, setBills] = useState<GroupedBill[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Concurrency guard + per-filter cache signature (see reportResultCache).
    const runningRef = useRef(false);
    const cacheKey = `dpbill:${channelToken ?? ''}:${dateFrom}:${dateTo}:${[...selectedChannelIds].sort().join(',')}`;

    const loadReport = useCallback(async () => {
        if (!channelToken) return;
        if (runningRef.current) return;
        runningRef.current = true;
        setLoading(true);
        setError('');
        try {
            const from = istLocalToIso(dateFrom);
            const to = istLocalToIso(dateTo, true);
            const data = await fetchBillPrintReport(
                {
                    from,
                    to,
                    channelIds: selectedChannelIds.length > 0 ? selectedChannelIds : undefined,
                    skip: 0,
                    take: 1000,
                },
                channelToken,
            );
            const grouped = groupBills(data.items);
            setBills(grouped);
            setCachedReport(cacheKey, grouped);
        } catch (err) {
            setBills(null);
            setError(err instanceof Error ? err.message : 'Failed to load DP bill report');
        } finally {
            setLoading(false);
            runningRef.current = false;
        }
    }, [dateFrom, dateTo, channelToken, selectedChannelIds, cacheKey]);

    // Do NOT auto-run — hydrate from cache on mount / filter change; a fresh
    // fetch happens only on the explicit "Load Report" click.
    useEffect(() => {
        setBills(getCachedReport<GroupedBill[]>(cacheKey) ?? null);
    }, [cacheKey]);

    // Same slot grouping as the Invoice Report so BillNos line up across the two
    // reports. Order: DAT-morning → Tomorrow-morning → DAT-evening → Tomorrow-evening → Other.
    // Insertion order within each slot is preserved (backend time order).
    const groups = useMemo(() => {
        if (!bills) return [];
        const map = new Map<DeliverySlot, GroupedBill[]>();
        for (const b of bills) {
            const s = deliverySlot(b.deliveryTime);
            if (!map.has(s)) map.set(s, []);
            map.get(s)!.push(b);
        }
        return SLOT_ORDER
            .map((slot) => ({ slot, label: SLOT_LABEL[slot], items: map.get(slot) ?? [] }))
            .filter((g) => g.items.length > 0);
    }, [bills]);

    const channelLabel = useMemo(() => {
        if (selectedChannelIds.length === 1) {
            const ch = availableChannels.find((c) => c.id === selectedChannelIds[0]);
            return ch ? ch.code.replace(/__/g, '').replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) : 'All Channels';
        }
        return 'All Channels';
    }, [selectedChannelIds, availableChannels]);

    const reportDateLabel = useMemo(() => {
        if (!dateFrom) return '';
        const [datePart] = dateFrom.split('T');
        const [y, m, d] = datePart.split('-');
        return `${d}-${m}-${y}`;
    }, [dateFrom]);

    function handlePrint() {
        if (!bills) return;
        const html = buildDPBillDocument(groups, channelLabel, reportDateLabel);
        openPrintWindow(html);
    }

    return (
        <>
            <div className="px-4 sm:px-6 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                <button
                    onClick={onBack}
                    className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline mr-1"
                >
                    ← Daily Sales
                </button>
                <h1 className="text-[1rem] font-semibold text-[var(--foreground)]">Delivery Partner Bill Report</h1>
            </div>

            <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
                <div className="flex flex-wrap gap-3 mb-4 items-end">
                    <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-[var(--text-muted)]">From</label>
                        <input
                            type="datetime-local"
                            step="1"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="text-[0.8125rem] bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-3 py-1.5 text-[var(--foreground)]"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-[var(--text-muted)]">To</label>
                        <input
                            type="datetime-local"
                            step="1"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="text-[0.8125rem] bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-3 py-1.5 text-[var(--foreground)]"
                        />
                    </div>
                    {availableChannels.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <label className="text-[0.7rem] text-[var(--text-muted)]">Channel</label>
                            <ChannelMultiSelect
                                channels={availableChannels}
                                selectedIds={selectedChannelIds}
                                onChange={setSelectedChannelIds}
                            />
                        </div>
                    )}
                    <button
                        onClick={loadReport}
                        disabled={loading}
                        className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[0.8125rem] font-medium disabled:opacity-50 cursor-pointer"
                    >
                        {loading ? 'Loading…' : 'Refresh'}
                    </button>
                    {bills && bills.length > 0 && (
                        <button
                            onClick={handlePrint}
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-[0.8125rem] font-medium cursor-pointer hover:bg-emerald-500"
                        >
                            Print PDF
                        </button>
                    )}
                </div>

                {loading && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <Spinner />
                        <p className="text-[0.8125rem] text-[var(--text-muted)]">Loading… please wait</p>
                    </div>
                )}

                {!loading && error && <p className="text-red-400 text-[0.8125rem] mb-3">{error}</p>}

                {!loading && bills && (
                    <div className="text-[0.75rem] text-[var(--text-muted)] mb-3">
                        {bills.length} order{bills.length !== 1 ? 's' : ''} across {groups.length} delivery slot{groups.length === 1 ? '' : 's'}
                    </div>
                )}

                {!loading && bills && bills.length > 0 && (() => {
                    let runningSno = 0;
                    return groups.map((g) => {
                        const startSno = runningSno;
                        runningSno += g.items.length;
                        return (
                            <div key={g.slot} className="mb-6">
                                <h3 className="text-[0.8125rem] font-semibold mb-2 flex items-center gap-2">
                                    <span style={{ color: 'var(--foreground)' }}>{g.label}</span>
                                    <span className="text-[var(--text-muted)] font-normal text-[0.75rem]">({g.items.length})</span>
                                </h3>
                                <div className="overflow-x-auto rounded-xl border border-[var(--card-border)]">
                                    <table className="w-full text-[0.8rem] border-collapse">
                                        <thead>
                                            <tr className="bg-[var(--card-bg)] text-[var(--text-muted)]">
                                                <th className="px-3 py-2 text-left font-medium border-b border-[var(--card-border)]">BillNo</th>
                                                <th className="px-3 py-2 text-left font-medium border-b border-[var(--card-border)]">Order Code</th>
                                                <th className="px-3 py-2 text-right font-medium border-b border-[var(--card-border)]">Amount</th>
                                                <th className="px-3 py-2 text-left font-medium border-b border-[var(--card-border)]">Payment Status</th>
                                                <th className="px-3 py-2 text-left font-medium border-b border-[var(--card-border)]">Cash Mode</th>
                                                <th className="px-3 py-2 text-left font-medium border-b border-[var(--card-border)]">Note</th>
                                                <th className="px-3 py-2 text-left font-medium border-b border-[var(--card-border)]">Order Modify Note</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {g.items.map((bill, idx) => (
                                                <tr key={bill.code} className="border-b border-[var(--card-border)] hover:bg-overlay/3">
                                                    <td className="px-3 py-2 text-[var(--text-muted)]">{startSno + idx + 1}</td>
                                                    <td className="px-3 py-2 font-mono text-[0.75rem]">{bill.code}</td>
                                                    <td className="px-3 py-2 text-right">₹{(bill.netTotal / 100).toFixed(2)}</td>
                                                    <td className="px-3 py-2">
                                                        <span className={`px-2 py-0.5 rounded-full text-[0.7rem] font-medium ${
                                                            bill.paymentType === 'ONLINE'
                                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                                : 'bg-amber-500/20 text-amber-400'
                                                        }`}>
                                                            {bill.paymentType === 'ONLINE' ? (bill.adminMarkedAsPaid ? 'Bill Paid' : 'Online') : 'COD'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2"></td>
                                                    <td className="px-3 py-2 text-[0.75rem] max-w-[200px] break-words">{bill.note ?? ''}</td>
                                                    <td className="px-3 py-2 text-[0.75rem] max-w-[200px] break-words">{bill.orderModifyNote ?? ''}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    });
                })()}

                {!loading && bills && bills.length === 0 && (
                    <p className="text-[var(--text-muted)] text-[0.8125rem]">No orders found for the selected range.</p>
                )}
            </div>
        </>
    );
}

// ── DP Bill print template ─────────────────────────────────────────────

function buildDPBillDocument(
    groups: { slot: DeliverySlot; label: string; items: GroupedBill[] }[],
    channelLabel: string,
    reportDateLabel: string,
): string {
    const ROWS_PER_PAGE = 28;
    const logoUrl = `${window.location.origin}/kaaikani_logo.png`;

    function esc(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function paymentLabel(bill: GroupedBill): string {
        if (bill.paymentType === 'ONLINE') return bill.adminMarkedAsPaid ? 'Bill Paid' : 'Online';
        return 'COD';
    }

    // Build a flat list of row entries that includes a slot-header row before
    // each group. BillNo runs continuously (1..N) across all slots so the DP
    // SNos match the Invoice Report.
    type RowEntry =
        | { kind: 'slot-header'; label: string; count: number }
        | { kind: 'bill'; sno: number; bill: GroupedBill };

    const entries: RowEntry[] = [];
    let snoCounter = 0;
    for (const g of groups) {
        entries.push({ kind: 'slot-header', label: g.label, count: g.items.length });
        for (const bill of g.items) {
            snoCounter += 1;
            entries.push({ kind: 'bill', sno: snoCounter, bill });
        }
    }

    function renderEntry(e: RowEntry): string {
        if (e.kind === 'slot-header') {
            return `
        <tr class="slot-row">
            <td class="slot-cell" colspan="7">${esc(e.label)} (${e.count})</td>
        </tr>`;
        }
        const bill = e.bill;
        return `
        <tr>
            <td class="col-no">${e.sno}</td>
            <td class="col-code">${esc(bill.code)}</td>
            <td class="col-amt">&#8377;${(bill.netTotal / 100).toFixed(2)}</td>
            <td class="col-pay">${esc(paymentLabel(bill))}</td>
            <td class="col-cash"></td>
            <td class="col-note">${esc(bill.note ?? '')}</td>
            <td class="col-note">${esc(bill.orderModifyNote ?? '')}</td>
        </tr>`;
    }

    const totalPages = Math.ceil(entries.length / ROWS_PER_PAGE) || 1;

    const pages: string[] = [];
    for (let p = 0; p < totalPages; p++) {
        const slice = entries.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
        const rows = slice.map(renderEntry).join('');

        pages.push(`
<div class="page">
    <div class="header-section">
        <div class="brand-row">
            <img class="brand-logo" src="${logoUrl}" alt="KAAIKANI" />
            <div class="brand-title">${esc(channelLabel)}</div>
        </div>
        <div class="report-meta">
            <span>Delivery Partner Bill Report on ${esc(reportDateLabel)}</span>
            <span>Page No: ${p + 1} / ${totalPages}</span>
        </div>
    </div>
    <table>
        <thead>
            <tr>
                <th class="col-no">BillNo</th>
                <th class="col-code">Order Code</th>
                <th class="col-amt">Amount</th>
                <th class="col-pay">Payment Status</th>
                <th class="col-cash">Cash Mode</th>
                <th class="col-note">Note</th>
                <th class="col-note">Order Modify Note</th>
            </tr>
        </thead>
        <tbody>
            ${rows}
        </tbody>
    </table>
</div>`);
    }

    const pagesHtml = pages.join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>KAAIKANI</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 9.5pt; color: #000; background: #fff; }
    .page { width: 210mm; padding: 8mm 10mm; min-height: 297mm; page-break-after: always; overflow: hidden; }
    .page:last-child { page-break-after: auto; }

    .header-section { margin-bottom: 3mm; }
    .brand-row { display: flex; align-items: center; gap: 10px; margin-bottom: 1.5mm; }
    .brand-logo { height: 34px; width: auto; display: block; }
    .brand-title { font-size: 12pt; font-weight: bold; color: #000; }
    .report-meta { display: flex; justify-content: space-between; align-items: center; font-size: 9pt; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 1.5mm 0; margin-bottom: 2mm; }

    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }
    th, td { border: 1px solid #000; padding: 4px 5px; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; white-space: normal; }
    th { background: #fff; font-weight: bold; text-align: left; }
    tr.slot-row td.slot-cell { background: #fff; font-weight: bold; font-size: 9.5pt; padding: 5px 6px; border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000; }

    /* Fixed column widths — total must fit within ~186mm (210mm - 24mm padding) */
    .col-no   { width: 28px; text-align: center; }
    .col-code { width: 80px; }
    .col-amt  { width: 56px; text-align: right; }
    .col-pay  { width: 60px; }
    .col-cash { width: 50px; }
    .col-note { width: auto; }

    @page { size: A4; margin: 0; }
    /* Force pure black-and-white output (see note in the other reports). */
    .brand-logo, img { filter: grayscale(100%); }
    /* NOTE: no CSS filter on html/body -- a filter on a page container forces
       the browser to rasterize the whole page to a bitmap on print, so the PDF
       text becomes an unsearchable image. Logo is greyscaled above. */
    @media print { html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page { padding: 8mm 10mm; } }
</style>
</head>
<body>
${pagesHtml}
<script>
    window.addEventListener('load', () => { setTimeout(() => window.print(), 200); });
</script>
</body>
</html>`;
}
