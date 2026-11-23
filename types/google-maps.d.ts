/**
 * Explicitly pull in the Google Maps JS type definitions so the global
 * `google.maps` namespace resolves everywhere (DeliveryMapModal, lib/maps).
 *
 * @types/* packages are normally auto-included, but editor TS servers
 * sometimes miss ones installed mid-session — this reference makes the
 * resolution deterministic for both `tsc` and the IDE.
 */
/// <reference types="google.maps" />
