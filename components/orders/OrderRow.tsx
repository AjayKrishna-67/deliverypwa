'use client';

import { memo } from 'react';
import { useOrderActions } from '@/hooks/useOrderActions';
import { getStateBadgeClasses, formatState, formatRelativeTime } from '@/lib/formatters';
import {
    type ColKey,
    SETTLE_BUTTON_STYLE,
    SETTLE_BUTTON_LOADING_STYLE,
    FULFILL_BUTTON_STYLE,
    OUT_FOR_DELIVERY_BUTTON_STYLE,
    OUT_FOR_DELIVERY_BUTTON_LOADING_STYLE,
    DELIVER_BUTTON_STYLE,
    DELIVER_BUTTON_LOADING_STYLE,
} from '@/lib/constants';
import { CheckIcon, SpinnerIcon, ArrowIcon, TruckIcon } from '@/components/icons';
import { ModalPortal } from '@/components/orders/ModalPortal';
import { FulfillModal } from '@/components/orders/FulfillModal';
import { PaymentCollectionModal } from '@/components/orders/PaymentCollectionModal';
import type { DeliveryOrder, DeliveryPerson } from '@/services/orders.service';

interface OrderRowProps {
    order: DeliveryOrder;
    visibleCols: ColKey[];
    channelToken: string | null;
    deliveryPersons: DeliveryPerson[];
    isDeliveryPerson: boolean;
    onOrderUpdated: (orderId: string, newState: string) => void;
}

export const OrderRow = memo(function OrderRow({
    order,
    visibleCols,
    channelToken,
    deliveryPersons,
    isDeliveryPerson,
    onOrderUpdated,
}: OrderRowProps) {
    const {
        settling, settleError, handleSettle,
        fulfillModalOpen, setFulfillModalOpen,
        transitioning, transitionError, handleOutForDelivery, handleDeliver,
        paymentModalOpen, setPaymentModalOpen, paymentFulfillmentId,
        customerName, total, invoiceNo,
        canSettle, canFulfill, canOutForDelivery, canDeliver,
    } = useOrderActions({ order, channelToken, isDeliveryPerson, onOrderUpdated });

    const cellClass = 'px-4 py-3 text-[0.8125rem] border-b border-overlay/[0.04] align-middle';

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
            <tr
                className="transition-all duration-300 hover:bg-overlay/[0.03]"
            >
                {visibleCols.map((key) => {
                    switch (key) {
                        case 'invoice':
                            return (
                                <td key={key} className={cellClass}>
                                    {invoiceNo ? (
                                        <span className="tabular-nums text-[var(--text-muted)]">{invoiceNo}</span>
                                    ) : (
                                        <span className="tabular-nums text-foreground/20">—</span>
                                    )}
                                </td>
                            );
                        case 'code':
                            return (
                                <td key={key} className={cellClass}>
                                    <span className="font-mono text-xs text-[var(--accent)] font-medium hover:underline">
                                        {order.code}
                                    </span>
                                </td>
                            );
                        case 'customer':
                            return (
                                <td key={key} className={cellClass}>
                                    <span className="font-medium whitespace-nowrap">{customerName}</span>
                                </td>
                            );
                        case 'state':
                            return (
                                <td key={key} className={cellClass}>
                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold whitespace-nowrap tracking-wide transition-all duration-300 ${getStateBadgeClasses(order.state)}`}>
                                        {formatState(order.state, isDeliveryPerson)}
                                    </span>
                                </td>
                            );
                        case 'total':
                            return (
                                <td key={key} className={cellClass}>
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold tabular-nums whitespace-nowrap">{total}</span>
                                        {order.paymentMethod === 'razorpay-payment' ? (
                                            <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--tone-green)' }}>PAID</span>
                                        ) : order.paymentMethod === 'offline' ? (
                                            <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(251,191,36,0.12)', color: 'var(--tone-amber)' }}>COD</span>
                                        ) : null}
                                    </div>
                                </td>
                            );
                        case 'updatedAt':
                            return (
                                <td key={key} className={cellClass}>
                                    <span
                                        className="text-[0.75rem] tabular-nums whitespace-nowrap"
                                        style={{ color: 'var(--text-muted)' }}
                                        title={order.updatedAt ? new Date(order.updatedAt).toLocaleString('en-IN') : ''}
                                    >
                                        {order.updatedAt ? formatRelativeTime(order.updatedAt) : '—'}
                                    </span>
                                </td>
                            );
                        case 'action':
                            return (
                                <td key={key} className={cellClass} onClick={(e) => e.stopPropagation()}>
                                    {canSettle ? (
                                        <div className="flex flex-col gap-1">
                                            <button
                                                onClick={handleSettle}
                                                disabled={settling}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                                style={settling ? SETTLE_BUTTON_LOADING_STYLE : SETTLE_BUTTON_STYLE}
                                            >
                                                {settling ? (
                                                    <><SpinnerIcon /> Settling…</>
                                                ) : (
                                                    <><CheckIcon /> Settle Payment</>
                                                )}
                                            </button>
                                            {settleError && (
                                                <span className="text-[0.6875rem] text-red-400 leading-tight">{settleError}</span>
                                            )}
                                        </div>
                                    ) : canFulfill ? (
                                        <button
                                            onClick={() => setFulfillModalOpen(true)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap"
                                            style={FULFILL_BUTTON_STYLE}
                                        >
                                            <ArrowIcon /> Fulfill Order
                                        </button>
                                    ) : canOutForDelivery ? (
                                        <div className="flex flex-col gap-1">
                                            <button
                                                onClick={handleOutForDelivery}
                                                disabled={transitioning}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                                style={transitioning ? OUT_FOR_DELIVERY_BUTTON_LOADING_STYLE : OUT_FOR_DELIVERY_BUTTON_STYLE}
                                            >
                                                {transitioning ? (
                                                    <><SpinnerIcon /> Updating…</>
                                                ) : (
                                                    <><TruckIcon /> Out for Delivery</>
                                                )}
                                            </button>
                                            {transitionError && (
                                                <span className="text-[0.6875rem] text-red-400 leading-tight">{transitionError}</span>
                                            )}
                                        </div>
                                    ) : canDeliver ? (
                                        <div className="flex flex-col gap-1">
                                            <button
                                                onClick={handleDeliver}
                                                disabled={transitioning}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.75rem] font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                                style={transitioning ? DELIVER_BUTTON_LOADING_STYLE : DELIVER_BUTTON_STYLE}
                                            >
                                                {transitioning ? (
                                                    <><SpinnerIcon /> Delivering…</>
                                                ) : (
                                                    <><CheckIcon /> Mark as Delivered</>
                                                )}
                                            </button>
                                            {transitionError && (
                                                <span className="text-[0.6875rem] text-red-400 leading-tight">{transitionError}</span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-foreground/20 text-xs">—</span>
                                    )}
                                </td>
                            );
                        default:
                            return null;
                    }
                })}
            </tr>
        </>
    );
});
