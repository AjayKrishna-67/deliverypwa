import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell for the delivery-person app.
 *
 * Same appId as the existing TWA listing so this ships as a normal UPDATE on
 * Play Store (drivers keep the same app). The shell loads the HOSTED PWA via
 * server.url — the Next.js app keeps its server routes (/api/graphql proxy
 * etc.), and web deploys keep working without an app release. Capacitor
 * injects its native bridge into the remote page, which is how the PWA code
 * reaches the background-geolocation plugin when running inside this shell.
 */
const config: CapacitorConfig = {
    appId: 'in.co.kaaikani.deliverypartner.twa',
    appName: 'Kaaikani Delivery',
    // Stub only — real content comes from server.url. Required by `cap sync`.
    webDir: 'capacitor-shell',
    server: {
        url: 'https://deliverypartner.kaaikani.co.in',
        cleartext: false,
    },
};

export default config;
