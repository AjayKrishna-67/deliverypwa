// ─── Service Worker for Delivery Dashboard PWA ────────────────────────────────
// Handles: install (pre-cache), activate (cleanup), fetch (cache strategy),
//          push notifications, and notification click events.

/*
  BUMP THIS WHENEVER A DEVICE IS STUCK ON OLD CODE. The activate handler deletes
  every cache whose name is not this one, so changing it empties the old cache the
  moment the new worker takes over.

  v6 exists because v5 could not be escaped from. The dev/production test below used
  to depend on a query flag that only the NEW page bundle knows to register — but the
  old bundle was itself being served from the v5 cache, so it kept registering the
  worker without the flag, the worker kept serving the stale bundle, and the loop had
  no way out. Phones went on running code from days earlier while every fix looked
  like it had failed. Renaming the cache breaks that: the browser always re-checks
  the worker SCRIPT (updateViaCache: 'none'), the new one activates, and its first
  act is to delete v5.
*/
const CACHE_NAME = 'delivery-dashboard-v6';
const OFFLINE_URL = '/login';

/**
 * In development this worker never serves from cache.
 *
 * Push notifications need a registered service worker, so testing them means
 * keeping one in development — and the fetch handler below is cache-first for
 * static assets, while a development server's scripts are not content-hashed. A
 * cached chunk therefore outlives the code that replaced it, and the page runs a
 * mixture of old and new: components rendering twice, stack traces pointing at
 * comments, changes that appear not to have taken.
 *
 * HOW IT KNOWS. ServiceWorkerRegistrar registers this script as `/sw.js?dev=1`
 * outside production and plain `/sw.js` in it. That flag is the authority.
 *
 * The hostname is still checked, but only as a second chance — and it is why this
 * needed fixing. The hostname WAS the whole test, and it recognised `localhost`
 * alone. A phone reaching a development server through a tunnel sees an ngrok
 * hostname, so this said "production", the worker cached development chunks, and the
 * phone went on running an old bundle no matter what changed on the laptop. Every fix
 * looked as though it had not worked, because on that device it had not arrived.
 *
 * A deployed copy is unaffected: no flag, no development hostname, caching exactly
 * as before.
 */
const IS_DEV_SERVER =
    new URL(self.location.href).searchParams.get('dev') === '1' ||
    self.location.hostname === 'localhost' ||
    self.location.hostname === '127.0.0.1';

// Only pre-cache static assets that are guaranteed to succeed.
// Page routes (/, /login, /orders) are cached lazily via the fetch handler
// because they may redirect or fail during SW install (auth redirects, etc.).
const PRECACHE_ASSETS = [
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
];

// ── Install: pre-cache static assets ─────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// ── Activate: clean up old caches, take control immediately ──────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
                )
            )
            .then(() => self.clients.claim())
    );
});

// ── Fetch: network-first for nav/API, cache-first for static assets ──────────
self.addEventListener('fetch', (event) => {
    // See IS_DEV_SERVER above: in development every request goes to the network, so a
    // code change is never masked by something cached before it — including on a phone
    // reaching the dev server through a tunnel.
    if (IS_DEV_SERVER) return;

    const { request } = event;
    const url = new URL(request.url);

    // Only handle same-origin HTTP GET requests.
    // Skip: non-GET, non-http(s), data: URIs, cross-origin (e.g. Razorpay images)
    if (request.method !== 'GET') return;
    if (!url.protocol.startsWith('http')) return;
    if (url.origin !== self.location.origin) return;

    // Never cache API calls
    if (url.pathname.startsWith('/api/')) return;

    /*
      Next.js fetches its own navigation payloads for this same path — an RSC
      request, marked by an "_rsc" query parameter and an "RSC" header.

      They are not assets, and the cache-first branch below was treating them as if
      they were: pressing a filter card handed the router a payload cached under an
      earlier one, the router could not use it, and it fell back to a FULL page
      navigation. Every filter press reloaded the whole app.

      Left to the network, where they belong.
    */
    if (url.searchParams.has('_rsc') || request.headers.get('RSC')) return;

    // Navigation: network-first, fall back to cached page or offline page
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() =>
                    caches.match(request).then(
                        (cached) => cached ?? caches.match(OFFLINE_URL)
                    )
                )
        );
        return;
    }

    // Static assets: cache-first with network fallback
    event.respondWith(
        caches.match(request).then(
            (cached) =>
                cached ??
                fetch(request).then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
        )
    );
});

// ── Push Notifications (Web Push API) ────────────────────────────────────────
self.addEventListener('push', (event) => {
    if (!event.data) return;

    const data = event.data.json();
    const options = {
        body: data.body,
        icon: data.icon || '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        vibrate: [100, 50, 100],
        // Same transfer, same tag — a second message about one load replaces the
        // first instead of stacking five entries in the tray.
        tag: data.tag || undefined,
        // …but replacing it still alerts. Without this a replacement arrives in
        // silence, so "confirmed" makes a sound and the "dispatched" that follows
        // updates the tray with nothing to draw anyone's eye to it.
        renotify: Boolean(data.tag),
        data: {
            dateOfArrival: Date.now(),
            // Store the full absolute URL so notificationclick can open it
            url: data.url
                ? new URL(data.url, self.registration.scope).href
                : self.registration.scope + 'orders',
        },
    };

    // Tell any open tab as well as the notification tray.
    //
    // A push arrives the instant the other branch acts, and a tab that is already
    // open is exactly where someone is watching for it — the source branch sitting
    // on a transfer waiting for the destination to accept it. Without this the page
    // learns nothing from the push and only catches up on its next poll, so a screen
    // in front of a person stays wrong for as long as that takes.
    //
    // Delivered to EVERY client, including ones this worker does not control yet
    // (includeUncontrolled), because a tab loaded before the worker activated is
    // still a tab someone is looking at. What each page does with it is its own
    // business; a page that does not listen is unaffected.
    const notifyOpenTabs = self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
            for (const client of clientList) {
                client.postMessage({
                    type: 'push-alert',
                    title: data.title || '',
                    body: data.body || '',
                    // Which thing changed, so a page showing that thing can decide
                    // whether this concerns it. Matches the payload the server sends.
                    tag: data.tag || '',
                    url: options.data.url,
                });
            }
        })
        .catch(() => {
            // A tab that cannot be reached is not a reason to skip the notification
            // below, which is the half that matters when nobody is looking.
        });

    event.waitUntil(
        Promise.all([
            self.registration.showNotification(data.title || 'Delivery Dashboard', options),
            notifyOpenTabs,
        ])
    );
});

// ── Notification Click ────────────────────────────────────────────────────────
// clients.openWindow() REQUIRES an absolute URL per the Service Worker spec.
self.addEventListener('notificationclick', (event) => {
    console.log('Notification click received.');
    event.notification.close();
    // data.url is already absolute (set in the push handler above)
    const targetUrl = event.notification.data?.url || (self.registration.scope + 'orders');
    event.waitUntil(
        clients
            .matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // If a window with this URL is already open, focus it
                for (const client of clientList) {
                    if (client.url === targetUrl && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Otherwise open a new window
                if (clients.openWindow) {
                    return clients.openWindow(targetUrl);
                }
            })
    );
});
