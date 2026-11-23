'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { CloseIcon } from '@/components/icons';

// ─── Filter definitions ─────────────────────────────────────────────

export type FilterType = 'string' | 'number' | 'date' | 'boolean' | 'id' | 'state';

export interface FilterDef {
    key: string;
    label: string;
    type: FilterType;
}

/** Available filters — mirrors Vendure admin order filter list */
export const FILTER_DEFS: FilterDef[] = [
    { key: 'id', label: 'ID', type: 'id' },
    { key: 'createdAt', label: 'Created at', type: 'date' },
    { key: 'updatedAt', label: 'Updated at', type: 'date' },
    { key: 'orderPlacedAt', label: 'Placed at', type: 'date' },
    { key: 'state', label: 'State', type: 'state' },
    { key: 'totalWithTax', label: 'Total', type: 'number' },
    { key: 'totalQuantity', label: 'Total quantity', type: 'number' },
    { key: 'customerLastName', label: 'Last name', type: 'string' },
    { key: 'transactionId', label: 'Transaction ID', type: 'string' },
    { key: 'platform', label: 'Platform', type: 'string' },
    { key: 'deviceMedium', label: 'Device Medium', type: 'string' },
    { key: 'invoiceNo', label: 'Invoice No', type: 'number' },
    { key: 'code', label: 'Code', type: 'string' },
];

// Operator options per filter type
const STRING_OPERATORS = [
    { value: 'eq', label: 'equals' },
    { value: 'notEq', label: 'not equals' },
    { value: 'contains', label: 'contains' },
    { value: 'notContains', label: 'not contains' },
];

const NUMBER_OPERATORS = [
    { value: 'eq', label: 'equals' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'less or equal' },
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'greater or equal' },
    { value: 'between', label: 'between' },
];

const ID_OPERATORS = [
    { value: 'eq', label: 'equals' },
    { value: 'notEq', label: 'not equals' },
];

const STATE_OPTIONS = [
    'PaymentAuthorized',
    'PaymentSettled',
    'Shipped',
    'PartiallyShipped',
    'OutforDelivery',
    'Delivered',
    'CancellationRequested',
    'Cancelled',
];

// ─── Date presets ───────────────────────────────────────────────────

interface DatePreset {
    value: string;
    label: string;
}

const DATE_PRESETS: DatePreset[] = [
    { value: 'last_day', label: 'Last day' },
    { value: 'last_week', label: 'Last week' },
    { value: 'last_month', label: 'Last month' },
    { value: 'last_year', label: 'Last year' },
    { value: 'custom', label: 'Custom range' },
];

/** Resolve a date preset to { start, end } ISO strings */
function resolveDatePreset(preset: string): { start: string; end: string } {
    const now = new Date();
    const end = now.toISOString();
    const start = new Date(now);
    switch (preset) {
        case 'last_day':
            start.setDate(start.getDate() - 1);
            break;
        case 'last_week':
            start.setDate(start.getDate() - 7);
            break;
        case 'last_month':
            start.setMonth(start.getMonth() - 1);
            break;
        case 'last_year':
            start.setFullYear(start.getFullYear() - 1);
            break;
        default:
            start.setDate(start.getDate() - 1);
    }
    return { start: start.toISOString(), end };
}

// ─── Types ──────────────────────────────────────────────────────────

export interface ActiveFilter {
    key: string;
    operator: string;
    value: string;
    value2?: string;  // for "between" / custom date end
}

/** Convert active filters to Vendure GraphQL filter object */
export function buildFilterParam(filters: ActiveFilter[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const f of filters) {
        const def = FILTER_DEFS.find((d) => d.key === f.key);
        if (!def || !f.value) continue;
        if (def.type === 'state') {
            if (f.operator === 'in') {
                const values = f.value.split(',').map((v) => v.trim()).filter(Boolean);
                result[f.key] = { in: values };
            } else {
                result[f.key] = { [f.operator]: f.value };
            }
        } else if (def.type === 'date') {
            // Date presets are stored as operator='between', value=preset or datetime-local
            if (f.operator === 'between') {
                const isPreset = DATE_PRESETS.some((p) => p.value === f.value && p.value !== 'custom');
                if (isPreset) {
                    const { start, end } = resolveDatePreset(f.value);
                    result[f.key] = { between: { start, end } };
                } else if (f.value2) {
                    // Custom range: value/value2 are datetime-local strings (YYYY-MM-DDTHH:mm)
                    const startISO = new Date(f.value).toISOString();
                    const endISO = new Date(f.value2).toISOString();
                    result[f.key] = { between: { start: startISO, end: endISO } };
                }
            } else {
                result[f.key] = { [f.operator]: new Date(f.value).toISOString() };
            }
        } else if (def.type === 'number') {
            if (f.operator === 'between' && f.value2) {
                result[f.key] = { between: { start: Number(f.value), end: Number(f.value2) } };
            } else {
                result[f.key] = { [f.operator]: Number(f.value) };
            }
        } else if (def.type === 'id') {
            result[f.key] = { [f.operator]: f.value };
        } else {
            result[f.key] = { [f.operator]: f.value };
        }
    }
    return result;
}

// ─── Helpers ────────────────────────────────────────────────────────

function getOperators(type: FilterType) {
    switch (type) {
        case 'string': return STRING_OPERATORS;
        case 'number': return NUMBER_OPERATORS;
        case 'date': return []; // date uses presets, not operators
        case 'id': return ID_OPERATORS;
        case 'boolean': return [{ value: 'eq', label: 'equals' }];
        case 'state': return [
            { value: 'eq', label: 'equals' },
            { value: 'notEq', label: 'not equals' },
            { value: 'in', label: 'is any of' },
        ];
    }
}

function getDefaultOperator(type: FilterType): string {
    switch (type) {
        case 'string': return 'contains';
        case 'number': return 'eq';
        case 'date': return 'between';
        case 'id': return 'eq';
        case 'boolean': return 'eq';
        case 'state': return 'in';
    }
}

// ─── Filter Chip ────────────────────────────────────────────────────

function FilterChip({ filter, onRemove }: { filter: ActiveFilter; onRemove: () => void }) {
    const def = FILTER_DEFS.find((d) => d.key === filter.key);
    const label = def?.label ?? filter.key;

    let displayValue: string;
    if (def?.type === 'date') {
        const preset = DATE_PRESETS.find((p) => p.value === filter.value);
        if (preset && preset.value !== 'custom') {
            displayValue = preset.label;
        } else if (filter.value2) {
            // Format datetime-local (YYYY-MM-DDTHH:mm) to readable
            const fmt = (v: string) => {
                const d = new Date(v);
                return isNaN(d.getTime()) ? v : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
            };
            displayValue = `${fmt(filter.value)} to ${fmt(filter.value2)}`;
        } else {
            displayValue = filter.value;
        }
    } else {
        const opLabel = getOperators(def?.type ?? 'string').find((o) => o.value === filter.operator)?.label ?? filter.operator;
        displayValue = filter.operator === 'between' && filter.value2
            ? `${opLabel} ${filter.value} - ${filter.value2}`
            : `${opLabel} ${filter.value}`;
    }

    return (
        <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold"
            style={{
                background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.35)',
                color: 'var(--tone-indigo)',
            }}
        >
            {label}: {displayValue}
            <button
                onClick={onRemove}
                className="ml-0.5 hover:opacity-70 transition-opacity cursor-pointer"
            >
                <CloseIcon width={8} height={8} />
            </button>
        </span>
    );
}

// ─── Add Filter Dropdown ────────────────────────────────────────────

function FilterSelector({ onSelect, existingKeys }: { onSelect: (key: string) => void; existingKeys: Set<string> }) {
    const available = FILTER_DEFS.filter((d) => !existingKeys.has(d.key));
    return (
        <div
            className="absolute top-full left-0 mt-1 z-50 min-w-[200px] max-h-[320px] overflow-y-auto rounded-lg shadow-2xl"
            style={{ background: 'var(--surface)', border: '1px solid rgb(var(--overlay-rgb)/0.12)' }}
        >
            <div className="px-3 py-2 text-[0.625rem] font-bold uppercase tracking-widest text-[var(--text-muted)] border-b"
                style={{ borderColor: 'rgb(var(--overlay-rgb)/0.1)' }}>
                Filter by:
            </div>
            {available.length === 0 ? (
                <div className="px-3 py-2 text-[0.75rem] text-[var(--text-muted)]">All filters applied</div>
            ) : (
                available.map((def) => (
                    <button
                        key={def.key}
                        onClick={() => onSelect(def.key)}
                        className="w-full text-left px-3 py-2 text-[0.8125rem] text-[var(--foreground)] hover:bg-overlay/10 transition-colors cursor-pointer"
                    >
                        {def.label}
                    </button>
                ))
            )}
        </div>
    );
}

// ─── Date Filter Editor ─────────────────────────────────────────────

function DateFilterEditor({
    filterDef,
    onApply,
    onCancel,
}: {
    filterDef: FilterDef;
    onApply: (operator: string, value: string, value2?: string) => void;
    onCancel: () => void;
}) {
    const [selected, setSelected] = useState<string | null>(null);
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const isCustom = selected === 'custom';

    function handlePresetClick(preset: string) {
        if (preset === 'custom') {
            setSelected('custom');
        } else {
            onApply('between', preset);
        }
    }

    function handleCustomApply() {
        if (!customFrom || !customTo) return;
        onApply('between', customFrom, customTo);
    }

    return (
        <div
            className="absolute top-full left-0 mt-1 z-50 min-w-[280px] rounded-lg shadow-2xl"
            style={{ background: 'var(--surface)', border: '1px solid rgb(var(--overlay-rgb)/0.12)' }}
        >
            <div className="px-3 py-2 text-[0.75rem] font-semibold text-[var(--foreground)] border-b"
                style={{ borderColor: 'rgb(var(--overlay-rgb)/0.1)' }}>
                {filterDef.label}
            </div>

            {/* Preset buttons */}
            <div className="p-2 flex flex-col gap-0.5">
                {DATE_PRESETS.map((preset) => (
                    <button
                        key={preset.value}
                        onClick={() => handlePresetClick(preset.value)}
                        className="w-full text-left px-3 py-2 rounded-md text-[0.8125rem] transition-colors cursor-pointer"
                        style={selected === preset.value ? {
                            background: 'rgba(99,102,241,0.2)',
                            color: 'var(--tone-indigo-soft)',
                        } : {
                            color: 'var(--foreground)',
                        }}
                        onMouseEnter={(e) => {
                            if (selected !== preset.value) (e.target as HTMLElement).style.background = 'rgb(var(--overlay-rgb)/0.06)';
                        }}
                        onMouseLeave={(e) => {
                            if (selected !== preset.value) (e.target as HTMLElement).style.background = '';
                        }}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>

            {/* Custom date+time range inputs */}
            {isCustom && (
                <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: 'rgb(var(--overlay-rgb)/0.1)' }}>
                    <div className="flex flex-col gap-2 mb-2">
                        <div>
                            <label className="text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">From</label>
                            <input
                                type="datetime-local"
                                value={customFrom}
                                onChange={(e) => setCustomFrom(e.target.value)}
                                className="w-full px-2 py-1.5 rounded-md bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.75rem] outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">To</label>
                            <input
                                type="datetime-local"
                                value={customTo}
                                onChange={(e) => setCustomTo(e.target.value)}
                                className="w-full px-2 py-1.5 rounded-md bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.75rem] outline-none"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <button
                            onClick={onCancel}
                            className="px-3 py-1 rounded-md text-[0.6875rem] text-[var(--text-muted)] hover:text-[var(--foreground)] cursor-pointer transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleCustomApply}
                            disabled={!customFrom || !customTo}
                            className="px-3 py-1 rounded-md text-[0.6875rem] font-semibold cursor-pointer transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            style={{
                                background: 'rgba(99,102,241,0.2)',
                                border: '1px solid rgba(99,102,241,0.4)',
                                color: 'var(--tone-indigo-soft)',
                            }}
                        >
                            Apply
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Generic Filter Editor (non-date) ───────────────────────────────

function FilterEditor({
    filterDef,
    onApply,
    onCancel,
}: {
    filterDef: FilterDef;
    onApply: (operator: string, value: string, value2?: string) => void;
    onCancel: () => void;
}) {
    const [operator, setOperator] = useState(getDefaultOperator(filterDef.type));
    const [value, setValue] = useState('');
    const [value2, setValue2] = useState('');
    const [stateSelections, setStateSelections] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleApply = useCallback(() => {
        if (filterDef.type === 'state' && operator === 'in') {
            if (stateSelections.length === 0) return;
            onApply(operator, stateSelections.join(','));
        } else {
            if (!value) return;
            onApply(operator, value, operator === 'between' ? value2 : undefined);
        }
    }, [filterDef.type, operator, value, value2, stateSelections, onApply]);

    const operators = getOperators(filterDef.type);
    const isBetween = operator === 'between';
    const isStateIn = filterDef.type === 'state' && operator === 'in';
    const inputType = filterDef.type === 'number' ? 'number' : 'text';

    return (
        <div
            className="absolute top-full left-0 mt-1 z-50 min-w-[300px] rounded-lg shadow-2xl p-3"
            style={{ background: 'var(--surface)', border: '1px solid rgb(var(--overlay-rgb)/0.12)' }}
        >
            <div className="text-[0.75rem] font-semibold text-[var(--foreground)] mb-2">
                {filterDef.label}
            </div>
            <select
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                className="w-full px-2 py-1.5 mb-2 rounded-md bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.75rem] outline-none cursor-pointer"
            >
                {operators.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                ))}
            </select>
            {filterDef.type === 'state' && operator === 'eq' ? (
                <select
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="w-full px-2 py-1.5 mb-2 rounded-md bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.75rem] outline-none cursor-pointer"
                >
                    <option value="">Select state...</option>
                    {STATE_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
            ) : isStateIn ? (
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {STATE_OPTIONS.map((s) => {
                        const selected = stateSelections.includes(s);
                        return (
                            <button
                                key={s}
                                type="button"
                                onClick={() => setStateSelections((prev) =>
                                    selected ? prev.filter((v) => v !== s) : [...prev, s]
                                )}
                                className="px-2 py-1 rounded-md text-[0.6875rem] font-medium cursor-pointer transition-all"
                                style={selected ? {
                                    background: 'rgba(99,102,241,0.2)',
                                    border: '1px solid rgba(99,102,241,0.5)',
                                    color: 'var(--tone-indigo-soft)',
                                } : {
                                    background: 'rgb(var(--overlay-rgb)/0.04)',
                                    border: '1px solid rgb(var(--overlay-rgb)/0.1)',
                                    color: 'var(--text-muted)',
                                }}
                            >
                                {s}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <>
                    <input
                        ref={inputRef}
                        type={inputType}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
                        placeholder="Value..."
                        className="w-full px-2 py-1.5 mb-2 rounded-md bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.75rem] outline-none"
                    />
                    {isBetween && (
                        <input
                            type={inputType}
                            value={value2}
                            onChange={(e) => setValue2(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleApply()}
                            placeholder="End value..."
                            className="w-full px-2 py-1.5 mb-2 rounded-md bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.75rem] outline-none"
                        />
                    )}
                </>
            )}
            <div className="flex gap-2 justify-end">
                <button
                    onClick={onCancel}
                    className="px-3 py-1 rounded-md text-[0.6875rem] text-[var(--text-muted)] hover:text-[var(--foreground)] cursor-pointer transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={handleApply}
                    className="px-3 py-1 rounded-md text-[0.6875rem] font-semibold cursor-pointer transition-all"
                    style={{
                        background: 'rgba(99,102,241,0.2)',
                        border: '1px solid rgba(99,102,241,0.4)',
                        color: 'var(--tone-indigo-soft)',
                    }}
                >
                    Apply
                </button>
            </div>
        </div>
    );
}

// ─── Main FilterPanel ───────────────────────────────────────────────

interface FilterPanelProps {
    filters: ActiveFilter[];
    onChange: (filters: ActiveFilter[]) => void;
}

export function FilterPanel({ filters, onChange }: FilterPanelProps) {
    const [showSelector, setShowSelector] = useState(false);
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setShowSelector(false);
                setEditingKey(null);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const existingKeys = new Set(filters.map((f) => f.key));

    function handleSelectFilter(key: string) {
        setShowSelector(false);
        setEditingKey(key);
    }

    function handleApplyFilter(operator: string, value: string, value2?: string) {
        if (!editingKey) return;
        const newFilter: ActiveFilter = { key: editingKey, operator, value, value2 };
        onChange([...filters.filter((f) => f.key !== editingKey), newFilter]);
        setEditingKey(null);
    }

    function handleRemoveFilter(key: string) {
        onChange(filters.filter((f) => f.key !== key));
    }

    const editingDef = editingKey ? FILTER_DEFS.find((d) => d.key === editingKey) : null;
    const isDateEditor = editingDef?.type === 'date';

    return (
        <div className="flex items-center gap-2 flex-wrap">
            {filters.map((f) => (
                <FilterChip key={f.key} filter={f} onRemove={() => handleRemoveFilter(f.key)} />
            ))}
            <div ref={panelRef} className="relative">
                <button
                    onClick={() => { setShowSelector(!showSelector); setEditingKey(null); }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap"
                    style={{
                        background: showSelector || editingKey ? 'rgba(99,102,241,0.15)' : 'rgb(var(--overlay-rgb)/0.04)',
                        border: showSelector || editingKey ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgb(var(--overlay-rgb)/0.08)',
                        color: showSelector || editingKey ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                >
                    + Add filter
                    {filters.length > 0 && (
                        <span className="text-[0.5625rem] opacity-60">F</span>
                    )}
                </button>
                {showSelector && (
                    <FilterSelector onSelect={handleSelectFilter} existingKeys={existingKeys} />
                )}
                {editingDef && isDateEditor && (
                    <DateFilterEditor
                        filterDef={editingDef}
                        onApply={handleApplyFilter}
                        onCancel={() => setEditingKey(null)}
                    />
                )}
                {editingDef && !isDateEditor && (
                    <FilterEditor
                        filterDef={editingDef}
                        onApply={handleApplyFilter}
                        onCancel={() => setEditingKey(null)}
                    />
                )}
            </div>
            {filters.length > 0 && (
                <button
                    onClick={() => onChange([])}
                    className="text-[0.6875rem] text-[var(--text-muted)] hover:text-red-400 transition-colors cursor-pointer whitespace-nowrap"
                >
                    Clear filters
                </button>
            )}
        </div>
    );
}
