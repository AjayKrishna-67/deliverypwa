/**
 * Server-side API route that reads the master Excel from /excel/ and returns
 * a SKU → local-name lookup as JSON.
 *
 * The admin just replaces the Excel file (via git push, SFTP, etc.). The
 * server re-parses on next request whenever the file's mtime changes —
 * no build step, no JSON commit, no developer involvement.
 *
 * Masters are per-channel. The shared/default master lives directly in
 * /excel/; a channel that sells a different catalogue (Idukki) gets its own
 * master under /excel/channels/<slug>/. `?channel=<code>` picks the channel
 * master and falls back to the default one when that channel has never had a
 * file uploaded — so reports keep printing instead of going blank.
 *
 * Which column carries the local name is per-channel too: Idukki bills print
 * from "Malayalam Name", everyone else from "Tamil Name" (see
 * lib/product-master-channels). When a channel falls back to the shared
 * master, so does the column — that file is the Tamil catalogue, and half a
 * loaf beats a bill with no local names on it at all.
 *
 * The xlsx library runs server-side only here, so it never bloats the
 * client bundle.
 */

import { NextResponse } from 'next/server';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

import {
    DEFAULT_LOCAL_NAME,
    localNameForChannel,
    type LocalNameColumn,
} from '@/lib/product-master-channels';
import { channelExcelDirs, DEFAULT_EXCEL_DIR } from '@/lib/product-master-dirs';

/** Full product info from the Excel master, keyed by SKU. */
interface ProductInfo {
    sku: string;
    /** Tamil name for the purchase and packing lists. Falls back to the
     *  channel's own column when the file carries no Tamil column at all,
     *  so a Malayalam-only Idukki master doesn't blank those reports. */
    tamilName: string;
    productName: string;
    /** Weight per unit. Kg for weight-priced items; 1 for quantity-priced items
     *  like juices/dairy/MRP. The purchase-list report uses weight × ordered_qty
     *  uniformly for both kinds. */
    weight: number;
    category: string;
    groupName: string;
    /** OrdNo from the Excel — used by the Purchase List to order categories
     *  the way the kitchen team prefers (vegetables first, then fruits, etc.).
     *  Lower values come first; missing/invalid → very large fallback. */
    ordNo: number;
}

/** One parsed Excel. Says nothing about who asked for it — the same file
 *  answers several channels, so the requesting channel is stamped on the
 *  response rather than baked into the cached parse. */
interface ParsedMaster {
    /** The name bill prints put under the English one, read from the column
     *  this master was parsed for — strictly that column, so an Idukki bill
     *  shows Malayalam or nothing, never a leftover Tamil name. */
    bySku: Record<string, string>;
    byProductName: Record<string, string>;
    /** Full product info per SKU — used by the Purchase List report. */
    productsBySku: Record<string, ProductInfo>;
    /** Same info indexed by normalized English product name (fallback when SKU
     *  isn't available on the bill row). */
    productsByName: Record<string, ProductInfo>;
    source: string;
    rowCount: number;
}

interface CacheEntry {
    mtimeMs: number;
    master: ParsedMaster;
}

// Module-level cache — survives across requests in the same Node process.
// Keyed by file path + the column it was parsed for, validated by mtime, so
// replacing any channel's Excel invalidates only that channel's entry.
const cache = new Map<string, CacheEntry>();

function normalizeProductName(s: string): string {
    return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Cell text, with the literal export artefact "NULL" read as blank.
 *
 * The Idukki master arrives with "NULL" written into Group Name on rows the
 * source system had nothing for. It is a non-empty string, so the reports'
 * `groupName || tamilName || englishName` fallback picks it and prints the
 * word NULL as a purchase-list heading. Blanking it here lets the fallback
 * reach the real name instead.
 */
const NULL_TEXT = /^(null|n\/a|#n\/a|undefined)$/i;

function cell(value: unknown): string {
    const text = String(value ?? '').trim();
    return NULL_TEXT.test(text) ? '' : text;
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
    for (const k of keys) {
        if (row[k] !== undefined && cell(row[k]) !== '') return row[k];
    }
    return undefined;
}

const SKU_KEYS = ['SKU', 'sku', 'Sku', 'SKU_CODE', 'sku_code'];
const NAME_KEYS = ['Product Name', 'ProductName', 'product_name', 'Name'];

/** True when the sheet's header row carries any spelling of `aliases`. */
function hasColumn(headers: Set<string>, aliases: string[]): boolean {
    return aliases.some((h) => headers.has(h));
}

/** How many rows actually carry a value in that column. */
function countFilled(rows: Record<string, unknown>[], aliases: string[]): number {
    let n = 0;
    for (const row of rows) {
        if (cell(pick(row, aliases)) !== '') n++;
    }
    return n;
}

/**
 * Pick the Excel file in `dir` that carries local names.
 *
 * A file qualifies on `localName`'s column or, failing that, on the Tamil
 * one — a channel whose master hasn't been re-exported with its own column
 * yet still resolves here, rather than silently falling through to the shared
 * catalogue. Files are ranked by rows in the wanted column first, so once the
 * right file is uploaded it wins outright.
 */
async function findMasterExcel(
    dir: string,
    localName: LocalNameColumn,
): Promise<string | null> {
    let files: string[];
    try {
        files = await readdir(dir);
    } catch {
        return null;
    }
    const candidates = files.filter((f) => /\.xlsx?$/i.test(f));
    if (candidates.length === 0) return null;

    let best: { path: string; wanted: number; tamil: number } | null = null;
    for (const f of candidates) {
        const path = join(dir, f);
        try {
            const buf = await readFile(path);
            const wb = XLSX.read(buf, { type: 'buffer' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            if (!sheet) continue;
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
            if (rows.length === 0) continue;
            const headers = new Set(Object.keys(rows[0]));
            const hasWanted = hasColumn(headers, localName.aliases);
            const hasTamil = hasColumn(headers, DEFAULT_LOCAL_NAME.aliases);
            if (!hasWanted && !hasTamil) continue;
            const wanted = hasWanted ? countFilled(rows, localName.aliases) : 0;
            const tamil = hasTamil ? countFilled(rows, DEFAULT_LOCAL_NAME.aliases) : 0;
            if (wanted === 0 && tamil === 0) continue;
            if (!best || wanted > best.wanted || (wanted === best.wanted && tamil > best.tamil)) {
                best = { path, wanted, tamil };
            }
        } catch {
            // Unreadable file — skip and continue looking.
        }
    }
    return best?.path ?? null;
}

async function parseExcel(
    filePath: string,
    localName: LocalNameColumn,
): Promise<ParsedMaster> {
    const buffer = await readFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];

    // Purchase and packing lists print Tamil names. When the file has no Tamil
    // column at all they read the local one instead, so replacing Idukki's
    // Tamil column with a Malayalam one changes the bill print (as asked) and
    // leaves those two reports filled in rather than blank.
    const headers = new Set(Object.keys(rows[0] ?? {}));
    const tamilKeys = hasColumn(headers, DEFAULT_LOCAL_NAME.aliases)
        ? DEFAULT_LOCAL_NAME.aliases
        : localName.aliases;

    const bySku: Record<string, string> = {};
    const byProductName: Record<string, string> = {};
    const productsBySku: Record<string, ProductInfo> = {};
    const productsByName: Record<string, ProductInfo> = {};

    for (const row of rows) {
        const sku = pick(row, SKU_KEYS);
        const local = pick(row, localName.aliases);
        const tamil = pick(row, tamilKeys);
        const productName = pick(row, NAME_KEYS);
        if (sku == null) continue;
        const skuStr = cell(sku);
        const localStr = cell(local);
        const tamilStr = cell(tamil);
        if (!skuStr || (!localStr && !tamilStr)) continue;

        const productNameStr = cell(productName);
        const nameKey = productNameStr ? normalizeProductName(productNameStr) : '';

        // The bill-print lookup only ever holds the requested column.
        if (localStr) {
            bySku[skuStr] = localStr;
            if (nameKey) byProductName[nameKey] = localStr;
        }

        if (!tamilStr) continue;
        const weightRaw = row['Weight'] ?? row['weight'] ?? 0;
        const weight = typeof weightRaw === 'number'
            ? weightRaw
            : (parseFloat(String(weightRaw)) || 0);
        const ordNoRaw = row['OrdNo'] ?? row['OrdNumber'] ?? row['ordNo'] ?? row['Order No'] ?? '';
        const ordNoParsed = typeof ordNoRaw === 'number'
            ? ordNoRaw
            : parseInt(String(ordNoRaw), 10);
        const ordNo = Number.isFinite(ordNoParsed) ? ordNoParsed : Number.MAX_SAFE_INTEGER;
        const info: ProductInfo = {
            sku: skuStr,
            tamilName: tamilStr,
            productName: productNameStr,
            weight,
            category: cell(row['Category']),
            groupName: cell(row['Group Name']),
            ordNo,
        };
        productsBySku[skuStr] = info;
        if (nameKey) productsByName[nameKey] = info;
    }

    return {
        bySku,
        byProductName,
        productsBySku,
        productsByName,
        source: filePath.split('/').pop() ?? '',
        rowCount: rows.length,
    };
}

export async function GET(req: Request) {
    const channelCode = (new URL(req.url).searchParams.get('channel') ?? '').trim();
    const channelLocalName = localNameForChannel(channelCode);

    // A channel with its own master wins; without one it shares the default
    // master, so a channel nobody has uploaded for still prints real names.
    // Directories are tried current-code first, then any the channel used
    // before it was renamed — a rename must not blank a region's bills.
    let scope: 'channel' | 'default' = 'default';
    let filePath: string | null = null;
    for (const dir of channelExcelDirs(channelCode)) {
        filePath = await findMasterExcel(dir, channelLocalName);
        if (filePath) break;
    }
    if (filePath) {
        scope = 'channel';
    } else {
        filePath = await findMasterExcel(DEFAULT_EXCEL_DIR, DEFAULT_LOCAL_NAME);
    }

    // The shared master is the Tamil catalogue, so a channel borrowing it
    // borrows its language too.
    const localName = scope === 'channel' ? channelLocalName : DEFAULT_LOCAL_NAME;
    const meta = {
        channelCode,
        scope,
        localNameColumn: localName.column,
        localNameLabel: localName.label,
        localNameScript: localName.script,
    };

    if (!filePath) {
        return NextResponse.json(
            {
                bySku: {},
                byProductName: {},
                productsBySku: {},
                productsByName: {},
                ...meta,
                error: `No Excel file with a "${localName.column}" column found in ${DEFAULT_EXCEL_DIR}. Upload the master via the admin Product Names page (any other .xls in that folder is ignored).`,
            },
            { status: 200 },
        );
    }

    const stats = await stat(filePath);

    // Cache hit: same file, same column, same mtime → reuse the parse
    const cacheKey = `${filePath}|${localName.column}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
        return NextResponse.json({ ...cached.master, ...meta }, {
            headers: { 'Cache-Control': 'public, max-age=60' },
        });
    }

    // Cache miss: parse and store
    try {
        const master = await parseExcel(filePath, localName);
        cache.set(cacheKey, { mtimeMs: stats.mtimeMs, master });
        return NextResponse.json({ ...master, ...meta }, {
            headers: { 'Cache-Control': 'public, max-age=60' },
        });
    } catch (err) {
        return NextResponse.json(
            {
                bySku: {},
                byProductName: {},
                productsBySku: {},
                productsByName: {},
                ...meta,
                error: `Failed to parse Excel: ${err instanceof Error ? err.message : String(err)}`,
            },
            { status: 500 },
        );
    }
}
