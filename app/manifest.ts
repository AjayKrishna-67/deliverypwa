import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        id: '/',
        name: 'Delivery Dashboard',
        short_name: 'Delivery',
        description: 'Channel-aware delivery order management dashboard',
        start_url: '/login',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0a0a0f',
        theme_color: '#6366f1',
        categories: ['business', 'productivity'],
        lang: 'en',
        prefer_related_applications: false,
        icons: [
            // Each size/purpose needs its own entry (TypeScript type constraint)
            { src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-144x144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
            {
                name: 'Orders',
                short_name: 'Orders',
                description: 'View delivery orders',
                url: '/orders',
                icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192' }],
            },
        ],
    };
}
