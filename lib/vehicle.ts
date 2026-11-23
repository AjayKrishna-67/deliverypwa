/**
 * Route vehicle — which of Google's travel modes the delivery map plans
 * with. Riders are on two-wheelers by default (lanes and cut-throughs cars
 * can't use, so DRIVE over-estimates); a rider in a van switches to car on
 * the map once and the phone remembers it. Affects ONLY the drawn route,
 * its distance estimate and ETA — the credited ride km always comes from
 * the GPS trail, whatever mode is selected.
 */

export type Vehicle = 'TWO_WHEELER' | 'DRIVE';

const VEHICLE_KEY = 'route-vehicle';

export const DEFAULT_VEHICLE: Vehicle = 'TWO_WHEELER';

export function readVehicle(): Vehicle {
    try {
        return localStorage.getItem(VEHICLE_KEY) === 'DRIVE' ? 'DRIVE' : DEFAULT_VEHICLE;
    } catch {
        return DEFAULT_VEHICLE; // SSR / storage blocked
    }
}

export function saveVehicle(v: Vehicle): void {
    try {
        localStorage.setItem(VEHICLE_KEY, v);
    } catch { /* storage blocked — the choice just doesn't persist */ }
}

export const VEHICLE_LABEL: Record<Vehicle, { icon: string; name: string }> = {
    TWO_WHEELER: { icon: '🏍️', name: 'Bike' },
    DRIVE: { icon: '🚗', name: 'Car' },
};
