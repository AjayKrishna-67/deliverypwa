/**
 * GraphQL client for Vendure Admin API.
 * All requests are proxied through /api/graphql to avoid CORS issues.
 */

const API_URL = '/api/graphql';

// ─── Types ───────────────────────────────────────────────────────────

export interface GraphQLResponse<T> {
    data: T;
    errors?: GraphQLError[];
}

export interface GraphQLError {
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
}

export class GraphQLRequestError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly statusText: string,
    ) {
        super(message);
        this.name = 'GraphQLRequestError';
    }
}

/**
 * Thrown when the Vendure server returns HTTP 200 with a populated `errors`
 * array. This is the standard GraphQL error shape — separate from network or
 * HTTP-level failures so callers can distinguish them.
 */
export class GraphQLOperationError extends Error {
    constructor(
        message: string,
        public readonly errors: GraphQLError[],
    ) {
        super(message);
        this.name = 'GraphQLOperationError';
    }
}

// ─── Client ──────────────────────────────────────────────────────────

export async function vendureFetch<T>(
    query: string,
    variables?: Record<string, unknown>,
    channelToken?: string,
): Promise<GraphQLResponse<T>> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    // Pass the channel token so Vendure scopes all data to the selected channel
    // (same mechanism as the channel switcher in Vendure Admin UI)
    if (channelToken) {
        headers['vendure-token'] = channelToken;
    }

    const res = await fetch(API_URL, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
        // Surface the body — Vendure/Apollo puts the real reason (validation
        // error, bad variable, etc.) there, not in the status text.
        let detail = '';
        try {
            detail = await res.text();
        } catch {
            detail = '';
        }

        /*
          …unless the body is a WEB PAGE, in which case it is not from Vendure at all.

          When the server behind the proxy is down — a restart, a tunnel that has lost
          its upstream — what comes back is that proxy's own error page: several
          kilobytes of HTML. It was being pasted straight onto the screen, so a
          momentary outage during a background refresh filled the top of the transfer
          list with `<!DOCTYPE html> <html class="h-full" …`, which tells the person
          reading it nothing at all and looks like the app itself has broken.

          A leading `<` is the whole test. No GraphQL error body starts with one, and
          every HTML page does.
        */
        const isWebPage = detail.trimStart().startsWith('<');
        const reason = isWebPage
            ? 'the server could not be reached'
            : detail
              ? detail.slice(0, 300)
              : '';

        throw new GraphQLRequestError(
            `Vendure API error: ${res.status} ${res.statusText}${reason ? ` — ${reason}` : ''}`,
            res.status,
            res.statusText,
        );
    }

    const json = (await res.json()) as GraphQLResponse<T>;

    // Surface GraphQL-level errors as exceptions so callers don't have to
    // null-check every nested field. Vendure returns HTTP 200 with an
    // `errors` array (and often `data: null` or partially-null fields) when
    // a resolver throws — without this check, downstream code crashes with
    // confusing "Cannot read properties of null" errors instead of seeing
    // the real error message.
    if (json.errors && json.errors.length > 0) {
        const message = json.errors.map(e => e.message).join('; ');
        throw new GraphQLOperationError(message, json.errors);
    }

    return json;
}
