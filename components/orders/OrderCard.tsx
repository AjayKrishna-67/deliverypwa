'use client';

import { memo } from 'react';
import { useOrderActions } from '@/hooks/useOrderActions';
import { getStateBadgeClasses, formatState, formatRelativeTime } from '@/lib/formatters';
import {
    SETTLE_BUTTON_STYLE,
    SETTLE_BUTTON_LOADING_STYLE,
    FULFILL_BUTTON_STYLE,
    OUT_FOR_DELIVERY_BUTTON_STYLE,
    OUT_FOR_DELIVERY_BUTTON_LOADING_STYLE,
    DELIVER_BUTTON_STYLE,
    DELIVER_BUTTON_LOADING_STYLE,
} from '@/lib/constants';
import { ModalPortal } from '@/components/orders/ModalPortal';
import { FulfillModal } from '@/components/orders/FulfillModal';
import { PaymentCollectionModal } from '@/components/orders/PaymentCollectionModal';
import type { DeliveryOrder, DeliveryPerson } from '@/services/orders.service';

interface OrderCardProps {
    order: DeliveryOrder;
    channelToken: string | null;
    deliveryPersons: DeliveryPerson[];
    isDeliveryPerson: boolean;
    onOrderUpdated: (orderId: string, newState: string) => void;
}

export const OrderCard = memo(function OrderCard({
    order,
    channelToken,
    deliveryPersons,
    isDeliveryPerson,
    onOrderUpdated,
}: OrderCardProps) {
    const {
        settling, settleError, handleSettle,
        fulfillModalOpen, setFulfillModalOpen,
        transitioning, transitionError, handleOutForDelivery, handleDeliver,
        paymentModalOpen, setPaymentModalOpen, paymentFulfillmentId,
        customerName, total, invoiceNo,
        canSettle, canFulfill, canOutForDelivery, canDeliver,
    } = useOrderActions({ order, channelToken, isDeliveryPerson, onOrderUpdated });

    return (
        <>
            {fulfillModalOpen && (
                <ModalPortal>
                    <FulfillModal
                        order={order}
                        deliveryPersons={deliveryPersons}
                        channelToken={channelToken}
                        onFulfilled={onOrderUpdated}
                        onClose={() => setFulfillModalOpen(false)}
                    />
                </ModalPortal>
            )}
            {paymentModalOpen && paymentFulfillmentId && (
                <ModalPortal>
                    <PaymentCollectionModal
                        order={order}
                        fulfillmentId={paymentFulfillmentId}
                        channelToken={channelToken}
                        onDelivered={onOrderUpdated}
                        onClose={() => setPaymentModalOpen(false)}
                    />
                </ModalPortal>
            )}
            <div
                className="rounded-xl p-3.5 flex flex-col gap-2.5 transition-all duration-300"
                style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--card-border)',
                }}
            >
                {/* Row 1: Name + Code + Time + State badge */}
                <div className="flex items-center gap-2.5">
                    <div className="flex-1 min-w-0">
                        <p className="text-[0.8125rem] font-semibold text-[var(--foreground)] truncate">{customerName}</p>
                        <div className="flex items-center gap-2">
                            <p className="text-[0.6875rem] text-[var(--accent)] font-mono truncate">
                                {order.code}
                            </p>
                            {order.updatedAt && (
                                <span
                                    className="text-[0.625rem] whitespace-nowrap shrink-0"
                                    style={{ color: 'var(--text-muted)', opacity: 0.6 }}
                                >
                                    · {formatRelativeTime(order.updatedAt)}
                                </span>
                            )}
                        </div>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-semibold whitespace-nowrap transition-all duration-300 ${getStateBadgeClasses(order.state)}`}>
                        {formatState(order.state, isDeliveryPerson)}
                    </span>
                </div>

                {/* Row 2: Invoice + Total + Payment badge */}
                <div className="flex items-center justify-between gap-2">
                    <div>
                        {invoiceNo ? (
                            <span className="text-[0.6875rem] text-[var(--text-muted)]">#{invoiceNo}</span>
                        ) : (
                            <span className="text-[0.6875rem] text-foreground/20">No invoice</span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[0.875rem] font-semibold tabular-nums">{total}</span>
                        {order.paymentMethod === 'razorpay-payment' ? (
                            <span className="text-[0.5625rem] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--tone-green)' }}>PAID</span>
                        ) : order.paymentMethod === 'offline' ? (
                            <span className="text-[0.5625rem] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(251,191,36,0.12)', color: 'var(--tone-amber)' }}>COD</span>
                        ) : null}
                    </div>
                </div>

                {/* Row 3: Action button (full width, stops card navigation) */}
                {(canSettle || canFulfill || canOutForDelivery || canDeliver) && (
                    <div onClick={(e) => e.stopPropagation()}>
                        {canSettle && (
                            <button
                                onClick={handleSettle}
                                disabled={settling}
                                className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-50"
                                style={settling ? SETTLE_BUTTON_LOADING_STYLE : SETTLE_BUTTON_STYLE}
                            >
                                {settling ? 'Settling…' : '✓ Settle Payment'}
                            </button>
                        )}
                        {canFulfill && (
                            <button
                                onClick={() => setFulfillModalOpen(true)}
                                className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[0.8125rem] font-semibold cursor-pointer"
                                style={FULFILL_BUTTON_STYLE}
                            >
                                → Fulfill Order
                            </button>
                        )}
                        {canOutForDelivery && (
                            <button
                                onClick={handleOutForDelivery}
                                disabled={transitioning}
                                className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-50"
                                style={transitioning ? OUT_FOR_DELIVERY_BUTTON_LOADING_STYLE : OUT_FOR_DELIVERY_BUTTON_STYLE}
                            >
                                {transitioning ? 'Updating…' : '📦 Out for Delivery'}
                            </button>
                        )}
                        {canDeliver && (
                            <button
                                onClick={handleDeliver}
                                disabled={transitioning}
                                className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-50"
                                style={transitioning ? DELIVER_BUTTON_LOADING_STYLE : DELIVER_BUTTON_STYLE}
                            >
                                {transitioning ? 'Delivering…' : '✓ Mark as Delivered'}
                            </button>
                        )}
                    </div>
                )}

                {(settleError || transitionError) && (
                    <span className="text-[0.6875rem] text-red-400">{settleError || transitionError}</span>
                )}
            </div>
        </>
    );
});
