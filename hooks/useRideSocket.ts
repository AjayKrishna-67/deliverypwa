'use client';

/**
 * useRideSocket — the driver's live position stream during an active ride.
 *
 * Mounts on the delivery page while the ride is active: connects a
 * ticket-authenticated socket to the backend's /fleet-io gateway and emits a
 * `ride-fix` (lat/lng/heading + cumulative odometer) for every accepted GPS
 * fix, throttled to one per ~2.5 s. The gateway relays each fix instantly to
 * the owner's fleet map — the marker glides instead of hopping every 20 s.
 *
 * While the stream is connected, DriverLocationProvider skips HTTP heartbeats
 * (the backend stamps presence from the streamed fixes). On any drop it
 * redials with a fresh ticket after 5 s; heartbeats resume automatically in
 * the meantime, so the fallback ladder is: stream → heartbeats → silence.
 *
 * Works in browser, TWA, and the Capacitor app — inside the app, the ride
 * foreground service keeps this streaming with the screen off.
 */

import { useEffect, useRef, useState } from 'react';
import { isPreciseFix } from '@/lib/gps-policy';
import { io, type Socket } from 'socket.io-client';
import { vendureFetch } from '@/graphql/client';
import { DRIVER_SOCKET_TICKET } from '@/graphql/operations/tracking';
import { useDriverLocation } from '@/providers/DriverLocationProvider';
import { readOdometerMeters } from '@/lib/odometer';
import { setRideStreamConnected } from '@/lib/ride-stream-state';

const EMIT_MIN_INTERVAL_MS = 2_500;
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

export function useRideSocket(
    active: boolean,
    orderId: string | null,
    channelToken: string | null,
): { streaming: boolean } {
    const { position } = useDriverLocation();
    const [streaming, setStreaming] = useState(false);
    const socketRef = useRef<Socket | null>(null);
    const lastEmitRef = useRef(0);

    // ── Connection lifecycle ──────────────────────────────────────────
    useEffect(() => {
        if (!active || !orderId) return;
        const origin = backendOrigin();
        if (!origin) return;

        let disposed = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        const scheduleRetry = () => {
            if (disposed || retryTimer) return;
            retryTimer = setTimeout(() => {
                retryTimer = null;
                socketRef.current?.close();
                socketRef.current = null;
                void connect();
            }, RETRY_MS);
        };

        const connect = async () => {
            if (disposed) return;
            let ticket: string;
            try {
                const res = await vendureFetch<{ driverSocketTicket: string }>(
                    DRIVER_SOCKET_TICKET,
                    {},
                    channelToken ?? undefined,
                );
                ticket = res.data.driverSocketTicket;
            } catch {
                scheduleRetry();
                return;
            }
            if (disposed) return;
            const socket = io(origin, {
                path: '/fleet-io',
                transports: ['websocket'],
                reconnection: false,
                auth: { ticket },
            });
            socketRef.current = socket;
            socket.on('connect', () => {
                if (disposed) return;
                setStreaming(true);
                setRideStreamConnected(true);
                lastEmitRef.current = 0; // first fix flows immediately
            });
            const onDrop = () => {
                if (disposed) return;
                setStreaming(false);
                setRideStreamConnected(false);
                scheduleRetry();
            };
            socket.on('disconnect', onDrop);
            socket.on('connect_error', onDrop);
        };

        void connect();
        return () => {
            disposed = true;
            if (retryTimer) clearTimeout(retryTimer);
            socketRef.current?.close();
            socketRef.current = null;
            setStreaming(false);
            setRideStreamConnected(false);
        };
    }, [active, orderId, channelToken]);

    // ── Emit throttled fixes ──────────────────────────────────────────
    useEffect(() => {
        if (!active || !orderId || !position) return;
        // A cell-tower fix (1–3 km) would throw the owner's map across town
        if (!isPreciseFix(position.accuracy)) return;
        const socket = socketRef.current;
        if (!socket?.connected) return;
        const now = Date.now();
        if (now - lastEmitRef.current < EMIT_MIN_INTERVAL_MS) return;
        lastEmitRef.current = now;
        socket.emit('ride-fix', {
            orderId,
            lat: position.lat,
            lng: position.lng,
            heading: position.heading,
            rideDistanceMeters: readOdometerMeters(orderId),
        });
    }, [active, orderId, position]);

    return { streaming };
}
