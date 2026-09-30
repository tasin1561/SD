/**
 * D0 — drive the demo seller's parcels through a real lifecycle, so
 * every tutorial about something GOING WRONG has something to film.
 *
 * Sections D, E and K of CURRICULUM.md are mostly about states a seller
 * only reaches after a parcel has moved: delivered, refused, coming
 * back, restocked, paused at the call cap. None of those can be faked by
 * writing a status onto an order — they carry stock movements, wallet
 * entries, tracking events, tickets and a courier booking, and a video
 * of a status with none of that behind it is a video of a lie.
 *
 * So this drives the REAL path, exactly as `scripts/sim-e2e.ts` does:
 * an order placed by the seller, confirmed on a CALL (never god mode,
 * which by design provisions no shipment — ORD-2), a waybill booked
 * against the local Delhivery simulator, picked, packed at the bench
 * with the box ritual, scanned at handover, and then advanced by the
 * simulator, which fires the same signed webhooks the real courier does.
 *
 * ── WHAT IT WILL NOT DO ───────────────────────────────────────────────
 *
 * IT NEVER REWINDS. Every state here has money and stock behind it, and
 * an order found in the wrong one is LEFT ALONE and named. The rest of
 * the seeding hard-deletes freely because those rows are minutes old and
 * carry nothing; these do, and a seed that quietly unwound a delivered
 * parcel to re-film a video would be the most dangerous thing in this
 * directory.
 *
 * There are exactly TWO departures and both keep that rule. The
 * call-cap parcel is DELETED and remade (`rebuildStaleReviewParcel`) —
 * safe only because it was never confirmed, so there is nothing behind
 * it to lose. D4's two parcels are RETIRED and remade
 * (`retireSpentParcel`): the spent one keeps every row, every movement
 * and its waybill and simply stops answering to the canonical
 * reference. Neither unwinds anything.
 *
 * IT REFUSES ANY COURIER THAT IS NOT THE SIMULATOR. `assertSimulator`
 * reads the live `courier.delhivery_api_base_url` and demands a loopback
 * host that answers on the simulator's own route. This is the one script
 * here that would book REAL PARCELS if pointed at the real API with
 * live writes on — which is the configuration production runs.
 */
import { prisma } from './deps.mjs';
import { call, waitFor } from './api.mjs';

const SIM = process.env.SIM_URL ?? 'http://127.0.0.1:4010';

/**
 * The parcels, by the seller's own reference — which is the identity
 * this pass is keyed on, because it is the one field a human can read
 * off a screen and match to this file.
 */
export const LIFECYCLE_PARCELS = [
  {
    ref: 'RSH-LIFE-DELIVERED',
    want: 'DELIVERED',
    customer: { name: 'Lakshmi Raghavan', phone: '+919845060011' },
    stages: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  },
  {
    ref: 'RSH-LIFE-FAILED',
    want: 'DELIVERY_FAILED',
    customer: { name: 'Vikram Desai', phone: '+919845060022' },
    stages: [
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      ['NDR', 'Nobody at the address; watchman asked us to come back tomorrow'],
    ],
  },
  {
    ref: 'RSH-LIFE-RETURNING',
    want: 'RTO_IN_TRANSIT',
    customer: { name: 'Sneha Pillai', phone: '+919845060033' },
    stages: [
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      ['NDR', 'Customer refused the parcel at the door'],
      'RTO_INITIATED',
      'RTO_IN_TRANSIT',
    ],
  },
  {
    ref: 'RSH-LIFE-RESTOCKED',
    want: 'RTO_RESTOCKED',
    customer: { name: 'Anil Varma', phone: '+919845060044' },
    /**
     * TWO units, because the curriculum wants this parcel to be BOTH
     * restocked and carrying a damage ticket — and on a one-unit line
     * those are contradictory: a restock means the unit was GOOD, a
     * ticket means it was not. WMS-8d is exactly the answer ("what if
     * this product has 2 qty? one is good and another is damaged"), so
     * the line is inspected BY QUANTITY: one unit back on the shelf, one
     * written off. Order status is then RTO_RESTOCKED (any restocked
     * unit wins) with a scrap ticket beside it.
     */
    quantity: 2,
    stages: [
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      ['NDR', 'Address not found'],
      'RTO_INITIATED',
      'RTO_IN_TRANSIT',
    ],
    // The warehouse leg, which a webhook may NOT drive (TRK-6): somebody
    // has to physically have the carton before the conservation-critical
    // finalize chain can run.
    receiveAndFinalize: true,
  },
  {
    ref: 'RSH-LIFE-CONFIRMED',
    want: 'CONFIRMED',
    customer: { name: 'Gayatri Menon', phone: '+919845060055' },
    /** Stops after the call. The waybill exists; nothing has been picked. */
    stages: [],
  },
  {
    ref: 'RSH-LIFE-REVIEW',
    want: 'AWAITING_SELLER_DECISION',
    customer: { name: 'Rahul Bhatt', phone: '+919845060066' },
    /**
     * Never confirmed. The agent rings, gets no answer, and does it
     * again until the cap — at which point a MANUAL_REVIEW seller is
     * ASKED rather than rejected (R5b).
     *
     * `inventory.early_reservation_enabled` is seeded false and that
     * does NOT matter here, which was an open question in CURRICULUM.md
     * and is settled by reading the code: `handleNdrCap` resolves only
     * `inventory.early_reservation_ndr_action` (MANUAL_REVIEW by
     * default) and raises the review with `heldQty: 0` when nothing was
     * held. The enable switch governs whether stock is booked AT
     * PLACEMENT; the pause at the cap is a question about whether to
     * keep CALLING, and every seller gets to answer it.
     */
    noAnswerToCap: true,
  },
  {
    ref: 'RSH-LIFE-OVERDUE',
    want: 'OUT_FOR_DELIVERY',
    customer: { name: 'Priyanka Joshi', phone: '+919845060077' },
    /**
     * THE ONE PARCEL THE SIMULATOR CANNOT PRODUCE.
     *
     * `/needs-attention`'s second list is parcels that went out for
     * delivery three nights or more ago and never arrived — and the
     * simulator moves a parcel through every scan in seconds, so
     * nothing on this box is ever three days old. D3's video would be
     * half a screen without it.
     *
     * So its scans are RECORDED BY HAND, back-dated, through the
     * product's own `ManualTrackingService` (TRK-9) — which REQUIRES
     * the operator to supply `eventAtIso` for exactly this reason:
     * TRK-3 says `event_at` is the SCAN time, never `now()`, and a
     * backfill is meant to land in its true place on the timeline. No
     * column is written that the product does not write itself, and the
     * scan goes through the same mapping and the same monotonic-forward
     * guard a webhook does.
     */
    stages: [],
    backdatedScans: [
      { status: 'IN_TRANSIT', daysAgo: 5, description: 'Shipment picked up' },
      { status: 'OUT_FOR_DELIVERY', daysAgo: 4, description: 'Out for delivery' },
    ],
  },
  /**
   * ── THE TWO D4 PARCELS ARE SPENT BY THEIR OWN VIDEO ──────────────
   *
   * D4 is the one tutorial whose take CONSUMES what it films. Both of
   * its actions move the parcel irreversibly, one of them by calling
   * the courier on the click (CUR-10's seller amendment), and neither
   * can be undone by anything in this file — a returning parcel is not
   * rewound to out-for-delivery, ever.
   *
   * They exist rather than the video borrowing D2's failed parcel or D0's
   * delivered one for exactly that reason. A send-back on
   * `RSH-LIFE-FAILED` would take D2's world with it; a return request on
   * `RSH-LIFE-DELIVERED` would take B5's, D1's, E2's and D6's. Each of
   * those is the sort of loss that shows up as a DIFFERENT video failing
   * its check a fortnight later.
   *
   * `spendable: true` is what makes D4 re-takeable: a parcel found past
   * its state is RETIRED — its `sellerOrderRef` is moved aside and a
   * fresh one is built under the canonical ref. That is forward motion,
   * not a rewind: the spent parcel keeps every row it has, its stock,
   * its money and its waybill, and carries on being a parcel that is
   * coming back. It just stops answering to this name. Costs one courier
   * booking and one warehouse run per take, which on the simulator is
   * about twenty seconds.
   *
   * Note that a `--check` pass spends one too — check mode drives the
   * real app, so it really does press the button. Seed, check, seed,
   * check, seed, take is therefore three parcels, and the procedure in
   * CURRICULUM.md ("`--check` twice with a seed in between") is exactly
   * what makes that work.
   */
  {
    ref: 'RSH-LIFE-SENDBACK',
    want: 'OUT_FOR_DELIVERY',
    customer: { name: 'Meenakshi Sundaram', phone: '+919845060088' },
    /**
     * OUT_FOR_DELIVERY, not CONFIRMED. CURRICULUM.md's D4 entry asked
     * for "D0's CONFIRMED-with-waybill" order and that is wrong: the
     * seller's send-back lives on `DeliveryTroublePanel`, which renders
     * only while `orderStatus` is DELIVERY_FAILED or OUT_FOR_DELIVERY.
     * On a CONFIRMED order there is no panel and no button at all.
     *
     * Out for delivery rather than failed, so the two halves of the
     * video are about two different moments: a parcel still moving that
     * the seller has changed their mind about, and one already delivered
     * that the customer wants to send back.
     */
    stages: ['IN_TRANSIT', 'OUT_FOR_DELIVERY'],
    spendable: true,
    /**
     * ITS STATUS DOES NOT MOVE WHEN IT IS SPENT, which is the whole
     * reason this flag exists. A send-back reaches the courier and they
     * accept it, but the ORDER stays OUT_FOR_DELIVERY — CUR-11: their
     * scans are the only authority on our status, and accepting a
     * cancellation is not a scan. So the ordinary "is it still at its
     * want" test answers yes on a parcel already turned round, and the
     * next take would film a second send-back on a waybill the courier
     * has already cancelled.
     *
     * `shipments.courierCancelledAt` is the honest signal: it is stamped
     * only when the courier actually accepted, and nothing else writes
     * it.
     */
    spentWhenCourierCancelled: true,
  },
  {
    ref: 'RSH-LIFE-RETURNREQ',
    want: 'DELIVERED',
    customer: { name: 'Kaushik Iyer', phone: '+919845060099' },
    stages: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'],
    spendable: true,
  },
];

/**
 * States this pass can carry a parcel FORWARD from.
 *
 * Deliberately not "everything short of the target": a parcel abandoned
 * mid-warehouse (PENDING_PICK, PICKED, PACKED) has a claim, an
 * allocation or an open box behind it, and picking that up blind is how
 * a seed corrupts stock. Those are named and left.
 */
const RESUMABLE_FROM = new Set([
  'PENDING_CONFIRMATION',
  // Mid-calling. An agent recorded No answer and the order was
  // re-queued (CC-2/CC-5); nothing is reserved, booked or picked, so
  // carrying on ringing is exactly what the product would do next.
  'CALL_NO_RESPONSE',
  'CALL_RESCHEDULED',
  'CONFIRMED',
  'DISPATCHED',
]);

/**
 * The statuses a confirmation call can still be made against.
 *
 * NOT just PENDING_CONFIRMATION: the moment an agent records No answer
 * the order moves to CALL_NO_RESPONSE and is re-queued (CC-2/CC-5), so
 * a loop that stopped at "no longer pending" stopped after ONE ring.
 * AWAITING_SELLER_DECISION is deliberately absent — it is where this
 * loop is trying to get to, and the product's own
 * `CONFIRMATION_CALL_STATUSES` includes it for a different reason.
 */
const STILL_CALLABLE = new Set(['PENDING_CONFIRMATION', 'CALL_NO_RESPONSE', 'CALL_RESCHEDULED']);

/** …and of those, the ones that have already been through the bench. */
const ALREADY_DISPATCHED = new Set(['DISPATCHED']);

/** A parcel's line: one unit of a stocked SKU. */
const LIFECYCLE_SKU = 'RSH-JAMDANI-IVORY';

/**
 * Refuse to run against anything but the local simulator.
 *
 * The check is deliberately belt and braces — the configured base URL
 * must be a loopback host AND the simulator's own route must answer on
 * it. A base URL alone could be a loopback tunnel to somewhere real, and
 * a reachable simulator alone says nothing about where the adapter will
 * actually post.
 */
async function assertSimulator() {
  const row = await prisma.systemSetting.findUnique({
    where: { key: 'courier.delhivery_api_base_url' },
    select: { valueString: true },
  });
  const base = row?.valueString ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(base)) {
    throw new Error(
      `Refusing to drive a lifecycle: courier.delhivery_api_base_url is "${base}". ` +
        'This books waybills, and against a real base URL with live writes on they are REAL PARCELS. ' +
        `Point it at the simulator first (${SIM}).`,
    );
  }
  const up = await fetch(`${base.replace(/\/$/, '')}/_sim/parcels`).then(
    (r) => r.ok,
    () => false,
  );
  if (!up) {
    throw new Error(
      `courier.delhivery_api_base_url is ${base} but nothing answers /_sim/parcels there. ` +
        'Start the simulator:\n\n' +
        '  PORT=4010 SKYDROP_API_URL=http://127.0.0.1:4000 \\\n' +
        '  TRACKING_WEBHOOK_SECRET_DELHIVERY=devsimsecret \\\n' +
        '  pnpm --filter @skydrop/delhivery-sim start\n',
    );
  }
  return base.replace(/\/$/, '');
}

async function statusOf(orderId) {
  const row = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  return row?.status ?? null;
}

/** Move the parcel in the simulator. Each advance fires a signed webhook. */
async function advance(sim, awb, stage, note) {
  const res = await fetch(`${sim}/_sim/parcels/${awb}/advance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage, ...(note === undefined ? {} : { note }) }),
  });
  if (!res.ok) throw new Error(`sim advance ${stage} → ${res.status} ${await res.text()}`);
  // The webhook is processed off a BullMQ queue; give the processor a
  // moment before the next scan, or two arrive out of order and TRK-4
  // correctly drops the second.
  await new Promise((r) => setTimeout(r, 1500));
}

/**
 * Put OUR entry at the front of the call queue.
 *
 * `pullNext` is strict FIFO on `available_at ASC, created_at ASC`, and
 * `release` puts an entry back WITHOUT touching `available_at` — which
 * is right (an agent handing a call back must not lose its place) and
 * makes "pull until you get your own" unusable on a queue with anything
 * older on it: the same entry comes back every time, for ever. A dev box
 * accumulates those from every abandoned simulator run.
 *
 * So the seeding schedules its own call instead of fishing for it.
 * `available_at` is a SCHEDULING column the product writes itself — a
 * callback pushes it forward — and this is the same act in the other
 * direction, on THIS ORDER ONLY. Nobody else's place in the queue moves.
 */
/**
 * Close call-queue entries whose order has moved on.
 *
 * CC-6's dequeue is POST-COMMIT and BEST-EFFORT, and CLAUDE.md says so
 * in as many words: "a best-effort failure never fails the order write —
 * an admin re-enqueue / out-of-band reconciler recovers". This is that
 * reconciler, and on a dev box it earns its keep immediately: an entry
 * left behind by an abandoned simulator run sat at the head of the queue
 * pointing at an order that had reached RTO_RESTOCKED, and because the
 * FIFO is `(scheduled_attempts > 0) DESC, available_at ASC` and forty-
 * four reschedules had accumulated on it, it OUTRANKED every genuine
 * call on the box. Releasing it put it straight back at the front. So
 * nothing could be confirmed through the call centre at all.
 *
 * The predicate is the rule itself — an entry is garbage exactly when
 * its order is no longer PENDING_CONFIRMATION — which is why this is
 * safe to run across every seller rather than only ours.
 */
async function reconcileStaleCallQueue(log) {
  const { count } = await prisma.callQueueEntry.updateMany({
    where: {
      status: { in: ['PENDING', 'ASSIGNED'] },
      // ONLY a confirmation call. The other three reasons
      // (SELLER_ASKED, STORE_ASKED, DELIVERY_FAILED) exist precisely to
      // ring a customer whose order is PAST confirmation, so a predicate
      // about the order having moved on is false of a perfectly live
      // entry — and this swept three of them away on the first D0 box,
      // closing the post-NDR call the delivery-failed listener had just
      // queued and leaving `closure_reason` null as the fingerprint.
      reason: 'ORDER_CONFIRMATION',
      // …and only for an order no confirmation call can be made against
      // any more. NOT "not PENDING_CONFIRMATION": the moment an agent
      // records No answer the order moves to CALL_NO_RESPONSE and the
      // product RE-QUEUES it (CC-2/CC-5), so that predicate destroyed
      // the second ring of every three-ring sequence and the next pass
      // then waited thirty seconds for a queue entry it had deleted
      // itself. The rule is "a confirmation call for an order that can
      // no longer be confirmed".
      order: { status: { notIn: [...STILL_CALLABLE] } },
    },
    data: { status: 'COMPLETED', assignedAgentId: null, assignedAt: null },
  });
  if (count > 0) {
    log(`  · closed ${count} call-queue entr${count === 1 ? 'y' : 'ies'} whose order had moved on`);
  }
}

async function callThisOneFirst(orderId) {
  // CC-6 enqueues POST-COMMIT and best-effort, so the row is a heartbeat
  // behind the submit that caused it. Wait for it rather than racing it.
  await waitFor(`${orderId} to reach the call queue`, () =>
    prisma.callQueueEntry.findFirst({
      where: { orderId, status: 'PENDING' },
      select: { id: true },
    }),
  );
  const earliest = await prisma.callQueueEntry.aggregate({
    where: { status: 'PENDING' },
    _min: { availableAt: true },
  });
  // AHEAD OF THE QUEUE **AND IN THE PAST**. A no-answer re-queue is
  // scheduled forward by the retry backoff (CC-2), so on a queue whose
  // only entry is that one, "earliest minus a minute" is still in the
  // future and `pullNext` correctly hands back nothing — which presents
  // as "the order left the call queue" on the second ring.
  const earliestAt = earliest._min.availableAt ?? new Date();
  const front = new Date(Math.min(earliestAt.getTime(), Date.now()) - 60_000);
  await prisma.callQueueEntry.updateMany({
    where: { orderId, status: 'PENDING' },
    data: { availableAt: front },
  });
}

/**
 * Take OUR entry off the call queue.
 *
 * It has just been moved to the front, so the first pull should be it —
 * but anything that is not ours is RELEASED rather than consumed, and
 * the loop is bounded by how many are actually waiting so a queue that
 * cannot be walked says so instead of spinning.
 */
async function pullOwnCall(orderId, staffToken) {
  await call('/agent/settings', {
    method: 'PATCH',
    token: staffToken,
    body: { isAvailable: true },
  });
  await callThisOneFirst(orderId);

  // Ours is at the front, so the first pull should be it. Anything else
  // is released and NOTED: a queue that hands back the same entry twice
  // cannot be walked (release keeps its place, by design), and saying so
  // is better than spinning until a loop bound runs out.
  const seen = new Set();
  const waiting = await prisma.callQueueEntry.count({ where: { status: 'PENDING' } });
  for (let i = 0; i < waiting + 5; i += 1) {
    const pulled = await call('/agent/calls/next', { method: 'POST', token: staffToken });
    const assignment = pulled.assignment;
    if (!assignment) return null;
    if (assignment.orderId === orderId) return assignment.assignmentId;
    if (seen.has(assignment.assignmentId)) {
      throw new Error(
        `The call queue keeps handing back ${assignment.assignmentId} — it is ahead of ours ` +
          'and release does not move it. Clear the stale PENDING entries on this box first.',
      );
    }
    seen.add(assignment.assignmentId);
    // A 409 here means it is already back on the queue, which is the
    // outcome we wanted: not consumed.
    await call(`/agent/calls/${assignment.assignmentId}/release`, {
      method: 'POST',
      token: staffToken,
    }).catch((e) => {
      if (!/ASSIGNMENT_NOT_ACTIVE/.test(String(e))) throw e;
    });
  }
  return null;
}

async function recordAttempt(assignmentId, staffToken, outcome, notes) {
  await call(`/agent/calls/${assignmentId}/record-attempt`, {
    method: 'POST',
    token: staffToken,
    body: {
      outcome,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      endedAt: new Date().toISOString(),
      outcomeNotes: notes,
    },
  });
}

/**
 * Release a pick claim a dead run left behind.
 *
 * `PickExecutionService.start` stamps `pick_started_at` and THEN
 * transitions CONFIRMED → PENDING_PICK, so a process that dies between
 * the two leaves a shipment claimed by nobody — and the pick queue
 * filters on `pick_started_at IS NULL`, so it becomes invisible while
 * its order sits at CONFIRMED looking perfectly eligible. The queue then
 * answers "empty" to an order that is plainly in it, which is a
 * confusing hour if you have not met it before.
 *
 * WMS-5's own answer is the supervisor override, which is the same
 * time-based CAS the BullMQ expiry uses and is idempotent — so this is
 * the product's recovery path, not a seeding shortcut.
 */
async function releaseStalePickClaim(orderId, staffToken, log) {
  const links = await prisma.orderShipment.findMany({
    where: { orderId },
    select: { shipmentId: true },
  });
  const stuck = await prisma.shipment.findFirst({
    where: {
      id: { in: links.map((l) => l.shipmentId) },
      deletedAt: null,
      supersededAt: null,
      pickStartedAt: { not: null },
      pickCompletedAt: null,
    },
    select: { id: true },
  });
  if (stuck === null) return;
  await call(`/admin/warehouse/picks/${stuck.id}/expire`, { method: 'POST', token: staffToken });
  log(`    released a stale pick claim on ${stuck.id}`);
}

/** Everything between a confirmed order and a parcel a courier has taken. */
async function driveToDispatched(orderId, staffToken, log) {
  await releaseStalePickClaim(orderId, staffToken, log);

  let shipmentId = null;
  const seenPicks = new Set();
  for (let i = 0; i < 40 && shipmentId === null; i += 1) {
    const pulled = await call('/warehouse/picks/next', { method: 'POST', token: staffToken });
    const pick = pulled.pick;
    if (!pick) throw new Error('Pick queue empty — a CONFIRMED order should be eligible');
    if (pick.orderId === orderId) {
      shipmentId = pick.shipmentId;
      break;
    }
    // `pullNext` claims nothing (the claim is `start`), so a queue with
    // somebody else's parcel at the head hands back the SAME one for
    // ever. Say which, rather than looping to a bound.
    if (seenPicks.has(pick.shipmentId)) {
      throw new Error(
        `The pick queue keeps handing back ${pick.shipmentId} — somebody else's parcel is ` +
          'ahead of ours and pulling does not move it.',
      );
    }
    seenPicks.add(pick.shipmentId);
  }
  if (shipmentId === null) throw new Error('Could not pull our own pick');

  const started = await call(`/warehouse/picks/${shipmentId}/start`, {
    method: 'POST',
    token: staffToken,
  });
  if (started.fullyAllocated !== true) {
    throw new Error(
      `Pick could not be fully allocated (${started.status}) — is there enough stock? ` +
        'WMS-4 would route this to manual placement.',
    );
  }

  // Bin and batch come from the phase-2 reservations the allocator just
  // populated (INV-4) — the authoritative record of where the goods are.
  const items = await prisma.shipmentItem.findMany({
    where: { shipmentId },
    select: { id: true, orderItemId: true },
  });
  for (const item of items) {
    const reservation = await prisma.stockReservation.findFirst({
      where: { orderItemId: item.orderItemId, status: 'ACTIVE', binId: { not: null } },
      select: { binId: true, batchId: true },
    });
    if (!reservation?.binId || !reservation.batchId) {
      throw new Error(`No phase-2 reservation for shipment item ${item.id}`);
    }
    await call(`/warehouse/picks/${shipmentId}/items`, {
      method: 'POST',
      token: staffToken,
      body: {
        shipmentItemId: item.id,
        pickedBinId: reservation.binId,
        pickedBatchId: reservation.batchId,
      },
    });
  }
  await call(`/warehouse/picks/${shipmentId}/complete`, { method: 'POST', token: staffToken });

  for (let i = 0; i < 40; i += 1) {
    const pulled = await call('/warehouse/packs/next', { method: 'POST', token: staffToken });
    const pack = pulled.pack;
    if (!pack) throw new Error('Pack queue empty — the shipment should be eligible once PICKED');
    if (pack.shipmentId === shipmentId) break;
  }

  // THE REAL BOX RITUAL, not `force-complete`. LBL-4: a parcel cannot be
  // packed unless its contents were scanned, and the escape hatch exists
  // for goods shelved before labelling did. Routing the seeding through
  // it would leave the one path production runs unexercised.
  const shipment = await prisma.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    select: { awbNumber: true },
  });
  const awb = shipment.awbNumber;
  if (awb === null) throw new Error('Shipment carries no waybill — nothing to scan at the bench');

  const opened = await call('/warehouse/packs/boxes/open', {
    method: 'POST',
    token: staffToken,
    body: { awbNumber: awb },
  });
  const boxId = opened.box?.id ?? opened.packBoxId;
  if (typeof boxId !== 'string') throw new Error('Opening the box returned no id');

  // One scan PER UNIT: the contents are checked as a SET at close, and a
  // quantity of two needs the code twice.
  const lines = await prisma.shipmentItem.findMany({
    where: { shipmentId },
    select: { quantity: true, orderItem: { select: { variant: { select: { skuCode: true } } } } },
  });
  for (const packLine of lines) {
    const code = packLine.orderItem?.variant?.skuCode;
    if (typeof code !== 'string') throw new Error('A pack line resolved to no SKU code');
    for (let unit = 0; unit < packLine.quantity; unit += 1) {
      await call(`/warehouse/packs/boxes/${boxId}/scan`, {
        method: 'POST',
        token: staffToken,
        body: { code },
      });
    }
  }
  await call(`/warehouse/packs/boxes/${boxId}/close`, {
    method: 'POST',
    token: staffToken,
    body: { awbNumber: awb },
  });

  // CUR-4: THE SCAN IS THE HANDOVER. The parcel goes DISPATCHED here and
  // the manifest — made for us at pack (WMS-7) — closes itself.
  await call('/admin/courier/handover-scan', {
    method: 'POST',
    token: staffToken,
    body: { awbNumber: awb },
  });
  return { shipmentId, awb };
}

/**
 * Record a parcel's scans by hand, back-dated.
 *
 * TRK-9's own path: the same mapping, the same monotonic-forward guard
 * and the same `tracking_events` writer a webhook uses, with the
 * operator supplying the scan time — which TRK-3 requires precisely so
 * a backfill lands where it belongs rather than at `now()`.
 *
 * `eventAt` is what decides how many nights a parcel has been out (the
 * NSA sweep asks the courier's scan, not when we recorded it), so the
 * days are counted from the seeding's own clock and a rebuild weeks
 * later produces the same picture.
 */
async function recordBackdatedScans(shipmentId, staffToken, scans, log) {
  for (const scan of scans) {
    const eventAtIso = new Date(Date.now() - scan.daysAgo * 86_400_000).toISOString();
    const res = await call(`/admin/tracking/shipments/${shipmentId}/manual-scan`, {
      method: 'POST',
      token: staffToken,
      body: {
        status: scan.status,
        eventAtIso,
        description: scan.description,
        locationName: 'Bengaluru Hub',
        locationCity: 'Bengaluru',
      },
    });
    // A skipped transition is NORMAL for a repeat (TRK-4), but on a
    // FIRST build it means the order never got where the video needs
    // it — so say which, rather than reporting success either way.
    log(
      `    scan ${scan.status} at ${eventAtIso.slice(0, 10)} → ${res.kind}` +
        (res.toStatus === undefined ? '' : ` (${res.toStatus})`),
    );
  }
}

/** Receive the carton, inspect every line, and finalize (WMS-8). */
async function receiveAndFinalize(awb, staffToken, disposition) {
  await call('/warehouse/rto/receive', {
    method: 'POST',
    token: staffToken,
    body: { awbNumber: awb },
  });
  const shipment = await prisma.shipment.findFirstOrThrow({
    where: { awbNumber: awb },
    select: { id: true, items: { select: { id: true } } },
  });
  for (const item of shipment.items) {
    await call(`/warehouse/rto/items/${item.id}/inspect`, {
      method: 'POST',
      token: staffToken,
      body: disposition,
    });
  }
  await call(`/warehouse/rto/shipments/${shipment.id}/finalize`, {
    method: 'POST',
    token: staffToken,
  });
}

/**
 * Retire a SPENT D4 parcel so a fresh one can take its name.
 *
 * D4 presses two buttons that cannot be un-pressed: a send-back reaches
 * the courier on the click, and a return request books a collection and
 * moves the order onto the RTO path. Both leave the parcel somewhere
 * `ensureLifecycleParcels` will not carry it forward from, which without
 * this would print "left alone" for ever and the video could never be
 * re-taken.
 *
 * IT DOES NOT REWIND, AND THAT IS THE WHOLE POINT. Nothing is deleted
 * and nothing is unwound — the spent parcel keeps its stock movements,
 * its wallet entries, its waybill and its reverse booking, and carries
 * on being a parcel that is coming back, which is a true record of what
 * the take did. All that changes is the NAME: `sellerOrderRef` moves to
 * `<ref>-SPENT-<n>`, which is free (it is a seller-supplied external
 * reference, unique per seller and store, read by nothing that decides
 * anything) and leaves the canonical ref available for a new one.
 *
 * Contrast `rebuildStaleReviewParcel`, which really does delete: that
 * parcel was never confirmed, so there was nothing behind it to lose.
 * These two have been picked, packed, dispatched and scanned.
 *
 * Nothing happens while the parcel is still at its state and unspent —
 * a seed run between two takes must not churn a parcel that is ready.
 */
async function retireSpentParcel(sellerId, ref, want, log, spentWhenCourierCancelled = false) {
  const order = await prisma.order.findFirst({
    where: { sellerId, sellerOrderRef: ref },
    select: { id: true, status: true, orderNumber: true, customerReturnRequestedAt: true },
  });
  if (order === null) return;

  // Spent means "no longer the parcel the video needs". Three ways.
  //
  // The status moved (a send-back or a return request both do that), or
  // it is still DELIVERED but a return has already been asked for —
  // which the request endpoint treats as idempotent, so a second take
  // would film "was already coming back" instead of a collection being
  // booked.
  const movedOn = order.status !== want;
  const alreadyAsked = !movedOn && order.customerReturnRequestedAt !== null;
  // …and for the send-back parcel, whose status does NOT move when it is
  // spent (CUR-11 — see its entry in `LIFECYCLE_PARCELS`).
  const courierTold =
    !movedOn && !alreadyAsked && spentWhenCourierCancelled
      ? await courierWasToldToReturn(order.id)
      : false;

  // …AND THE THIRD: THE SIMULATOR HAS FORGOTTEN IT.
  //
  // The simulator keeps its parcels in memory and says so in its own
  // words ("Restarting is the reset"). Our database keeps the waybill
  // either way, so after a sim restart an order sits perfectly at
  // OUT_FOR_DELIVERY carrying a waybill the courier has never heard of —
  // and the ONE thing D4 does with it, the send-back, is a live call
  // against that waybill. It comes back "waybill not found", which the
  // product correctly records as a courier refusal, and the take fails
  // eight scenes in.
  //
  // It cost exactly that once, so the check is here rather than in a
  // note: a parcel the simulator cannot answer for is spent, whatever
  // our own status column says.
  const unknownToSim =
    movedOn || alreadyAsked || courierTold ? false : !(await simKnowsParcelFor(order.id));
  if (!movedOn && !alreadyAsked && !courierTold && !unknownToSim) return;

  // A suffix that cannot collide, whatever is already parked.
  const parked = await prisma.order.count({
    where: { sellerId, sellerOrderRef: { startsWith: `${ref}-SPENT-` } },
  });
  const retiredRef = `${ref}-SPENT-${parked + 1}`;
  await prisma.order.update({
    where: { id: order.id },
    data: { sellerOrderRef: retiredRef },
  });
  const why = unknownToSim
    ? 'the simulator has forgotten its waybill (it was restarted)'
    : courierTold
      ? `the courier has already been told to return ${order.orderNumber}`
      : `${order.orderNumber} is ${order.status}${alreadyAsked ? ', return already asked' : ''}`;
  log(
    `  · ${ref} is spent — ${why}. ` + `Renamed ${retiredRef} and left intact; a fresh one follows`,
  );
}

/**
 * Has the courier already accepted a cancellation on this order's parcel?
 *
 * `courierCancelledAt` is stamped by `cancelWithCourier` and by nothing
 * else, only on a successful reply — so it is the one column that says
 * "they really were told", which the order's own status cannot (CUR-11).
 */
async function courierWasToldToReturn(orderId) {
  const cancelled = await prisma.shipment.findFirst({
    where: {
      orderShipments: { some: { orderId } },
      supersededAt: null,
      courierCancelledAt: { not: null },
    },
    select: { id: true },
  });
  return cancelled !== null;
}

/**
 * Does the simulator still hold the live waybill of this order's parcel?
 *
 * Asked through `/_sim/parcels`, which is the simulator's own
 * introspection route rather than Delhivery's wire API — this is a
 * question about the FIXTURE, not about a courier.
 *
 * FAILS SAFE TOWARDS "YES": a sim we cannot reach, or an order with no
 * waybill at all, answers true, so a network wobble never retires a good
 * parcel and costs a fresh courier booking. Being wrong that way shows
 * up as the take failing, which is loud; being wrong the other way
 * churns parcels quietly on every seed run.
 */
async function simKnowsParcelFor(orderId) {
  const awb = await prisma.shipment
    .findFirst({
      where: {
        orderShipments: { some: { orderId } },
        deletedAt: null,
        supersededAt: null,
        awbNumber: { not: null },
      },
      select: { awbNumber: true },
      orderBy: { createdAt: 'desc' },
    })
    .catch(() => null);
  if (awb?.awbNumber == null) return true;
  try {
    const res = await fetch(`${SIM}/_sim/parcels`);
    if (!res.ok) return true;
    const parcels = await res.json();
    if (!Array.isArray(parcels)) return true;
    return parcels.some((p) => p?.awb === awb.awbNumber);
  } catch {
    return true;
  }
}

/**
 * Rebuild the call-cap parcel once its review has been ANSWERED.
 *
 * D5's video presses "Keep trying", which RESOLVES the review — and
 * `handleNdrCap` upserts with `update: {}`, so a resolved review is
 * never reopened. Ringing the order back to the cap therefore parks it
 * at AWAITING_SELLER_DECISION again with NOTHING OPEN on `/holds`, and
 * the video cannot be re-taken. (The order is not stranded: the
 * product's own `sweepOrphans` expires a parked order with no open
 * review on the TTL. It is simply not filmable.)
 *
 * So this one parcel is REBUILT rather than resumed — and it is the only
 * one that can be, which is the whole argument for doing it here and
 * nowhere else: it was never confirmed, so it carries no waybill, no
 * picked stock, no wallet entry and no courier booking. Deleting it
 * costs a phone call that never connected. Every other lifecycle parcel
 * does carry those, which is why `ensureLifecycleParcels` refuses to
 * rewind one.
 *
 * Nothing happens while the parcel is exactly right: paused, with a
 * review still open to answer. Anything else — answered, or stopped
 * part-way through its ring sequence — is rebuilt, so this parcel is
 * deterministic rather than merely resumable.
 */
async function rebuildStaleReviewParcel(sellerId, ref, want, log) {
  const order = await prisma.order.findFirst({
    where: { sellerId, sellerOrderRef: ref },
    select: {
      id: true,
      status: true,
      orderNumber: true,
      earlyReservationReview: { select: { status: true } },
    },
  });
  if (order === null) return;
  const review = order.earlyReservationReview ?? null;
  // Exactly right: paused, with a review still open to answer.
  if (order.status === want && review !== null && review.status === 'OPEN') return;
  const why =
    order.status !== want
      ? `mid-calling at ${order.status}`
      : `an answered review (${review?.status ?? 'none'})`;

  await prisma.$transaction([
    prisma.earlyReservationReview.deleteMany({ where: { orderId: order.id } }),
    prisma.callAttempt.deleteMany({ where: { orderId: order.id } }),
    prisma.callQueueEntry.deleteMany({ where: { orderId: order.id } }),
    prisma.orderCharge.deleteMany({ where: { orderId: order.id } }),
    prisma.orderItem.deleteMany({ where: { orderId: order.id } }),
    prisma.orderEvent.deleteMany({ where: { orderId: order.id } }),
    prisma.order.deleteMany({ where: { id: order.id } }),
  ]);
  log(`  · ${ref} had ${why} — rebuilt from scratch`);
}

/**
 * Build the lifecycle parcels, or leave alone the ones that exist.
 *
 * Deliberately not "the N parcels": the count is `LIFECYCLE_PARCELS`,
 * and this sentence said six through two additions of a seventh and an
 * eighth. `log` is passed in so the caller owns the seeding's voice.
 */
export async function ensureLifecycleParcels({ sellerId, sellerToken, staffToken, log }) {
  const sim = await assertSimulator();
  await reconcileStaleCallQueue(log);

  const variant = await prisma.productVariant.findFirst({
    where: { skuCode: LIFECYCLE_SKU, product: { sellerId } },
    select: { id: true },
  });
  if (variant === null) {
    throw new Error(`No ${LIFECYCLE_SKU} for this seller — the catalogue seeding runs first.`);
  }

  for (const parcel of LIFECYCLE_PARCELS) {
    if (parcel.noAnswerToCap === true)
      await rebuildStaleReviewParcel(sellerId, parcel.ref, parcel.want, log);
    if (parcel.spendable === true)
      await retireSpentParcel(
        sellerId,
        parcel.ref,
        parcel.want,
        log,
        parcel.spentWhenCourierCancelled === true,
      );

    const existing = await prisma.order.findFirst({
      where: { sellerId, sellerOrderRef: parcel.ref },
      select: { id: true, status: true, orderNumber: true },
    });

    // NEVER REWOUND, but RESUMED wherever it can be. These carry stock,
    // money and a courier booking, so unwinding one to re-film a video
    // is the worst thing this directory could do — and the first build
    // still has to survive a crash halfway through, which is exactly
    // what left two of them half-made the first time this ran. So a
    // parcel found short of its state is carried FORWARD from where it
    // actually is; only one in a state this pass cannot continue from is
    // left alone and named.
    if (existing !== null && existing.status === parcel.want) {
      log(`  · ${parcel.ref} already ${parcel.want}`);
      continue;
    }
    if (existing !== null && !RESUMABLE_FROM.has(existing.status)) {
      log(
        `  · ${parcel.ref} is ${existing.status}, not ${parcel.want} — left alone ` +
          `(${existing.orderNumber}). Delete it by hand if you meant to rebuild it.`,
      );
      continue;
    }
    if (existing !== null) {
      log(`  · ${parcel.ref} resuming from ${existing.status} (${existing.orderNumber})`);
    }

    const order =
      existing ??
      (await call('/seller/orders', {
        method: 'POST',
        token: await sellerToken(),
        body: {
          recipientName: parcel.customer.name,
          recipientPhoneE164: parcel.customer.phone,
          recipientAddressLine1: '18, Residency Road',
          // ORD-5: line two is the LANDMARK and is required.
          recipientAddressLine2: 'Beside the Bangalore Club gate, opposite the bus stop',
          recipientPostalCode: '560025',
          paymentMode: 'COD',
          codAmountInr: '2400',
          sellerOrderRef: parcel.ref,
          items: [{ variantId: variant.id, quantity: parcel.quantity ?? 1 }],
        },
      }));
    if (existing === null) {
      await call(`/seller/orders/${order.id}/submit`, {
        method: 'POST',
        token: await sellerToken(),
      });
    }
    const from = existing?.status ?? 'PENDING_CONFIRMATION';

    if (parcel.noAnswerToCap === true) {
      // Ring, ring, ring. NO_ANSWER is one of the six counting outcomes
      // (CC-5), and the cap is `ops.call_max_attempts_before_ndr`.
      const cap = await prisma.systemSetting.findUnique({
        where: { key: 'ops.call_max_attempts_before_ndr' },
        select: { valueInt: true },
      });
      const attempts = cap?.valueInt ?? 3;
      /*
        Ring until the order stops being callable, bounded by the cap.

        Not "ring exactly `cap` times": the D5 video ANSWERS this review
        with "keep trying", which puts the order back to
        PENDING_CONFIRMATION with its attempts already counted — so the
        next seeding's very FIRST ring is at the cap and re-pauses it,
        and two more rings would then be asking for a call the order is
        no longer in the queue for. Reading the order's own status after
        each attempt is the honest condition; the cap is only the bound
        that stops a loop running away.
      */
      for (let i = 0; i < attempts; i += 1) {
        if (!STILL_CALLABLE.has(await statusOf(order.id))) break;
        const assignmentId = await pullOwnCall(order.id, staffToken);
        if (assignmentId === null) {
          throw new Error(`${parcel.ref} left the call queue before attempt ${i + 1}`);
        }
        await recordAttempt(assignmentId, staffToken, 'NO_ANSWER', 'Rang out — nobody picked up');
      }
      const rang = await prisma.callAttempt.count({ where: { orderId: order.id } });
      log(
        `  · ${parcel.ref} rang ${rang} time${rang === 1 ? '' : 's'} → ${await statusOf(order.id)}`,
      );
      continue;
    }

    if (from === 'PENDING_CONFIRMATION') {
      const assignmentId = await pullOwnCall(order.id, staffToken);
      if (assignmentId === null) {
        throw new Error(`${parcel.ref} never appeared on the call queue (CC-6 enqueues on submit)`);
      }
      await recordAttempt(assignmentId, staffToken, 'CONFIRMED', 'Customer confirmed on the phone');
    }

    // Confirming is what books the waybill (CUR-2b), off a queue worker.
    // Through the API, not Prisma: a shipment carries no `orderId` — the
    // link is the `order_shipments` join, and the admin read already
    // walks it. (`findFirst({ where: { orderId } })` is a schema error
    // Prisma reports as forty lines of available filters.)
    const awb = await waitFor(`a waybill on ${parcel.ref}`, async () => {
      const shipments = await call(`/admin/orders/${order.id}/shipments`, { token: staffToken });
      return (Array.isArray(shipments) ? shipments : []).find((sh) => sh.awbNumber)?.awbNumber;
    });

    if (parcel.stages.length === 0 && parcel.backdatedScans === undefined) {
      log(`  · ${parcel.ref} confirmed, waybill ${awb}, nothing picked`);
      continue;
    }

    // Past the warehouse already? Then the waybill we just read IS the
    // one on the road, and the scans are all that is left. Replaying the
    // whole stage list is safe either way: TRK-4 skips a scan whose
    // target the order is already at, silently and by design.
    const dispatched = ALREADY_DISPATCHED.has(from)
      ? { awb, shipmentId: null }
      : await driveToDispatched(order.id, staffToken, log);
    const dispatchedAwb = dispatched.awb;
    for (const stage of parcel.stages) {
      const [name, note] = Array.isArray(stage) ? stage : [stage, undefined];
      await advance(sim, dispatchedAwb, name, note);
    }

    if (parcel.backdatedScans !== undefined) {
      const shipmentId =
        dispatched.shipmentId ??
        (
          await prisma.shipment.findFirstOrThrow({
            where: { awbNumber: dispatchedAwb },
            select: { id: true },
          })
        ).id;
      await recordBackdatedScans(shipmentId, staffToken, parcel.backdatedScans, log);
    }

    if (parcel.receiveAndFinalize === true) {
      // WMS-8d: one verdict PER UNIT. One goes back on the shelf, one is
      // written off — which is what opens the scrap ticket the seller's
      // Tickets screen is about (TKT-1) while still leaving the order
      // RTO_RESTOCKED. `rows` must cover the line's quantity exactly.
      await receiveAndFinalize(dispatchedAwb, staffToken, {
        rows: [
          {
            quantity: 1,
            condition: 'GOOD',
            disposition: 'RESTOCK',
            notes: 'Unopened and sellable.',
          },
          {
            quantity: 1,
            condition: 'DAMAGED',
            disposition: 'WRITE_OFF',
            notes: 'Water damage to the packaging and the fabric inside.',
          },
        ],
      });
    }

    log(`  · ${parcel.ref} → ${await statusOf(order.id)} (${dispatchedAwb})`);
  }

  await raiseOverdueFlags(sellerId, staffToken, log);
  await settleScrapTicket(sellerId, staffToken, log);
}

/**
 * The damage claim, seen through: our reply, then a refund.
 *
 * The RTO inspection opens the ticket (TKT-1) and leaves it OPEN, which
 * is the right place for a claim nobody has looked at. D6's video is
 * about the whole arc — the warehouse finding damage, the conversation,
 * and the money landing in the wallet — so the claim is settled here.
 *
 * NEVER RE-SETTLED: `RESOLVED_REFUND` is terminal and it writes a real
 * `SCRAP_REFUND` credit, so a second pass on a settled ticket would pay
 * the seller twice. The matrix refuses it (no outbound edges from a
 * resolution) and this returns before asking.
 *
 * The figure is the SKU's declared value, for the one unit written off.
 */
const SCRAP_REFUND_INR = '2400.00';

async function settleScrapTicket(sellerId, staffToken, log) {
  const ticket = await prisma.ticket.findFirst({
    where: { sellerId, ticketType: 'SCRAP_DAMAGE' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, ticketNumber: true, status: true, resolutionWalletEntryId: true },
  });
  if (ticket === null) {
    log('  · no damage ticket to settle (nothing was written off)');
    return;
  }
  if (ticket.status === 'RESOLVED_REFUND') {
    await renameRefundNoteToTicketNumber(ticket, log);
    log(`  · ${ticket.ticketNumber} already refunded`);
    return;
  }
  if (ticket.status !== 'OPEN' && ticket.status !== 'NEGOTIATING') {
    log(`  · ${ticket.ticketNumber} is ${ticket.status} — left alone`);
    return;
  }

  if (ticket.status === 'OPEN') {
    await call(`/admin/tickets/${ticket.id}/notes`, {
      method: 'POST',
      token: staffToken,
      body: {
        note:
          'We have checked the photographs from the returns bench and we agree with the ' +
          'inspector — the water damage happened in transit, not in your packing. We are ' +
          'settling this at the declared value of the unit.',
      },
    });
  }

  await call(`/admin/tickets/${ticket.id}`, {
    method: 'PATCH',
    token: staffToken,
    body: {
      to: 'RESOLVED_REFUND',
      refundAmountInr: SCRAP_REFUND_INR,
      notes: 'Refunded at the declared value of the damaged unit.',
    },
  });
  log(`  · ${ticket.ticketNumber} refunded ₹${SCRAP_REFUND_INR}`);
}

/**
 * Bring a PRE-FIX refund note up to what the product now writes.
 *
 * `TicketService.transition` used to note a `SCRAP_REFUND` as
 * "Ticket <uuid> settled". That line is what the seller reads in their
 * wallet ledger beside "Damage settlement", and a uuid is not something
 * anybody can read down a phone or type into the ticket search — the
 * same defect D5 found on `/holds`. It names the ticket NUMBER now, and
 * D6 and E2 both film that exact row.
 *
 * A wallet entry is append-only and this file is careful about that, so
 * the scope is deliberately tight: the seeded scrap ticket's OWN entry,
 * only when its note still carries the uuid, and only the NOTE — the
 * direction, the amount and the running balance are untouched, so no
 * money and no chain is rewritten. It is bringing a demo row into line
 * with the code, not correcting a ledger.
 *
 * Nothing happens once it has run, and nothing happens on a box where
 * the refund was written after the fix.
 */
async function renameRefundNoteToTicketNumber(ticket, log) {
  if (ticket.resolutionWalletEntryId == null || ticket.ticketNumber == null) return;
  const fixed = await prisma.sellerWalletEntry.updateMany({
    where: {
      id: ticket.resolutionWalletEntryId,
      direction: 'SCRAP_REFUND',
      note: `Ticket ${ticket.id} settled`,
    },
    data: { note: `Ticket ${ticket.ticketNumber} settled` },
  });
  if (fixed.count > 0) {
    log(`  · ledger note for ${ticket.ticketNumber} now names the ticket rather than its uuid`);
  }
}

/**
 * Put the back-dated parcel on `/needs-attention`'s overdue list.
 *
 * The flag is `orders.nsa_*`, and the ONLY thing that writes it is the
 * nightly sweep — so the seeding runs the sweep rather than stamping the
 * columns, through the product's own `POST /admin/nsa/sweep`, which
 * exists for precisely this ("run it now rather than waiting for the
 * hourly tick") and is idempotent per evening.
 *
 * Run every time, because the short-circuit above skips a parcel already
 * in its target state — so on a second seeding nothing else would ask.
 * Guarded on one of OUR parcels actually being out for delivery: the
 * sweep is estate-wide, and running it for nothing would flag whatever
 * else happens to be sitting on the box.
 */
async function raiseOverdueFlags(sellerId, staffToken, log) {
  const overdue = LIFECYCLE_PARCELS.filter((p) => p.want === 'OUT_FOR_DELIVERY').map((p) => p.ref);
  if (overdue.length === 0) return;
  const waiting = await prisma.order.findFirst({
    where: { sellerId, sellerOrderRef: { in: overdue }, status: 'OUT_FOR_DELIVERY' },
    select: { id: true, nsaDayCount: true },
  });
  if (waiting === null) {
    log('  · no parcel is out for delivery — the overdue sweep has nothing to flag');
    return;
  }
  const summary = await call('/admin/nsa/sweep', { method: 'POST', token: staffToken });
  const after = await prisma.order.findUniqueOrThrow({
    where: { id: waiting.id },
    select: { nsaDayCount: true, nsaRaisedAt: true },
  });
  log(
    `  · overdue sweep: raised ${summary.raised}, escalated ${summary.escalated} — ` +
      `our parcel is day ${after.nsaDayCount}` +
      (after.nsaRaisedAt === null ? ' (NOT FLAGGED)' : ''),
  );
  if (after.nsaRaisedAt === null) {
    throw new Error(
      'The back-dated parcel is out for delivery but the sweep did not flag it. ' +
        'Check `ops.nsa_enabled`, and that the OUT_FOR_DELIVERY scan really carries a past date.',
    );
  }
}

/**
 * Drive ONE already-placed order all the way to OUT_FOR_DELIVERY.
 *
 * G6's queue has a DELIVERY ASK in it — call the customer again, try
 * again, send it back — and `DeliveryActionService.request` refuses
 * anything that is not out for delivery or freshly failed. So the
 * reseller store's third order has to go the whole way: confirmed on a
 * call, a waybill booked, picked, packed at the bench, scanned at
 * handover, and then moved by the simulator.
 *
 * It is the SAME path `ensureLifecycleParcels` walks — the same call, the
 * same box ritual, the same signed webhooks — reached through the same
 * private helpers rather than a second copy of them. What it does NOT
 * share is `LIFECYCLE_PARCELS`: this order is placed by a STORE, through
 * `/store/orders`, and belongs to whoever placed it rather than to that
 * table.
 *
 * IDEMPOTENT AND FORWARD-ONLY, exactly as the rest of this file: an
 * order already out for delivery is left alone, and one in a state this
 * cannot carry forward from is NAMED and left rather than unwound.
 */
export async function driveOrderToOutForDelivery({ orderId, staffToken, log }) {
  const sim = await assertSimulator();
  await reconcileStaleCallQueue(log);

  const before = await statusOf(orderId);
  if (before === 'OUT_FOR_DELIVERY') return { moved: false, status: before };
  if (before !== null && !RESUMABLE_FROM.has(before)) {
    log(`  · order is ${before}, which this cannot carry forward from — left alone`);
    return { moved: false, status: before };
  }

  if (STILL_CALLABLE.has(before ?? '')) {
    const assignmentId = await pullOwnCall(orderId, staffToken);
    if (assignmentId === null) {
      throw new Error('The order never appeared on the call queue (CC-6 enqueues on submit)');
    }
    await recordAttempt(assignmentId, staffToken, 'CONFIRMED', 'Customer confirmed on the phone');
  }

  // Confirming books the waybill (CUR-2b), off a queue worker.
  await waitFor('a waybill on the store order', async () => {
    const shipments = await call(`/admin/orders/${orderId}/shipments`, { token: staffToken });
    return (Array.isArray(shipments) ? shipments : []).find((sh) => sh.awbNumber)?.awbNumber;
  });

  const now = await statusOf(orderId);
  const dispatched = ALREADY_DISPATCHED.has(now ?? '')
    ? {
        awb: (
          await prisma.shipment.findFirstOrThrow({
            where: {
              orderShipments: { some: { orderId } },
              deletedAt: null,
              supersededAt: null,
              awbNumber: { not: null },
            },
            select: { awbNumber: true },
          })
        ).awbNumber,
      }
    : await driveToDispatched(orderId, staffToken, log);

  for (const stage of ['IN_TRANSIT', 'OUT_FOR_DELIVERY']) {
    await advance(sim, dispatched.awb, stage);
  }
  return { moved: true, status: await statusOf(orderId), awb: dispatched.awb };
}

/** What the pass is supposed to have produced, for a caller to check. */
export async function lifecycleReport(sellerId) {
  const rows = await prisma.order.findMany({
    where: { sellerId, sellerOrderRef: { in: LIFECYCLE_PARCELS.map((p) => p.ref) } },
    select: { sellerOrderRef: true, status: true, orderNumber: true },
  });
  return LIFECYCLE_PARCELS.map((p) => {
    const row = rows.find((r) => r.sellerOrderRef === p.ref);
    return {
      ref: p.ref,
      want: p.want,
      got: row?.status ?? null,
      orderNumber: row?.orderNumber ?? null,
      ok: row?.status === p.want,
    };
  });
}
