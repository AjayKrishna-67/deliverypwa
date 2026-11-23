'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js in production only. In development the SW is unregistered
 * (and its caches purged) to avoid serving stale bundles after code changes —
 * Next.js dev mode doesn't use hashed filenames so the SW would serve old
 * code until a hard refresh.
 *
 * On registration:
 *   scope: '/'
 *   updateViaCache: 'none'   ← forces browsers to re-fetch sw.js on every check
 *
 * Also wires up a "new version available" auto-reload: when a new SW takes
 * control (skipWaiting → claim), the page reloads once so users see the new
 * code without needing a hard refresh.
 */
/**
 * Opt-in override for local push testing.
 *
 * Push needs a registered service worker, and the teardown below deliberately
 * removes it in development — so push cannot be exercised with `next dev` at all.
 * Setting NEXT_PUBLIC_SW_IN_DEV=1 keeps the worker in development so it can be.
 *
 * It belongs in .env.local, which is git-ignored, so it cannot reach anyone else's
 * machine or a deployment. Unset — which is every case but a developer who typed it
 * — the behaviour below is exactly what it always was.
 *
 * The cost of turning it on is the reason the teardown exists: sw.js serves static
 * assets cache-first, and Next's development chunks are not content-hashed, so a
 * stale script can be served after a code change. If something looks like it did not
 * take effect, hard-reload (Ctrl+Shift+R) — or unset this and go back to the default.
 */
const KEEP_SW_IN_DEV = process.env.NEXT_PUBLIC_SW_IN_DEV === '1';

export function ServiceWorkerRegistrar() {
    useEffect(() => {
        if (!('serviceWorker' in navigator)) return;

        // ── Development: tear down any SW + caches so dev rebuilds aren't masked ──
        // If we find leftover state, reload once after clearing so the page is
        // served by the dev server directly, not by a stale SW. Idempotent: if
        // nothing was cached, no reload happens, so no loop.
        if (process.env.NODE_ENV !== 'production' && !KEEP_SW_IN_DEV) {
            (async () => {
                const regs = await navigator.serviceWorker.getRegistrations();
                const cacheKeys = 'caches' in window ? await caches.keys() : [];
                const hadState = regs.length > 0 || cacheKeys.length > 0;

                await Promise.all([
                    ...regs.map((r) => r.unregister()),
                    ...cacheKeys.map((k) => caches.delete(k)),
                ]);

                if (hadState) {
                    // We just freed the SW grip; reload to fetch fresh bundles.
                    window.location.reload();
                }
            })();
            return;
        }

        // ── Register and watch for updates ──
        // Production always; development only when KEEP_SW_IN_DEV is set above.
        /*
          `?dev=1` in development, and it is not cosmetic.

          The worker decides whether to serve from cache, and it had no way to know it
          was running against a development server — it guessed from the hostname, and
          only recognised `localhost`. A phone reaching this app through a tunnel sees
          an ngrok hostname, so the guess said "production" and the worker cached
          Next's development chunks. Those are not content-hashed, so a cached chunk
          outlives the code that replaced it: the phone kept running the old bundle,
          and every change made here appeared not to take effect. Hours can go into
          debugging a fix that was never actually on the device.

          The worker cannot read NEXT_PUBLIC_*; this page can. So it is told, in the
          only channel a worker script has — its own URL. A different URL is also a
          different script to the browser, so an existing worker is replaced rather
          than left in place.
        */
        const swUrl = process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?dev=1';

        navigator.serviceWorker
            .register(swUrl, { scope: '/', updateViaCache: 'none' })
            .then(async (registration) => {
                console.log('[SW] Registered, scope:', registration.scope);

                const sub = await registration.pushManager.getSubscription();
                window.dispatchEvent(new CustomEvent('sw:subscription', { detail: sub }));
            })
            .catch((err) => {
                console.warn('[SW] Registration failed:', err);
            });

        // When a new SW takes control of this page, reload once so the open
        // tab picks up the new code without manual hard-refresh. The flag
        // prevents reload loops if the controller changes more than once.
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloading) return;
            reloading = true;
            window.location.reload();
        });
    }, []);

    return null;
}
