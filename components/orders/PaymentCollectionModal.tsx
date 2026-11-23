'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SpinnerIcon } from '@/components/icons';
import {
    transitToDelivered,
    generateDeliveryQrCode,
    checkDeliveryQrStatus,
    closeDeliveryQrCode,
    createPaymentLink,
    checkPaymentLinkStatus,
    cancelPaymentLink,
    type DeliveryOrder,
    type DeliveryQrCodeResult,
    type PaymentLinkResult,
} from '@/services/orders.service';
import { formatCurrency } from '@/lib/formatters';

const QR_POLL_INTERVAL_MS = 3000;
const PAYMENT_LINK_POLL_INTERVAL_MS = 5000;

type PaymentMode = 'cash' | 'qr' | 'split' | 'payment-link';

interface PaymentCollectionModalProps {
    order: DeliveryOrder;
    fulfillmentId: string;
    channelToken: string | null;
    onDelivered: (orderId: string, newState: string) => void;
    onClose: () => void;
}

export function PaymentCollectionModal({
    order,
    fulfillmentId,
    channelToken,
    onDelivered,
    onClose,
}: PaymentCollectionModalProps) {
    const isOnline = order.paymentMethod === 'razorpay-payment';
    const [mode, setMode] = useState<PaymentMode | null>(null); // null = initial selection screen
    const [cashAmount, setCashAmount] = useState(order.totalWithTax);
    const [splitCashAmount, setSplitCashAmount] = useState(0);
    const [collectionNote, setCollectionNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    // QR state
    const [qrData, setQrData] = useState<DeliveryQrCodeResult | null>(null);
    const [qrLoading, setQrLoading] = useState(false);
    const [qrPaid, setQrPaid] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Payment Link state
    const [plPhone, setPlPhone] = useState('');
    const [plData, setPlData] = useState<PaymentLinkResult | null>(null);
    const [plLoading, setPlLoading] = useState(false);
    const [plPaid, setPlPaid] = useState(false);
    const plPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const token = channelToken ?? undefined;
    const orderTotal = order.totalWithTax;
    const orderTotalDisplay = formatCurrency(orderTotal, order.currencyCode || 'INR');

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
            if (plPollRef.current) clearInterval(plPollRef.current);
        };
    }, []);

    const stopPolling = useCallback(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        if (plPollRef.current) { clearInterval(plPollRef.current); plPollRef.current = null; }
    }, []);

    function handleBack() {
        stopPolling();
        setQrData(null);
        setQrPaid(false);
        setPlData(null);
        setPlPaid(false);
        setPlPhone('');
        setError('');
        setMode(null);
    }

    // ── Online: Bill Paid → just deliver ──
    async function handleOnlineDeliver() {
        if (submitting) return;
        setSubmitting(true);
        setError('');
        try {
            await transitToDelivered(fulfillmentId, token);
            onDelivered(order.id, 'Delivered');
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Delivery failed');
        } finally {
            setSubmitting(false);
        }
    }

    // ── Cash: Confirm & Deliver ──
    async function handleCashDeliver() {
        if (submitting) return;
        setSubmitting(true);
        setError('');
        try {
            await transitToDelivered(fulfillmentId, token, {
                paymentCollectionMethod: 'Cash',
                collectedAmount: cashAmount,
                collectionNote: collectionNote || undefined,
            });
            onDelivered(order.id, 'Delivered');
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Payment collection failed');
        } finally {
            setSubmitting(false);
        }
    }

    // ── QR / Split: Generate QR ──
    async function handleGenerateQr() {
        setQrLoading(true);
        setError('');
        try {
            const cash = mode === 'split' ? splitCashAmount : undefined;
            const result = await generateDeliveryQrCode(fulfillmentId, cash, token);
            setQrData(result);
            startPolling();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate QR');
        } finally {
            setQrLoading(false);
        }
    }

    function startPolling() {
        stopPolling();
        pollRef.current = setInterval(async () => {
            try {
                const status = await checkDeliveryQrStatus(fulfillmentId, token);
                setQrData(status);
                if (status.status === 'paid') {
                    stopPolling();
                    setQrPaid(true);
                    onDelivered(order.id, 'Delivered');
                    setTimeout(() => onClose(), 1500);
                } else if (status.status === 'closed') {
                    stopPolling();
                    setError('QR code expired or was cancelled');
                }
            } catch {
                // Silently retry on poll errors
            }
        }, QR_POLL_INTERVAL_MS);
    }

    async function handleCancelQr() {
        stopPolling();
        try {
            await closeDeliveryQrCode(fulfillmentId, token);
            setQrData(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to cancel QR');
        }
    }

    // ── Manual deliver: DP confirms payment received, close QR & deliver ──
    async function handleManualQrDeliver() {
        if (submitting) return;
        setSubmitting(true);
        setError('');
        stopPolling();
        try {
            // Close the QR first (ignore errors — it may already be closed/paid)
            try { await closeDeliveryQrCode(fulfillmentId, token); } catch { /* ignore */ }
            // Transition to delivered with QR payment method
            const qrAmount = qrData?.amount ?? orderTotal;
            const cashPortion = qrData?.cashAmount ?? 0;
            const method = cashPortion > 0 ? 'Cash+QR' : 'QR';
            await transitToDelivered(fulfillmentId, token, {
                paymentCollectionMethod: method,
                collectedAmount: orderTotal,
                collectionNote: `Manual confirm by DP (QR: Rs.${(qrAmount / 100).toFixed(2)}${cashPortion > 0 ? `, Cash: Rs.${(cashPortion / 100).toFixed(2)}` : ''})`,
            });
            onDelivered(order.id, 'Delivered');
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to mark as delivered');
        } finally {
            setSubmitting(false);
        }
    }

    // ── Payment Link: Create & send SMS ──
    async function handleCreatePaymentLink() {
        const phone = plPhone.replace(/\s+/g, '');
        if (!/^[6-9]\d{9}$/.test(phone)) {
            setError('Enter a valid 10-digit Indian mobile number');
            return;
        }
        setPlLoading(true);
        setError('');
        try {
            const result = await createPaymentLink(fulfillmentId, phone, token);
            setPlData(result);
            startPaymentLinkPolling();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create payment link');
        } finally {
            setPlLoading(false);
        }
    }

    function startPaymentLinkPolling() {
        stopPolling();
        plPollRef.current = setInterval(async () => {
            try {
                const status = await checkPaymentLinkStatus(fulfillmentId, token);
                setPlData(status);
                if (status.status === 'paid') {
                    stopPolling();
                    setPlPaid(true);
                    onDelivered(order.id, 'Delivered');
                    setTimeout(() => onClose(), 1500);
                } else if (status.status === 'cancelled' || status.status === 'expired') {
                    stopPolling();
                    setError(`Payment link ${status.status}`);
                }
            } catch {
                // Silently retry on poll errors
            }
        }, PAYMENT_LINK_POLL_INTERVAL_MS);
    }

    async function handleCancelPaymentLink() {
        stopPolling();
        try {
            await cancelPaymentLink(fulfillmentId, token);
            setPlData(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to cancel payment link');
        }
    }

    const splitQrAmount = orderTotal - splitCashAmount;
    const canGenerateSplitQr = splitCashAmount > 0 && splitCashAmount < orderTotal;

    const customerName = order.shippingAddress?.fullName
        || (order.customer ? `${order.customer.firstName} ${order.customer.lastName}` : '');

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
        >
            <div
                className="w-full flex flex-col overflow-hidden rounded-t-2xl animate-[slideUp_0.3s_ease-out]"
                style={{
                    background: 'var(--surface-sheet)',
                    border: '1px solid rgb(var(--overlay-rgb)/0.08)',
                    borderBottom: 'none',
                    boxShadow: 'var(--shadow-sheet)',
                    maxHeight: '85vh',
                }}
            >
                {/* ── Handle bar ── */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 rounded-full" style={{ background: 'rgb(var(--overlay-rgb)/0.15)' }} />
                </div>

                {/* ── Header ── */}
                <div className="px-5 pb-3 pt-1">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-[0.9375rem] font-semibold text-[var(--foreground)]">{customerName}</h2>
                            <p className="text-[0.6875rem] text-[var(--text-muted)] font-mono mt-0.5">{order.code}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-[1.125rem] font-bold tabular-nums text-[var(--foreground)]">{orderTotalDisplay}</p>
                            {isOnline ? (
                                <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--tone-green)' }}>Online</span>
                            ) : (
                                <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(251,191,36,0.12)', color: 'var(--tone-amber)' }}>COD</span>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ borderTop: '1px solid rgb(var(--overlay-rgb)/0.06)' }} />

                {/* ── Content ── */}
                <div className="flex flex-col overflow-y-auto flex-1 px-5 py-4">

                    {/* ═══ ONLINE: Bill Paid ═══ */}
                    {isOnline && (
                        <div className="flex flex-col items-center gap-4 py-4">
                            <div
                                className="w-16 h-16 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(34,197,94,0.12)', border: '2px solid rgba(34,197,94,0.3)' }}
                            >
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--tone-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M20 6L9 17l-5-5" />
                                </svg>
                            </div>
                            <div className="text-center">
                                <p className="text-[1rem] font-semibold text-green-400">Bill Paid</p>
                                <p className="text-[0.75rem] text-[var(--text-muted)] mt-1">Payment received online via Razorpay</p>
                            </div>
                            <button
                                onClick={handleOnlineDeliver}
                                disabled={submitting}
                                className="w-full px-5 py-3 rounded-xl text-[0.875rem] font-semibold cursor-pointer transition-all duration-200 disabled:opacity-40 flex items-center justify-center gap-2"
                                style={{
                                    background: submitting ? 'rgba(34,197,94,0.18)' : 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
                                    border: '1px solid rgba(34,197,94,0.4)',
                                    color: submitting ? 'var(--foreground)' : '#fff',
                                    boxShadow: submitting ? 'none' : '0 4px 20px rgba(34,197,94,0.35)',
                                }}
                            >
                                {submitting ? <><SpinnerIcon width={14} height={14} /> Confirming…</> : 'Confirm Delivery'}
                            </button>
                        </div>
                    )}

                    {/* ═══ COD: Mode selection ═══ */}
                    {!isOnline && mode === null && (
                        <div className="flex flex-col gap-3 py-2">
                            <p className="text-[0.75rem] text-[var(--text-muted)] text-center mb-1">How was payment collected?</p>
                            <button
                                onClick={() => setMode('cash')}
                                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl cursor-pointer transition-all hover:scale-[1.01]"
                                style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)' }}
                            >
                                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(251,191,36,0.12)' }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tone-amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="2" y="6" width="20" height="12" rx="2" />
                                        <circle cx="12" cy="12" r="2" />
                                        <path d="M6 12h.01M18 12h.01" />
                                    </svg>
                                </div>
                                <div className="text-left">
                                    <p className="text-[0.875rem] font-semibold" style={{ color: 'var(--tone-amber)' }}>Cash</p>
                                    <p className="text-[0.6875rem] text-[var(--text-muted)]">Customer paid full amount in cash</p>
                                </div>
                            </button>
                            <button
                                onClick={() => setMode('qr')}
                                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl cursor-pointer transition-all hover:scale-[1.01]"
                                style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)' }}
                            >
                                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(167,139,250,0.12)' }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tone-violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="7" height="7" rx="1" />
                                        <rect x="14" y="3" width="7" height="7" rx="1" />
                                        <rect x="3" y="14" width="7" height="7" rx="1" />
                                        <rect x="14" y="14" width="3" height="3" />
                                        <path d="M21 14h-3v3" />
                                        <path d="M18 21v-3h3" />
                                    </svg>
                                </div>
                                <div className="text-left">
                                    <p className="text-[0.875rem] font-semibold" style={{ color: 'var(--tone-violet)' }}>QR</p>
                                    <p className="text-[0.6875rem] text-[var(--text-muted)]">Generate QR code for full amount</p>
                                </div>
                            </button>
                            <button
                                onClick={() => setMode('split')}
                                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl cursor-pointer transition-all hover:scale-[1.01]"
                                style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)' }}
                            >
                                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(99,102,241,0.12)' }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tone-indigo)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 2v20M2 12h20" />
                                    </svg>
                                </div>
                                <div className="text-left">
                                    <p className="text-[0.875rem] font-semibold" style={{ color: 'var(--tone-indigo)' }}>Cash + QR</p>
                                    <p className="text-[0.6875rem] text-[var(--text-muted)]">Split payment between cash and QR</p>
                                </div>
                            </button>
                            <button
                                onClick={() => setMode('payment-link')}
                                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl cursor-pointer transition-all hover:scale-[1.01]"
                                style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)' }}
                            >
                                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(56,189,248,0.12)' }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tone-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                    </svg>
                                </div>
                                <div className="text-left">
                                    <p className="text-[0.875rem] font-semibold" style={{ color: 'var(--tone-sky)' }}>Payment Link</p>
                                    <p className="text-[0.6875rem] text-[var(--text-muted)]">Send payment link via SMS to someone else</p>
                                </div>
                            </button>
                        </div>
                    )}

                    {/* ═══ COD — CASH MODE ═══ */}
                    {!isOnline && mode === 'cash' && (
                        <div className="flex flex-col gap-4 py-2">
                            <button onClick={handleBack} className="self-start text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline">← Back</button>
                            <div>
                                <label className="block text-[0.75rem] font-semibold text-[var(--text-muted)] mb-1.5">Amount Collected (₹)</label>
                                <input
                                    type="number"
                                    value={cashAmount / 100}
                                    onChange={(e) => setCashAmount(Math.round(Number(e.target.value) * 100))}
                                    onFocus={(e) => e.target.select()}
                                    className="w-full px-3 py-2.5 rounded-lg text-[0.875rem] font-semibold outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                                />
                            </div>
                            <div>
                                <label className="block text-[0.75rem] font-semibold text-[var(--text-muted)] mb-1.5">Note (optional)</label>
                                <textarea
                                    value={collectionNote}
                                    onChange={(e) => setCollectionNote(e.target.value)}
                                    rows={2}
                                    placeholder="e.g. Change returned ₹50"
                                    className="w-full px-3 py-2 rounded-lg text-[0.8125rem] outline-none resize-none"
                                    style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                                />
                            </div>
                            <button
                                onClick={handleCashDeliver}
                                disabled={submitting || cashAmount <= 0}
                                className="w-full px-5 py-3 rounded-xl text-[0.875rem] font-semibold cursor-pointer transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                style={{
                                    background: (submitting || cashAmount <= 0) ? 'rgba(251,191,36,0.18)' : 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
                                    border: '1px solid rgba(251,191,36,0.4)',
                                    color: (submitting || cashAmount <= 0) ? 'var(--foreground)' : '#fff',
                                    boxShadow: (submitting || cashAmount <= 0) ? 'none' : '0 4px 20px rgba(251,191,36,0.3)',
                                }}
                            >
                                {submitting ? <><SpinnerIcon width={14} height={14} /> Confirming…</> : `Collect ${formatCurrency(cashAmount, 'INR')} & Deliver`}
                            </button>
                        </div>
                    )}

                    {/* ═══ COD — QR MODE ═══ */}
                    {!isOnline && mode === 'qr' && (
                        <div className="flex flex-col gap-4 py-2">
                            <button onClick={handleBack} className="self-start text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline">← Back</button>
                            {!qrData && !qrPaid && (
                                <div className="text-center py-2">
                                    <p className="text-[0.8125rem] text-[var(--text-muted)] mb-3">
                                        Generate QR for <span className="text-[var(--foreground)] font-semibold">{orderTotalDisplay}</span>
                                    </p>
                                    <button
                                        onClick={handleGenerateQr}
                                        disabled={qrLoading}
                                        className="w-full px-5 py-3 rounded-xl text-[0.875rem] font-semibold cursor-pointer transition-all flex items-center justify-center gap-2"
                                        style={{
                                            background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
                                            border: '1px solid rgba(167,139,250,0.4)',
                                            color: '#fff',
                                            boxShadow: '0 4px 20px rgba(167,139,250,0.3)',
                                        }}
                                    >
                                        {qrLoading ? <><SpinnerIcon width={14} height={14} /> Generating…</> : 'Generate QR Code'}
                                    </button>
                                </div>
                            )}
                            {qrData && !qrPaid && (
                                <QrDisplay qrData={qrData} currencyCode={order.currencyCode || 'INR'} onCancel={handleCancelQr} onRetry={handleGenerateQr} onManualDeliver={handleManualQrDeliver} />
                            )}
                            {qrPaid && <QrPaidSuccess />}
                        </div>
                    )}

                    {/* ═══ COD — SPLIT MODE ═══ */}
                    {!isOnline && mode === 'split' && (
                        <div className="flex flex-col gap-4 py-2">
                            <button onClick={handleBack} className="self-start text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline">← Back</button>
                            {!qrData && !qrPaid && (
                                <>
                                    <div>
                                        <label className="block text-[0.75rem] font-semibold text-[var(--text-muted)] mb-1.5">Cash Portion (₹)</label>
                                        <input
                                            type="number"
                                            value={splitCashAmount === 0 ? '' : splitCashAmount / 100}
                                            placeholder="Enter cash amount"
                                            onChange={(e) => setSplitCashAmount(Math.round(Number(e.target.value) * 100))}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full px-3 py-2.5 rounded-lg text-[0.875rem] font-semibold outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                                        />
                                    </div>
                                    {canGenerateSplitQr && (
                                        <p className="text-[0.75rem] text-[var(--text-muted)]">
                                            QR will be for remaining <span className="text-[var(--foreground)] font-semibold">{formatCurrency(splitQrAmount, order.currencyCode || 'INR')}</span>
                                        </p>
                                    )}
                                    <button
                                        onClick={handleGenerateQr}
                                        disabled={!canGenerateSplitQr || qrLoading}
                                        className="w-full px-5 py-3 rounded-xl text-[0.875rem] font-semibold cursor-pointer transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                        style={{
                                            background: canGenerateSplitQr ? 'linear-gradient(135deg, #4f46e5 0%, #818cf8 100%)' : 'rgba(99,102,241,0.18)',
                                            border: '1px solid rgba(99,102,241,0.4)',
                                            color: canGenerateSplitQr ? '#fff' : 'var(--foreground)',
                                            boxShadow: canGenerateSplitQr ? '0 4px 20px rgba(99,102,241,0.3)' : 'none',
                                        }}
                                    >
                                        {qrLoading ? <><SpinnerIcon width={14} height={14} /> Generating…</> : 'Generate QR for Remainder'}
                                    </button>
                                </>
                            )}
                            {qrData && !qrPaid && (
                                <QrDisplay qrData={qrData} currencyCode={order.currencyCode || 'INR'} onCancel={handleCancelQr} onRetry={handleGenerateQr} onManualDeliver={handleManualQrDeliver} />
                            )}
                            {qrPaid && <QrPaidSuccess />}
                        </div>
                    )}

                    {/* ═══ COD — PAYMENT LINK MODE ═══ */}
                    {!isOnline && mode === 'payment-link' && (
                        <div className="flex flex-col gap-4 py-2">
                            <button onClick={handleBack} className="self-start text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline">← Back</button>

                            {!plData && !plPaid && (
                                <>
                                    <div className="text-center">
                                        <p className="text-[0.8125rem] text-[var(--text-muted)]">
                                            Send payment link for <span className="text-[var(--foreground)] font-semibold">{orderTotalDisplay}</span>
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-[0.75rem] font-semibold text-[var(--text-muted)] mb-1.5">Sender&apos;s Phone Number</label>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[0.875rem] font-semibold text-[var(--text-muted)] shrink-0">+91</span>
                                            <input
                                                type="tel"
                                                value={plPhone}
                                                placeholder="Enter 10-digit mobile number"
                                                onChange={(e) => setPlPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                                className="w-full px-3 py-2.5 rounded-lg text-[0.875rem] font-semibold outline-none tabular-nums"
                                                style={{ background: 'rgb(var(--overlay-rgb)/0.04)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--foreground)' }}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleCreatePaymentLink}
                                        disabled={plPhone.length !== 10 || plLoading}
                                        className="w-full px-5 py-3 rounded-xl text-[0.875rem] font-semibold cursor-pointer transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                        style={{
                                            background: plPhone.length === 10 ? 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)' : 'rgba(56,189,248,0.18)',
                                            border: '1px solid rgba(56,189,248,0.4)',
                                            color: plPhone.length === 10 ? '#fff' : 'var(--foreground)',
                                            boxShadow: plPhone.length === 10 ? '0 4px 20px rgba(56,189,248,0.3)' : 'none',
                                        }}
                                    >
                                        {plLoading ? <><SpinnerIcon width={14} height={14} /> Sending…</> : 'Send Payment Link'}
                                    </button>
                                </>
                            )}

                            {plData && !plPaid && (
                                <PaymentLinkStatus plData={plData} currencyCode={order.currencyCode || 'INR'} onCancel={handleCancelPaymentLink} />
                            )}

                            {plPaid && <QrPaidSuccess />}
                        </div>
                    )}

                    {/* ── Error ── */}
                    {error && (
                        <div className="px-3 py-2 rounded-lg mt-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                            <p className="text-[0.75rem] text-red-400">{error}</p>
                        </div>
                    )}
                </div>

                {/* ── Bottom safe area padding ── */}
                <div className="h-2" style={{ background: 'transparent' }} />
            </div>

            {/* ── Slide-up animation ── */}
            <style jsx>{`
                @keyframes slideUp {
                    from { transform: translateY(100%); }
                    to { transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}

// ── QR Display sub-component ──

function QrDisplay({
    qrData,
    currencyCode,
    onCancel,
    onRetry,
    onManualDeliver,
}: {
    qrData: DeliveryQrCodeResult;
    currencyCode: string;
    onCancel: () => void;
    onRetry: () => void;
    onManualDeliver: () => void;
}) {
    const isDataUri = qrData.imageUrl?.startsWith('data:');
    // The load result is kept with the URL it belongs to, so a new QR (Retry)
    // starts from 'loading' on its own — no reset effect, no extra render.
    const [loadResult, setLoadResult] = useState<{ url: string; status: 'loaded' | 'error' } | null>(null);
    const imgStatus: 'loading' | 'loaded' | 'error' =
        loadResult?.url === qrData.imageUrl ? loadResult.status : isDataUri ? 'loaded' : 'loading';

    return (
        <div className="flex flex-col items-center gap-3 py-2">
            <div className="rounded-xl overflow-hidden bg-white relative" style={{ minWidth: '14rem', minHeight: '14rem' }}>
                {imgStatus === 'loading' && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <SpinnerIcon width={24} height={24} />
                    </div>
                )}
                {imgStatus === 'error' ? (
                    <div className="flex flex-col items-center justify-center gap-2 p-6 text-center" style={{ minHeight: '14rem' }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        <p className="text-[0.75rem] text-red-500 font-medium">QR image failed to load</p>
                        <button
                            onClick={onRetry}
                            className="text-[0.75rem] text-indigo-600 font-semibold hover:underline cursor-pointer"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    // A data: URI or a one-time gateway URL — nothing for next/image to
                    // optimise or cache, and the QR must stay pixel-exact to scan.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={qrData.imageUrl}
                        alt="Payment QR Code"
                        className="w-56 sm:w-64"
                        style={{ display: imgStatus === 'loaded' ? 'block' : 'none' }}
                        decoding="async"
                        fetchPriority="high"
                        onLoad={() => setLoadResult({ url: qrData.imageUrl, status: 'loaded' })}
                        onError={() => setLoadResult({ url: qrData.imageUrl, status: 'error' })}
                    />
                )}
            </div>
            <div className="text-center">
                <p className="text-[0.875rem] font-semibold text-[var(--foreground)]">
                    {formatCurrency(qrData.amount, currencyCode)}
                </p>
                {qrData.cashAmount > 0 && (
                    <p className="text-[0.75rem] text-[var(--text-muted)]">
                        Cash: {formatCurrency(qrData.cashAmount, currencyCode)}
                    </p>
                )}
                <div className="flex items-center justify-center gap-2 mt-2">
                    <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold"
                        style={qrData.status === 'active' ? {
                            background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: 'var(--tone-amber)',
                        } : {
                            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--error)',
                        }}
                    >
                        {qrData.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                        {qrData.status === 'active' ? 'Waiting for payment…' : qrData.status}
                    </span>
                </div>
            </div>
            {qrData.status === 'active' && (
                <div className="flex flex-col items-center gap-3 w-full">
                    <button onClick={onCancel} className="text-[0.75rem] text-red-400 hover:text-red-300 cursor-pointer transition-colors">
                        Cancel QR
                    </button>
                    <button
                        onClick={onManualDeliver}
                        className="w-full px-5 py-3 rounded-xl text-[0.8125rem] font-semibold cursor-pointer transition-all flex items-center justify-center gap-2"
                        style={{
                            background: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
                            border: '1px solid rgba(34,197,94,0.4)',
                            color: '#fff',
                            boxShadow: '0 4px 20px rgba(34,197,94,0.35)',
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5" />
                        </svg>
                         Mark Delivered
                    </button>
                </div>
            )}
        </div>
    );
}

function QrPaidSuccess() {
    return (
        <div className="flex flex-col items-center gap-2 py-6">
            <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(34,197,94,0.15)', border: '2px solid rgba(34,197,94,0.3)' }}
            >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                </svg>
            </div>
            <p className="text-[0.9375rem] font-semibold text-green-400">Payment Received!</p>
            <p className="text-[0.75rem] text-[var(--text-muted)]">Order marked as delivered</p>
        </div>
    );
}

function PaymentLinkStatus({
    plData,
    currencyCode,
    onCancel,
}: {
    plData: PaymentLinkResult;
    currencyCode: string;
    onCancel: () => void;
}) {
    const [copied, setCopied] = useState(false);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(plData.shortUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback for older browsers
            const input = document.createElement('input');
            input.value = plData.shortUrl;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }

    return (
        <div className="flex flex-col items-center gap-3 py-2">
            {/* Link sent confirmation */}
            <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(56,189,248,0.12)', border: '2px solid rgba(56,189,248,0.3)' }}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--tone-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2L11 13" />
                    <path d="M22 2L15 22l-4-9-9-4 20-7z" />
                </svg>
            </div>

            <div className="text-center">
                <p className="text-[0.875rem] font-semibold text-[var(--foreground)]">
                    Payment link sent!
                </p>
                <p className="text-[0.75rem] text-[var(--text-muted)] mt-1">
                    Sent to <span className="text-[var(--foreground)] font-mono">+91 {plData.customerPhone}</span>
                </p>
                <p className="text-[0.875rem] font-semibold text-[var(--foreground)] mt-2">
                    {formatCurrency(plData.amount, currencyCode)}
                </p>
            </div>

            {/* Short URL display with copy button */}
            <button
                onClick={handleCopy}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all"
                style={{
                    background: copied ? 'rgba(34,197,94,0.08)' : 'rgb(var(--overlay-rgb)/0.04)',
                    border: copied ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgb(var(--overlay-rgb)/0.08)',
                }}
            >
                <span className="text-[0.75rem] font-mono text-sky-400 break-all">
                    {plData.shortUrl}
                </span>
                {copied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <path d="M20 6L9 17l-5-5" />
                    </svg>
                ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tone-slate)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                )}
            </button>

            {/* Status badge */}
            <div className="flex items-center justify-center gap-2">
                <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold"
                    style={plData.status === 'created' ? {
                        background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)', color: 'var(--tone-sky)',
                    } : {
                        background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--error)',
                    }}
                >
                    {plData.status === 'created' && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />}
                    {plData.status === 'created' ? 'Waiting for payment…' : plData.status}
                </span>
            </div>

            {plData.status === 'created' && (
                <button onClick={onCancel} className="text-[0.75rem] text-red-400 hover:text-red-300 cursor-pointer transition-colors">
                    Cancel Link
                </button>
            )}
        </div>
    );
}
