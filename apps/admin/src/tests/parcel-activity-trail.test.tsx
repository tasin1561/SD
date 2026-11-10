import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { StaffRoleKey } from '@skydrop/db';
import { ParcelActivityPanel } from '../app/(authed)/orders/_components/parcel-activity-panel';
import { HoldsBoard } from '../app/(authed)/warehouse/holds/_components/holds-board';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

/**
 * "Who did what" and "who has what".
 *
 * What is worth asserting on a screen is the HONESTY, not the layout: a
 * step nobody is recorded against must not read as a person, a staff
 * member who has left must still be named as the one who did the work,
 * and a lapsed hold must read as free rather than sending somebody off
 * to find the name on the row.
 */

const ORDER = '0192c000-0000-7000-8000-000000000001';

const staff = makeStaff([StaffRoleKey.SUPER_ADMIN], ['orders.view', 'warehouse.view']);
const noPermission = makeStaff([StaffRoleKey.CALL_AGENT], ['callcenter.work']);

const trail = {
  orderId: ORDER,
  orderNumber: 'SD-2026-1',
  parcels: [
    {
      shipmentId: 'ship-1',
      shipmentNumber: 'SH-1',
      awbNumber: 'AWB1',
      superseded: false,
      lastTouch: {
        key: 'ship-1:HANDOVER_SCANNED',
        kind: 'HANDOVER_SCANNED',
        atIso: '2026-11-10T05:00:00.000Z',
        atApproximate: false,
        actor: { kind: 'STAFF', name: 'Karim Uddin' },
        shipmentId: 'ship-1',
        shipmentNumber: 'SH-1',
        awbNumber: 'AWB1',
        detail: null,
      },
    },
  ],
  events: [
    {
      key: 'ship-1:LABEL_PRINTED',
      kind: 'LABEL_PRINTED',
      atIso: '2026-11-10T03:00:00.000Z',
      atApproximate: false,
      actor: { kind: 'STAFF_REMOVED', name: 'Old Packer' },
      shipmentId: 'ship-1',
      shipmentNumber: 'SH-1',
      awbNumber: 'AWB1',
      detail: { sheets: 2 },
    },
    {
      key: 'ship-1:PICKED',
      kind: 'PICKED',
      atIso: '2026-11-10T04:00:00.000Z',
      atApproximate: false,
      actor: { kind: 'UNRECORDED', name: null },
      shipmentId: 'ship-1',
      shipmentNumber: 'SH-1',
      awbNumber: 'AWB1',
      detail: null,
    },
    {
      key: 'ship-1:PACKED',
      kind: 'PACKED',
      atIso: '2026-11-10T04:30:00.000Z',
      atApproximate: false,
      actor: { kind: 'SYSTEM', name: null },
      shipmentId: 'ship-1',
      shipmentNumber: 'SH-1',
      awbNumber: 'AWB1',
      detail: null,
    },
    {
      key: 'ship-1:HANDOVER_SCANNED',
      kind: 'HANDOVER_SCANNED',
      atIso: '2026-11-10T05:00:00.000Z',
      atApproximate: false,
      actor: { kind: 'STAFF', name: 'Karim Uddin' },
      shipmentId: 'ship-1',
      shipmentNumber: 'SH-1',
      awbNumber: 'AWB1',
      detail: null,
    },
  ],
};

describe('the parcel activity trail', () => {
  it('names the staff member, the system and the unrecorded step each as what it is', async () => {
    renderWithProviders(<ParcelActivityPanel orderId={ORDER} />, {
      identity: staff,
      fetchImpl: buildFetchMock([
        {
          match: /\/api\/admin\/orders\/.*\/parcel-activity/,
          responses: [{ status: 200, body: trail }],
        },
      ]),
    });

    await waitFor(() => expect(screen.getByText('Shipping label printed')).toBeInTheDocument());
    // A staff member who has left keeps their name AND is marked.
    expect(screen.getByText('Old Packer (has left)')).toBeInTheDocument();
    // No actor column exists for this step, and the UI says exactly that
    // instead of borrowing the name of whoever claimed the pick.
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText('Skydrop system')).toBeInTheDocument();
    expect(screen.queryByText('undefined')).toBeNull();
  });

  it('reads oldest first, the order the work happened in', async () => {
    renderWithProviders(<ParcelActivityPanel orderId={ORDER} />, {
      identity: staff,
      fetchImpl: buildFetchMock([
        { match: /parcel-activity/, responses: [{ status: 200, body: trail }] },
      ]),
    });
    await waitFor(() => expect(screen.getByText('Packed')).toBeInTheDocument());
    // Scoped to the step label itself: an unscoped text query also
    // matches every ANCESTOR whose text contains the words, so the list
    // would come back with the rows' wrappers interleaved.
    const steps = screen.getAllByText(
      /Shipping label printed|Picked from the shelf|Packed|Scanned at handover/,
      { selector: '.pa-row__what' },
    );
    expect(steps.map((n) => n.textContent)).toEqual([
      'Shipping label printed',
      'Picked from the shelf',
      'Packed',
      'Scanned at handover',
    ]);
  });

  it('renders nothing, and asks for nothing, without orders.view', () => {
    const fetchImpl = buildFetchMock([]);
    renderWithProviders(<ParcelActivityPanel orderId={ORDER} />, {
      identity: noPermission,
      fetchImpl,
    });
    // Not `toBeEmptyDOMElement` on the container: the render harness
    // mounts a Toaster of its own, so the container is never empty.
    expect(screen.queryByText('Who did what')).toBeNull();
    expect(screen.queryByText('Shipping label printed')).toBeNull();
    // And it spends no round trip on a request it knows will 403 — the
    // permission is passed to the query's `enabled`, not only to the
    // markup.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

const HOUR = 3_600_000;

function holdsBody(now: number) {
  return {
    nowIso: new Date(now).toISOString(),
    stuckAfterMinutes: 15,
    holds: [
      {
        key: 'PACK_BOX:box-1',
        kind: 'PACK_BOX',
        holder: { kind: 'STAFF', name: 'Karim Uddin' },
        shipmentNumber: 'SH-1',
        awbNumber: 'AWB1',
        orderId: ORDER,
        orderNumber: 'SD-2026-1',
        batchNumber: null,
        warehouseName: 'Delhi',
        sinceIso: new Date(now - HOUR).toISOString(),
        untilIso: new Date(now - HOUR / 2).toISOString(),
        expired: true,
        stuck: true,
        detail: { scanned: 1 },
      },
      {
        key: 'PICK:ship-2',
        kind: 'PICK',
        holder: { kind: 'STAFF', name: 'Nasir Ahmed' },
        shipmentNumber: 'SH-2',
        awbNumber: null,
        orderId: null,
        orderNumber: null,
        batchNumber: null,
        warehouseName: 'Delhi',
        sinceIso: new Date(now).toISOString(),
        untilIso: new Date(now + HOUR).toISOString(),
        expired: false,
        stuck: false,
        detail: null,
      },
    ],
    reprints: [
      {
        shipmentId: 'ship-3',
        shipmentNumber: 'SH-3',
        awbNumber: 'AWB3',
        orderId: ORDER,
        orderNumber: 'SD-2026-1',
        warehouseName: 'Delhi',
        sheets: 2,
        lastPrintedBy: { kind: 'STAFF', name: 'Karim Uddin' },
        lastPrintedAtIso: new Date(now - HOUR).toISOString(),
        labelVersions: 1,
      },
    ],
  };
}

describe('the live holds board', () => {
  it('says FREE and STUCK for a lapsed hold, and names who still has the live one', async () => {
    renderWithProviders(<HoldsBoard />, {
      identity: staff,
      fetchImpl: buildFetchMock([
        {
          match: /\/api\/admin\/warehouse\/holds/,
          responses: [{ status: 200, body: holdsBody(Date.parse('2026-11-10T06:00:00.000Z')) }],
        },
      ]),
    });

    await waitFor(() => expect(screen.getByText('Karim Uddin')).toBeInTheDocument());
    expect(screen.getByText('Stuck — go and ask')).toBeInTheDocument();
    expect(screen.getByText('Nasir Ahmed')).toBeInTheDocument();
    // An absolute clock time, never "in 23 minutes".
    expect(screen.getByText(/Theirs until/)).toBeInTheDocument();
    expect(screen.getByText(/Lapsed at/)).toBeInTheDocument();
    expect(screen.queryByText(/minutes ago|in \d+ minutes/)).toBeNull();
  });

  it('shows a twice-printed label as a reprint and never as somebody holding it', async () => {
    renderWithProviders(<HoldsBoard />, {
      identity: staff,
      fetchImpl: buildFetchMock([
        {
          match: /holds/,
          responses: [{ status: 200, body: holdsBody(Date.parse('2026-11-10T06:00:00.000Z')) }],
        },
      ]),
    });
    await waitFor(() =>
      expect(screen.getByText('Labels printed more than once')).toBeInTheDocument(),
    );
    expect(screen.getByText('2 sheets printed')).toBeInTheDocument();
  });
});
