/**
 * Full-screen loading screen with logo and spinner.
 */

import Image from 'next/image';
import { Spinner } from './Spinner';

export function LoadingScreen() {
    return (
        <div className="flex items-center justify-center min-h-dvh flex-col gap-4">
            <Image
                src="/kaaikanilogo.png"
                alt="Kaaikani"
                width={56}
                height={56}
                priority
                unoptimized
                style={{ borderRadius: '0.75rem' }}
            />
            <Spinner size="lg" />
        </div>
    );
}
