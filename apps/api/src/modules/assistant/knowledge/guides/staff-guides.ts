import type { Guide } from '../knowledge.types';

const AD = (file: string): string => `apps/admin/src/i18n/messages/${file}.ts`;
const INV = (file: string): string => `docs/invariants/${file}.md`;

/**
 * Guides for STAFF (admin console). These may name internal screens and
 * error codes. They are never offered to any other audience.
 */
export const STAFF_GUIDES: readonly Guide[] = [
  {
    id: 'staff-find-anything',
    audience: ['staff'],
    title: 'Find any order fast: the search box at the top',
    summary:
      'The search box in the top bar finds an order by number, the client’s reference, the customer, the phone, the AWB or a ticket number.',
    keywords: [
      'search',
      'find',
      'awb',
      'waybill',
      'tracking number',
      'order number',
      'phone',
      'customer name',
      'ticket number',
      'look up',
    ],
    errorDomains: [],
    sections: [
      {
        heading: 'Searching',
        steps: [
          'Use the search box in the top bar ("Order, AWB, ticket, name or phone…").',
          'Type at least 2 characters and wait a moment. It searches the order number, the client’s own reference, the recipient’s name and phone, the waybill (AWB), and a ticket number (TK-…).',
          'Pick the result to open that order or ticket.',
        ],
      },
    ],
    sources: [AD('shell')],
  },
  {
    id: 'staff-call-centre',
    audience: ['staff'],
    title: 'Call centre: confirming orders by phone',
    summary:
      'The queue, taking a call, correcting the address, recording an outcome, and the calls-off path.',
    keywords: [
      'call',
      'queue',
      'confirm',
      'confirmation',
      'agent',
      'outcome',
      'attempt',
      'no answer',
      'callback',
      'wrong number',
      'cap',
      'awaiting confirmation',
    ],
    errorDomains: ['call-center'],
    sections: [
      {
        heading: 'The queue',
        steps: [
          'An order enters the call queue when it reaches pending confirmation. It leaves when an agent records an outcome.',
          'Take the next call from the Call centre page. Calls come out oldest first, and two agents can never get the same call.',
          'If you hold a call and do not act, the assignment expires after a set time and goes back to the queue in its original place.',
          'Nobody waiting to be called is normal. The queue checks again every few seconds.',
        ],
      },
      {
        heading: 'During the call',
        steps: [
          "You may correct the customer's name, address, city, state and PIN during the call. The phone number cannot be changed.",
          'Save the corrections before you choose an outcome. The outcome list and the record button are blocked while edits are unsaved.',
          'If the client or the store changes the order while you are on it, the screen shows the new version. Read the address and items again before you confirm.',
          "Answer the issue questions on the call. Your outcome note is written onto the client's open issue word for word.",
        ],
      },
      {
        heading: 'Outcomes and the attempt cap',
        steps: [
          'There are nine outcomes: confirmed, customer declined, wrong number, no answer, busy, voicemail left, callback requested, technical failure and language barrier.',
          'Six count toward the attempt cap: confirmed, declined, wrong number, no answer, busy and voicemail left. Callback requested, technical failure and language barrier do not count.',
          "The cap is the client's own override if they have one, otherwise the system setting, otherwise 3.",
          'When the cap is reached with no answer, the order is rejected as unreachable (NDR). The exception is a client who chose to be consulted: then the order waits under their Needs attention for them to decide, and is rejected automatically if they do not answer in time.',
          'Confirming reserves stock for the order. Each attempt is permanent and cannot be edited.',
        ],
      },
      {
        heading: 'Supervisors: force an outcome',
        steps: [
          'Use Force outcome when you already know how the call ended and nobody needs to dial.',
          'It is recorded as a real attempt under your own name, with the same effect on the order.',
          'You must say why. The attempt ledger is append-only, so the reason lives only there.',
        ],
      },
      {
        heading: 'Clients with calls switched off',
        steps: [
          "Orders from those clients appear on Awaiting confirmation instead of the queue. They confirm on their own when the client's time runs out.",
          'Send one to the call queue to confirm it sooner. This needs the permission to manage the call queue.',
          'Confirm now means nobody phones the customer. Stock is claimed straight away and the order goes to packing. The client carries the return cost.',
        ],
      },
    ],
    sources: [INV('call-center'), AD('cc'), AD('confirmation')],
  },
  {
    id: 'staff-warehouse-print-pick',
    audience: ['staff'],
    title: 'Warehouse: printing labels and picking sheets, then picking',
    summary: 'The print-first path: labels, one picking sheet, walk, mark picked.',
    keywords: [
      'print',
      'printing',
      'label',
      'picking sheet',
      'pick list',
      'pick',
      'picked',
      'batch',
      'allocation',
      'not allocated',
      'reprint',
    ],
    errorDomains: ['warehouse-printing', 'warehouse-pick', 'pick-allocation'],
    sections: [
      {
        heading: 'The everyday path (Warehouse, Printing)',
        steps: [
          'Labels first, then the picking sheet. Nothing moves until somebody confirms the paper came out.',
          '1. Select parcels and print their labels. Confirm printed. Only confirm what is on paper in front of you. Confirming moves the parcels to the picking tab.',
          '2. Select the labelled parcels and print one consolidated picking sheet. Confirm printed.',
          '3. Walk the sheet and pick.',
          '4. When the picker returns, mark the list picked. The parcels go to the packing bench.',
        ],
      },
      {
        heading: 'What confirming the picking sheet does',
        steps: [
          'It allocates stock to the parcels, so the bin codes on the paper are real.',
          'A shortfall shows at the desk, before anyone walks. Parcels without enough stock are on the sheet marked NOT ALLOCATED. The rest of the batch is still walkable. Bring the NOT ALLOCATED ones to a supervisor.',
          'A picking list can be withdrawn. Every parcel on it goes back to the picking queue, unpicked.',
        ],
      },
      {
        heading: 'Labels and reprints',
        steps: [
          'A packed parcel is not offered for a label on purpose. A second label on a sealed box is how two parcels come to carry one waybill.',
          'A reprint needs a reason of at least the minimum length. It is the only record of why a second label exists for a parcel.',
          'Product stickers are printed from a goods receipt, one per unit received.',
        ],
      },
      {
        heading: 'Serialised (strict) products, and one-off parcels',
        steps: [
          'Strict products show no SKU barcode on the sheet. Each unit is scanned by its own serial at the packing table.',
          'Parcels with serialised units stay behind for the per-parcel pick station (Warehouse, Pick). It is also for one-off parcels.',
          'A pick claim that nobody finishes expires and the parcel can be picked again. A supervisor can force-expire a stuck claim. It is safe to run twice and will not take a parcel from a picker who has since claimed it.',
        ],
      },
    ],
    sources: [INV('warehouse'), AD('wh'), INV('labels-scanning')],
  },
  {
    id: 'staff-pack-bench',
    audience: ['staff'],
    title: 'The pack bench and its refusals',
    summary:
      'Open a box by scanning the label, scan the contents, close with the label. Why a scan is refused.',
    keywords: [
      'pack',
      'packing',
      'box',
      'scan',
      'bench',
      'label',
      'verification',
      'duplicate scan',
      'blocked',
      'force complete',
      'refused',
      'superseded',
    ],
    errorDomains: ['warehouse-pack', 'warehouse-bin-ops'],
    sections: [
      {
        heading: 'Packing a parcel',
        steps: [
          'Scan the shipping label to open a box. A box can be opened only for a printed label, so print from Printing first if the list says no printed label yet.',
          'Scan each product into the box. Over-scanning is refused at the scan.',
          'Scan the label again to close. This checks the contents as a set, by product and by unit, and then packs the parcel.',
          'Stock leaves inventory once, at the closing scan. Serialised parcels also need their serials.',
          'A packed parcel is attached to the draft manifest for its courier and warehouse automatically.',
        ],
      },
      {
        heading: 'Why a scan is refused',
        steps: [
          'PACK_VERIFICATION_REQUIRED: the parcel has no closed box, so nothing proves its contents were scanned. Pack it at the bench.',
          'PACK_LABEL_SUPERSEDED: that label was replaced and a new one printed. Bin the old sticker and scan the new label.',
          'PACK_AWB_NOT_FOUND: no parcel matches the code scanned.',
          'PACK_SCAN_EMPTY: nothing was scanned. Scan the shipping label to open a box.',
          'PACK_NOT_AVAILABLE: another packer already packed it, or it is no longer packable.',
          'DUPLICATE_SCAN: this parcel was already packed (or already with the courier at the handover bench).',
        ],
      },
      {
        heading: 'A duplicate-scan stop',
        steps: [
          'A repeated box stops the person who scanned it. Put the box aside and get an admin.',
          'The stop is per person, not per bench. It also covers their next parcel, because the whole pile is in doubt.',
          'An admin clears it by resolving the issue on System issues with a note, after checking whether there are two boxes with one waybill.',
          'A scan gun that fires twice is not counted as a repeated box.',
        ],
      },
      {
        heading: 'Cancelling a box, and stuck boxes',
        steps: [
          'Cancelling a box discards the scans and puts the parcel back in the queue. Nothing returns to inventory, because packing never took anything out.',
          'A packer can have one open box, and a parcel can have one open box.',
          'An abandoned box is released automatically after a timeout (60 minutes by default).',
        ],
      },
      {
        heading: 'Pack without checking (supervisor)',
        steps: [
          'A supervisor with the supervise permission can force-complete a parcel without checking its contents. It needs a reason of at least 20 characters and is recorded as an unverified pack.',
          'Use it only for goods shelved before labelling existed.',
        ],
      },
    ],
    sources: [INV('warehouse'), INV('labels-scanning'), AD('wh'), AD('rest')],
  },
  {
    id: 'staff-handover-manifest',
    audience: ['staff'],
    title: 'Handover, manifests and courier pickups',
    summary: 'The handover scan dispatches the parcel. Manifests mostly look after themselves.',
    keywords: [
      'handover',
      'hand over',
      'dispatch',
      'manifest',
      'van',
      'pickup',
      'courier pickup',
      'scan',
      'driver',
    ],
    errorDomains: ['warehouse-manifest', 'courier-dispatch'],
    sections: [
      {
        heading: 'Handover bench',
        steps: [
          'Scan every parcel as it goes onto the van. The scan is the handover: the parcel is dispatched the moment it is read.',
          'The manifest closes itself once its last parcel has gone.',
          'A repeated handover scan stops the person who made it, the same way as at the pack bench. Put the box aside and get an admin.',
          'If a driver took a stack before anybody scanned it, a supervisor can confirm the handoff for the manifest as a fallback.',
        ],
      },
      {
        heading: 'Manifests',
        steps: [
          'A manifest is a record of which parcels went out together. A draft manifest is created when the first parcel is packed for a courier and warehouse.',
          'Closing and courier handoff are automatic once a box is packed. Nothing there needs doing unless something went wrong.',
          'To move a parcel to another manifest, do it before either is closed. The new manifest must be a draft for the same courier and warehouse.',
        ],
      },
      {
        heading: 'Courier pickups',
        steps: [
          "Raise one pickup request per courier per warehouse per day, when the day's parcels are packed and ready. It covers the whole handover.",
          "The courier accepts only one open request per location per day. A failed attempt keeps the day claimed on purpose. Free it only after checking the courier's own panel, because freeing it may book a second van.",
        ],
      },
    ],
    sources: [INV('couriers'), INV('labels-scanning'), AD('wh'), AD('rest')],
  },
  {
    id: 'staff-courier-decisions-manual',
    audience: ['staff'],
    title: 'Courier decisions and manual placement',
    summary: 'When a courier refuses a parcel, or a client wants to pick the carrier.',
    keywords: [
      'courier',
      'manual placement',
      'courier decision',
      'awb',
      'waybill',
      'refused',
      'serviceable',
      'shiprocket',
      'delhivery',
      'carrier',
      'cheapest',
      'fastest',
      'cancel',
    ],
    errorDomains: [
      'courier-manual-placement',
      'courier-awb',
      'courier-dispatch',
      'courier-shared',
      'courier-delhivery',
    ],
    sections: [
      {
        heading: 'When the AWB is created',
        steps: [
          'The AWB (waybill) is booked when the order is confirmed, not at packing. A parcel gets exactly one AWB.',
          'If the courier says it will not carry the parcel, the order moves to pending manual placement.',
          'A temporary courier failure does not move it. The order stays confirmed and the booking is retried. A courier that keeps refusing is asked at most 3 more times, then the system stops asking and raises an issue.',
        ],
      },
      {
        heading: 'Manual placement',
        steps: [
          'Book the parcel with a courier outside Skydrop, then record the waybill in Manual placement.',
          'Fill in the courier name. The client and the customer both see it on tracking. If it is blank they are told the courier is called "manual".',
          'A parcel already picked and packed goes out. One that has not been picked goes to the warehouse floor to be picked first. The result says which.',
          'If no courier will carry it, cancel instead. Cancelling releases the stock and voids the shipment. The client sees a cancelled order, so give a reason they will understand.',
        ],
      },
      {
        heading: 'Courier decisions',
        steps: [
          'This page lists confirmed parcels waiting for somebody to choose the carrier. It shows only clients whose courier policy is Manual, and only when the aggregator offered more than one carrier.',
          'Their stock is reserved and their customers have been told, so the wait is real. If nobody chooses, the cheapest option is booked automatically and an issue is raised.',
          "The policies are the aggregator's own pick (the default), cheapest, fastest, cheapest within a number of days, and manual. A client can have their own.",
        ],
      },
      {
        heading: 'Courier switches and accounts',
        steps: [
          'Turning a courier off diverts new orders to the others. Parcels it already holds keep being tracked and can still be cancelled or re-attempted.',
          'API credentials are encrypted and never shown again. To change one, add a new account and deactivate the old.',
        ],
      },
    ],
    sources: [INV('couriers'), AD('ordersOps'), AD('cour')],
  },
  {
    id: 'staff-failed-deliveries',
    audience: ['staff'],
    title: 'Failed deliveries (NDR) and courier actions on an order',
    summary:
      'Handling what clients ask for after a failed delivery, and the courier tools on the order page.',
    keywords: [
      'ndr',
      'failed delivery',
      'delivery action',
      're-attempt',
      'reattempt',
      'recall',
      'return',
      'rto',
      'cancel waybill',
      'manual scan',
      'courier ops',
    ],
    errorDomains: ['delivery-action', 'order-reattempt', 'courier-ops', 'tracking-manual'],
    sections: [
      {
        heading: 'Failed deliveries page',
        steps: [
          'It lists what clients have asked us to do about parcels the courier could not hand over.',
          'Approving a re-attempt sends a van. Approving a return ends the sale. A recall only queues one of our agents to phone the customer, and nothing reaches the courier.',
          'Delhivery answers asynchronously. The action returns a reference, not an outcome. The real result arrives on the next scan.',
          "A member store's ask that its client chose to approve is shown for reference only. Client staff decide it, not Skydrop admin.",
        ],
      },
      {
        heading: 'Courier tools on the order page',
        steps: [
          'Re-attempt: the courier is asked to send its van out again. It confirms separately, and only its own scans move the order.',
          'Cancelling a parcel already in transit does not make it vanish. It becomes a return and comes back, at the cost of a return leg. Only a parcel not yet collected stops where it is.',
          'Close the waybill: if the order is already cancelled, this asks the courier to close the waybill it booked, which credits the booking charge back.',
          "Mark the waybill as already cancelled only when it really was cancelled in the courier's own portal or by phone. Skydrop does not call the courier. It records your word, and the record says so.",
          'Delhivery refuses edits on parcels already dispatched or finished.',
          "Manual scan is for when the courier's webhook never reached us. It drives the order exactly as a real scan would. If the order is already at or past that point, it does not move, which is normal.",
        ],
      },
    ],
    sources: [AD('cour'), AD('ordersOps'), INV('couriers'), INV('tracking')],
  },
  {
    id: 'staff-rto-receive-inspect',
    audience: ['staff'],
    title: 'Returns (RTO): receive, inspect, finalise',
    summary: 'The returns bench, per-quantity inspection, and what each decision does to stock.',
    keywords: [
      'rto',
      'return',
      'returns',
      'receive',
      'inspect',
      'inspection',
      'finalise',
      'finalize',
      'restock',
      'write off',
      'damaged',
      'returns hold',
      'putaway',
    ],
    errorDomains: ['warehouse-rto'],
    sections: [
      {
        heading: 'The three lists',
        steps: [
          'On their way back: nothing to do yet. It shows what is coming.',
          'Handed back and not received: nobody has received it here. Receiving starts the inspection, and nothing does it automatically, on purpose.',
          'Received and not finalised: held up by items nobody inspected, or items somebody looked at and could not decide about.',
        ],
      },
      {
        heading: 'Inspect each line',
        steps: [
          'Record what you found in the box. Damaged or Missing opens a damage ticket to the client. That is where any refund is decided.',
          'Choose a decision for each line: Put back in stock, Keep aside (damaged), Write off, or Inspect later.',
          'You can split a line by quantity, for example one good and one damaged. Use one verdict or split rows, never both (RTO_INSPECTION_AMBIGUOUS). Rows must add up to the line quantity (RTO_SPLIT_QUANTITY_MISMATCH).',
          'A line with serialised units cannot be split (RTO_SPLIT_SERIALIZED_LINE).',
          'Everything received waits in the returns hold until you decide. A parcel cannot be finalised until every line has a decision. Inspect later blocks it.',
        ],
      },
      {
        heading: 'What each decision does at finalise',
        steps: [
          'Put back in stock: sellable immediately. It moves from the returns hold to the floor bin, or back to the shelf it came from when the warehouse tracks bins.',
          'Keep aside (damaged): it moves to the Damaged bin, kept for the client and never sold. No inbound freight is charged. Finalise is refused if the warehouse has no Damaged bin (RTO_NO_DAMAGED_BIN).',
          "Write off: removed from the returns hold and from stock for good. The client is charged this unit's share of inbound freight. Any refund for the goods is decided on the damage ticket.",
          'The order ends as restocked if any unit was put back in stock, otherwise as damaged.',
          'To send a kept-aside unit back or scrap it later, use Inventory, Adjustments, a decrease from the Damaged bin.',
        ],
      },
      {
        heading: 'Refusals you may meet',
        steps: [
          'RTO_RESTOCK_NEVER_LEFT_STOCK: that line never left stock through us. Choose Write off.',
          'RTO_RESTOCK_EXCEEDS_STOCK_LEFT: you are returning more units than left.',
          'If the warehouse has no returns hold bin, the receive is recorded but nothing is booked until finalise. Create one under Warehouse, Bins.',
        ],
      },
    ],
    sources: [INV('warehouse'), AD('wh')],
  },
  {
    id: 'staff-god-mode',
    audience: ['staff'],
    title: 'God mode (forced order changes) and its audit',
    summary: 'The one sanctioned way to override an order, its guardrails, and what it still does.',
    keywords: [
      'god mode',
      'override',
      'force',
      'forcemutate',
      'force status',
      'admin override',
      'audit',
      'hasadminoverride',
    ],
    errorDomains: ['order'],
    sections: [
      {
        heading: 'What it is',
        steps: [
          'God mode is the only sanctioned way to bypass the order status rules. Use it as a last resort, when a normal transition cannot do the job.',
        ],
      },
      {
        heading: 'Guardrails',
        steps: [
          'You must give a reason of at least 30 characters.',
          'You must acknowledge the data-integrity risk.',
          'You must change at least one field or set a target status.',
          'The change, its event and its audit entry are written together. The audit severity is critical.',
          'The order is flagged as admin-touched forever. The flag is never cleared.',
          'A stale force is refused with STALE_ORDER_STATUS if the order moved since you read it.',
        ],
      },
      {
        heading: 'What a forced status still triggers',
        steps: [
          'A forced status change has the same consequences as a normal transition, except for stock. The call queue, the shipment, the cancel-time refund, notifications, webhooks and invoices all react.',
          'Stock is not moved. If reservations need cleaning up, use the release-reservations action.',
          'A field-only edit triggers none of that.',
          'Forcing a COD amount or payment mode on a member store order re-prices the money. The force is never refused. If the money cannot follow, a loud issue is raised and both parties are told.',
        ],
      },
    ],
    sources: [INV('orders')],
  },
  {
    id: 'staff-money-overview',
    audience: ['staff'],
    title: 'Settlements, remittances and treasury (high level)',
    summary: 'What each money screen is for. This is orientation only.',
    keywords: [
      'settlement',
      'settlements',
      'remittance',
      'remittances',
      'treasury',
      'payout',
      'utr',
      'cod',
      'reconcile',
      'bank',
      'money',
      'p&l',
    ],
    errorDomains: ['treasury', 'courier-settlement', 'admin-remittance', 'pnl'],
    sections: [
      {
        heading: 'Settlements: what couriers pay us',
        steps: [
          "Settlements shows every rupee the courier pays us, matched to the orders it covers. What is not matched is float we carry on the clients' behalf.",
          "Enter the courier's payout with its UTR reference and the orders it covers. The reference must be the courier's own UTR. Recording the same credit twice is refused.",
          'Rows are matched on their waybill. Rows that cannot be placed are listed, never dropped.',
          'A payout allocated for less than the order was expected to yield is flagged. Each one is a conversation with the courier.',
        ],
      },
      {
        heading: 'Remittances: what we pay clients',
        steps: [
          "Remittances records withdrawals paid to clients. Each entry debits the client's wallet.",
          'A bank fee is booked as our expense. The client still receives the full amount.',
          'A payout leaves one account, so the total across all accounts is not the test. The server refuses a payout above the wallet balance (INSUFFICIENT_WALLET_BALANCE).',
          'Check the client has bank details on file before paying.',
        ],
      },
      {
        heading: 'Treasury',
        steps: [
          'Treasury shows which account holds what, how much of it is ours, and whether what we owe clients is covered.',
          'A balance is the sum of its entries. It is append-only. A correction is a new entry saying who corrected it and by how much, never an edit.',
          'Money the owner puts in or takes out is equity. It is never counted as income or expense.',
          'We owe clients more than we hold is not automatically wrong. COD collected by the courier but not yet settled looks exactly like this.',
          'These screens need the money permissions. Without them the pages are hidden.',
        ],
      },
    ],
    sources: [AD('money'), 'apps/admin/src/lib/page-access.ts', INV('treasury')],
  },
  {
    id: 'staff-stuck',
    audience: ['staff'],
    title: 'Stuck? Common situations for staff',
    summary: 'Quick pointers for the problems staff meet most.',
    keywords: [
      'stuck',
      'help',
      'cannot',
      "can't",
      'problem',
      'blocked',
      'permission',
      'error',
      'not showing',
    ],
    sections: [
      {
        heading: 'A page or button is missing',
        steps: [
          'Each page needs a permission. The page list shows which one. Ask an administrator to change your role if you need it.',
        ],
      },
      {
        heading: 'A parcel is not in the pack queue',
        steps: [
          'It must be picked first, and it must have a printed label. A box is opened by scanning the label.',
        ],
      },
      {
        heading: 'I am stopped from scanning',
        steps: [
          'You scanned a repeated box. Put it aside and get an admin to clear it on System issues.',
        ],
      },
      {
        heading: 'A courier refused a parcel',
        steps: [
          'It lands in Manual placement. See the courier decisions and manual placement guide.',
        ],
      },
      {
        heading: 'Return finalise is refused',
        steps: [
          'Every line needs a decision, and the warehouse needs a Damaged bin for kept-aside units.',
        ],
      },
    ],
    sources: [
      AD('wh'),
      AD('rest'),
      AD('ordersOps'),
      'apps/admin/src/lib/page-access.ts',
      INV('labels-scanning'),
    ],
  },
];
