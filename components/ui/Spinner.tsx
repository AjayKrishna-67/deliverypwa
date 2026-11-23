/**
 * Reusable spinner component.
 */

interface SpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-5 h-5 border-2',
    lg: 'w-8 h-8 border-3',
};

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
    const isLg = size === 'lg';
    return (
        <span
            className={`
                inline-block rounded-full animate-spin
                ${isLg
                    ? 'border-[rgba(99,102,241,0.2)] border-t-[var(--accent)]'
                    // currentColor: white on an accent button, ink on the page —
                    // whichever the surrounding text is, in either theme.
                    : 'border-current/30 border-t-current'
                }
                ${sizeClasses[size]}
                ${className}
            `}
            role="status"
            aria-label="Loading"
        />
    );
}
