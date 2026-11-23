'use client';

/**
 * The instant half of staying up to date.
 *
 * Screens in this section poll every ALERT_INTERVAL_MS, which is what makes them
 * correct eventually. This is what makes them correct NOW: the service worker
 * receives a push the moment the other branch acts, and forwards it to every open
 * tab (see the `push` handler in public/sw.js). A page listening here can refetch
 * straight away instead of waiting out the rest of its interval.
 *
 * It replaces nothing. Push needs a subscription and permission, and neither is
 * guaranteed — a browser that refused notifications, an account that has not
 * subscribed yet, a server with no VAPID keys. Every screen therefore keeps its
 * poll, and this only ever makes the same refresh happen sooner. Correctness comes
 * from the poll; this is the part that makes it feel live.
 */

import { useEffect, useRef } from 'react';

/** What public/sw.js forwards from a push. */
export interface PushAlert {
    title: string;
    body: string;
    /** `${refType}-${refId}` — what the alert is ABOUT, e.g. "transfer-42". */
    tag: string;
    url: string;
}

/**
 * Calls `onAlert` when a push arrives while this page is open.
 *
 * `filter` decides what is worth waking for. A detail screen passes the one tag it
 * cares about so an alert about a different transfer does not make it refetch; a
 * list passes nothing and takes them all.
 */
export function useGoodsTransferPushRefresh(
    onAlert: (alert: PushAlert) => void,
    filter?: (alert: PushAlert) => boolean,
): void {
    // Held in refs so a caller that rebuilds these on every render does not tear the
    // listener down and put it back. Written in an effect rather than during render:
    // a ref set while rendering can belong to a render React later discards.
    const alertRef = useRef(onAlert);
    const filterRef = useRef(filter);

    useEffect(() => {
        alertRef.current = onAlert;
        filterRef.current = filter;
    });

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
            return;
        }

        function handle(event: MessageEvent) {
            const data = event.data as Partial<PushAlert> & { type?: string };
            // Other things may talk to this page over the same channel one day. Only
            // messages this module put on it are ours to act on.
            if (!data || data.type !== 'push-alert') {
                return;
            }
            const alert: PushAlert = {
                title: data.title ?? '',
                body: data.body ?? '',
                tag: data.tag ?? '',
                url: data.url ?? '',
            };
            if (filterRef.current && !filterRef.current(alert)) {
                return;
            }
            alertRef.current(alert);
        }

        navigator.serviceWorker.addEventListener('message', handle);
        return () => navigator.serviceWorker.removeEventListener('message', handle);
    }, []);
}
