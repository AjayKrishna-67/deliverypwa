/**
 * Shared map-marker visual: the top-view rider (scooter) badge.
 * Same artwork as the delivery map's driver marker, parameterized so the
 * fleet map can tint it per driver state.
 */

/**
 * White circular badge with a top-view scooter and a direction beak.
 * `accent` colors the beak + scooter deck (state color on the fleet map).
 */
export function createRiderBadge(accent: string, size = 40): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `width:${size}px;height:${size}px;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.4));`;
    el.innerHTML =
        `<svg width="${size}" height="${size}" viewBox="0 0 44 44">` +
        // direction beak (peeks out above the badge)
        `<path d="M22 0 L28.5 9 L15.5 9 Z" fill="${accent}"/>` +
        // white badge
        '<circle cx="22" cy="23" r="19" fill="#fff" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>' +
        // scooter, top view, pointing up: front wheel · handlebar · deck · helmet · rear wheel
        '<rect x="19.5" y="9.5" width="5" height="8" rx="2.5" fill="#263043"/>' +
        '<rect x="13" y="16.5" width="18" height="3.2" rx="1.6" fill="#263043"/>' +
        `<rect x="16.5" y="18" width="11" height="15" rx="5" fill="${accent}" stroke="#fff" stroke-width="1.5"/>` +
        '<circle cx="22" cy="26.5" r="4.6" fill="#22c55e" stroke="#fff" stroke-width="1.5"/>' +
        '<rect x="19.5" y="33.5" width="5" height="6.5" rx="2.5" fill="#263043"/>' +
        '</svg>';
    return el;
}
