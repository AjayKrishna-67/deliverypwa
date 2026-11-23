'use client';

/**
 * Orders page — displays delivery orders filtered by the selected channel.
 * The channel token (from sidebar selection) is passed as the vendure-token header
 * on every API call, scoping data exactly as Vendure Admin UI does.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { Spinner } from '@/components/ui/Spinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SearchIcon, CloseIcon, GridIcon } from '@/components/icons';
import { ColumnPanel, FilterPanel, OrderRow, OrderCard } from '@/components/orders';
import { type ActiveFilter, buildFilterParam } from '@/components/orders/FilterPanel';
import {
    PAGE_SIZE_OPTIONS,
    ALL_COLUMNS,
    type ColKey,
    DEFAULT_ORDER,
    DEFAULT_VISIBLE,
    DELIVERED_VISIBILITY_MS,
} from '@/lib/constants';
import {
    fetchDeliveryOrders,
    fetchShippingMethods,
    fetchOrderPostalCodes,
    fetchOrderAreas,
    fetchDeliveryPersons,
    fetchMyDeliveryOrders,
    type DeliveryOrder,
    type ShippingMethodItem,
    type DeliveryPerson,
    type PostalCodeAreaItem,
} from '@/services/orders.service';
import { orderLatLng } from '@/lib/maps';

// ─── Export ───────────────────────────────────────────────────────────

export default function OrdersPage() {
    const { isLoading: authLoading, isAuthenticated } = useRequireAuth();

    if (authLoading) return <LoadingScreen />;
    if (!isAuthenticated) return null;

    return (
        <DashboardLayout>
            {({ channelToken, channelPermissions }) => (
                <OrdersContent channelToken={channelToken} permissions={channelPermissions} />
            )}
        </DashboardLayout>
    );
}

// ─── Orders Content ───────────────────────────────────────────────────

interface OrdersContentProps {
    channelToken: string | null;
    permissions: string[];
}

function OrdersContent({ channelToken, permissions }: OrdersContentProps) {
    // ── Role detection ────────────────────────────────────────────────
    // Detect DP by CAPABILITY, not permission count. A delivery person carries the
    // delivery transition permissions but NOT the admin-only CustomFulfillment
    // permission (which gates createDeliveryFulfillment and the channel-wide
    // `deliveryOrders` query). The old `permissions.length <= 3` heuristic
    // misclassified any DP role that also had Read permissions (Order, Product, …)
    // as an admin — so the page loaded the all-orders admin path instead of the
    // DP's own assigned fulfillments (myDeliveryFulfillments). Detecting by
    // capability is deterministic regardless of how many Read perms the role has.
    // Prevents admin-only queries from firing for DPs.
    // `detectedAsDP` stays as a runtime fallback.
    const hasPermissions = permissions.length > 0;
    const [detectedAsDP, setDetectedAsDP] = useState<boolean | null>(null);
    const hasAdminFulfillment = permissions.includes('CustomFulfillment');
    const hasDeliveryTransition =
        permissions.includes('TransitionToOutForDelivery') || permissions.includes('TransitionToDelivered');
    const isDeliveryPerson =
        hasPermissions && !hasAdminFulfillment && (hasDeliveryTransition || detectedAsDP === true);
    const isAdmin = hasPermissions && !isDeliveryPerson;

    const [orders, setOrders] = useState<DeliveryOrder[]>([]);
    const [totalItems, setTotalItems] = useState(0);
    const [shippingMethods, setShippingMethods] = useState<ShippingMethodItem[]>([]);
    const [deliveryPersons, setDeliveryPersons] = useState<DeliveryPerson[]>([]);
    const [isLoadingOrders, setIsLoadingOrders] = useState(true);
    const [error, setError] = useState('');

    // Filters
    const [selectedShippingMethod, setSelectedShippingMethod] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState<number>(10);

    const [postalCodes, setPostalCodes] = useState<string[]>([]);
    const [area, setArea] = useState('');
    const [areas, setAreas] = useState<PostalCodeAreaItem[]>([]);

    // Column customisation
    const [colOrder, setColOrder] = useState<ColKey[]>(DEFAULT_ORDER);
    const [colVisible, setColVisible] = useState<Set<ColKey>>(new Set(DEFAULT_VISIBLE));
    const [colPanelOpen, setColPanelOpen] = useState(false);
    const colBtnRef = useRef<HTMLDivElement>(null);
    // Ref so loadOrders can read the latest detectedAsDP without it being a dep,
    // preventing a double-load when the role flips null→false (admin confirmed).
    const detectedAsDPRef = useRef<boolean | null>(null);
    detectedAsDPRef.current = detectedAsDP;

    const visibleCols = colOrder.filter((k) => colVisible.has(k));

    function handleToggleCol(key: ColKey) {
        setColVisible((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                if (next.size === 1) return prev;
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }

    function handleResetCols() {
        setColOrder(DEFAULT_ORDER);
        setColVisible(new Set(DEFAULT_VISIBLE));
    }

    const shippingMethodChangedByUser = useRef(false);

    // Debounce search input
    useEffect(() => {
        const t = setTimeout(() => {
            setSearch(searchInput);
            setPage(0);
        }, 350);
        return () => clearTimeout(t);
    }, [searchInput]);

    function clearAllFilters() {
        setSearch('');
        setSearchInput('');
        setSelectedShippingMethod('');
        setPostalCode('');
        setActiveFilters([]);
        setPage(0);
    }

    // Reset role detection when the channel changes — re-detect on next load
    useEffect(() => {
        setDetectedAsDP(null);
    }, [channelToken]);

    // ── Effect 1: channel changed — reset filters ─────────────────────
    // Always reset filter state when the channel changes, regardless of role.
    useEffect(() => {
        if (channelToken === null) return;
        shippingMethodChangedByUser.current = false;
        setSelectedShippingMethod('');
        setPostalCode('');
        setSearch('');
        setSearchInput('');
        setActiveFilters((prev) => (prev.length === 0 ? prev : []));
        setPage(0);
    }, [channelToken]);

    // ── Effect 1b: load admin metadata only once role is confirmed ────
    // Only fires when detectedAsDP===false (confirmed admin) to avoid
    // firing expensive queries (especially fetchOrderPostalCodes take:500)
    // for delivery persons before their role is determined.
    useEffect(() => {
        if (channelToken === null) return;
        if (!hasPermissions) return;

        if (isDeliveryPerson) {
            setShippingMethods([]);
            setPostalCodes([]);
            setDeliveryPersons([]);
        } else {
            // Each dropdown populates as soon as its own data arrives — a slow
            // postal-codes call no longer holds back shipping methods or DPs.
            fetchShippingMethods(channelToken)
                .then(setShippingMethods)
                .catch(() => setShippingMethods([]));
            fetchOrderPostalCodes(undefined, channelToken)
                .then(setPostalCodes)
                .catch(() => setPostalCodes([]));
            fetchDeliveryPersons(channelToken)
                .then(setDeliveryPersons)
                .catch(() => setDeliveryPersons([]));
            fetchOrderAreas(channelToken)
                .then(setAreas)
                .catch(() => setAreas([]));
        }
        // detectedAsDP===null: role still unknown, wait for loadOrders to determine it
    }, [channelToken, isDeliveryPerson, isAdmin, hasPermissions]);

    // ── Effect 2: shipping method changed BY USER ────────────────────
    useEffect(() => {
        if (!shippingMethodChangedByUser.current) return;
        shippingMethodChangedByUser.current = false;
        setPostalCode('');
        setArea('');
        setPage(0);
        fetchOrderPostalCodes(selectedShippingMethod || undefined, channelToken ?? undefined)
            .then(setPostalCodes)
            .catch(() => { /* non-critical */ });
    }, [selectedShippingMethod, channelToken]);

    // ── Orders fetch ─────────────────────────────────────────────────
    const loadDPOrders = useCallback(async (token: string) => {
        // Server owns sort + delivered-window + paging + count. We only supply the
        // window edge (now − 5min) and the current page. The delivered-cutoff, client
        // sort, and slice that used to live here are gone — the server never returns a
        // long-delivered order, so page 2+ can't surprise the rider with stale history.
        const deliveredSince = new Date(Date.now() - DELIVERED_VISIBILITY_MS).toISOString();
        return fetchMyDeliveryOrders(token, {
            skip: page * pageSize,
            take: pageSize,
            deliveredSince,
            search: search || undefined,
        });
    }, [search, page, pageSize]);

    const loadOrders = useCallback(async (opts?: { silent?: boolean }) => {
        if (channelToken === null) return;
        if (!hasPermissions) return;
        if (!opts?.silent) setIsLoadingOrders(true);
        setError('');
        try {
            let result;

            if (isDeliveryPerson || detectedAsDPRef.current === true) {
                // Route by permission (capability-based isDeliveryPerson) — no need
                // to fire an admin query that we know will be FORBIDDEN for a DP.
                result = await loadDPOrders(channelToken);
            } else {
                // Unknown/admin: try admin query first. On ACCESS_DENIED mark as DP
                // and fall back. Using a ref (not state) avoids a spurious re-run.
                try {
                    const filter = activeFilters.length > 0 ? buildFilterParam(activeFilters) : undefined;
                    result = await fetchDeliveryOrders({
                        shippingMethodId: selectedShippingMethod || undefined,
                        postalCode: postalCode || undefined,
                        area: area || undefined,
                        search: search || undefined,
                        skip: page * pageSize,
                        take: pageSize,
                        filter,
                        channelToken,
                    });
                    if (detectedAsDPRef.current === null) setDetectedAsDP(false);
                } catch {
                    setDetectedAsDP(true);
                    result = await loadDPOrders(channelToken);
                }
            }

            setOrders(result.items);
            setTotalItems(result.totalItems);

            if (process.env.NODE_ENV === 'development') {
                // Stage-0 verification: how many orders actually carry shipping
                // coordinates. If this stays 0/N, the storefront isn't writing
                // lat/lng at checkout and the delivery-map feature will silently
                // fall back to the no-map flow for every order.
                const withGeo = result.items.filter((o) => orderLatLng(o.shippingAddress)).length;
                console.info(
                    `[geo] ${withGeo}/${result.items.length} orders on this page have shipping coordinates`,
                );
            }
        } catch (err) {
            if (!opts?.silent) setError(err instanceof Error ? err.message : 'Failed to load orders');
        } finally {
            setIsLoadingOrders(false);
        }
    }, [selectedShippingMethod, postalCode, area, search, activeFilters, page, pageSize, channelToken, hasPermissions, isDeliveryPerson, loadDPOrders]);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    useEffect(() => {
        setPage(0);
    }, [pageSize]);

    const totalPages = Math.ceil(totalItems / pageSize);
    const startItem = page * pageSize + 1;
    const endItem = Math.min((page + 1) * pageSize, totalItems);

    // Stable ref to loadOrders so the callback below never changes identity
    const loadOrdersRef = useRef(loadOrders);
    loadOrdersRef.current = loadOrders;
    const refetchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    const handleOrderUpdated = useCallback((orderId: string, newState: string) => {
        setOrders((prev) =>
            prev.map((o) => o.id === orderId
                ? { ...o, state: newState, updatedAt: new Date().toISOString() }
                : o,
            ),
        );
        // Debounced background sync — resets on each call so rapid actions don't stack
        if (refetchTimer.current) clearTimeout(refetchTimer.current);
        refetchTimer.current = setTimeout(() => loadOrdersRef.current({ silent: true }), 8000);
    }, []);

    return (
        <div className="flex flex-col min-h-full">
            {/* ─── Filter Bar ──────────────────────────────────────── */}
            <div className="flex flex-col gap-0 sticky top-0 z-10 border-b border-[var(--card-border)] bg-[var(--card-bg)] backdrop-blur-xl">

                {/* Row 1: Search + Dropdowns + Columns */}
                <div className="flex items-center gap-2 md:gap-3 px-3 md:px-6 py-3 flex-wrap">

                    {/* Search input */}
                    <div className="flex-1 min-w-[200px] relative">
                        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search by name or order code…"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.8125rem] outline-none transition-all duration-200 placeholder:text-[var(--text-muted)]"
                            style={{ '--tw-ring-shadow': 'none' } as React.CSSProperties}
                            onFocus={(e) => { e.target.style.borderColor = 'rgba(99,102,241,0.5)'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'; }}
                            onBlur={(e) => { e.target.style.borderColor = ''; e.target.style.boxShadow = ''; }}
                        />
                        {searchInput && (
                            <button
                                onClick={() => setSearchInput('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-overlay/10 transition-all cursor-pointer"
                            >
                                <CloseIcon width={10} height={10} />
                            </button>
                        )}
                    </div>

                    {/* Shipping method — admin only */}
                    {isAdmin && (
                        <div className="flex items-center gap-2">
                            <span className="text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">
                                Shipping
                            </span>
                            <select
                                className="px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.8125rem] outline-none cursor-pointer transition-all duration-200 min-w-[160px] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--input-focus)]"
                                value={selectedShippingMethod}
                                onChange={(e) => {
                                    shippingMethodChangedByUser.current = true;
                                    setSelectedShippingMethod(e.target.value);
                                }}
                            >
                                <option value="">All Methods</option>
                                {shippingMethods.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Postal code — admin only */}
                    {isAdmin && (
                        <div className="flex items-center gap-2">
                            <span className="text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">
                                Postal Code
                            </span>
                            <select
                                className="px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.8125rem] outline-none cursor-pointer transition-all duration-200 min-w-[130px] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--input-focus)]"
                                value={postalCode}
                                onChange={(e) => setPostalCode(e.target.value)}
                            >
                                <option value="">All Postal Codes</option>
                                {postalCodes.map((code) => (
                                    <option key={code} value={code}>{code}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Area — admin only */}
                    {isAdmin && areas.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">
                                Area
                            </span>
                            <select
                                className="px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.8125rem] outline-none cursor-pointer transition-all duration-200 min-w-[130px] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--input-focus)]"
                                value={area}
                                onChange={(e) => { setArea(e.target.value); setPage(0); }}
                            >
                                <option value="">All Areas</option>
                                {(postalCode
                                    ? areas.filter(a => a.postalCode?.code === postalCode)
                                    : areas
                                ).map((a) => (
                                    <option key={a.id} value={a.name}>
                                        {a.name}{a.postalCode ? ` (${a.postalCode.code})` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Columns button */}
                    <div ref={colBtnRef} className="relative">
                        <button
                            onClick={() => setColPanelOpen((v) => !v)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[0.75rem] font-medium cursor-pointer transition-all duration-150"
                            style={{
                                background: colPanelOpen ? 'rgba(99,102,241,0.15)' : 'rgb(var(--overlay-rgb)/0.06)',
                                border: colPanelOpen ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgb(var(--overlay-rgb)/0.1)',
                                color: colPanelOpen ? 'var(--accent)' : 'var(--text-muted)',
                            }}
                        >
                            <GridIcon />
                        </button>

                        {colPanelOpen && (
                            <ColumnPanel
                                colOrder={colOrder}
                                colVisible={colVisible}
                                onToggle={handleToggleCol}
                                onReorder={setColOrder}
                                onReset={handleResetCols}
                                onClose={() => setColPanelOpen(false)}
                            />
                        )}
                    </div>
                </div>

                {/* Row 2: Filters */}
                <div className="flex items-center gap-2 px-3 md:px-6 pb-3 flex-wrap">
                    <FilterPanel
                        filters={activeFilters}
                        onChange={(f) => { setActiveFilters(f); setPage(0); }}
                    />
                    {(search || postalCode || selectedShippingMethod || activeFilters.length > 0) && (
                        <button
                            onClick={clearAllFilters}
                            className="ml-auto text-[0.6875rem] text-[var(--text-muted)] hover:text-red-400 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                        >
                            Clear all
                        </button>
                    )}
                </div>
            </div>

            {/* ─── Content ─────────────────────────────────────────── */}
            {error ? (
                <div className="flex-1 flex items-center justify-center p-16 text-center text-[var(--text-muted)]">
                    <div>
                        <h3 className="text-lg font-semibold mb-1 text-[var(--error)]">Error</h3>
                        <p className="text-[0.8125rem]">{error}</p>
                    </div>
                </div>
            ) : isLoadingOrders ? (
                <div className="flex-1 flex items-center justify-center p-16">
                    <Spinner size="lg" />
                </div>
            ) : orders.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-16 text-center text-[var(--text-muted)]">
                    <div>
                        <h3 className="text-lg font-semibold mb-1 text-[var(--foreground)]">No orders found</h3>
                        <p className="text-[0.8125rem]">Try adjusting the filters above.</p>
                    </div>
                </div>
            ) : (
                <>
                    {/* ── Mobile card view (hidden on md+) ──────────── */}
                    <div className="md:hidden flex-1 flex flex-col gap-2 px-3 py-3">
                        {orders.map((order) => (
                            <OrderCard
                                key={order.id}
                                order={order}
                                channelToken={channelToken}
                                deliveryPersons={deliveryPersons}
                                isDeliveryPerson={isDeliveryPerson}
                                onOrderUpdated={handleOrderUpdated}
                            />
                        ))}
                    </div>

                    {/* ── Desktop table (hidden on <md) ─────────────── */}
                    <div className="hidden md:block flex-1 overflow-x-auto px-2">
                        <table className="w-full border-collapse min-w-[700px]">
                            <thead>
                                <tr>
                                    {visibleCols.map((key) => (
                                        <th
                                            key={key}
                                            className="px-4 py-3 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--card-border)] whitespace-nowrap sticky top-0 bg-[var(--background)] z-[1]"
                                        >
                                            {ALL_COLUMNS.find((c) => c.key === key)?.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {orders.map((order) => (
                                    <OrderRow
                                        key={order.id}
                                        order={order}
                                        visibleCols={visibleCols}
                                        channelToken={channelToken}
                                        deliveryPersons={deliveryPersons}
                                        isDeliveryPerson={isDeliveryPerson}
                                        onOrderUpdated={handleOrderUpdated}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* ─── Pagination ───────────────────────────────── */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 px-6 py-4 border-t border-[var(--card-border)]">
                            <button
                                className="px-3.5 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.8125rem] font-medium cursor-pointer transition-all duration-200 hover:border-[var(--accent)] hover:bg-indigo-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                                disabled={page === 0}
                                onClick={() => setPage((p) => p - 1)}
                            >
                                ← Prev
                            </button>
                            <span className="text-xs text-[var(--text-muted)] px-2">
                                {startItem}–{endItem} of {totalItems}
                            </span>
                            <button
                                className="px-3.5 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.8125rem] font-medium cursor-pointer transition-all duration-200 hover:border-[var(--accent)] hover:bg-indigo-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                                disabled={page >= totalPages - 1}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                Next →
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* ─── Bottom bar: total orders + rows per page ─────────── */}
            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-t border-[var(--card-border)] bg-[var(--card-bg)] backdrop-blur-xl flex-wrap">
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {isLoadingOrders ? '…' : `${totalItems} order${totalItems !== 1 ? 's' : ''}`}
                </span>
                <div className="flex items-center gap-2 ml-auto">
                    <span className="text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">
                        Rows
                    </span>
                    <select
                        className="px-2.5 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.8125rem] outline-none cursor-pointer transition-all duration-200 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--input-focus)]"
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                    >
                        {PAGE_SIZE_OPTIONS.map((n) => (
                            <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
}
