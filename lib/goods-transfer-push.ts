/**
 * Web Push for Goods Transfer — being told when the app is not open.
 *
 * Nothing here is a second notification system. The server writes the same alert
 * row it always did; push is one more way that row reaches a person, alongside the
 * toast the open app already shows (see hooks/useGoodsTransferAlerts.ts).
 *
 * THIS MODULE NEVER REGISTERS A SERVICE WORKER.
 *
 * components/ServiceWorkerRegistrar.tsx already owns /sw.js for the whole
 * dashboard: it registers in production and deliberately unregisters in
 * development so dev rebuilds are not masked by a stale worker. A second
 * registration here would fight that one — in development the two would take turns
 * registering and unregistering, and since that component reloads the page when the
 * controller changes, the result is a reload loop affecting every screen, delivery
 * partner views included. So this module only ever ASKS for the registration that
 * already exists. No registration, no push; nothing else breaks.
 *
 * Every failure to store the subscription is swallowed. The `gtPushSubscription`
 * custom field is declared by the backend Goods Transfer plugin, so on a server
 * without that plugin the write simply cannot succeed — and a browser that cannot
 * arrange notifications is not a reason to break the screen someone is working on.
 */

import { vendureFetch } from '@/graphql/client';
import {
    MY_PUSH_SUBSCRIPTION_QUERY,
    SAVE_PUSH_SUBSCRIPTION_MUTATION,
} from '@/graphql/operations/goods-transfer';

/** Public half of the VAPID pair — public by design; it proves nothing on its own. */
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/**
 * - `unsupported`   this browser has no push, or no service worker is registered
 * - `unconfigured`  push cannot be arranged here: no VAPID key, or the server
 *                   would not store the subscription
 * - `default`       the browser has not been asked yet
 * - `granted` / `denied`  the person's answer
 */
export type PushState = 'unsupported' | 'unconfigured' | 'default' | 'granted' | 'denied';

export function pushSupported(): boolean {
    return (
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window
    );
}

export function pushState(): PushState {
    if (!pushSupported()) {
        return 'unsupported';
    }
    if (!PUBLIC_KEY) {
        return 'unconfigured';
    }
    return Notification.permission as PushState;
}

/** The key travels as base64url; the browser wants raw bytes. */
function urlBase64ToUint8Array(base64: string): BufferSource {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
}

/** Long enough for a worker to install on a slow machine, short enough to give up. */
const REGISTRATION_WAIT_MS = 10_000;

/**
 * The worker ServiceWorkerRegistrar put in place, or null.
 *
 * "Not registered YET" is not the same as "not registered", and asking once cannot
 * tell them apart. ServiceWorkerRegistrar registers from an effect, this runs from
 * an effect, and nothing orders the two — so on a fresh load (or the first visit
 * after site data is cleared) the question was often asked before the answer
 * existed. The result was push silently never being set up, and appearing to work
 * only after a reload, by which time a worker was already in place.
 *
 * So: ask, and if there is nothing yet, wait for `ready` — which resolves as soon
 * as a worker is active — but not forever. In development without the opt-in flag
 * no worker is ever registered, and `ready` would simply never settle.
 */
async function existingRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (!pushSupported()) {
        return null;
    }

    const already = await navigator.serviceWorker.getRegistration();
    if (already) {
        return already;
    }

    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), REGISTRATION_WAIT_MS);
        }),
    ]);
}

/** One browser's address, as stored on the administrator record. */
interface StoredSubscription {
    endpoint: string;
    [key: string]: unknown;
}

/**
 * Every browser this account has allowed, as stored on the server.
 *
 * A JSON ARRAY, one entry per browser. It held a single address until the laptop
 * and the phone made the problem obvious: whichever subscribed last silently took
 * the notifications away from the other, which looks exactly like push being broken
 * on the first device.
 *
 * A lone object is still read, because that is what earlier versions wrote. It is
 * folded into the array the next time any browser subscribes.
 */
function parseStored(raw: string | null | undefined): StoredSubscription[] {
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        const list = Array.isArray(parsed) ? parsed : [parsed];
        return list.filter(
            (entry): entry is StoredSubscription =>
                Boolean(entry) && typeof (entry as StoredSubscription).endpoint === 'string',
        );
    } catch {
        return [];
    }
}

async function readStored(): Promise<StoredSubscription[]> {
    const result = await vendureFetch<{
        activeAdministrator: {
            customFields?: { gtPushSubscription?: string | null } | null;
        } | null;
    }>(MY_PUSH_SUBSCRIPTION_QUERY);
    return parseStored(result.data.activeAdministrator?.customFields?.gtPushSubscription);
}

async function write(subscriptions: StoredSubscription[]): Promise<void> {
    await vendureFetch(SAVE_PUSH_SUBSCRIPTION_MUTATION, {
        input: {
            customFields: {
                gtPushSubscription: subscriptions.length ? JSON.stringify(subscriptions) : '',
            },
        },
    });
}

/**
 * Adds THIS browser to the list, leaving every other browser's address alone.
 *
 * Read-then-write rather than overwrite: that is the whole difference between one
 * device receiving notifications and all of them.
 */
async function saveThisDevice(subscription: PushSubscription): Promise<boolean> {
    try {
        const mine = subscription.toJSON() as unknown as StoredSubscription;
        if (typeof mine.endpoint !== 'string') {
            return false;
        }
        // Replacing our own previous entry rather than appending a second one — a
        // browser can be re-subscribed, and the old address is then dead.
        const others = (await readStored()).filter((s) => s.endpoint !== mine.endpoint);
        await write([...others, mine]);
        return true;
    } catch {
        // A server without the Goods Transfer plugin has no such field. Nothing to
        // do about it here, and nothing worth interrupting anyone over.
        return false;
    }
}

/**
 * Asks permission, subscribes, and stores the result on the administrator record.
 *
 * Returns the outcome so the screen can say what happened. A refusal is not an
 * error: it is an answer, and everything else works without push.
 */
export async function enablePush(): Promise<PushState> {
    if (!pushSupported() || !PUBLIC_KEY) {
        return pushState();
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        return permission as PushState;
    }

    const registration = await existingRegistration();
    if (!registration) {
        return 'unsupported';
    }

    let subscription: PushSubscription;
    try {
        // An existing subscription is reused. Re-subscribing would issue a new
        // address and quietly orphan the one the server already holds.
        const existing = await registration.pushManager.getSubscription();
        subscription =
            existing ??
            (await registration.pushManager.subscribe({
                // Required by Chrome: a push may only be sent with a message the
                // person can see, never silently in the background.
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY),
            }));
    } catch {
        // Most often a VAPID key that does not match the one the existing
        // subscription was made with. Nothing the person can act on.
        return 'unconfigured';
    }

    const stored = await saveThisDevice(subscription);
    return stored ? 'granted' : 'unconfigured';
}

/**
 * Stops the server sending to THIS device, and to no other.
 *
 * The phone being turned off should not silence the laptop.
 */
export async function disablePush(): Promise<void> {
    const registration = await existingRegistration();
    let endpoint: string | null = null;
    try {
        const subscription = await registration?.pushManager.getSubscription();
        endpoint = subscription?.endpoint ?? null;
        await subscription?.unsubscribe();
    } catch {
        // Already gone is the outcome we wanted.
    }
    if (!endpoint) {
        return;
    }
    try {
        await write((await readStored()).filter((s) => s.endpoint !== endpoint));
    } catch {
        // The server will drop it on its own when it next answers "gone".
    }
}

/**
 * True when the server would send to THIS browser.
 *
 * It is not enough that the server holds an address and that this browser has a
 * subscription — they have to be the SAME address. The server keeps one per
 * administrator, so whichever app subscribed last owns it, and a person who used an
 * earlier version of this app on another port still has that older subscription
 * stored against their account. Checking only that both sides are non-empty said
 * "already set up" and left every notification going to the old address.
 *
 * The endpoint is what identifies a subscription — a URL at the browser vendor's
 * push service — so comparing endpoints is comparing destinations.
 *
 * The server keeps a list, so a laptop and a phone can both be on it. This asks
 * only whether THIS browser is — never whether the list is non-empty, which was the
 * bug that let one device's address stand in for another's.
 */
export async function pushActive(): Promise<boolean> {
    if (pushState() !== 'granted') {
        return false;
    }
    try {
        const [stored, registration] = await Promise.all([readStored(), existingRegistration()]);
        const onDevice = await registration?.pushManager.getSubscription();
        if (!onDevice) {
            return false;
        }
        return stored.some((s) => s.endpoint === onDevice.endpoint);
    } catch {
        // Unreadable or unparseable: treat this browser as not registered, so the
        // next prompt adds it.
        return false;
    }
}
