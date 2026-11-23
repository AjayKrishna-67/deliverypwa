'use client';

import { useState, useEffect } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { CloseIcon, SpinnerIcon } from '@/components/icons';
import {
    fetchOrderFulfillmentDetail,
    createFulfillmentWithDeliveryPerson,
    type DeliveryOrder,
    type DeliveryPerson,
    type OrderFulfillmentLine,
} from '@/services/orders.service';

interface FulfillModalProps {
    order: DeliveryOrder;
    deliveryPersons: DeliveryPerson[];
    channelToken: string | null;
    onFulfilled: (orderId: string, newState: string) => void;
    onClose: () => void;
}

export function FulfillModal({ order, deliveryPersons, channelToken, onFulfilled, onClose }: FulfillModalProps) {
    const [loadingLines, setLoadingLines] = useState(true);
    const [lines, setLines] = useState<OrderFulfillmentLine[]>([]);
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [selectedPersonId, setSelectedPersonId] = useState('');
    const [fulfilling, setFulfilling] = useState(false);
    const [fulfillError, setFulfillError] = useState('');

    // Fetch order lines on-demand when modal opens.
    //
    // `line.quantity` from the API is the TOTAL ordered count. To get the
    // unfulfilled remainder, subtract every fulfillmentLine attached to a
    // non-cancelled fulfillment. Without this, the modal would let the admin
    // try to fulfill items that are already fulfilled (e.g. by the auto-ship
    // subscriber) and Vendure would reject with ITEMS_ALREADY_FULFILLED_ERROR.
    useEffect(() => {
        let cancelled = false;
        fetchOrderFulfillmentDetail(order.id, channelToken ?? undefined)
            .then((detail) => {
                if (cancelled) return;
                const fetchedLines = detail.lines
                    .map((l) => {
                        const alreadyFulfilled = (l.fulfillmentLines ?? [])
                            .filter((fl) => fl.fulfillment.state !== 'Cancelled')
                            .reduce((sum, fl) => sum + fl.quantity, 0);
                        const remaining = Math.max(0, l.quantity - alreadyFulfilled);
                        return { ...l, quantity: remaining };
                    })
                    .filter((l) => l.quantity > 0);
                setLines(fetchedLines);
                setQuantities(Object.fromEntries(fetchedLines.map((l) => [l.id, l.quantity])));
            })
            .catch((err) => {
                if (cancelled) return;
                setFulfillError(err instanceof Error ? err.message : 'Failed to load order lines');
            })
            .finally(() => { if (!cancelled) setLoadingLines(false); });
        return () => { cancelled = true; };
    }, [order.id, channelToken]);

    const fulfillableLines = lines;
    const allLinesFulfilled = fulfillableLines.length === 0 && !loadingLines;

    function setQty(lineId: string, delta: number) {
        setQuantities((prev) => {
            const line = fulfillableLines.find((l) => l.id === lineId);
            if (!line) return prev;
            const max = line.quantity;
            const next = Math.max(0, Math.min(prev[lineId] + delta, max));
            return { ...prev, [lineId]: next };
        });
    }

    function setQtyDirect(lineId: string, val: number) {
        const line = fulfillableLines.find((l) => l.id === lineId);
        if (!line) return;
        const max = line.quantity;
        setQuantities((prev) => ({ ...prev, [lineId]: Math.max(0, Math.min(val, max)) }));
    }

    async function handleCreate() {
        if (!selectedPersonId) return;
        const orderLines = Object.entries(quantities)
            .filter(([, qty]) => qty > 0)
            .map(([id, quantity]) => ({ id, quantity }));
        if (orderLines.length === 0) return;
        setFulfilling(true);
        setFulfillError('');
        try {
            await createFulfillmentWithDeliveryPerson(orderLines, selectedPersonId, channelToken ?? undefined);
            onFulfilled(order.id, 'Shipped');
            onClose();
        } catch (err) {
            setFulfillError(err instanceof Error ? err.message : 'Fulfillment failed');
        } finally {
            setFulfilling(false);
        }
    }

    const addr = order.shippingAddress;
    const customerName = addr?.fullName
        || (order.customer ? `${order.customer.firstName} ${order.customer.lastName}` : '');

    const canCreate = !allLinesFulfilled && selectedPersonId && Object.values(quantities).some((q) => q > 0);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="w-full flex flex-col overflow-hidden rounded-2xl"
                style={{
                    background: 'var(--surface-sheet)',
                    border: '1px solid rgb(var(--overlay-rgb)/0.08)',
                    boxShadow: 'var(--shadow-modal)',
                    maxHeight: '92vh',
                    maxWidth: '860px',
                }}
            >
                {/* ── Header ─────────────────────────────────────────── */}
                <div
                    className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4"
                    style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
                >
                    <h2 className="text-[1rem] font-semibold text-[var(--foreground)]">Fulfill order</h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all hover:bg-overlay/[0.06]"
                        style={{ color: 'var(--text-muted)' }}
                    >
                        <CloseIcon />
                    </button>
                </div>

                {/* ── Body ────────────────────────────────────────────── */}
                <div className="flex flex-col md:flex-row flex-1 overflow-hidden" style={{ minHeight: 0 }}>

                    {/* ── LEFT: Product table ────────────────────────── */}
                    <div
                        className="flex-1 flex flex-col overflow-hidden border-b md:border-b-0 md:border-r"
                        style={{ borderColor: 'rgb(var(--overlay-rgb)/0.06)' }}
                    >
                        <div className="overflow-auto flex-1">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}>
                                        <th className="px-2 sm:px-3 py-3 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">Product</th>
                                        <th className="hidden sm:table-cell px-3 py-3 text-center text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">SKU</th>
                                        <th className="px-2 sm:px-3 py-3 text-center text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Qty</th>
                                        <th className="hidden sm:table-cell px-3 py-3 text-center text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Stock</th>
                                        <th className="px-2 sm:px-3 py-3 text-center text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Fulfill</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loadingLines && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center">
                                                <Spinner />
                                                <p className="text-[0.75rem] text-[var(--text-muted)] mt-2">Loading order lines…</p>
                                            </td>
                                        </tr>
                                    )}
                                    {!loadingLines && allLinesFulfilled && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center">
                                                <p className="text-[0.875rem] text-amber-400 font-medium">All items in this order are already fulfilled.</p>
                                                <p className="text-[0.75rem] text-[var(--text-muted)] mt-1">No additional fulfillment can be created.</p>
                                            </td>
                                        </tr>
                                    )}
                                    {fulfillableLines.map((line) => {
                                        const max = line.quantity;
                                        const qty = quantities[line.id] ?? max;
                                        const productName = line.productVariant?.name ?? 'Unknown product';
                                        const sku = line.productVariant?.sku ?? '—';
                                        const stock = line.productVariant?.stockOnHand;
                                        return (
                                            <tr
                                                key={line.id}
                                                className="transition-colors hover:bg-overlay/[0.02]"
                                                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.04)' }}
                                            >
                                                {/* Product name + thumbnail */}
                                                <td className="px-2 sm:px-3 py-3">
                                                    <div className="flex items-center gap-2">
                                                        {line.featuredAsset?.preview && (
                                                            // Vendure already serves a sized preset — next/image would only
                                                            // re-encode a 32px thumb and need remotePatterns per backend host.
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                src={line.featuredAsset.preview + '?preset=tiny'}
                                                                alt=""
                                                                className="w-7 h-7 sm:w-8 sm:h-8 rounded object-cover shrink-0"
                                                                style={{ border: '1px solid rgb(var(--overlay-rgb)/0.08)' }}
                                                            />
                                                        )}
                                                        <span className="text-[0.75rem] sm:text-[0.8125rem] font-medium text-[var(--foreground)] line-clamp-2">
                                                            {productName}
                                                        </span>
                                                    </div>
                                                </td>
                                                {/* SKU — hidden on mobile */}
                                                <td className="hidden sm:table-cell px-3 py-3 text-center">
                                                    <span className="text-[0.75rem] font-mono text-[var(--text-muted)]">{sku}</span>
                                                </td>
                                                {/* Unfulfilled qty */}
                                                <td className="px-2 sm:px-3 py-3 text-center">
                                                    <span className="text-[0.8125rem] sm:text-[0.875rem] tabular-nums text-[var(--foreground)]">
                                                        {max}
                                                    </span>
                                                </td>
                                                {/* Stock on hand — hidden on mobile */}
                                                <td className="hidden sm:table-cell px-3 py-3 text-center">
                                                    <span className={`text-[0.75rem] tabular-nums ${stock !== undefined && stock < max ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
                                                        {stock ?? '—'}
                                                    </span>
                                                </td>
                                                {/* Fulfill quantity stepper */}
                                                <td className="px-2 sm:px-3 py-3 text-center">
                                                    <div
                                                        className="inline-flex items-center rounded-lg overflow-hidden"
                                                        style={{
                                                            border: '1px solid rgb(var(--overlay-rgb)/0.15)',
                                                            background: 'rgb(var(--overlay-rgb)/0.04)',
                                                        }}
                                                    >
                                                        <button
                                                            onClick={() => setQty(line.id, -1)}
                                                            className="px-2 py-1.5 text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-overlay/[0.06] transition-all cursor-pointer text-[0.875rem]"
                                                        >
                                                            ‹
                                                        </button>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={max}
                                                            value={qty}
                                                            onChange={(e) => setQtyDirect(line.id, Number(e.target.value))}
                                                            className="w-9 text-center text-[0.875rem] font-semibold bg-transparent text-[var(--foreground)] outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                        />
                                                        <button
                                                            onClick={() => setQty(line.id, +1)}
                                                            className="px-2 py-1.5 text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-overlay/[0.06] transition-all cursor-pointer text-[0.875rem]"
                                                        >
                                                            ›
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ── BOTTOM/RIGHT: Customer address + Delivery method ──── */}
                    <div
                        className="w-full md:w-60 md:min-w-[200px] flex flex-col gap-3 sm:gap-4 px-3 sm:px-5 py-3 sm:py-4 overflow-y-auto"
                        style={{ borderTop: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
                    >
                        {/* Customer address */}
                        <div>
                            <p className="text-[0.8125rem] font-semibold text-[var(--foreground)] leading-snug">{customerName}</p>
                            {addr?.streetLine1 && (
                                <p className="text-[0.75rem] text-[var(--text-muted)] leading-snug mt-0.5">{addr.streetLine1}</p>
                            )}
                            {addr?.city && (
                                <p className="text-[0.75rem] text-[var(--text-muted)] leading-snug">{addr.city}</p>
                            )}
                            {addr?.postalCode && (
                                <p className="text-[0.75rem] text-[var(--text-muted)] leading-snug">{addr.postalCode}</p>
                            )}
                            {addr?.countryCode && (
                                <p className="text-[0.75rem] text-[var(--text-muted)] leading-snug">
                                    🌐 {addr.countryCode}
                                </p>
                            )}
                            {addr?.phoneNumber && (
                                <p className="text-[0.75rem] text-[var(--text-muted)] leading-snug">
                                    📞 {addr.phoneNumber}
                                </p>
                            )}
                        </div>

                        {/* Shipping method label */}
                        <div>
                            <p className="text-[0.8125rem] font-semibold text-[var(--foreground)] mb-2">Shipping method</p>
                            {order.shippingLines?.[0]?.shippingMethod?.name && (
                                <p className="text-[0.75rem] text-[var(--text-muted)]">
                                    {order.shippingLines[0].shippingMethod.name}
                                </p>
                            )}
                        </div>

                        {/* Delivery method (driver) */}
                        <div>
                            <label className="block text-[0.75rem] font-semibold text-[var(--text-muted)] mb-1.5">
                                Delivery Method
                            </label>
                            <select
                                className="w-full px-3 py-2 rounded-lg text-[0.8125rem] outline-none cursor-pointer transition-all"
                                style={{
                                    background: 'rgb(var(--overlay-rgb)/0.04)',
                                    border: '1px solid rgb(var(--overlay-rgb)/0.12)',
                                    color: selectedPersonId ? 'var(--foreground)' : 'var(--text-muted)',
                                }}
                                value={selectedPersonId}
                                onChange={(e) => setSelectedPersonId(e.target.value)}
                            >
                                <option value="" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>-- Select Delivery Method --</option>
                                {deliveryPersons.map((p) => (
                                    <option key={p.id} value={p.id} style={{ background: 'var(--surface)', color: 'var(--foreground)' }}>
                                        {p.firstName} {p.lastName}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Error */}
                        {fulfillError && (
                            <div
                                className="px-3 py-2 rounded-lg flex items-start gap-2"
                                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}
                            >
                                <p className="text-[0.75rem] text-red-400">{fulfillError}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Footer ──────────────────────────────────────────── */}
                <div
                    className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4"
                    style={{ borderTop: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
                >
                    <button
                        onClick={onClose}
                        disabled={fulfilling}
                        className="px-5 py-2.5 rounded-xl text-[0.8125rem] font-medium cursor-pointer transition-all duration-150 disabled:opacity-40 text-center"
                        style={{
                            background: 'rgb(var(--overlay-rgb)/0.05)',
                            border: '1px solid rgb(var(--overlay-rgb)/0.1)',
                            color: 'var(--text-muted)',
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!canCreate || fulfilling}
                        className="px-5 py-2.5 rounded-xl text-[0.8125rem] font-semibold cursor-pointer transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        style={{
                            background: (!canCreate || fulfilling)
                                ? 'rgba(99,102,241,0.18)'
                                : 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
                            border: '1px solid rgba(99,102,241,0.4)',
                            // White only on the solid gradient — the pale disabled tint needs ink
                            color: (!canCreate || fulfilling) ? 'var(--foreground)' : '#fff',
                            boxShadow: (!canCreate || fulfilling) ? 'none' : '0 4px 20px rgba(99,102,241,0.4)',
                        }}
                    >
                        {fulfilling ? (
                            <>
                                <SpinnerIcon width={13} height={13} />
                                Creating…
                            </>
                        ) : (
                            'Create fulfillment'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
