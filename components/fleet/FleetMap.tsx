'use client';

/**
 * FleetMap — live map of active delivery persons for the /fleet page.
 *
 * One marker per driver with a known position (inactive drivers are listed in
 * the table but not drawn — their position is stale by definition). Markers
 * move on every poll; the map auto-fits bounds once on first data, then leaves
 * the viewport alone so the owner can pan/zoom freely.
 */

import { useEffect, useRef, useState } from 'react';
import { armRasterFallbackWatchdog, googleMapId, loadGoogleMaps, preferRasterMap } from '@/lib/maps';
import { createRiderBadge } from '@/lib/riderMarker';
import type { DriverFleetStatus } from '@/services/tracking.service';

const STATE_COLORS: Record<string, string> = {
    OUT_FOR_DELIVERY: '#14b8a6',
    ACTIVE: '#22c55e',
};

/** Take a marker off the map. Outside the component so the React Compiler
 *  lint doesn't flag it as an in-effect mutation of ref-held state. */
function detachMarker(marker?: google.maps.marker.AdvancedMarkerElement) {
    if (marker) marker.map = null;
}

interface FleetMapProps {
    drivers: DriverFleetStatus[];
    /** Set (with a fresh ts) to pan/zoom the map onto one driver's marker —
     *  the table's Locate button drives this. */
    focus?: { administratorId: string; ts: number } | null;
}

export function FleetMap({ drivers, focus }: FleetMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<google.maps.Map | null>(null);
    const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
    const fittedRef = useRef(false);
    const watchdogStopRef = useRef<(() => void) | null>(null);
    const [mapError, setMapError] = useState('');
    const [mapReady, setMapReady] = useState(false);
    // Latest drivers for the focus effect — a ref so a Locate click pans once
    // instead of re-panning on every live position update. Synced in an
    // effect (declared before the focus effect, so it runs first).
    const driversRef = useRef(drivers);
    useEffect(() => {
        driversRef.current = drivers;
    });

    // ── Locate-on-map: pan/zoom to a driver when the table button fires ──
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady || !focus) return;
        const d = driversRef.current.find(
            (x) => String(x.administratorId) === String(focus.administratorId),
        );
        if (!d || d.lat == null || d.lng == null) return;
        map.panTo({ lat: d.lat, lng: d.lng });
        if ((map.getZoom() ?? 0) < 16) map.setZoom(16);
    }, [focus, mapReady]);

    // ── Map init (once) ───────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        // The Map instance itself never changes — captured so cleanup does
        // not read the ref after it may have moved on
        const markers = markersRef.current;
        (async () => {
            try {
                await loadGoogleMaps();
                if (cancelled || !containerRef.current) return;
                const mapsLib = (await google.maps.importLibrary('maps')) as google.maps.MapsLibrary;
                await google.maps.importLibrary('marker');
                if (cancelled || !containerRef.current) return;
                const map = new mapsLib.Map(containerRef.current, {
                    mapId: googleMapId(),
                    // Weak/software WebGL → raster from the start; the
                    // watchdog converts a vector map that never draws
                    ...(preferRasterMap() ? { renderingType: google.maps.RenderingType.RASTER } : {}),
                    center: { lat: 11.0168, lng: 76.9558 }, // Coimbatore fallback until first fix
                    zoom: 12,
                    disableDefaultUI: true,
                    zoomControl: true,
                    gestureHandling: 'greedy',
                });
                mapRef.current = map;
                watchdogStopRef.current = armRasterFallbackWatchdog(map);
                setMapReady(true);
            } catch (e) {
                if (!cancelled) setMapError(e instanceof Error ? e.message : 'Failed to load the map');
            }
        })();
        return () => {
            cancelled = true;
            watchdogStopRef.current?.();
            watchdogStopRef.current = null;
            markers.forEach((m) => { m.map = null; });
            markers.clear();
            mapRef.current = null;
        };
    }, []);

    // ── Marker sync on every drivers update ───────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        const visible = drivers.filter(
            (d) => d.state !== 'INACTIVE' && d.lat != null && d.lng != null,
        );
        const seen = new Set<string>();

        for (const d of visible) {
            seen.add(d.administratorId);
            const pos = { lat: d.lat as number, lng: d.lng as number };
            const color = STATE_COLORS[d.state] ?? '#22c55e';
            const existing = markersRef.current.get(d.administratorId);
            if (existing) {
                existing.position = pos;
                // Re-tint the rider badge only when the state actually changed
                const content = existing.content as HTMLElement;
                if (content.dataset.state !== d.state && content.firstChild) {
                    content.dataset.state = d.state;
                    content.replaceChild(createRiderBadge(color), content.firstChild);
                }
            } else {
                const content = document.createElement('div');
                content.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';
                content.dataset.state = d.state;
                content.appendChild(createRiderBadge(color));
                const label = document.createElement('div');
                label.textContent = d.name;
                label.style.cssText =
                    'font:600 11px/1.2 system-ui;color:#111;background:rgba(255,255,255,0.92);' +
                    'padding:2px 7px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,0.3);white-space:nowrap;';
                content.appendChild(label);
                markersRef.current.set(
                    d.administratorId,
                    new google.maps.marker.AdvancedMarkerElement({ map, position: pos, content }),
                );
            }
        }

        // Remove markers for drivers that dropped off (went inactive)
        const staleIds = [...markersRef.current.keys()].filter((id) => !seen.has(id));
        for (const id of staleIds) {
            detachMarker(markersRef.current.get(id));
            markersRef.current.delete(id);
        }

        // Fit bounds once, when positions first arrive
        if (!fittedRef.current && visible.length > 0) {
            fittedRef.current = true;
            if (visible.length === 1) {
                map.setCenter({ lat: visible[0].lat as number, lng: visible[0].lng as number });
                map.setZoom(14);
            } else {
                const b = new google.maps.LatLngBounds();
                visible.forEach((d) => b.extend({ lat: d.lat as number, lng: d.lng as number }));
                map.fitBounds(b, 48);
            }
        }
    }, [drivers, mapReady]);

    if (mapError) {
        return (
            <div className="flex items-center justify-center h-full text-[0.8125rem] text-[var(--text-muted)] p-6 text-center">
                {mapError}
            </div>
        );
    }
    return <div ref={containerRef} className="w-full h-full" />;
}
