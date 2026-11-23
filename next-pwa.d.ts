// Type declarations for next-pwa
declare module 'next-pwa' {
    import { NextConfig } from 'next';

    function withPWA(config: NextConfig): NextConfig;

    export default function (
        pwaConfig: {
            dest?: string;
            disable?: boolean;
            register?: boolean;
            scope?: string;
            sw?: string;
            skipWaiting?: boolean;
            runtimeCaching?: unknown[];
            publicExcludes?: string[];
            buildExcludes?: unknown[];
            cacheOnFrontEndNav?: boolean;
            reloadOnOnline?: boolean;
            customWorkerDir?: string;
            subdomainPrefix?: string;
        }
    ): typeof withPWA;
}
