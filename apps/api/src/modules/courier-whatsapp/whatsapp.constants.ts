/**
 * Shared between the API (which only ENQUEUES) and the portal worker
 * (which reads the panel). Kept dependency-free on purpose: importing
 * the portal module's queue file from the API would drag Playwright's
 * module graph into the API process (`portal-worker-isolation.spec.ts`).
 */
export const WHATSAPP_SETTING_KEY = 'courier.delhivery_whatsapp_enabled';
/**
 * Its OWN queue, so the portal queue's concurrency 1 (one signed-in
 * session, other jobs) is untouched. The WhatsApp worker's reads run in
 * separate tabs of the same logged-in browser context.
 */
export const WHATSAPP_QUEUE_NAME = 'courier-whatsapp';
export const JOB_WA_FETCH = 'wa-fetch';
export const JOB_WA_SWEEP = 'wa-sweep';
export const WHATSAPP_SWEEP_CRON = '*/15 * * * *';
export const WHATSAPP_BATCH_KEY = 'courier.delhivery_whatsapp_batch';
export const WHATSAPP_PARALLEL_KEY = 'courier.delhivery_whatsapp_parallel';
export const WHATSAPP_HOURLY_CAP_KEY = 'courier.delhivery_whatsapp_hourly_cap';
export const WHATSAPP_PARALLEL_MAX = 3;
/** BullMQ: lower number = served first. */
export const PRIORITY_HOT = 1;
export const PRIORITY_EVENT = 2;
export const PRIORITY_SWEEP = 5;
export type WhatsappReadKind = 'hot' | 'event' | 'viewer' | 'sweep';
/** Viewer-driven read: only when the stored copy is older than this. */
export const WHATSAPP_VIEWER_STALE_MS = 5 * 60 * 1000;
/** A follow-up read this long after a failed attempt. */
export const WHATSAPP_FAILED_FOLLOWUP_MS = 2 * 60 * 60 * 1000;
/** After a logged-out read nothing logs in again for this long. */
export const WHATSAPP_LOGGED_OUT_PAUSE_MS = 10 * 60 * 1000;
/** A parcel is not re-read more often than this by the sweep. */
export const WHATSAPP_DEBOUNCE_MS = 6 * 60 * 60 * 1000;
/** A staff "Refresh" may not hammer one parcel faster than this. */
export const WHATSAPP_MANUAL_MIN_GAP_MS = 2 * 60 * 1000;
/** Keep reading this long after a parcel's final scan. */
export const WHATSAPP_TAIL_MS = 7 * 24 * 60 * 60 * 1000;
export const WHATSAPP_COURIER = 'delhivery';

/** Scans after which Delhivery tends to message the customer. */
export const WHATSAPP_OFD_EVENTS = ['OUT_FOR_DELIVERY'] as const;
export const WHATSAPP_FAILED_EVENTS = [
  'DELIVERY_ATTEMPTED',
  'DELIVERY_FAILED',
  'ADDRESS_ISSUE',
  'CUSTOMER_REFUSED',
  'CUSTOMER_REQUESTED_RESCHEDULE',
] as const;
