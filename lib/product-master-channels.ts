/**
 * Channels that keep their own product master Excel.
 *
 * Most channels share one catalogue, so one Excel in /excel/ answers for all
 * of them. Idukki does not: it sells different products, in a different
 * language, so its bill prints, purchase list and packing lists have to read a
 * separate file. Listing a channel here gives it its own upload button on the
 * Reports screen and its own directory under /excel/channels/.
 *
 * Adding a second such channel later is one entry — nothing else needs to
 * change, because reports always ask the API for the channel they are showing
 * and the API falls back to the shared master when there is no channel file.
 */

/**
 * The column a master carries its local-language product names in, and how
 * that language is printed.
 *
 * The shared master is Tamil. Idukki sells in Kerala, so its bills print
 * Malayalam instead — a different Excel column, a different font stack. Both
 * are "the local name" as far as every report is concerned, which is why the
 * column is configuration rather than a second code path.
 */
export interface LocalNameColumn {
    /** Exact Excel header a master for this language must carry. */
    column: string;
    /** Header spellings accepted when reading a file (the exact column first). */
    aliases: string[];
    /** How the column is named in headings, buttons and validation errors. */
    label: string;
    /** Picks the print font stack — see the `.tamil` / `.malayalam` rules in
     *  the report print stylesheets. */
    script: 'tamil' | 'malayalam';
}

/** What every channel without its own master reads. */
export const DEFAULT_LOCAL_NAME: LocalNameColumn = {
    column: 'Tamil Name',
    aliases: ['Tamil Name', 'TamilName', 'tamil_name', 'Tamil', 'tamilname'],
    label: 'Tamil Name',
    script: 'tamil',
};

const MALAYALAM_NAME: LocalNameColumn = {
    column: 'Malayalam Name',
    aliases: [
        'Malayalam Name',
        'MalayalamName',
        'malayalam_name',
        'Malayalam',
        'malayalamname',
    ],
    label: 'Malayalam Name',
    script: 'malayalam',
};

export interface ChannelProductMaster {
    /** Vendure channel code, exactly as it appears on currentUser.channels. */
    code: string;
    /** Codes this channel has traded under before. A rename in Vendure would
     *  otherwise cut the channel off from its own master — reports would
     *  quietly fall back to the shared Tamil catalogue — and would strand the
     *  Excel already uploaded under the old code's directory. Matched on
     *  lookup; never used when writing. */
    legacyCodes?: string[];
    /** The channel's API token. Recorded so the mapping can be verified by eye
     *  against the channel switcher; the lookups below go by code. */
    token: string;
    /** How the channel is named in button labels and headings. */
    label: string;
    /** Which column its bills print product names from. */
    localName: LocalNameColumn;
}

export const CHANNEL_PRODUCT_MASTERS: ChannelProductMaster[] = [
    {
        code: 'Idukki',
        legacyCodes: ['Kochi'],
        token: 'ind-kochi',
        label: 'Idukki',
        localName: MALAYALAM_NAME,
    },
];

/** The dedicated master for a channel code, or null when it shares the
 *  default one. Case-insensitive — channel codes are typed by hand in Vendure. */
export function findChannelProductMaster(
    channelCode: string | null | undefined,
): ChannelProductMaster | null {
    const code = String(channelCode ?? '').trim().toLowerCase();
    if (!code) return null;
    return (
        CHANNEL_PRODUCT_MASTERS.find(
            (c) =>
                c.code.toLowerCase() === code ||
                (c.legacyCodes ?? []).some((old) => old.toLowerCase() === code),
        ) ?? null
    );
}

/**
 * The code a channel is filed under today, given any code it has ever used.
 *
 * Everything written to disk goes under this, so a channel renamed in Vendure
 * keeps one master rather than acquiring a second empty one.
 */
export function canonicalChannelCode(
    channelCode: string | null | undefined,
): string {
    const code = String(channelCode ?? '').trim();
    return findChannelProductMaster(code)?.code ?? code;
}

/** The language column a channel's reports print from — Malayalam for Idukki,
 *  Tamil for everyone else. */
export function localNameForChannel(
    channelCode: string | null | undefined,
): LocalNameColumn {
    return findChannelProductMaster(channelCode)?.localName ?? DEFAULT_LOCAL_NAME;
}
