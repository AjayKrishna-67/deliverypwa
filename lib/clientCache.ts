/**
 * Per-tab cache for static-ish dropdown data (shipping methods, postal codes,
 * areas, delivery persons). Backed by sessionStorage so it survives client-side
 * navigation and refreshes within the tab, but not across tabs/sessions.
 *
 * Why sessionStorage and not localStorage:
 *  - The cached data is per-channel and per-user; a fresh tab should re-validate.
 *  - sessionStorage clears automatically when the tab closes — no stale-key risk.
 *
 * Why not React Query / SWR:
 *  - The dashboard already runs without a data layer. A 60-line helper is enough
 *    for the four dropdowns we need to cache, and avoids a new dependency.
 */

const CACHE_PREFIX = 'dd:cache:v1:';

interface CacheEntry<T> {
    /** ISO ms timestamp when this entry expires. */
    expiresAt: number;
    /** Cached value. */
    value: T;
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function buildKey(scope: string, channelToken: string | null | undefined, suffix?: string): string {
    const tokenSegment = channelToken ?? '__no_channel__';
    return `${CACHE_PREFIX}${scope}:${tokenSegment}${suffix ? `:${suffix}` : ''}`;
}

/**
 * Read an entry from sessionStorage. Returns undefined if missing, expired, or
 * unparseable. Expired entries are evicted as a side effect.
 */
export function readCache<T>(scope: string, channelToken: string | null | undefined, suffix?: string): T | undefined {
    if (!isBrowser()) return undefined;
    const key = buildKey(scope, channelToken, suffix);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw) as CacheEntry<T>;
        if (parsed.expiresAt < Date.now()) {
            window.sessionStorage.removeItem(key);
            return undefined;
        }
        return parsed.value;
    } catch {
        window.sessionStorage.removeItem(key);
        return undefined;
    }
}

/**
 * Write an entry. ttlMs defaults to 5 minutes — appropriate for dropdown data
 * that changes weekly at most. Storage failures (quota, private mode) are
 * swallowed: the cache is an optimization, never a correctness boundary.
 */
export function writeCache<T>(
    scope: string,
    channelToken: string | null | undefined,
    value: T,
    ttlMs: number = 5 * 60 * 1000,
    suffix?: string,
): void {
    if (!isBrowser()) return;
    const key = buildKey(scope, channelToken, suffix);
    const entry: CacheEntry<T> = { expiresAt: Date.now() + ttlMs, value };
    try {
        window.sessionStorage.setItem(key, JSON.stringify(entry));
    } catch {
        /* quota / private mode — acceptable */
    }
}

/**
 * Convenience wrapper: return cached value if fresh, else call loader, cache
 * the result, and return it. Errors from loader propagate (the cache should
 * never mask real failures).
 */
export async function withCache<T>(
    scope: string,
    channelToken: string | null | undefined,
    loader: () => Promise<T>,
    ttlMs?: number,
    suffix?: string,
): Promise<T> {
    const cached = readCache<T>(scope, channelToken, suffix);
    if (cached !== undefined) return cached;
    const fresh = await loader();
    writeCache(scope, channelToken, fresh, ttlMs, suffix);
    return fresh;
}

/** Drop every entry that matches the prefix — used on sign-out. */
export function clearAllCache(): void {
    if (!isBrowser()) return;
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key && key.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach(k => window.sessionStorage.removeItem(k));
}
