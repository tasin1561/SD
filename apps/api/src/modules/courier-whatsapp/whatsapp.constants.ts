/**
 * Shared between the API (which only ENQUEUES) and the portal worker
 * (which reads the panel). Kept dependency-free on purpose: importing
 * the portal module's queue file from the API would drag Playwright's
 * module graph into the API process (`portal-worker-isolation.spec.ts`).
 */
export const WHATSAPP_SETTING_KEY = 'courier.delhivery_whatsapp_enabled';
/** The portal worker's existing queue name (`PORTAL_QUEUE`). */
export const PORTAL_QUEUE_NAME = 'courier-portal';
export const JOB_PORTAL_WHATSAPP_FETCH = 'portal-whatsapp-fetch';
export const JOB_PORTAL_WHATSAPP_SWEEP = 'portal-whatsapp-sweep';
/** A parcel is not re-read more often than this by the sweep. */
export const WHATSAPP_DEBOUNCE_MS = 6 * 60 * 60 * 1000;
/** A staff "Refresh" may not hammer one parcel faster than this. */
export const WHATSAPP_MANUAL_MIN_GAP_MS = 2 * 60 * 1000;
/** Keep reading this long after a parcel's final scan. */
export const WHATSAPP_TAIL_MS = 7 * 24 * 60 * 60 * 1000;
export const WHATSAPP_COURIER = 'delhivery';
