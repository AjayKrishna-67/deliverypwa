import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // Docker: emit .next/standalone (server.js + only the node_modules the
    // server actually imports) so the runtime image ships without the full
    // node_modules tree. `next start` on EC2/PM2 is unaffected by this.
    output: 'standalone',
    reactStrictMode: true,
    turbopack: {},
    // No floating "N" dev-tools bubble — riders test dev builds through the
    // app shell, where it sits over the bottom-left of every screen
    devIndicators: false,
    // Dev-server only: which origins may load this app's development assets. ngrok
    // hands out *.ngrok-free.dev addresses now as well as the older
    // *.ngrok-free.app, and a tunnel is how a real phone reaches a laptop over
    // HTTPS — which service workers, and so push notifications, require.
    allowedDevOrigins: [
        '*.ngrok-free.app',
        '*.ngrok-free.dev',
        '*.ngrok.io',
        '*.trycloudflare.com',
        'localhost',
        '10.*.*.*',
        '192.168.*.*',
    ],
    images: {
        remotePatterns: [],
    },
    async headers() {
        return [
            {
                // Security headers for all routes
                source: '/(.*)',
                headers: [
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                ],
            },
            {
                // Service worker must never be cached and must be served as JS
                source: '/sw.js',
                headers: [
                    { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
                    { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
                    { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; connect-src 'self' https:; img-src 'self' data: https:" },
                ],
            },
        ];
    },
};

export default nextConfig;