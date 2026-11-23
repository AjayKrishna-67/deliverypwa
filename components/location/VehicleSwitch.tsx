'use client';

/**
 * VehicleSwitch — header slider: 🏍️ Bike ⇄ 🚗 Car. Sets the vehicle the
 * delivery map plans routes for (Google's TWO_WHEELER vs DRIVE). Remembered
 * per phone; the map's own pill reads the same setting when it opens.
 *
 * Delivery persons only: rendered once location is granted, which admins
 * never reach (the provider keeps them at 'idle') — same rule the old
 * "GPS on" chip used, so this occupies exactly its place in the header.
 * Route vehicle changes the planned line and estimate only — never the
 * credited ride km, which comes from the GPS trail.
 */

import { useState } from 'react';
import { useDriverLocation } from '@/providers/DriverLocationProvider';
import { VEHICLE_LABEL, readVehicle, saveVehicle, type Vehicle } from '@/lib/vehicle';

export function VehicleSwitch() {
    const { status } = useDriverLocation();
    const [vehicle, setVehicle] = useState<Vehicle>(() => readVehicle());

    if (status !== 'granted') return null;

    const isCar = vehicle === 'DRIVE';
    const toggle = () => {
        const next: Vehicle = isCar ? 'TWO_WHEELER' : 'DRIVE';
        setVehicle(next);
        saveVehicle(next);
    };

    return (
        <button
            type="button"
            role="switch"
            aria-checked={isCar}
            aria-label={`Route vehicle: ${VEHICLE_LABEL[vehicle].name}. Tap to switch.`}
            title={`Routes planned for ${VEHICLE_LABEL[vehicle].name} — tap to switch`}
            onClick={toggle}
            className="flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-1 shrink-0 cursor-pointer select-none"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
        >
            {/* track + sliding knob */}
            <span
                className="relative inline-block w-9 h-5 rounded-full transition-colors"
                style={{ background: isCar ? 'rgba(99,102,241,0.55)' : 'rgba(34,197,94,0.45)' }}
                aria-hidden
            >
                <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white flex items-center justify-center text-[0.6rem] leading-none transition-transform"
                    style={{ transform: isCar ? 'translateX(18px)' : 'translateX(2px)' }}
                >
                    {VEHICLE_LABEL[vehicle].icon}
                </span>
            </span>
            <span className="text-[0.6875rem] font-semibold whitespace-nowrap text-[var(--foreground)]">
                {VEHICLE_LABEL[vehicle].name}
            </span>
        </button>
    );
}
