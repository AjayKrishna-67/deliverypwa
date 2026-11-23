'use client';

import { createPortal } from 'react-dom';

/**
 * Renders children at document.body to escape table/stacking-context constraints.
 * Safe in Next.js because this component is only rendered inside 'use client'
 * components that are never server-rendered (guarded by auth checks).
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
    if (typeof document === 'undefined') return null;
    // data-no-ptr: a drag inside a modal must never pull-to-refresh the page
    return createPortal(<div data-no-ptr className="contents">{children}</div>, document.body);
}
