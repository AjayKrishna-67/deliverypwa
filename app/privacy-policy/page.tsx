import type { Metadata } from 'next';

/**
 * Public privacy policy page — required for Google Play / App Store submission.
 * Server component, no auth: Play reviewers and users must reach it logged-out.
 * Whitelisted in proxy.ts PUBLIC_PATHS so it isn't redirected to /login.
 */

export const metadata: Metadata = {
    title: 'Privacy Policy — Kaaikani Delivery',
    description: 'Privacy policy for the Kaaikani Delivery Partner application.',
};

const LAST_UPDATED = '24 July 2026';
const CONTACT_EMAIL = 'kaaikanimarketing@gmail.com';
const APP_NAME = 'Kaaikani Delivery Partner';

export default function PrivacyPolicyPage() {
    return (
        <main className="mx-auto max-w-3xl px-6 py-16 text-neutral-200">
            <h1 className="text-3xl font-bold text-foreground">Privacy Policy</h1>
            <p className="mt-2 text-sm text-neutral-400">Last updated: {LAST_UPDATED}</p>

            <section className="mt-8 space-y-4 leading-relaxed">
                <p>
                    This Privacy Policy describes how {APP_NAME} (&quot;we&quot;, &quot;our&quot;, or
                    &quot;the app&quot;) collects, uses, and protects information when you use our
                    delivery-management application and website.
                </p>

                <h2 className="pt-4 text-xl font-semibold text-foreground">Information We Collect</h2>
                <ul className="list-disc space-y-2 pl-6">
                    <li>
                        <strong>Account &amp; authentication data:</strong> your login credentials and
                        session information, used to sign you in and keep you signed in.
                    </li>
                    <li>
                        <strong>Order &amp; delivery data:</strong> order details, delivery status, and
                        assignment information needed to fulfil deliveries.
                    </li>
                    <li>
                        <strong>Location data:</strong> with your permission, your precise location is
                        used to show your distance to assigned orders, guide you to the customer, share
                        your live position with the store while a delivery is in progress, and calculate
                        the ride distance. During an active delivery this continues in the background
                        or with the screen off, always with a visible &ldquo;Delivery in progress&rdquo;
                        notification, and stops when the order is delivered. Location is stored with the
                        delivery record for operational and payroll purposes and is never sold or used for
                        advertising.
                    </li>
                    <li>
                        <strong>Push-notification token:</strong> a device token used solely to send you
                        delivery-related notifications.
                    </li>
                </ul>

                <h2 className="pt-4 text-xl font-semibold text-foreground">How We Use Information</h2>
                <p>
                    We use collected information only to operate the app: to authenticate users, display
                    and manage delivery orders, send delivery notifications, and improve reliability. We
                    do not sell your personal data.
                </p>

                <h2 className="pt-4 text-xl font-semibold text-foreground">Data Sharing</h2>
                <p>
                    Information is processed through our Vendure eCommerce backend and is not shared with
                    third parties except as required to operate the service or comply with the law.
                </p>

                <h2 className="pt-4 text-xl font-semibold text-foreground">Data Retention</h2>
                <p>
                    We retain account and order data for as long as your account is active or as needed to
                    provide the service and meet legal obligations.
                </p>

                <h2 className="pt-4 text-xl font-semibold text-foreground">Your Rights</h2>
                <p>
                    You may request access to, correction of, or deletion of your personal data by
                    contacting us at the address below.
                </p>

                <h2 className="pt-4 text-xl font-semibold text-foreground">Contact</h2>
                <p>
                    For any privacy questions or data requests, contact us at{' '}
                    <a className="text-indigo-400 underline" href={`mailto:${CONTACT_EMAIL}`}>
                        {CONTACT_EMAIL}
                    </a>
                    .
                </p>
            </section>
        </main>
    );
}
