/**
 * Where each channel's product master Excel lives on the server.
 *
 * The shared master sits directly in /excel/ and answers for every channel
 * that hasn't been given its own. A channel selling a different catalogue —
 * Idukki, whose Excel has different products and different local names —
 * gets /excel/channels/<slug>/, uploaded and replaced independently.
 *
 * Channel subdirectories are invisible to the default scan because that scan
 * only accepts filenames ending in .xls/.xlsx, so nesting them under /excel/
 * costs the default master nothing.
 */

import { join } from 'node:path';

import {
    canonicalChannelCode,
    findChannelProductMaster,
} from '@/lib/product-master-channels';

export const DEFAULT_EXCEL_DIR = join(process.cwd(), 'excel');

const CHANNEL_EXCEL_ROOT = join(DEFAULT_EXCEL_DIR, 'channels');

/**
 * Filesystem-safe slug for a channel code. Returns null for anything that
 * isn't a plain channel code, which is what keeps a crafted `?channel=`
 * value from walking out of /excel/ — the slug is built from an allow-list
 * of characters rather than by stripping bad ones.
 */
export function channelDirSlug(channelCode: string | null | undefined): string | null {
    const slug = String(channelCode ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug ? slug : null;
}

/**
 * Directory a channel's master is written to, or null when the code is
 * empty/unusable — meaning "use the default master".
 *
 * Always the channel's current code, even when asked under one it has since
 * been renamed from, so a rename can never split one master across two
 * directories.
 */
export function channelExcelDir(channelCode: string | null | undefined): string | null {
    const slug = channelDirSlug(canonicalChannelCode(channelCode));
    return slug ? join(CHANNEL_EXCEL_ROOT, slug) : null;
}

/**
 * Every directory a channel's master could be sitting in, current code first.
 *
 * Reads go through this rather than through `channelExcelDir` alone: a server
 * that was uploaded to before the channel was renamed still holds that file
 * under the old slug, and falling back to the shared Tamil master there would
 * silently drop the local names off a whole region's bills. The next upload
 * writes to the current directory and the old one stops being consulted.
 */
export function channelExcelDirs(channelCode: string | null | undefined): string[] {
    const current = channelExcelDir(channelCode);
    if (!current) return [];
    const legacy = (findChannelProductMaster(channelCode)?.legacyCodes ?? [])
        .map((old) => channelDirSlug(old))
        .filter((slug): slug is string => Boolean(slug))
        .map((slug) => join(CHANNEL_EXCEL_ROOT, slug))
        .filter((dir) => dir !== current);
    return [current, ...legacy];
}
