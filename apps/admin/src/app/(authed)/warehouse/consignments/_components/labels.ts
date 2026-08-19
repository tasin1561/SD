import type { ConsignmentRoute, ConsignmentStatus, LabellingSite } from '@skydrop/db';

/**
 * Enum values as an operator would say them out loud.
 *
 * `VIA_BD` on a screen tells somebody at a bench nothing; "through
 * Bangladesh" tells them where the carton is. Kept in one file because
 * the list and the panel must not drift into two vocabularies for the
 * same thing.
 */
export const ROUTE_LABEL: Record<ConsignmentRoute, string> = {
  DIRECT_IN: 'Straight to India',
  VIA_BD: 'Through Bangladesh',
};

export const STATUS_LABEL: Record<ConsignmentStatus, string> = {
  PENDING: 'Announced',
  AT_BD: 'In Bangladesh',
  IN_TRANSIT: 'In transit',
  COMPLETED: 'Landed',
  CANCELLED: 'Cancelled',
};

export const SITE_LABEL: Record<LabellingSite, string> = {
  NONE: 'Not decided',
  BD: 'Bangladesh',
  IN: 'India',
};
