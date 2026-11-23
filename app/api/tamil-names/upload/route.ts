/**
 * POST /api/tamil-names/upload
 *
 * Accepts an Excel master file (.xls/.xlsx) from the admin upload UI.
 *
 * A `channel` field scopes the upload to one channel's master (Idukki sells a
 * different catalogue, so it keeps its own Excel under /excel/channels/<slug>/).
 * Omit it and the shared default master in /excel/ is the one replaced. Every
 * step below — the diff, the delete, the write — stays inside the resolved
 * directory, so uploading Idukki's file never touches the default one.
 *
 * Two modes:
 *   - mode=preview  → parse, validate columns, compare with current file,
 *                     return diff stats (added/changed/unchanged/removed).
 *                     Does NOT write anything to disk.
 *   - mode=confirm  → run the same validation + preview, AND save the file
 *                     to that channel's directory, replacing whatever was
 *                     there. The /api/tamil-names cache auto-invalidates on
 *                     next read because the file mtime changed.
 *
 * Required Excel columns (validated before save):
 *   SKU, Product Name, Group Name, Weight, <local name>,
 *   Price, Quantity, Category, OrdNo
 *
 * <local name> is the channel's own column: "Malayalam Name" for Idukki,
 * "Tamil Name" for the shared master. Requiring it here is what keeps a
 * channel from being handed a file its bill prints can't read.
 */

import { NextResponse } from 'next/server';
import { writeFile, readFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

import {
    DEFAULT_LOCAL_NAME,
    findChannelProductMaster,
    localNameForChannel,
    type LocalNameColumn,
} from '@/lib/product-master-channels';
import { channelExcelDir, channelExcelDirs, DEFAULT_EXCEL_DIR } from '@/lib/product-master-dirs';

/** Columns every master needs, whatever language it is in. */
const BASE_COLUMNS = [
    'SKU',
    'Product Name',
    'Group Name',
    'Weight',
    'Price',
    'Quantity',
    'Category',
    'OrdNo',
];

/** Full required list, with the local-name column in the position the admin
 *  screen's hint shows it. */
function requiredColumns(localName: LocalNameColumn): string[] {
    return [...BASE_COLUMNS.slice(0, 4), localName.column, ...BASE_COLUMNS.slice(4)];
}

// ─── Helpers ─────────────────────────────────────────────────────────

// Every column (except SKU, which is the row key) is compared when deciding
// whether a product changed.
function compareFields(localName: LocalNameColumn): string[] {
    return requiredColumns(localName).filter((c) => c !== 'SKU');
}

/**
 * Cell text, with the literal export artefact "NULL" read as blank.
 *
 * The Idukki master arrives with "NULL" written into Group Name on rows the
 * source system had nothing for. It is a non-empty string, so every
 * `groupName || tamilName || englishName` fallback in the reports picks it and
 * prints the word NULL as a purchase-list heading. Blanking it here lets the
 * fallback do its job.
 */
const NULL_TEXT = /^(null|n\/a|#n\/a|undefined)$/i;

function cell(value: unknown): string {
    const text = String(value ?? '').trim();
    return NULL_TEXT.test(text) ? '' : text;
}

/** The header this sheet spells the local-name column with, or null. */
function localHeader(
    present: Set<string>,
    localName: LocalNameColumn,
): string | null {
    return localName.aliases.find((a) => present.has(a)) ?? null;
}

interface ParsedRow {
    sku: string;
    productName: string;
    /** Value of the channel's local-name column. */
    localName: string;
    // label -> trimmed string value, for every compared column
    fields: Record<string, string>;
}

interface FieldDiff {
    field: string;
    old: string;
    new: string;
}

/** A SKU that appears on more than one row. The last row wins when the sheet
 *  is indexed, so every earlier product under that SKU is dropped from the
 *  catalogue without a word — worth showing before a file is saved. */
interface DuplicateSku {
    sku: string;
    count: number;
    /** English names of the colliding rows, in sheet order. */
    productNames: string[];
}

interface ParseResult {
    ok: boolean;
    missing?: string[];
    bySku?: Record<string, ParsedRow>;
    rowCount?: number;
    /** Rows dropped because the SKU cell was blank (usually trailing rows). */
    skippedBlankSku?: number;
    /** Rows dropped because BOTH the local-name and the Tamil cell were blank.
     *  Such a row carries no name any report could print, so it is no use to
     *  anyone. */
    skippedNoName?: number;
    /** Rows kept on their Tamil name alone, with the local-name cell blank.
     *  The purchase and packing lists read these fine; only the bill print's
     *  local-name line comes up empty — so this is a warning, not a reason to
     *  refuse a file whose local column is still being filled in. */
    missingLocalName?: number;
    /** Rows whose Group Name said "NULL" — counted so the export can be fixed
     *  at source even though `cell()` now reads it as blank. */
    nullGroupNames?: number;
    duplicateSkus?: DuplicateSku[];
}

function parseSheet(
    rows: Record<string, unknown>[],
    localName: LocalNameColumn,
): ParseResult {
    const required = requiredColumns(localName);
    if (rows.length === 0) {
        return { ok: false, missing: required };
    }
    // Validate ALL required columns are present in the header row. The local
    // name may be spelled any of its aliases; the rest are exact.
    const present = new Set(Object.keys(rows[0]));
    const header = localHeader(present, localName);
    const missing = required.filter(
        (c) => (c === localName.column ? header === null : !present.has(c)),
    );
    if (missing.length > 0) {
        return { ok: false, missing };
    }
    const compared = compareFields(localName);
    // A master carrying a separate Tamil column keeps its rows on that name
    // alone while the local column is still being translated — the purchase
    // and packing lists print from Tamil, so those rows are useful today.
    // Where the local column IS the Tamil one, they are the same header.
    const tamilFallbackHeader =
        localName.column === DEFAULT_LOCAL_NAME.column
            ? header
            : (DEFAULT_LOCAL_NAME.aliases.find((a) => present.has(a)) ?? null);

    const bySku: Record<string, ParsedRow> = {};
    // Why rows were dropped or flagged, kept apart so the caller can tell
    // "column not translated yet" from "no name at all" instead of just
    // reporting zero products.
    let skippedBlankSku = 0;
    let skippedNoName = 0;
    let missingLocalName = 0;
    let nullGroupNames = 0;
    // Names seen per SKU, so a collision can be named rather than counted.
    const namesPerSku = new Map<string, string[]>();
    for (const row of rows) {
        const sku = cell(row['SKU']);
        const local = cell(row[header!]);
        const tamil = tamilFallbackHeader ? cell(row[tamilFallbackHeader]) : '';
        const productName = cell(row['Product Name']);
        if (!sku) {
            skippedBlankSku++;
            continue;
        }
        if (!local && !tamil) {
            skippedNoName++;
            continue;
        }
        if (!local) missingLocalName++;
        if (NULL_TEXT.test(String(row['Group Name'] ?? '').trim())) nullGroupNames++;
        const fields: Record<string, string> = {};
        for (const col of compared) {
            const key = col === localName.column ? header! : col;
            fields[col] = cell(row[key]);
        }
        const seen = namesPerSku.get(sku);
        if (seen) seen.push(productName);
        else namesPerSku.set(sku, [productName]);
        // Last row wins — recorded in duplicateSkus below so the loss is visible.
        bySku[sku] = { sku, productName, localName: local, fields };
    }
    const duplicateSkus: DuplicateSku[] = [];
    for (const [sku, productNames] of namesPerSku) {
        if (productNames.length > 1) {
            duplicateSkus.push({ sku, count: productNames.length, productNames });
        }
    }
    return {
        ok: true,
        bySku,
        rowCount: rows.length,
        skippedBlankSku,
        skippedNoName,
        missingLocalName,
        nullGroupNames,
        duplicateSkus,
    };
}

async function readCurrentExcel(
    dir: string,
    localName: LocalNameColumn,
): Promise<Record<string, ParsedRow> | null> {
    try {
        const files = await readdir(dir);
        const candidate = files.find((f) => /\.xlsx?$/i.test(f));
        if (!candidate) return null;
        const buf = await readFile(join(dir, candidate));
        const wb = XLSX.read(buf, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
        const parsed = parseSheet(rows, localName);
        return parsed.ok ? (parsed.bySku ?? {}) : null;
    } catch {
        return null;
    }
}

interface PreviewBody {
    rowCount: number;
    totalSkus: number;
    /** False when the target directory holds no readable master yet. Then
     *  there is nothing to diff against, so every row lands in `added` and
     *  `changed` is structurally 0 — which reads as "no changes" unless the
     *  screen is told to say otherwise. */
    hasCurrent: boolean;
    added: number;
    changed: number;
    unchanged: number;
    removed: number;
    addedSamples: ParsedRow[];
    changedSamples: Array<{
        sku: string;
        productName: string;
        oldName: string;
        newName: string;
        changes: FieldDiff[];
    }>;
    removedSamples: ParsedRow[];
}

function buildPreview(
    newBySku: Record<string, ParsedRow>,
    rowCount: number,
    oldBySku: Record<string, ParsedRow> | null,
    localName: LocalNameColumn,
): PreviewBody {
    const newSkus = Object.keys(newBySku);
    const oldSkus = oldBySku ? Object.keys(oldBySku) : [];
    const oldSet = new Set(oldSkus);
    const newSet = new Set(newSkus);

    const added: ParsedRow[] = [];
    const changed: Array<{
        sku: string;
        productName: string;
        oldName: string;
        newName: string;
        changes: FieldDiff[];
    }> = [];
    let unchanged = 0;
    const removed: ParsedRow[] = [];
    const compared = compareFields(localName);

    for (const sku of newSkus) {
        if (!oldSet.has(sku)) {
            added.push(newBySku[sku]);
        } else {
            const oldRow = oldBySku![sku];
            const newRow = newBySku[sku];
            // Compare every tracked column, not just the local name.
            const diffs: FieldDiff[] = [];
            for (const col of compared) {
                const o = oldRow.fields[col] ?? '';
                const n = newRow.fields[col] ?? '';
                if (o !== n) diffs.push({ field: col, old: o, new: n });
            }
            if (diffs.length === 0) {
                unchanged++;
            } else {
                changed.push({
                    sku,
                    productName: newRow.productName,
                    oldName: oldRow.localName,
                    newName: newRow.localName,
                    changes: diffs,
                });
            }
        }
    }
    for (const sku of oldSkus) {
        if (!newSet.has(sku) && oldBySku) removed.push(oldBySku[sku]);
    }

    return {
        rowCount,
        totalSkus: newSkus.length,
        hasCurrent: oldBySku !== null,
        added: added.length,
        changed: changed.length,
        unchanged,
        removed: removed.length,
        addedSamples: added.slice(0, 10),
        changedSamples: changed.slice(0, 10),
        removedSamples: removed.slice(0, 10),
    };
}

// ─── POST handler ────────────────────────────────────────────────────

export async function POST(req: Request) {
    let formData: FormData;
    try {
        formData = await req.formData();
    } catch {
        return NextResponse.json({ error: 'Could not read form data' }, { status: 400 });
    }

    const file = formData.get('file');
    const mode = String(formData.get('mode') ?? 'preview');
    // No channel → the shared default master, which is exactly what the
    // original single-master upload page posts. A named channel must be one
    // that actually keeps its own master: an unrecognised code is rejected
    // rather than silently given a directory no report will ever read.
    const requestedChannel = String(formData.get('channel') ?? '').trim();
    const channel = requestedChannel ? findChannelProductMaster(requestedChannel) : null;
    const channelCode = channel?.code ?? '';
    const targetDir = channelExcelDir(channelCode) ?? DEFAULT_EXCEL_DIR;
    // Idukki's bills print Malayalam, so Idukki's master is validated against
    // "Malayalam Name"; every other master against "Tamil Name".
    const localName = localNameForChannel(channelCode);

    if (requestedChannel && !channel) {
        return NextResponse.json(
            { error: `No separate product master is set up for the channel "${requestedChannel}"` },
            { status: 400 },
        );
    }
    if (!(file instanceof File)) {
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (!/\.xlsx?$/i.test(file.name)) {
        return NextResponse.json(
            { error: 'File must be .xls or .xlsx' },
            { status: 400 },
        );
    }
    if (!['preview', 'confirm'].includes(mode)) {
        return NextResponse.json(
            { error: 'Invalid mode (use preview or confirm)' },
            { status: 400 },
        );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let workbook: XLSX.WorkBook;
    try {
        workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
        return NextResponse.json({ error: 'Could not read file as Excel' }, { status: 400 });
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
        return NextResponse.json({ error: 'Excel has no sheets' }, { status: 400 });
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
    const parsed = parseSheet(rows, localName);

    if (!parsed.ok) {
        return NextResponse.json(
            {
                error: 'Excel is missing required columns',
                missing: parsed.missing,
                required: requiredColumns(localName),
                localNameLabel: localName.label,
            },
            { status: 400 },
        );
    }

    // A header on its own proves nothing: a sheet can carry the column and
    // leave every cell in it blank, which validates cleanly and then yields
    // zero products. Refused here with the reason rather than reported as "0"
    // — but only when the row carries no name at all. A file whose local
    // column is still being translated is still worth saving: the purchase
    // and packing lists print from Tamil and start working immediately.
    const usable = Object.keys(parsed.bySku!).length;
    if (usable === 0) {
        const noName = parsed.skippedNoName ?? 0;
        const reason = noName > 0
            ? `${noName} row${noName === 1 ? ' has' : 's have'} neither a ${localName.label.toLowerCase()} nor a ${DEFAULT_LOCAL_NAME.label.toLowerCase()} — both name columns are empty`
            : 'every row has a blank SKU';
        return NextResponse.json(
            {
                error: `No usable products in this file: ${reason}.`,
                rowCount: parsed.rowCount,
                skippedBlankSku: parsed.skippedBlankSku,
                skippedNoName: parsed.skippedNoName,
                localNameLabel: localName.label,
            },
            { status: 400 },
        );
    }

    // Diffed against this channel's own current master, never the default —
    // the first Idukki upload should read as "all new", not as a rewrite of
    // the shared catalogue.
    // Read current-code first, then any directory the channel used under an
    // earlier code, so the first upload after a rename still diffs against the
    // master that is actually in service instead of reporting every row as new.
    let oldBySku: Record<string, ParsedRow> | null = null;
    for (const dir of channelCode ? channelExcelDirs(channelCode) : [targetDir]) {
        oldBySku = await readCurrentExcel(dir, localName);
        if (oldBySku) break;
    }
    const preview = buildPreview(parsed.bySku!, parsed.rowCount!, oldBySku, localName);
    // Row-level facts the diff can't express: what the sheet dropped on the
    // way in, and which SKUs collided so only the last row survived.
    const intake = {
        skippedBlankSku: parsed.skippedBlankSku ?? 0,
        skippedNoName: parsed.skippedNoName ?? 0,
        missingLocalName: parsed.missingLocalName ?? 0,
        nullGroupNames: parsed.nullGroupNames ?? 0,
        duplicateSkus: (parsed.duplicateSkus ?? []).slice(0, 20),
        duplicateSkuCount: (parsed.duplicateSkus ?? []).length,
    };

    if (mode === 'preview') {
        return NextResponse.json({
            ok: true,
            saved: false,
            channelCode,
            localNameLabel: localName.label,
            ...preview,
            ...intake,
        });
    }

    // mode === 'confirm' → write to the channel's directory, replacing any
    // existing file there.
    try {
        await mkdir(targetDir, { recursive: true });
        const existing = await readdir(targetDir);
        for (const f of existing) {
            if (/\.xlsx?$/i.test(f)) {
                await unlink(join(targetDir, f)).catch(() => {});
            }
        }
        const targetPath = join(targetDir, file.name);
        await writeFile(targetPath, buffer);
        return NextResponse.json({
            ok: true,
            saved: true,
            file: file.name,
            channelCode,
            localNameLabel: localName.label,
            ...preview,
            ...intake,
        });
    } catch (err) {
        return NextResponse.json(
            {
                error: `Failed to save Excel: ${err instanceof Error ? err.message : String(err)}`,
            },
            { status: 500 },
        );
    }
}
