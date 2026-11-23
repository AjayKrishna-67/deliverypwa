/**
 * Putting the cursor in a quantity box on the entry screens.
 *
 * Small, but it cannot live in either screen that needs it: the new-transfer form
 * and the line editor both do this, and both do it for the same reason.
 *
 * WHY NOT `getElementById`. Those screens render every row TWICE — as a card for a
 * phone and as a table row from md up — with CSS showing one and hiding the other.
 * Two elements would therefore carry the same id, `getElementById` returns whichever
 * comes first in the document, and half the time that is the hidden copy. Focusing a
 * hidden input does nothing whatsoever: no cursor, no keyboard, no scroll. From the
 * other side of the screen that looks exactly like the app ignoring the tap.
 *
 * So the boxes are marked with `data-amount-for` — an attribute, which may legally
 * repeat — and the visible one is chosen here.
 */

/**
 * The attribute an amount input must carry to be findable: `data-amount-for={key}`,
 * written literally in the JSX because an attribute name cannot be a variable there.
 */
const AMOUNT_ATTR = 'data-amount-for';

/**
 * Focus the quantity box for `key`, wherever it currently is, and select what is in
 * it.
 *
 * Selecting matters as much as focusing. Picking a product that is already on the
 * transfer sends you to a box with a number already in it, and what you want is to
 * type the new amount — not to place a caret and clear the old one a digit at a time.
 *
 * `offsetParent` is null for an element with `display: none` anywhere above it, which
 * is exactly the question being asked: is this the copy on screen?
 *
 * Does nothing if the row is not on the page. That is the honest outcome — the
 * caller is asking for a box that does not exist — and it is quieter than throwing
 * inside a click handler.
 */
/**
 * Send the cursor back to the product search box.
 *
 * What makes entering a long transfer bearable: search, tap the product, type the
 * quantity, press Enter — and be back in the search box ready for the next one,
 * without reaching for the screen in between. On a phone that is the difference
 * between two taps per product and four.
 *
 * By id rather than by the visible-copy hunt `focusAmount` does: a picker renders one
 * search box, not a phone copy and a desktop copy.
 *
 * WHICH picker has to be said when there are several. The new-transfer screen shows
 * one per receiving branch, and they are all real: returning to "the" search box
 * would send the cursor to the first branch's box after typing a quantity in the
 * third, which is worse than not moving it at all. Screens with a single picker leave
 * the argument out and get the default id.
 */
export function focusSearch(id = 'gt-product-search'): void {
    if (typeof document === 'undefined') {
        return;
    }
    const box = document.getElementById(id);
    if (box instanceof HTMLInputElement && !box.disabled) {
        box.focus();
        box.select();
    }
}

export function focusAmount(key: string): void {
    if (typeof document === 'undefined') {
        return;
    }
    const boxes = document.querySelectorAll<HTMLInputElement>(
        `[${AMOUNT_ATTR}="${CSS.escape(key)}"]`,
    );
    for (const box of boxes) {
        if (box.offsetParent === null) {
            continue;
        }
        box.focus();
        box.select();
        // Nothing scrolls a phone to a box that the keyboard is about to cover, so
        // ask for it. `center` rather than `nearest`: on a short screen "nearest"
        // leaves the box at the very bottom, under the keyboard.
        box.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
    }
}
