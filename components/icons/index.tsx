/**
 * Shared SVG icon components.
 * Extracted from repeated inline SVGs across OrderRow, OrderCard, FulfillModal, etc.
 */

interface IconProps {
    width?: number;
    height?: number;
    className?: string;
}

export function SearchIcon({ width = 14, height = 14, className }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
    );
}

export function CloseIcon({ width = 14, height = 14, className }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

export function CheckIcon({ width = 12, height = 12, className }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

export function SpinnerIcon({ width = 12, height = 12, className = 'animate-spin' }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
    );
}

export function TruckIcon({ width = 12, height = 12, className }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 3h15v13H1z" /><path d="M16 8h4l3 4v5h-7V8z" />
            <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
    );
}

export function ArrowIcon({ width = 12, height = 12, className }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
    );
}

export function GridIcon({ width = 13, height = 13, className }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
    );
}

export function DragIcon({ width = 12, height = 12, className }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 12 12" fill="currentColor">
            <circle cx="3.5" cy="3" r="1" />
            <circle cx="8.5" cy="3" r="1" />
            <circle cx="3.5" cy="6" r="1" />
            <circle cx="8.5" cy="6" r="1" />
            <circle cx="3.5" cy="9" r="1" />
            <circle cx="8.5" cy="9" r="1" />
        </svg>
    );
}
