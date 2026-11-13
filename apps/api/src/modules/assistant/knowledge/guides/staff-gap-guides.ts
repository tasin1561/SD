import type { Guide } from '../knowledge.types';

const AD = (file: string): string => `apps/admin/src/i18n/messages/${file}.ts`;
const INV = (file: string): string => `docs/invariants/${file}.md`;

/**
 * Staff guides added by "Step 4 — knowledge gaps". Every line is a close
 * paraphrase of the console's own copy (the AD() files) or of a rule in
 * docs/invariants (the INV() files). Where those sources are silent, the
 * guide is silent: nothing here is inferred.
 */
export const STAFF_GAP_GUIDES: readonly Guide[] = [
  {
    id: 'staff-goods-receipt-consignments',
    audience: ['staff'],
    title: 'Goods receipts and consignments: counting stock in, sending it to India',
    summary:
      'The receive station is where a goods receipt is counted and stock is written; the consignment page shows the whole journey and holds labelling, dispatch to India and cancelling.',
    keywords: [
      'goods receipt',
      'receive station',
      'receiving',
      'consignment',
      'count',
      'putaway',
      'dispatch to india',
      'transit',
      'cancel consignment',
      'intake',
      'damaged',
      'variance',
    ],
    errorDomains: ['consignment', 'inventory-receipt'],
    sections: [
      {
        heading: 'Where each job happens',
        steps: [
          'Clients declare stock as a consignment from Inbound in their portal before shipping. Once it arrives, its goods receipt appears on the Receive station for the warehouse team to count.',
          'The Receive station is where counting happens. A row that belongs to a consignment says which one; open that consignment to label, dispatch or see the whole journey.',
          'The consignment page shows where each consignment is, what each stop counted, and the steps the receive station has no opinion about: labelling, dispatch to India, and cancelling. Counting itself happens on the receive station.',
        ],
      },
      {
        heading: 'Counting a goods receipt',
        steps: [
          'Start receiving on the warehouse floor, then record each product’s received quantity and bin, then complete the receipt to write stock.',
          'Type a received quantity for every product (0 if none arrived) and record it. A product left uncounted gets nothing stocked.',
          'A damaged quantity needs a received quantity first. Enter the received quantity (0 if none arrived) before the damaged one.',
          'For a per-unit tracked product, scan the serials the supplier printed. Skip any they did not serialize: Skydrop prints a serial for each of those when you complete.',
          'Choose the putaway bin for each line. If the warehouse has no bin to put stock in, add a storage bin first.',
          'A variance against what was declared does not block the receipt. It is recorded on the receipt.',
          'Complete and write stock: stock is written for what was counted on each product and the receipt closes.',
        ],
      },
      {
        heading: 'Mistakes and cancelling',
        steps: [
          'A completed receipt cannot be cancelled. A mistake is corrected with a stock adjustment, where the movement is visible.',
          'Cancelling a receipt that has not been completed writes nothing to stock, so nothing is removed. The receipt simply leaves the queue. Give a reason of at least 10 characters; it is recorded on the receipt.',
        ],
      },
      {
        heading: 'Sending a consignment on to India',
        steps: [
          'Dispatch to India moves the units out of the Bangladesh count. They sit in the Indian warehouse’s transit location until they land. Dispatched stock is on hand but cannot be sold until it lands and is counted.',
          'If a consignment has not been counted in Bangladesh you can count it first, or send it on unopened. Sent unopened, it travels on the client’s declared quantities and India is the only count.',
          'Enter how many units are leaving on this shipment. A large intake can travel in several shipments.',
          'Once dispatched, the consignment can no longer be cancelled.',
          'Moving stock between warehouses needs permission. Without it you will see "You do not have permission to move stock between warehouses."',
        ],
      },
      {
        heading: 'Labelling and cancelling a consignment',
        steps: [
          'Only STRICT-mode SKUs are labelled; the rest are counted in aggregate.',
          'Once labels have been printed at a station, the station is locked and cannot be moved. A consignment half-labelled in one country and half in the other cannot be told apart without opening every carton.',
          'If a label was damaged or lost, name the units only (do not reprint the sheet). Somebody else has to approve the request, then you print it.',
          'Cancelling a consignment removes stock already booked in from Skydrop and returns it to the client. This is impossible once the goods have left Bangladesh. Give a reason of at least 10 characters; it is recorded permanently.',
        ],
      },
    ],
    sources: [AD('rest'), AD('rest3'), AD('wh'), AD('extra')],
  },
  {
    id: 'staff-bins',
    audience: ['staff'],
    title: 'Bins: where stock sits, and moving it',
    summary:
      'The Bins page shows what is in every bin, builds the layout (zones and bins), switches location tracking on or off, and moves stock between bins.',
    keywords: [
      'bin',
      'shelf',
      'zone',
      'aisle',
      'rack',
      'floor',
      'location tracking',
      'move stock',
      'quarantine',
      'damaged bin',
      'transit bin',
      'returns hold',
      're-shelve',
    ],
    errorDomains: ['warehouse-bin-ops'],
    sections: [
      {
        heading: 'What the page shows',
        steps: [
          'Bins shows where stock physically sits and what is in each bin, with the product, client and batch on each line.',
          'Returns-hold, damaged and in-transit stock is shown but cannot be sold.',
          'Returns hold: returns received but not yet decided. Not sellable; finalising each return moves it on (back into stock, to the damaged bin, or written off).',
          'Damaged: held back from sale. Nothing is picked from a damaged bin.',
          'Quarantine: held back from sale until somebody decides what happens to it.',
          'In transit: on its way from another warehouse. Counted here so neither building’s count finds it missing; sellable once it arrives and is received.',
        ],
      },
      {
        heading: 'Location tracking',
        steps: [
          'Tracking on: receiving asks which bin the goods went into, and pick sheets name a shelf.',
          'Tracking off: everything goes to FLOOR and pick sheets name no location. Receiving can still note one, but it is only a note.',
          'Create at least one bin before turning tracking on, otherwise receiving would have nowhere to put anything.',
          'Turning it on does not relocate what is already in FLOOR. New receipts go into real bins; the FLOOR pile drains as it is picked, or you move it deliberately.',
          'Turning it off stops the system asking. It does not collapse the bins you have built: everything stays exactly where it is recorded.',
        ],
      },
      {
        heading: 'Building the layout',
        steps: [
          'A bin lives in a zone. Zones also carry pick order, so a picker walks the building in a sensible sequence. Create a zone with a short code, for example MAIN or RET.',
          'Add a bin from the three coordinates: aisle (1–2 letters), rack and shelf. You never type the bin code; it is built for you.',
          'Choose a type for the bin: storage (the normal shelf), picking, receiving, packing, returns hold, damaged or quarantine. Returns hold, damaged and quarantine are not pickable.',
          'Removing a bin deletes it from the warehouse’s layout and cannot be restored. The server refuses while the bin still holds stock or an active reservation.',
        ],
      },
      {
        heading: 'Moving stock',
        steps: [
          'Do a move once the goods have physically been carried across: the record follows the shelf, and a picker sent to the new bin needs to find them there.',
          'Move stock between bins: re-shelving never changes the batch. A move answers where something is, not what it is.',
          'Move the whole bin: everything standing in the source bin is recorded as moved to the destination in one transaction, and you do not list the contents. Moving it back is the same action in reverse.',
          'Apply a list of moves: all of it commits or none of it does. Every line needs a client, variant, batch, a whole quantity of at least one, and two different bins.',
          'A bin that is not pickable keeps its stock counted, but the stock stops being sellable and orders will not allocate against it.',
          'The source bin’s FLOOR pile counts too: this is how you shelve stock that was received before tracking was switched on.',
        ],
      },
    ],
    sources: [AD('rest3'), AD('rest'), AD('rest2'), AD('wh'), AD('extra')],
  },
  {
    id: 'staff-adjustments-cycle-counts',
    audience: ['staff'],
    title: 'Stock adjustments and cycle counts',
    summary:
      'An adjustment corrects counted stock for one batch in one bin; a cycle count checks the shelves against the system and raises an adjustment for every difference.',
    keywords: [
      'adjustment',
      'stock adjustment',
      'cycle count',
      'stock take',
      'count',
      'discrepancy',
      'variance',
      'approval',
      'threshold',
      'write off',
      'correct stock',
    ],
    errorDomains: ['inventory-adjustment', 'inventory-cycle-count'],
    sections: [
      {
        heading: 'Raising a stock adjustment',
        steps: [
          'An adjustment corrects counted stock for one batch in one bin. Choose Add stock or Remove stock and enter the number of units, unsigned.',
          'Stock is held per batch per bin, so you need the variant, the bin and the batch. Read them off the count sheet or the movements report.',
          'Unit cost is only needed when the batch has no recorded cost. It is what decides whether the correction needs a second person.',
          'Say what happened. This is kept on the adjustment, and the approver reads it and nothing else.',
          'Below the value threshold the adjustment applies straight away. Above it, it waits for a second person before it moves any stock.',
        ],
      },
      {
        heading: 'Approving or rejecting',
        steps: [
          'Anything above the value threshold waits on the Adjustments page for a second pair of eyes before it moves inventory.',
          'Approving moves stock.',
          'When rejecting, give the reason. It is stored on the adjustment permanently, so write what you checked and what was actually on the shelf.',
          'Smaller corrections apply immediately: look under Executed for those.',
        ],
      },
      {
        heading: 'Cycle counts',
        steps: [
          'A cycle count is a physical verification against what the system believes. Completing a count raises an adjustment for every difference.',
          'Schedule a count for a warehouse, a zone or a handful of SKUs. It is created as Scheduled and nothing is counted or changed until someone starts it.',
          'Start the count before recording lines.',
          'Record each counted line against a variant and a bin (a count is per bin and batch) with the counted quantity. The system quantity is snapshotted when you record, not when the count was scheduled.',
          'Completing raises one adjustment for each line that differs from the system. If every line matches, completing raises none.',
        ],
      },
    ],
    sources: [AD('inv')],
  },
  {
    id: 'staff-pricing-and-fx',
    audience: ['staff'],
    title: 'Delivery and return fees, FX on fees, and the pricing preview',
    summary:
      'A client pays one flat delivery fee; a returned parcel adds a return fee. A fee is agreed in one currency and charged in rupees at the FX rate of the moment it is taken.',
    keywords: [
      'pricing',
      'fee',
      'flat fee',
      'delivery fee',
      'rto fee',
      'return fee',
      'fx',
      'exchange rate',
      'taka',
      'bdt',
      'inr',
      'currency',
      'override rate',
      'pricing preview',
    ],
    errorDomains: ['pricing', 'fx'],
    sections: [
      {
        heading: 'How a client is charged',
        steps: [
          'There is one flat delivery fee per client, anywhere in India. A per-client override beats the global default.',
          'A returned parcel costs the delivery fee plus a return fee. The return fee is charged when the parcel is physically received, not when a courier scan says it is coming back.',
          'If a returned order’s delivery fee is still unpaid, it is also taken when the return is received.',
          'Past orders show charges as they were persisted. They are never recomputed.',
          'A fee that works out to 0 is flagged and is refused rather than saved as a real price.',
        ],
      },
      {
        heading: 'FX on fees',
        steps: [
          'A fee is agreed in a currency and charged in rupees. Both the amount and its currency can be overridden per client, so a negotiated fee is one decision such as ৳250 or ₹180.',
          'A fee that is not in rupees is converted at the moment the charge is taken. The delivery fee converts when the order is created; the return fee converts when the return is received, which can be weeks later at a different rate.',
          'Each charge records its own agreed amount, currency and rate, so "why was I charged this amount?" can be answered later.',
          'A fee that cannot be priced is never a zero. When there is no FX rate for it, it is flagged, and the fix is on the FX screen rather than the pricing screen.',
        ],
      },
      {
        heading: 'The FX screen',
        steps: [
          'FX rates lists the current rate for each currency pair. Use Override to set the first rate for a pair.',
          'An override is saved as a manual rate and goes into the audit log and the history with the reason you give.',
          'Every change is kept in the append-only history, most recent first. Open Timeline on a pair to see it.',
        ],
      },
      {
        heading: 'The pricing preview',
        steps: [
          'Pricing preview shows what the engine would charge for a shipment, without creating an order to find out.',
          'Enter the destination pincode, weight, declared value, payment type (prepaid or cash on delivery) and the COD amount. The courier is optional and defaults to the system courier.',
          'The result lists the lines, GST and the total, plus a note when the engine answered but had to fall back on something. Read those notes before quoting the number to anybody.',
          'The margin shown (what we charge against what the courier costs us) is internal only. It is never shown to a client and never touches their wallet.',
        ],
      },
      {
        heading: 'Orders that finished with no charge',
        steps: [
          'An order with no charge rows is billed nothing when it delivers. "Add the missing charges" finds those orders and prices them at the current flat fee; it writes the charge lines only and takes nothing from a wallet.',
          'Preview first, then use the second button. Charging the unbilled orders is a real debit against a real client balance and cannot be undone from there.',
          'Only delivered or returned orders are eligible. An in-transit order is billed when it lands.',
        ],
      },
    ],
    sources: [INV('pricing'), AD('money'), AD('rest')],
  },
  {
    id: 'staff-inbound-freight',
    audience: ['staff'],
    title: 'Inbound freight bills (recording, settling, waiving, withdrawing)',
    summary:
      'One freight bill per BD to India consignment arrival; record it, record what we paid the forwarder, and settle, waive or withdraw the bill.',
    keywords: [
      'freight',
      'inbound freight',
      'freight bill',
      'forwarder',
      'pay now',
      'pay later',
      'receivable',
      'waive',
      'withdraw',
      'void',
      'settle',
      'our cost',
      'chargeable weight',
    ],
    errorDomains: ['inbound-freight'],
    sections: [
      {
        heading: 'Recording a bill',
        steps: [
          'Record the freight invoice for a consignment once something has landed in India. There is one bill per consignment: recording it twice is refused, and a client who shipped straight to India is refused outright.',
          'Only counted stops on Bangladesh-routed consignments appear in the list of stops to bill.',
          'Which stop is billed depends on the terms. On pay-in-advance terms it is the Bangladesh intake, billed before the goods fly. On pay-now and pay-later it is the India arrival, which is what a forwarder invoices. A consignment landing in two shipments gets one bill each.',
          'Price each product the way the invoice does: per kg or per piece, at its own rate. Every product must be priced.',
          'A per-kg line needs the chargeable weight from the invoice, not one worked out from the catalogue. Volumetric weight and rounding up to the next half-kilo are both normal.',
          'Enter the figures in the currency the rate was agreed in, exactly as on the invoice. The bill is converted to rupees at the rate in force when it is recorded, and the client is charged rupees either way.',
          'Leave the mode alone unless this consignment is an exception: whatever is already in force applies. Choosing one pins the consignment to it, and it decides which stop the bill hangs on.',
        ],
      },
      {
        heading: 'What the terms mean',
        steps: [
          'Pay now debits the client’s wallet immediately.',
          'Pay later leaves a receivable that amortises per unit as the stock sells.',
          'Pay in advance bills the Bangladesh intake before it flies.',
        ],
      },
      {
        heading: 'Our cost (what the forwarder charged us)',
        steps: [
          'Our cost is what the forwarder charged us, in rupees. The page shows what we billed the client, less what the forwarder charged us.',
          'Record the cost alone when their invoice has arrived but has not been paid. No money is recorded as leaving any account.',
          'Record the payment itself when it goes out. It records the money leaving the account and attributes it to this consignment in one step. Our cost becomes the sum of every payment against it.',
          'Do not record it as a loose expense instead: that would count the same cost twice in the P&L.',
        ],
      },
      {
        heading: 'Settle, waive, withdraw',
        steps: [
          'Settle debits the client’s wallet by the outstanding amount for that arrival. The ledger entry is permanent.',
          'Waive is for a bill that was right and we chose to forgive. No wallet movement; the bill stays countable as a waiver rather than disappearing. It needs a reason, and it is audited at HIGH severity.',
          'Withdraw is for a bill that was wrong, such as a mistyped rate or a recount. Whatever it charged goes back to the client’s wallet. Raise the corrected bill afterwards; until you do, that arrival has no freight against it. The client sees the reason on their consignment.',
          'If the lines add up to less than the bill, part of the bill is attached to no line and will never be recovered as units sell.',
        ],
      },
    ],
    sources: [AD('money'), AD('rest'), AD('extra')],
  },
  {
    id: 'staff-notifications',
    audience: ['staff'],
    title: 'Notifications: your inbox, what reaches you, and sending a broadcast',
    summary:
      'The inbox lists what was sent to you; Settings lets you silence topics; Broadcasts send a message to a chosen audience and cannot be recalled.',
    keywords: [
      'notification',
      'inbox',
      'broadcast',
      'announcement',
      'mute',
      'silence',
      'topic',
      'audience',
      'send message to clients',
    ],
    errorDomains: ['notification-audience'],
    sections: [
      {
        heading: 'Your inbox',
        steps: [
          'Notifications shows everything sent to you. Anything needing you will appear there.',
          'You can mark one read or unread, delete one, mark all read, or clear all. Clearing removes every notification from your inbox, including ones not loaded on the page.',
          'Use "Choose what reaches you" to switch off anything you would rather not see.',
        ],
      },
      {
        heading: 'What reaches you',
        steps: [
          'Switch off any topic you would rather not see.',
          'Messages about your account and credentials are not listed. They only ever go to your email and cannot be silenced.',
        ],
      },
      {
        heading: 'Sending a broadcast',
        steps: [
          'A broadcast is a message you choose to send. It cannot be recalled, so the count comes first: press "How many is that?" to see how many people it reaches.',
          'Choose who it reaches: every client, one company, a role or a permission at one company, one person at a client, every staff member, a staff role or permission, everyone at one member store, a member-store permission or user, or everyone subscribed to a topic.',
          'Prefer a permission to a role where one fits. A company can rename its own roles, while a permission is the durable way to say "whoever handles orders there".',
          '"Everyone subscribed to a topic" means people who opted in to that topic on their own notifications page.',
          'Send to the number you were shown. If anyone joined or left that audience since the count, the server refuses rather than sending to a number you were not shown.',
          'The page lists what has been sent, with how many were reached and how many delivered.',
        ],
      },
    ],
    sources: [AD('misc')],
  },
  {
    id: 'staff-roles-permissions',
    audience: ['staff'],
    title: 'Staff, roles and permissions',
    summary:
      'A role is a set of permissions; a person may hold several, and what they can do is everything those roles cover between them.',
    keywords: [
      'role',
      'roles',
      'permission',
      'permissions',
      'staff',
      'invite staff',
      'access',
      'deactivate',
      'cannot sign in',
      'rbac',
    ],
    errorDomains: ['staff-rbac', 'staff-invitation'],
    sections: [
      {
        heading: 'Roles',
        steps: [
          'A role is a set of permissions. Create as many as the work needs; the permissions themselves are fixed by the system.',
          'Create one when a job needs a combination of permissions the seeded roles do not cover.',
          'Search permissions by name, explanation or key. Permissions that can move money or stock are marked.',
          'Somebody may hold several roles, and what they can do is the union of them. The People column counts a person once per role they hold, so it adds up to more than the size of the team.',
          'A role that grants everything, including permissions added later, cannot be changed.',
          'Deleting a role cannot be undone. Nobody holds the role at that point, so no one loses access.',
        ],
      },
      {
        heading: 'Staff',
        steps: [
          'Invite staff to create a one-time link for them to set their password. The roles are fixed at invite time and can be changed afterwards.',
          'Choose at least one role. Somebody holding none cannot sign in at all, so the server refuses an invitation without any.',
          'Pick an access tier for how much of the console they reach, plus the job functions they do.',
          'The invitation link is shown only once; copy and share it. You can resend an invitation or revoke it, and revoking stops the link working.',
          'You can see the team and invite people, but changing which roles somebody holds needs the “Manage roles and permissions” permission.',
          'Change roles shows what a person gains and loses. Removing their last role signs them out and they cannot sign in again; the server refuses this.',
          'Deactivating a staff member means they can no longer sign in to the console.',
        ],
      },
    ],
    sources: [AD('rest'), AD('rest2'), AD('rest3'), AD('sell'), AD('extra')],
  },
];
