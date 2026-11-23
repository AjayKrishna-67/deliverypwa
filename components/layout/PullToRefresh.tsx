'use client';

/**
 * PullToRefresh — swipe down from the top of a page to reload it. App shell
 * only: a plain browser already has its own, and inside the Capacitor
 * WebView there is none, so riders had no way to refresh a stale list.
 *
 * Reloads the page outright (every screen re-fetches on mount, and the
 * session/active-ride recovery already survives a reload). Deliberately
 * picky about what counts as a pull:
 *   · the nearest scrollable ancestor must be at the very top
 *   · the gesture must be clearly vertical (axis locked after a small slop)
 *   · one finger only — a pinch disarms it
 *   · never inside maps, modals, drawers, or form fields
 */

import { useEffect, useRef, useState } from 'react';
import { isNativeApp } from '@/lib/native-tracking';
import { SpinnerIcon } from '@/components/icons';

const PULL_THRESHOLD_PX = 80;
const MAX_PULL_PX = 120;
const AXIS_SLOP_PX = 10;
/** Surfaces where a downward drag means something else */
const OPT_OUT_SELECTOR = '.gm-style, [role="dialog"], [data-no-ptr], aside, nav, input, textarea, select';

function scrolledAway(target: EventTarget | null): boolean {
    let el = target instanceof Element ? target : null;
    while (el) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
            return el.scrollTop > 0;
        }
        el = el.parentElement;
    }
    return (document.scrollingElement?.scrollTop ?? 0) > 0;
}

export function PullToRefresh() {
    const [pull, setPull] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const pullRef = useRef(0);
    const refreshingRef = useRef(false);

    useEffect(() => {
        if (!isNativeApp()) return;
        let startX = 0;
        let startY = 0;
        let armed = false;
        let axis: 'undecided' | 'vertical' = 'undecided';
        const reset = () => {
            armed = false;
            axis = 'undecided';
            pullRef.current = 0;
            setPull(0);
        };
        const onStart = (e: TouchEvent) => {
            if (refreshingRef.current) return;
            if (e.touches.length !== 1) {
                reset(); // a second finger = pinch, not a pull
                return;
            }
            const target = e.target instanceof Element ? e.target : null;
            if (target?.closest(OPT_OUT_SELECTOR) || scrolledAway(e.target)) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            armed = true;
            axis = 'undecided';
        };
        const onMove = (e: TouchEvent) => {
            if (!armed) return;
            if (e.touches.length !== 1) {
                reset();
                return;
            }
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;
            if (axis === 'undecided') {
                if (Math.abs(dx) < AXIS_SLOP_PX && Math.abs(dy) < AXIS_SLOP_PX) return;
                if (Math.abs(dx) >= Math.abs(dy) || dy < 0) {
                    armed = false; // sideways or upward — not ours
                    return;
                }
                axis = 'vertical';
            }
            // Rubber-band: the indicator follows the finger at half speed
            const p = dy <= 0 ? 0 : Math.min(MAX_PULL_PX, dy / 2);
            pullRef.current = p;
            setPull(p);
        };
        const onEnd = () => {
            if (!armed) return;
            const p = pullRef.current;
            reset();
            if (p >= PULL_THRESHOLD_PX && !refreshingRef.current) {
                refreshingRef.current = true;
                setRefreshing(true);
                setPull(p);
                setTimeout(() => window.location.reload(), 150);
            }
        };
        document.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend', onEnd);
        document.addEventListener('touchcancel', onEnd);
        return () => {
            document.removeEventListener('touchstart', onStart);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            document.removeEventListener('touchcancel', onEnd);
        };
    }, []);

    if (pull <= 0 && !refreshing) return null;
    const ready = refreshing || pull >= PULL_THRESHOLD_PX;
    return (
        <div
            className="pointer-events-none fixed left-0 right-0 z-[90] flex justify-center"
            // Below the dashboard header, then follows the finger
            style={{ top: `calc(env(safe-area-inset-top) + 3.5rem + ${Math.round(pull / 2)}px)` }}
            aria-hidden
        >
            <div
                className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.75rem] font-semibold"
                style={{
                    background: 'rgb(var(--bg-rgb)/0.92)',
                    border: '1px solid var(--card-border)',
                    color: 'var(--foreground)',
                    opacity: Math.min(1, pull / PULL_THRESHOLD_PX),
                }}
            >
                {ready ? <SpinnerIcon width={14} height={14} /> : <span aria-hidden>↓</span>}
                {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
            </div>
        </div>
    );
}
