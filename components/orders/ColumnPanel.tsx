'use client';

import { useEffect, useRef } from 'react';
import { ALL_COLUMNS, type ColKey } from '@/lib/constants';
import { DragIcon } from '@/components/icons';

interface ColumnPanelProps {
    colOrder: ColKey[];
    colVisible: Set<ColKey>;
    onToggle: (key: ColKey) => void;
    onReorder: (newOrder: ColKey[]) => void;
    onReset: () => void;
    onClose: () => void;
}

export function ColumnPanel({ colOrder, colVisible, onToggle, onReorder, onReset, onClose }: ColumnPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const dragKey = useRef<ColKey | null>(null);

    // Close on outside click
    useEffect(() => {
        function handler(e: MouseEvent) {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    function handleDragStart(key: ColKey) {
        dragKey.current = key;
    }

    function handleDragOver(e: React.DragEvent, overKey: ColKey) {
        e.preventDefault();
        if (!dragKey.current || dragKey.current === overKey) return;
        const from = colOrder.indexOf(dragKey.current);
        const to = colOrder.indexOf(overKey);
        if (from === -1 || to === -1) return;
        const next = [...colOrder];
        next.splice(from, 1);
        next.splice(to, 0, dragKey.current);
        onReorder(next);
    }

    const labelOf = (key: ColKey) => ALL_COLUMNS.find((c) => c.key === key)?.label ?? key;

    return (
        <div
            ref={panelRef}
            className="absolute right-0 top-[calc(100%+6px)] z-50 rounded-xl py-2 min-w-[220px]"
            style={{
                background: 'var(--surface)',
                border: '1px solid rgb(var(--overlay-rgb)/0.12)',
                boxShadow: 'var(--shadow-popover)',
            }}
        >
            {/* Column rows */}
            <ul className="py-1">
                {colOrder.map((key) => (
                    <li
                        key={key}
                        draggable
                        onDragStart={() => handleDragStart(key)}
                        onDragOver={(e) => handleDragOver(e, key)}
                        onDragEnd={() => { dragKey.current = null; }}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-default select-none transition-colors duration-100 hover:bg-overlay/[0.04]"
                    >
                        {/* Drag handle */}
                        <span
                            className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] opacity-50 hover:opacity-100 shrink-0"
                            title="Drag to reorder"
                        >
                            <DragIcon />
                        </span>

                        {/* Checkbox */}
                        <input
                            type="checkbox"
                            checked={colVisible.has(key)}
                            onChange={() => onToggle(key)}
                            className="accent-[var(--accent)] w-3.5 h-3.5 cursor-pointer shrink-0"
                        />

                        {/* Label */}
                        <span className="text-[0.8125rem] text-[var(--foreground)]">
                            {labelOf(key)}
                        </span>
                    </li>
                ))}
            </ul>

            {/* Reset */}
            <div className="px-3 pt-2 border-t border-overlay/[0.08]">
                <button
                    onClick={onReset}
                    className="text-[0.75rem] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors duration-150 cursor-pointer"
                >
                    ↺ Reset columns
                </button>
            </div>
        </div>
    );
}
