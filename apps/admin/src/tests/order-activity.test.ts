/**
 * The Activity card's rows are built from arrays the page already holds.
 * Counts and order are what the segmented control and "Show all (N)" show,
 * so they are what is pinned here.
 */
import { describe, expect, it } from 'vitest';
import type { JourneyEntryView, JourneyMilestoneView } from '@skydrop/ui/components';
import type { ParcelActivityEvent } from '@/lib/activity-hooks';
import {
  ACTIVITY_PREVIEW,
  buildActivity,
  rowsFor,
} from '@/app/(authed)/orders/_components/order-activity';

const entry = (at: string, owner: JourneyEntryView['owner'], title: string): JourneyEntryView => ({
  at,
  owner,
  title,
  detail: null,
  location: null,
  nslCode: null,
  rawStatus: null,
  attempt: null,
});
const step = (
  key: string,
  state: JourneyMilestoneView['state'],
  at: string | null,
): JourneyMilestoneView => ({
  key,
  label: key,
  owner: 'SKYDROP',
  at,
  state,
  detail: null,
  estimated: false,
});
const audit = (key: string, atIso: string): ParcelActivityEvent => ({
  key,
  kind: 'PACKED',
  atIso,
  atApproximate: false,
  actor: { kind: 'STAFF', name: 'Tasin' },
  shipmentId: 's1',
  shipmentNumber: 'SH-1',
  awbNumber: null,
  detail: null,
});

const model = buildActivity({
  milestones: [step('received', 'DONE', '2026-11-09T09:00:00Z'), step('later', 'PENDING', null)],
  entries: [
    entry('2026-11-12T11:00:00Z', 'COURIER', 'In transit'),
    entry('2026-11-10T09:00:00Z', 'SKYDROP', 'Confirmed by phone'),
    entry('2026-11-11T09:00:00Z', 'SELLER', 'Order edited'),
    entry('2026-11-12T08:00:00Z', 'COURIER', 'Picked up'),
  ],
  audit: [audit('a1', '2026-11-12T10:00:00Z'), audit('a2', '2026-11-09T12:00:00Z')],
  actorLabel: () => 'Tasin',
  auditText: () => 'Packed',
});

describe('buildActivity', () => {
  it('All merges history and warehouse audit, newest first', () => {
    expect(model.all.map((r) => r.text)).toEqual([
      'In transit', // 11-12 11:00
      'Packed', //     11-12 10:00 (audit)
      'Picked up', //  11-12 08:00
      'Order edited', // 11-11
      'Confirmed by phone', // 11-10
      'Packed', //     11-09 12:00 (audit)
    ]);
    expect(model.all).toHaveLength(6);
  });

  it('Client and Skydrop events are in All but not in Courier scans', () => {
    expect(model.all.some((r) => r.source === 'SELLER')).toBe(true);
    expect(model.all.some((r) => r.source === 'SKYDROP')).toBe(true);
    expect(model.courier.map((r) => r.text)).toEqual(['In transit', 'Picked up']);
  });

  it('Warehouse audit is only the who-did-what rows; Milestones only steps that happened', () => {
    expect(model.warehouse).toHaveLength(2);
    expect(model.warehouse.every((r) => r.source === 'WAREHOUSE' && r.who === 'Tasin')).toBe(true);
    expect(model.milestones.map((r) => r.text)).toEqual(['received']); // 'later' has no time
  });

  it('rowsFor picks the list for the filter', () => {
    expect(rowsFor(model, 'all')).toBe(model.all);
    expect(rowsFor(model, 'courier')).toBe(model.courier);
    expect(rowsFor(model, 'warehouse')).toBe(model.warehouse);
    expect(rowsFor(model, 'milestones')).toBe(model.milestones);
  });

  it('previews eight rows', () => {
    expect(ACTIVITY_PREVIEW).toBe(8);
  });
});
