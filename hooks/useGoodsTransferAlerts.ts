'use client';

/**
 * Alerts for the branch being acted as, anywhere in the Goods Transfer section.
 *
 * Being told about a claim raised in Idukki should not depend on which Goods
 * Transfer screen happens to be open, so this is mounted by the section's shell
 * rather than by one page. It stops the moment someone leaves the section — the
 * other screens in this dashboard have their own concerns and should not be paying
 * for this poll.
 *
 * The read is the ordinary list query with `take: 1`: alerts ride on it, so this
 * publishes no endpoint of its own and adds no server work beyond one small row.
 *
 * `enabled` exists because of that same fact. The transfer list already runs the
 * full version of this query and gets the alerts with it, so polling while that
 * screen is open would ask the server the same question twice. There, the list
 * reports what it received and this stays quiet.
 */

import { useEffect, useRef } from 'react';

import { useGoodsTransferPushRefresh } from '@/hooks/useGoodsTransferPushRefresh';
import {
    ALERT_INTERVAL_MS as POLL_MS,
    markAlertsFetched,
    msSinceAlertsFetched,
    readAlertMarker,
    writeAlertMarker,
} from '@/lib/goods-transfer-alert-marker';
import {
    fetchTransfers,
    isAuthError,
    isPluginMissingError,
} from '@/services/goods-transfer.service';
import type { Alert } from '@/types/goods-transfer';

export function useGoodsTransferAlerts(
    channelToken: string | null,
    userId: string | null,
    onAlert: (alert: Alert) => void,
    onAuthError: () => void,
    enabled: boolean,
): void {
    // Held in refs so a caller re-creating these functions on every render does not
    // tear down and restart the timer.
    //
    // The refs are refreshed in an effect rather than during render: a ref written
    // while rendering can be read by a render that is later thrown away, which
    // React's concurrent rendering makes a real possibility rather than a
    // theoretical one. Declared BEFORE the polling effect so it has already run by
    // the time the first tick fires — and useRef seeds them with the first values
    // anyway, so even that first tick calls the right function.
    const alertRef = useRef(onAlert);
    const authErrorRef = useRef(onAuthError);

    useEffect(() => {
        alertRef.current = onAlert;
        authErrorRef.current = onAuthError;
    });

    /**
     * The current tick, so a push can ask for one out of turn.
     *
     * Set by the effect below and left null when polling is off, which is what makes
     * a push harmless on the list screen: that screen owns the alerts itself, this
     * hook stands down there, and there is nothing here to call.
     */
    const pollNowRef = useRef<(() => void) | null>(null);

    /**
     * A push means something just happened — read the alerts now rather than waiting
     * out the rest of the interval.
     *
     * It asks for a POLL rather than showing the push's own words as a toast, and
     * that is the whole trick. The poll returns alerts newer than the marker and then
     * advances it, so whatever it shows is shown exactly once. Toasting the push
     * directly would have no id to record, and the same alert would arrive again on
     * the next tick as though nothing had been seen.
     */
    useGoodsTransferPushRefresh(() => pollNowRef.current?.());

    useEffect(() => {
        const token = channelToken;
        const user = userId;
        if (!enabled || !token || !user) {
            return;
        }
        let stopped = false;
        let interval: number | undefined;

        async function poll(token: string, user: string) {
            markAlertsFetched();
            try {
                const result = await fetchTransfers(
                    // No status filter: this read exists only to carry the alerts.
                    // The list screen fetches its own rows.
                    undefined,
                    { take: 1, alertsAfterId: readAlertMarker(user, token) },
                    token,
                );
                if (stopped) {
                    return;
                }
                const alerts = result.alerts;
                if (alerts.length) {
                    for (const alert of alerts) {
                        alertRef.current(alert);
                    }
                    writeAlertMarker(user, token, alerts[alerts.length - 1].id);
                }
            } catch (err) {
                if (stopped) {
                    return;
                }
                if (isAuthError(err)) {
                    authErrorRef.current();
                    return;
                }
                if (isPluginMissingError(err)) {
                    // This server has no Goods Transfer module, and asking again in
                    // twenty seconds will not change that. Stop rather than spend a
                    // request a minute, for as long as the tab stays open, on a
                    // question that already has a permanent answer.
                    stopped = true;
                    if (interval !== undefined) {
                        window.clearInterval(interval);
                    }
                    return;
                }
                // Anything else — the server briefly unreachable — is left alone.
                // The next tick tries again, and a failed poll is not worth an error
                // message over whatever the person is actually doing.
            }
        }

        // Wait out whatever is left of the interval since alerts were last read —
        // by this poll on an earlier screen, or by the list's own query. Starting
        // with an immediate request meant every step off the list asked again for
        // what had just been answered.
        const wait = Math.max(0, POLL_MS - msSinceAlertsFetched());

        const starter = window.setTimeout(() => {
            if (stopped) {
                return;
            }
            void poll(token, user);
            interval = window.setInterval(() => void poll(token, user), POLL_MS);
        }, wait);

        // Available from now, not only once the first timer has fired: a push can
        // arrive during the wait above, and that is precisely the moment worth
        // reading early.
        pollNowRef.current = () => {
            if (!stopped) {
                void poll(token, user);
            }
        };

        return () => {
            stopped = true;
            pollNowRef.current = null;
            window.clearTimeout(starter);
            if (interval !== undefined) {
                window.clearInterval(interval);
            }
        };
    }, [enabled, channelToken, userId]);
}
