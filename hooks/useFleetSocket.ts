'use client';

/**
 * useFleetSocket — live push channel for the fleet page.
 *
 * Connects Socket.IO directly to the Vendure backend (path /fleet-io — the
 * GraphQL proxy can't carry websockets). Auth is ticket-based: fetch a
 * one-time ticket via the normal authenticated `fleetSocketTicket` query,
 * then hand it to the socket handshake. The backend binds the socket to the
 * channel the ticket was issued for.
 *
 * Reconnection is manual (socket.io's built-in retry can't refresh the
 * single-use ticket): on any drop we tear down and redial with a fresh
 * ticket after 5 s. While disconnected the fleet page's 10 s poll takes
 * over, so the page degrades to exactly the old behavior — never worse.
 *
 * `transports: ['websocket']` skips the HTTP long-polling handshake, which
 * also dodges ngrok's browser interstitial in dev.
 */

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { vendureFetch } from '@/graphql/client';
import type { DriverFleetStatus } from '@/services/tracking.service';

const FLEET_SOCKET_TICKET = `query FleetSocketTicket { fleetSocketTicket }`;
const RETRY_MS = 5_000;

function backendOrigin(): string | null {
    const api = process.env.NEXT_PUBLIC_VENDURE_ADMIN_API;
    if (!api) return null;
    try {
        return new URL(api).origin;
    } catch {
        return null;
    }
}

interface FleetSocketHandlers {
    /** Fired on every (re)connect — run the snapshot query so no update is missed. */
    onSnapshotNeeded: () => void;
    onDriverUpdate: (driver: DriverFleetStatus) => void;
    /** Live streamed positions during rides (~every 2.5 s) — move the marker. */
    onDriverLive?: (update: DriverLiveUpdate) => void;
}

/** Streamed position from a riding driver — relayed by the gateway. */
export interface DriverLiveUpdate {
    administratorId: string;
    lat: number;
    lng: number;
    heading: number | null;
    activeOrderId: string | null;
    rideDistanceMeters: number | null;
    at: number;
}

export function useFleetSocket(
    enabled: boolean,
    channelToken: string | null,
    handlers: FleetSocketHandlers,
): { connected: boolean } {
    const [connected, setConnected] = useState(false);
    // Ref so socket callbacks always see the latest handlers without
    // re-dialing the socket on every render. Synced in an effect, not during
    // render — React may render and throw away a render, and a ref written
    // there would hold handlers from a render that never committed.
    const handlersRef = useRef(handlers);
    useEffect(() => {
        handlersRef.current = handlers;
    });

    useEffect(() => {
        if (!enabled) return;
        const origin = backendOrigin();
        if (!origin) return; // no backend URL exposed — polling handles it

        let socket: Socket | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let disposed = false;

        const scheduleRetry = () => {
            if (disposed || retryTimer) return;
            retryTimer = setTimeout(() => {
                retryTimer = null;
                socket?.close();
                socket = null;
                void connect();
            }, RETRY_MS);
        };

        const connect = async () => {
            if (disposed) return;
            let ticket: string;
            try {
                const res = await vendureFetch<{ fleetSocketTicket: string }>(
                    FLEET_SOCKET_TICKET,
                    {},
                    channelToken ?? undefined,
                );
                ticket = res.data.fleetSocketTicket;
            } catch {
                scheduleRetry();
                return;
            }
            if (disposed) return;
            socket = io(origin, {
                path: '/fleet-io',
                transports: ['websocket'],
                reconnection: false,
                auth: { ticket },
            });
            socket.on('connect', () => {
                if (disposed) return;
                setConnected(true);
                handlersRef.current.onSnapshotNeeded();
            });
            socket.on('driver-update', (driver: DriverFleetStatus) => {
                if (!disposed) handlersRef.current.onDriverUpdate(driver);
            });
            socket.on('driver-live', (update: DriverLiveUpdate) => {
                if (!disposed) handlersRef.current.onDriverLive?.(update);
            });
            socket.on('disconnect', () => {
                if (disposed) return;
                setConnected(false);
                scheduleRetry();
            });
            socket.on('connect_error', () => {
                if (disposed) return;
                setConnected(false);
                scheduleRetry();
            });
        };

        void connect();
        return () => {
            disposed = true;
            if (retryTimer) clearTimeout(retryTimer);
            socket?.close();
            setConnected(false);
        };
    }, [enabled, channelToken]);

    return { connected };
}
