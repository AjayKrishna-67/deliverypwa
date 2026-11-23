import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy for Vendure assets — transfer PDFs and damage photos.
 *
 * WHY THIS EXISTS. Asset links used to be built straight against
 * NEXT_PUBLIC_VENDURE_ADMIN_API, which in development is `http://localhost:3005`.
 * That works on the machine running the server and nowhere else. On a phone reaching
 * this app through a tunnel, `localhost:3005` is the PHONE's own localhost — nothing
 * is listening there — so every transfer PDF and every damage photo failed to open,
 * with no error to explain it. The same would be true of the TWA app, which is a
 * remote origin by definition.
 *
 * It is the same problem /api/graphql already solved for data, and the same answer:
 * the browser only ever talks to THIS server, and this server talks to Vendure. A
 * relative URL cannot be pointed at the wrong host.
 *
 * WHAT IT DOES NOT DO. It never takes a host from the caller — only a path under the
 * asset root, joined to the configured Vendure origin here. A proxy that forwarded
 * wherever it was told would let anyone use this server to fetch anything, which is
 * how an open relay is built by accident.
 *
 * Range requests are forwarded because a PDF viewer asks for one: Android's opens the
 * first page by fetching a slice rather than the whole file, and a proxy that answers
 * 200-with-everything to a Range request leaves some viewers showing nothing.
 */

const VENDURE_API_URL = process.env.NEXT_PUBLIC_VENDURE_ADMIN_API ?? '';

/** The Vendure origin, with the `/admin-api` suffix taken off. */
const ASSET_ORIGIN = VENDURE_API_URL.replace(/\/admin-api\/?$/, '');

/** Headers worth passing back — everything a viewer needs, nothing it does not. */
const FORWARDED_RESPONSE_HEADERS = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'last-modified',
    'etag',
];

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ path: string[] }> },
) {
    if (!ASSET_ORIGIN) {
        return new NextResponse('Asset origin is not configured', { status: 500 });
    }

    const { path } = await context.params;

    /*
      Rebuilt from the decoded segments rather than taken from the raw URL.

      Next has already decoded each segment, so a `..` that arrived percent-encoded is
      a literal `..` by the time it is seen here — which is exactly the case a check
      against the raw string would miss. Any segment that is `.` or `..`, or that
      carries a slash or backslash of its own, is refused rather than cleaned up:
      there is no legitimate asset path containing one, so the only thing being
      rejected is an attempt to climb out of the asset root.
    */
    if (!path?.length || path.some((s) => s === '.' || s === '..' || /[/\\]/.test(s))) {
        return new NextResponse('Bad asset path', { status: 400 });
    }

    const target = `${ASSET_ORIGIN}/assets/${path.map(encodeURIComponent).join('/')}`;

    const range = request.headers.get('range');

    let upstream: Response;
    try {
        upstream = await fetch(target, {
            headers: {
                ...(range ? { Range: range } : {}),
                // Assets are public in Vendure, but forwarding the session costs
                // nothing and keeps this working if that is ever locked down.
                ...(request.headers.get('cookie') ? { Cookie: request.headers.get('cookie')! } : {}),
            },
            // The asset host is the same deployment; nothing here should be cached by
            // the fetch layer, because the response is cached below on its own terms.
            cache: 'no-store',
        });
    } catch {
        // The Vendure server being down is a 502 from this proxy's point of view, not
        // a 500: this route worked, the thing behind it did not answer.
        return new NextResponse('Could not reach the asset server', { status: 502 });
    }

    if (!upstream.ok && upstream.status !== 206) {
        return new NextResponse('Asset not found', { status: upstream.status });
    }

    const headers = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) {
            headers.set(name, value);
        }
    }

    /*
      Cached hard, and safely so. Every asset URL this app builds carries a `v=`
      stamped from the asset's own updatedAt, so a changed document is a changed URL —
      which is what makes "immutable" true rather than merely convenient. A phone on a
      warehouse connection re-opening the same transfer document then pays for it once.
    */
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    /*
      Shown in the browser, not pushed at the disk.

      Vendure serves these with `Content-Disposition: attachment`, which makes a
      phone download the PDF to a file the person then has to go and find in a
      downloads folder. Someone checking what is on a transfer wants to look at it.
      The Download button on the detail screen still saves it, because an `<a download>`
      asks for that separately.
    */
    headers.set('Content-Disposition', 'inline');

    return new NextResponse(upstream.body, {
        status: upstream.status,
        headers,
    });
}
