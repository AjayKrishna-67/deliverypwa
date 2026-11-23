'use server';

/**
 * Server Actions for Web Push Notifications.
 *
 * These actions run exclusively on the server (never bundled into client JS),
 * keeping VAPID_PRIVATE_KEY secret.
 *
 * NOTE: The `subscription` variable is in-memory.  In production, store it in
 * a database so subscriptions survive server restarts and support multiple users.
 * Example:  await db.subscriptions.upsert({ where: { userId }, data: sub })
 */

import webpush from 'web-push';

webpush.setVapidDetails(
    'mailto:admin@delivery-dashboard.local',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
);

// ── In-memory store (replace with DB in production) ────────────────────────
let subscription: PushSubscription | null = null;

// ── Subscribe ──────────────────────────────────────────────────────────────
export async function subscribeUser(sub: PushSubscription) {
    // The client passes JSON.parse(JSON.stringify(sub)) which gives a plain object
    // matching the PushSubscriptionJSON shape expected by web-push.
    subscription = sub;
    return { success: true };
}

// ── Unsubscribe ────────────────────────────────────────────────────────────
export async function unsubscribeUser() {
    subscription = null;
    return { success: true };
}

// ── Send Notification ──────────────────────────────────────────────────────
export async function sendNotification(message: string) {
    if (!subscription) {
        throw new Error('No subscription available');
    }

    try {
        await webpush.sendNotification(
            // web-push accepts PushSubscription JSON
            subscription as unknown as webpush.PushSubscription,
            JSON.stringify({
                title: 'Delivery Dashboard',
                body: message,
                icon: '/icons/icon-192x192.png',
                // url is relative; the SW converts it to absolute using self.registration.scope
                url: '/orders',
            })
        );
        return { success: true };
    } catch (error) {
        console.error('[Push] Error sending notification:', error);
        return { success: false, error: 'Failed to send notification' };
    }
}
