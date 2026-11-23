'use client';

/**
 * Admin → Update Product Names
 * Upload a new Excel master, see what would change, then confirm to save.
 * Replaces the old file with the new one. The bill-print API auto-detects the
 * change via mtime and serves fresh names on the next print, no restart needed.
 *
 * `?channel=<code>` scopes the whole screen to one channel's master — Idukki
 * sells a different catalogue, so its Excel is uploaded, diffed and stored
 * separately from the shared one. No parameter means the shared master, which
 * is what every other channel reads.
 *
 * The Suspense boundary is here because the channel is read from the URL with
 * useSearchParams, and Next requires a boundary above any component that does.
 */

import { Suspense, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useAuth } from '@/providers/AuthProvider';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { Spinner } from '@/components/ui/Spinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { findChannelProductMaster, localNameForChannel } from '@/lib/product-master-channels';

interface PreviewSample {
    sku: string;
    productName: string;
    /** Value of this master's local-name column — Malayalam for Idukki,
     *  Tamil for the shared one. */
    localName?: string;
    oldName?: string;
    newName?: string;
    changes?: FieldDiff[];
}

interface FieldDiff {
    field: string;
    old: string;
    new: string;
}

interface PreviewResponse {
    ok: boolean;
    saved: boolean;
    rowCount: number;
    totalSkus: number;
    /** False when no master is saved for this channel yet — nothing to diff
     *  against, so every row is "new" and "changed" can only ever be 0. */
    hasCurrent?: boolean;
    added: number;
    changed: number;
    unchanged: number;
    removed: number;
    addedSamples: PreviewSample[];
    changedSamples: PreviewSample[];
    removedSamples: PreviewSample[];
    file?: string;
    error?: string;
    missing?: string[];
    required?: string[];
    /** How the server named this master's local-name column. */
    localNameLabel?: string;
    /** Rows the sheet dropped on the way in — a blank SKU cell, or no name at
     *  all in either name column. Both leave the product out of the catalogue. */
    skippedBlankSku?: number;
    skippedNoName?: number;
    /** Kept on their Tamil name alone, with the local-name cell still blank —
     *  reports work, only the bill print's local line is empty. */
    missingLocalName?: number;
    /** Rows whose Group Name said the literal text "NULL". */
    nullGroupNames?: number;
    /** SKUs carried by more than one row. Only the last row survives. */
    duplicateSkus?: DuplicateSku[];
    duplicateSkuCount?: number;
}

interface DuplicateSku {
    sku: string;
    count: number;
    productNames: string[];
}

export default function TamilNamesAdminPage() {
    return (
        <Suspense fallback={<LoadingScreen />}>
            <TamilNamesAdminScreen />
        </Suspense>
    );
}

function TamilNamesAdminScreen() {
    const { isLoading, isAuthenticated } = useRequireAuth();
    const requestedChannel = (useSearchParams().get('channel') ?? '').trim();

    if (isLoading) return <LoadingScreen />;
    if (!isAuthenticated) return null;

    // An unknown code is refused rather than quietly redirected to the shared
    // master — silently rewriting every channel's catalogue is the one mistake
    // this screen must not make.
    const channel = findChannelProductMaster(requestedChannel);
    if (requestedChannel && !channel) {
        return (
            <DashboardLayout>
                {() => (
                    <main className="flex-1 flex items-center justify-center px-6">
                        <p className="text-[var(--text-muted)] text-[0.875rem] text-center">
                            No separate product master is set up for the channel{' '}
                            <span className="text-[var(--foreground)]">{requestedChannel}</span>.
                        </p>
                    </main>
                )}
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            {() => <TamilNamesAdminContent channelCode={channel?.code ?? ''} channelLabel={channel?.label ?? ''} />}
        </DashboardLayout>
    );
}

function TamilNamesAdminContent({
    channelCode,
    channelLabel,
}: {
    /** '' = the shared master every other channel reads. */
    channelCode: string;
    channelLabel: string;
}) {
    const router = useRouter();
    const { permissions } = useAuth();
    // Idukki's master is Malayalam; every other one is Tamil.
    const localName = localNameForChannel(channelCode);
    const allowed =
        permissions.includes('ManageProductTamilNames') ||
        permissions.includes('ViewBusinessReports') ||
        permissions.includes('SuperAdmin');

    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<PreviewResponse | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!allowed) {
        return (
            <main className="flex-1 flex items-center justify-center">
                <p className="text-[var(--text-muted)] text-[0.875rem]">
                    You don&apos;t have permission to manage product Tamil names.
                </p>
            </main>
        );
    }

    async function uploadFile(targetFile: File, mode: 'preview' | 'confirm'): Promise<PreviewResponse> {
        const fd = new FormData();
        fd.append('file', targetFile);
        fd.append('mode', mode);
        fd.append('channel', channelCode);
        const res = await fetch('/api/tamil-names/upload', { method: 'POST', body: fd });
        const data: PreviewResponse = await res.json();
        if (!res.ok) {
            const detail = data.missing
                ? ` (missing columns: ${data.missing.join(', ')})`
                : data.rowCount
                  ? ` (${data.rowCount} rows read, none usable)`
                  : '';
            throw new Error(data.error + detail);
        }
        return data;
    }

    async function handleFileSelected(f: File) {
        setError('');
        setSuccess('');
        setPreview(null);
        setFile(f);
        setLoadingPreview(true);
        try {
            const res = await uploadFile(f, 'preview');
            setPreview(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to preview file');
        } finally {
            setLoadingPreview(false);
        }
    }

    async function handleConfirm() {
        if (!file) return;
        setError('');
        setConfirming(true);
        try {
            const res = await uploadFile(file, 'confirm');
            setSuccess(
                channelLabel
                    ? `Saved ${res.file ?? file.name}. ${channelLabel} reports will now use these product names; other channels are unchanged.`
                    : `Saved ${res.file ?? file.name}. Bill prints will now use the new ${localName.label.toLowerCase()}s.`,
            );
            setPreview(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save file');
        } finally {
            setConfirming(false);
        }
    }

    function handleReset() {
        setFile(null);
        setPreview(null);
        setError('');
        setSuccess('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    function onDragOver(e: React.DragEvent) {
        e.preventDefault();
        setDragActive(true);
    }
    function onDragLeave(e: React.DragEvent) {
        e.preventDefault();
        setDragActive(false);
    }
    function onDrop(e: React.DragEvent) {
        e.preventDefault();
        setDragActive(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) handleFileSelected(dropped);
    }

    return (
        <main className="flex-1 flex flex-col overflow-hidden">
            {/* ── Header bar ── */}
            <div
                className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3"
                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
            >
                <button
                    onClick={() => router.push('/reports')}
                    className="text-[0.75rem] text-[var(--accent)] cursor-pointer hover:underline mr-1"
                >
                    ← Reports
                </button>
                <h1 className="text-[1rem] font-semibold text-[var(--foreground)]">
                    Update Product Names
                </h1>
                {/* The channel is stated in the header, not just in the URL — this
                    screen overwrites a catalogue, so which one must be unmissable. */}
                <span
                    className="px-2 py-0.5 rounded-md text-[0.6875rem] font-semibold"
                    style={
                        channelLabel
                            ? { background: 'rgba(236,72,153,0.16)', border: '1px solid rgba(236,72,153,0.4)', color: 'var(--tone-pink)' }
                            : { background: 'rgb(var(--overlay-rgb)/0.05)', border: '1px solid rgb(var(--overlay-rgb)/0.12)', color: 'var(--text-muted)' }
                    }
                >
                    {channelLabel || 'All other channels'}
                </span>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-auto px-4 sm:px-6 py-6">
                <div className="max-w-3xl mx-auto">
                    <p className="text-[0.8125rem] text-[var(--text-muted)] mb-4 leading-relaxed">
                        Upload your latest Excel master file. The system will compare with the
                        current file, show you what will change, and let you confirm before
                        saving. <span className="text-[var(--foreground)]">You only need to
                        upload when product details have changed</span> — bill prints work
                        from the saved file until the next upload.
                    </p>

                    <p className="text-[0.8125rem] text-[var(--text-muted)] mb-4 leading-relaxed">
                        {channelLabel ? (
                            <>
                                This file is used <span className="text-[var(--foreground)]">only for
                                the {channelLabel} channel</span> — its Invoice, Purchase List, Whole
                                Vegetable and Cut Vegetable reports. Every other channel keeps its own
                                master and is untouched by this upload.
                            </>
                        ) : (
                            <>
                                This is the <span className="text-[var(--foreground)]">shared master</span>,
                                used by every channel that doesn&apos;t have one of its own. Channels with
                                a separate catalogue are updated from their own button on the Reports
                                screen.
                            </>
                        )}
                    </p>

                    {/* ── Required columns hint ── */}
                    <div
                        className="rounded-lg px-3 py-2 mb-4 text-[0.6875rem]"
                        style={{
                            background: 'rgb(var(--overlay-rgb)/0.03)',
                            border: '1px solid rgb(var(--overlay-rgb)/0.08)',
                            color: 'var(--text-muted)',
                        }}
                    >
                        <b className="text-[var(--foreground)]">Required columns:</b> SKU, Product
                        Name, Group Name, Weight,{' '}
                        <span className="text-[var(--foreground)]">{localName.column}</span>, Price,
                        Quantity, Category, OrdNo
                    </div>

                    {/* ── Drop zone ── */}
                    <div
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-xl px-6 py-10 text-center cursor-pointer transition-all"
                        style={{
                            background: dragActive
                                ? 'rgba(99,102,241,0.10)'
                                : 'rgb(var(--overlay-rgb)/0.02)',
                            border: `2px dashed ${dragActive ? 'var(--tone-indigo)' : 'rgb(var(--overlay-rgb)/0.15)'}`,
                        }}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xls,.xlsx"
                            onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
                            className="hidden"
                        />
                        <p className="text-[0.875rem] text-[var(--foreground)] font-medium">
                            {file ? file.name : 'Click or drag an Excel file here'}
                        </p>
                        <p className="text-[0.75rem] text-[var(--text-muted)] mt-1">
                            {file
                                ? `${(file.size / 1024).toFixed(1)} KB`
                                : 'Accepts .xls or .xlsx'}
                        </p>
                    </div>

                    {/* ── Loading / errors / success ── */}
                    {loadingPreview && (
                        <div className="flex items-center justify-center py-6">
                            <Spinner />
                            <span className="ml-3 text-[0.8125rem] text-[var(--text-muted)]">
                                Validating Excel...
                            </span>
                        </div>
                    )}

                    {error && (
                        <div
                            className="px-3 py-2 rounded-lg mt-4"
                            style={{
                                background: 'rgba(239,68,68,0.08)',
                                border: '1px solid rgba(239,68,68,0.22)',
                            }}
                        >
                            <p className="text-[0.8125rem] text-red-400">{error}</p>
                        </div>
                    )}

                    {success && (
                        <div
                            className="px-3 py-3 rounded-lg mt-4"
                            style={{
                                background: 'rgba(74,222,128,0.08)',
                                border: '1px solid rgba(74,222,128,0.22)',
                            }}
                        >
                            <p className="text-[0.8125rem] text-green-400 font-semibold">
                                ✓ {success}
                            </p>
                            <button
                                onClick={handleReset}
                                className="mt-2 text-[0.75rem] underline cursor-pointer"
                                style={{ color: 'var(--tone-green)' }}
                            >
                                Upload another file
                            </button>
                        </div>
                    )}

                    {/* ── Preview ── */}
                    {preview && !success && (
                        <div className="mt-6">
                            <h2 className="text-[0.9375rem] font-semibold text-[var(--foreground)] mb-3">
                                Preview of changes
                            </h2>

                            {/* Without a saved master there is nothing to diff against, so
                                every row is counted as new and "Changed" can only be 0.
                                Say that outright — a bare 0 reads as "your edits were
                                ignored", which is what sent this bug in. */}
                            {preview.hasCurrent === false && (
                                <div
                                    className="px-3 py-3 rounded-lg mb-4"
                                    style={{
                                        background: 'rgba(251,191,36,0.08)',
                                        border: '1px solid rgba(251,191,36,0.28)',
                                    }}
                                >
                                    <p className="text-[0.8125rem] text-[var(--tone-amber)] font-semibold">
                                        No {channelLabel ? `${channelLabel} ` : ''}master is saved yet
                                    </p>
                                    <p className="text-[0.75rem] text-[var(--text-muted)] mt-1 leading-relaxed">
                                        There is no previous file to compare against, so all{' '}
                                        {preview.totalSkus} products are listed as new and{' '}
                                        <span className="text-[var(--foreground)]">Changed shows 0
                                        even if you edited values</span>. Confirm below to save this
                                        file as the baseline — your next upload will show real
                                        changes.
                                        {channelLabel
                                            ? ` Until then, ${channelLabel} reports fall back to the shared master.`
                                            : ''}
                                    </p>
                                </div>
                            )}

                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
                                <StatCard label="Total Products" value={preview.totalSkus} color="var(--tone-indigo)" />
                                <StatCard label="New" value={preview.added} color="var(--tone-green)" />
                                <StatCard label="Changed" value={preview.changed} color="var(--tone-amber)" />
                                <StatCard label="Unchanged" value={preview.unchanged} color="var(--tone-slate)" />
                                <StatCard label="Removed" value={preview.removed} color="var(--tone-red)" />
                            </div>

                            {preview.changed > 0 && (
                                <SamplesTable
                                    title={`Changed products (showing first ${preview.changedSamples.length})`}
                                    columns={['SKU', 'Product', 'Changed fields']}
                                    rows={preview.changedSamples.map((s) => [
                                        s.sku,
                                        s.productName,
                                        (s.changes ?? [])
                                            .map(
                                                (c) =>
                                                    `${c.field}: "${c.old}" → "${c.new}"`,
                                            )
                                            .join('\n'),
                                    ])}
                                />
                            )}
                            {/* Row-level losses the four counters can't show. A sheet
                                that drops rows on the way in still reports a tidy
                                total, so the drops are stated outright. */}
                            {(preview.missingLocalName ?? 0) > 0 && (
                                <div
                                    className="px-3 py-2 rounded-lg mb-4 text-[0.75rem] leading-relaxed"
                                    style={{
                                        background: 'rgba(251,191,36,0.06)',
                                        border: '1px solid rgba(251,191,36,0.22)',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    <b className="text-[var(--tone-amber)]">
                                        {preview.missingLocalName} product
                                        {preview.missingLocalName === 1 ? '' : 's'} have no{' '}
                                        {localName.label.toLowerCase()}
                                    </b>{' '}
                                    — they are saved and the Purchase List, Whole Vegetable and Cut
                                    Vegetable reports will print their Tamil names, but bill prints
                                    will show no {localName.label.toLowerCase()} line until the
                                    column is filled in.
                                </div>
                            )}

                            {(preview.skippedNoName ?? 0) > 0 && (
                                <div
                                    className="px-3 py-2 rounded-lg mb-4 text-[0.75rem] leading-relaxed"
                                    style={{
                                        background: 'rgba(248,113,113,0.06)',
                                        border: '1px solid rgba(248,113,113,0.22)',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    <b className="text-[var(--tone-red)]">
                                        {preview.skippedNoName} row
                                        {preview.skippedNoName === 1 ? '' : 's'} skipped
                                    </b>{' '}
                                    — no name in either name column, so no report could print them.
                                </div>
                            )}

                            {(preview.nullGroupNames ?? 0) > 0 && (
                                <div
                                    className="px-3 py-2 rounded-lg mb-4 text-[0.75rem] leading-relaxed"
                                    style={{
                                        background: 'rgba(251,191,36,0.06)',
                                        border: '1px solid rgba(251,191,36,0.22)',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    <b className="text-[var(--tone-amber)]">
                                        {preview.nullGroupNames} row
                                        {preview.nullGroupNames === 1 ? '' : 's'} have Group Name set
                                        to the text &ldquo;NULL&rdquo;
                                    </b>{' '}
                                    — read as blank, so those products fall back to their Tamil name
                                    on the Purchase List instead of printing NULL. Worth fixing in
                                    the export so they group correctly.
                                </div>
                            )}

                            {(preview.duplicateSkuCount ?? 0) > 0 && (
                                <SamplesTable
                                    title={`Duplicate SKUs — only the last row of each is kept (${preview.duplicateSkuCount} in this file)`}
                                    columns={['SKU', 'Rows', 'Products sharing it (last one wins)']}
                                    rows={(preview.duplicateSkus ?? []).map((d) => [
                                        d.sku,
                                        String(d.count),
                                        d.productNames.join('\n'),
                                    ])}
                                />
                            )}

                            {preview.added > 0 && (
                                <SamplesTable
                                    title={`New products (showing first ${preview.addedSamples.length})`}
                                    columns={['SKU', 'Product', localName.label]}
                                    rows={preview.addedSamples.map((s) => [
                                        s.sku,
                                        s.productName,
                                        s.localName ?? '',
                                    ])}
                                />
                            )}
                            {preview.removed > 0 && (
                                <SamplesTable
                                    title={`Will be removed (showing first ${preview.removedSamples.length})`}
                                    columns={['SKU', 'Product', localName.label]}
                                    rows={preview.removedSamples.map((s) => [
                                        s.sku,
                                        s.productName,
                                        s.localName ?? '',
                                    ])}
                                />
                            )}

                            {preview.added === 0 && preview.changed === 0 && preview.removed === 0 && (
                                <p
                                    className="px-3 py-3 rounded-lg text-[0.8125rem] text-[var(--text-muted)]"
                                    style={{
                                        background: 'rgb(var(--overlay-rgb)/0.02)',
                                        border: '1px solid rgb(var(--overlay-rgb)/0.06)',
                                    }}
                                >
                                    No changes — this file is identical to the current one.
                                </p>
                            )}

                            <div className="flex flex-wrap gap-3 mt-6">
                                <button
                                    onClick={handleConfirm}
                                    disabled={confirming || (preview.added === 0 && preview.changed === 0 && preview.removed === 0)}
                                    className="px-4 py-2 rounded-lg text-[0.8125rem] font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{
                                        background: 'rgba(74,222,128,0.18)',
                                        border: '1px solid rgba(74,222,128,0.4)',
                                        color: 'var(--tone-green)',
                                    }}
                                >
                                    {confirming ? 'Saving...' : 'Confirm and Save'}
                                </button>
                                <button
                                    onClick={handleReset}
                                    className="px-4 py-2 rounded-lg text-[0.8125rem] font-semibold cursor-pointer transition-all"
                                    style={{
                                        background: 'rgb(var(--overlay-rgb)/0.04)',
                                        border: '1px solid rgb(var(--overlay-rgb)/0.12)',
                                        color: 'var(--foreground)',
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div
            className="rounded-xl px-3 py-3 flex flex-col gap-1"
            style={{
                background: `color-mix(in srgb, ${color} 6%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
            }}
        >
            <span
                className="text-[0.625rem] font-semibold uppercase tracking-widest"
                style={{ color: `color-mix(in srgb, ${color} 70%, var(--foreground))` }}
            >
                {label}
            </span>
            <span className="text-[1.25rem] font-bold tabular-nums" style={{ color }}>
                {value}
            </span>
        </div>
    );
}

function SamplesTable({
    title,
    columns,
    rows,
}: {
    title: string;
    columns: string[];
    rows: string[][];
}) {
    return (
        <div className="mb-4">
            <h3 className="text-[0.75rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">
                {title}
            </h3>
            <div
                className="rounded-lg overflow-hidden"
                style={{ border: '1px solid rgb(var(--overlay-rgb)/0.06)' }}
            >
                <table className="w-full border-collapse">
                    <thead>
                        <tr
                            style={{
                                background: 'rgb(var(--overlay-rgb)/0.02)',
                                borderBottom: '1px solid rgb(var(--overlay-rgb)/0.06)',
                            }}
                        >
                            {columns.map((c) => (
                                <th
                                    key={c}
                                    className="px-3 py-2 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]"
                                >
                                    {c}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, idx) => (
                            <tr
                                key={idx}
                                style={{ borderBottom: '1px solid rgb(var(--overlay-rgb)/0.04)' }}
                            >
                                {row.map((cell, j) => (
                                    <td
                                        key={j}
                                        className="px-3 py-2 text-[0.75rem] text-[var(--foreground)] whitespace-pre-line align-top"
                                    >
                                        {cell}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
