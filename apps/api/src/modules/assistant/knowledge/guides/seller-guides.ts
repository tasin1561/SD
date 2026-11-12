import type { Guide } from '../knowledge.types';

const S = (file: string): string => `apps/seller/src/i18n/messages/${file}.ts`;
const UI = 'packages/ui/src/app/i18n/ui-messages.ts';

/**
 * Guides for a CLIENT (UI word; "seller" in code). Plain words, nothing
 * internal. Every line traces to a source listed on its guide.
 */
export const SELLER_GUIDES: readonly Guide[] = [
  {
    id: 'seller-find-anything',
    audience: ['seller'],
    title: 'Find any order fast: the search box at the top',
    summary:
      'The search box at the top of every page finds an order by number, your reference, the customer, the phone, the AWB or a ticket number.',
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
          'Use the search box in the bar at the top of every page ("Order, AWB, ticket, name or phone…").',
          'Type at least 2 characters and wait a moment. It searches the order number, your own reference, the recipient’s name and phone, the waybill (AWB), and a ticket number (TK-…).',
          'Pick the result to open that order or ticket.',
          'If nothing matches, check the number for a typo, or look in the Orders list.',
        ],
      },
    ],
    sources: [S('authedShell')],
  },
  {
    id: 'seller-getting-started',
    audience: ['seller'],
    title: 'Getting started as a client',
    summary: 'How an account is opened, what to do first, and the order of the main steps.',
    keywords: ['begin', 'new', 'first time', 'onboarding', 'invite', 'sign up', 'login'],
    sections: [
      {
        heading: 'Your account',
        steps: [
          'Skydrop accounts are opened by invitation. Skydrop sets up your warehouse space, courier accounts and terms before your first parcel moves.',
          'Sign in with the details from your invitation. There is no sign-up form, because accounts are invite-only.',
          'The dashboard shows your most recent orders, what you are owed, and where to go next.',
        ],
      },
      {
        heading: 'The usual order of work',
        steps: [
          '1. Add your products (Products).',
          '2. Send stock to the Indian warehouse (Add stock).',
          '3. Create orders for your customers (Orders).',
          '4. Our call centre phones each customer to confirm. Then the warehouse packs the parcel and a courier delivers it.',
          '5. Follow parcels on the Tracking page.',
          '6. Add your bank details on your profile before your first withdrawal. Cash on delivery (COD) money comes into your wallet.',
        ],
      },
    ],
    sources: [
      S('signUp'),
      S('dashboard'),
      S('wallet'),
      S('orderNew'),
      'docs/invariants/consoles.md',
      'CLAUDE.md',
    ],
  },
  {
    id: 'seller-add-products',
    audience: ['seller'],
    title: 'Adding products',
    summary: 'Create a product with its variants and SKUs, or import a whole catalogue.',
    keywords: [
      'product',
      'sku',
      'variant',
      'catalogue',
      'catalog',
      'csv',
      'import',
      'size',
      'colour',
    ],
    sections: [
      {
        heading: 'Create one product',
        steps: [
          'Go to Products and choose New product. A product is one item plus every variant it ships in.',
          'A single item needs no options. It gets one SKU.',
          'For a product with several colours, sizes or packs, add options. Two options is the limit, for example Colour and Size. Give each option its own name.',
          'Each variant needs its own SKU. Skydrop suggests SKUs from the product name, and you can edit them.',
          'A SKU is permanent once saved, because every order, pick and stock count refers to it.',
          'Weight and dimensions are asked once on the product. A variant that differs, such as a heavier size, can override its own value on the variant page.',
        ],
      },
      {
        heading: 'Add variants to a product you already have',
        steps: [
          'Reuse the existing product reference. The new variants are added to that product and no second product is made. They inherit its weight and dimensions.',
        ],
      },
      {
        heading: 'If some variants fail to save',
        steps: [
          'The product is still created. The page lists the variants that could not be added.',
          'Fix them and save again. Only the missing ones are sent.',
        ],
      },
      {
        heading: 'Bringing in a whole catalogue',
        steps: [
          'Use the CSV import on the Products page. A re-upload matches on your own product reference.',
        ],
      },
    ],
    sources: [S('productNew')],
  },
  {
    id: 'seller-send-stock',
    audience: ['seller'],
    title: 'Sending stock to the warehouse (consignments)',
    summary: 'Announce a consignment before it ships, follow it, and see what was counted.',
    keywords: [
      'consignment',
      'inbound',
      'stock',
      'warehouse',
      'ship',
      'dhaka',
      'freight',
      'receive',
      'count',
    ],
    errorDomains: ['consignment', 'inbound-freight'],
    sections: [
      {
        heading: 'Announce it',
        steps: [
          'Open Add stock (the Inbound page) and create a consignment before the goods ship. Receiving then knows to expect it, and you can follow it.',
          'Say where you are sending it and what is in it. The warehouse counts against what you declare.',
          'Add at least one product with a whole-number quantity.',
          'Unit cost is optional. If you give it, landed cost and margin are more accurate.',
        ],
      },
      {
        heading: 'Two ways to ship',
        steps: [
          'You ship to our Indian warehouse yourself: one arrival, one count, and no inbound freight from us.',
          'You ship to Dhaka and we move it to India: we charge inbound freight for this option. The bill is raised once the forwarder invoices us.',
        ],
      },
      {
        heading: 'Changing or cancelling',
        steps: [
          'You can change a consignment only while it is still pending. Once the warehouse starts receiving, what you declared is what they count against.',
          'When you change the product list, you replace the whole list. Leave the lines that are right alone.',
          'Cancelling is possible only before the consignment leaves for India. The goods come back to you, and anything already counted is taken off your stock. Give a reason of at least ten characters.',
        ],
      },
      {
        heading: 'After it ships',
        steps: [
          'Open the consignment to see its timeline and what each warehouse counted against what you declared.',
          'Units that have not been counted in India yet are not sellable until they land.',
          'A different count blocks nothing. Your stock is what was counted. If the difference is not yours, raise an issue.',
        ],
      },
    ],
    sources: [S('inbound'), S('inboundDetail'), S('consignmentWords')],
  },
  {
    id: 'seller-create-order',
    audience: ['seller'],
    title: 'Creating an order (the order form and the address check)',
    summary:
      'Fill the order form correctly: shop, products, customer, payment, and the address check score.',
    keywords: [
      'order',
      'new order',
      'form',
      'cod',
      'prepaid',
      'pin',
      'pincode',
      'address',
      'score',
      'collectable',
      'declared value',
      'weight',
      'phone',
    ],
    errorDomains: ['order', 'address-check', 'shipment-address'],
    sections: [
      {
        heading: 'The form',
        steps: [
          'Go to Orders and choose New order.',
          'Every order is filed under one of your shops. Add another shop to sell under more than one brand.',
          'Add at least one product from the list on the right.',
          'Fill in who it goes to. Stock is held when the call centre confirms the order, not when you create it.',
        ],
      },
      {
        heading: 'Customer details',
        steps: [
          'The phone number must have the right number of digits and start with 6, 7, 8 or 9.',
          'Address line 1 is the address only, in this order: Village or City, Post Office, Police Station, District. No extra words. The PIN decides the rest.',
          'Address line 2 is the landmark only, such as a hospital, school or shop nearby. Never copy line 1 into it. An order with both lines the same is held.',
          'Check the PIN twice. A wrong PIN is the single most expensive typing mistake on this form. If a PIN does not exist you can still place the order, but check it first.',
        ],
      },
      {
        heading: 'Payment, value and weight',
        steps: [
          'Cash on delivery (COD): the collectable amount must be more than zero. Your default extra amount, set in Settings, is added to the collectable.',
          'Prepaid: the driver hands the parcel over and takes no money.',
          'Declared value is for customs, not collection. It adds up from the catalogue.',
          'Weight adds up from the catalogue. Type a number to override it. It stays 0 if none of the products has a weight.',
        ],
      },
      {
        heading: 'The address check',
        steps: [
          'The address check runs by itself once the PIN and both address lines are filled. Use Check address or Check again to ask again. The customer sees nothing of it.',
          'It shows a validity score out of 100, and a suggested action: Looks deliverable, Confirm with the customer, or Do not ship as written.',
          'It may also show a return risk percentage, and questions to ask the customer.',
          'If the check is unavailable, the order saves exactly as usual. Ring the customer if the address looks thin. We check again in the background.',
          'Our courier may not deliver to some PINs. The order can still be placed.',
        ],
      },
      {
        heading: 'Warnings you may see',
        steps: [
          'Duplicate warning: an earlier order to the same number has not been packed yet. If it is a separate parcel, tick the box to say you checked. If you entered the same order twice, cancel and check.',
          'Short of stock: you can still place the order. Stock on its way in will cover it, but the call centre cannot confirm an order we cannot pick, so it waits.',
        ],
      },
      {
        heading: 'Submit',
        steps: [
          'The order is created and joins the call queue. The call centre phones the customer to confirm.',
          'Many orders at once: use the CSV import. Rows that are missing something or look like duplicates wait in the Pending list for your decision. Everything else imports.',
        ],
      },
    ],
    sources: [S('orderNew'), S('guidance'), S('orderPending'), S('settingsOrders'), UI],
  },
  {
    id: 'seller-after-submit',
    audience: ['seller'],
    title: 'What happens after you submit an order',
    summary: 'Confirmation call, picking, packing, dispatch, and what you can still change.',
    keywords: [
      'confirm',
      'call',
      'status',
      'pending',
      'pick',
      'pack',
      'dispatch',
      'waybill',
      'awb',
      'unreachable',
      'out of stock',
    ],
    errorDomains: ['order-reattempt', 'delivery-action'],
    sections: [
      {
        heading: 'The steps',
        steps: [
          'Step 1: the order joins the call queue. A Skydrop agent phones the customer to confirm.',
          'Step 2: when the customer confirms, your stock is held for the order and a courier waybill is booked.',
          'Step 3: the warehouse picks and packs the parcel.',
          'Step 4: the parcel is handed to the courier and goes out for delivery.',
          'An out-of-stock order keeps its place and can be confirmed once the stock is in.',
        ],
      },
      {
        heading: 'What you can still change',
        steps: [
          'A draft can be changed in full.',
          'Once an order is waiting on the call centre, you can still correct the recipient and the notes.',
        ],
      },
      {
        heading: 'If the customer does not answer',
        steps: [
          'Our agents ring your customer more than once. If nobody answers by the last try, what happens depends on your settings: the order is either closed as unreachable, or it waits under Needs attention for you to decide. The Unreachable customers page lists the orders that are waiting.',
          'If it is waiting for you, open it and tell us to keep trying, or let it go. If you leave it, we let it go for you after a few days.',
        ],
      },
      {
        heading: 'If you switch confirmation calls off',
        steps: [
          'In your order settings you can turn confirmation calls off. Orders then wait in your list and confirm on their own when the time you set runs out. The time is whole hours, up to 7 days.',
          'You can send an order for a call to confirm it sooner.',
          'The confirmation call is what keeps COD returns down. A parcel that comes back is charged to you at the usual return fee.',
        ],
      },
    ],
    sources: [
      S('orderNew'),
      S('orderEdit'),
      S('needsAttention'),
      S('orderUnreachable'),
      S('callConfirmation'),
      'apps/associate/src/i18n/messages/orders.ts',
      'packages/ui/src/status/index.ts',
      'CLAUDE.md',
    ],
  },
  {
    id: 'seller-tracking',
    audience: ['seller'],
    title: 'Tracking your parcels',
    summary: 'Where to follow a parcel, and why a new parcel may show nothing yet.',
    keywords: [
      'track',
      'tracking',
      'where is my parcel',
      'status',
      'scan',
      'transit',
      'out for delivery',
      'delivered',
    ],
    errorDomains: ['seller-tracking', 'tracking'],
    sections: [
      {
        heading: 'Following a parcel',
        steps: [
          'Open Tracking. A parcel appears there once it has been handed to the courier.',
          'The first scan usually appears within a day of pickup. Until then you may see that the courier has the parcel but has not reported on it.',
          'Stages you will see include In transit, Out for delivery and Delivered.',
          'On the dashboard, one number is confirmed and dispatched but not delivered. Another is delivered and waiting on the courier to remit the cash to us.',
        ],
      },
      {
        heading: 'A parcel that never arrived',
        steps: [
          'If a parcel went out for delivery and never arrived, it shows under Needs attention. We chase the courier. That page says how far we have got.',
        ],
      },
    ],
    sources: [S('tracking'), S('dashboard'), S('needsAttention')],
  },
  {
    id: 'seller-failed-delivery',
    audience: ['seller'],
    title: 'Failed delivery: what you can ask us to do',
    summary:
      'When the courier could not hand a parcel over: another attempt, a call to the customer, or a return.',
    keywords: [
      'failed delivery',
      'ndr',
      'not delivered',
      'reattempt',
      're-attempt',
      'redeliver',
      'customer not available',
      'undelivered',
    ],
    errorDomains: ['delivery-action', 'order-reattempt'],
    sections: [
      {
        heading: 'What happens first',
        steps: [
          'When the courier could not hand a parcel over, we queue a call to your customer to find out why.',
          'You can also tell us what to do. Open the order and pick one of the three choices below.',
        ],
      },
      {
        heading: 'Your three choices',
        steps: [
          'Ask for another attempt: we ask the courier to try again. This is best when you know the customer will be there.',
          'Ask us to call the customer: one of our agents phones them and reports back. Nothing moves until you know more.',
          'Return the parcel: this is your decision. It reaches the courier immediately and cannot be undone. The parcel comes back to our warehouse, the sale ends, and a return fee applies. The order page shows the fee before you confirm.',
        ],
      },
      {
        heading: 'Adding a note',
        steps: [
          'Add anything that helps, such as the customer called you, they will be home Saturday, or the address was wrong.',
          'A note or a call request is read by an operator and acted on. Nothing reaches the courier automatically.',
        ],
      },
    ],
    sources: [S('orderDelivery'), S('needsAttention')],
  },
  {
    id: 'seller-returns',
    audience: ['seller'],
    title: 'Returns (RTO)',
    summary: 'What happens when a parcel comes back, and what happens to the stock.',
    keywords: ['rto', 'return', 'returned', 'return to origin', 'damaged', 'restock', 'refund'],
    errorDomains: ['customer-return'],
    sections: [
      {
        heading: 'When a parcel comes back',
        steps: [
          'A returned parcel comes back to our warehouse. The sale ends and a return fee applies.',
          'The warehouse looks at what you got back, item by item.',
          'Good items go back into your sellable stock.',
          'Damaged items can be kept aside for you, and are never sold.',
          'If an item is damaged or missing, a ticket is opened to you. Any refund is decided on that ticket.',
        ],
      },
      {
        heading: 'Keeping returns down',
        steps: [
          'The confirmation call helps keep COD returns down.',
          'Check the PIN and address on every order. The address check score and the suggested action help.',
        ],
      },
    ],
    sources: [
      S('orderDelivery'),
      S('tickets'),
      S('callConfirmation'),
      'apps/admin/src/i18n/messages/wh.ts',
    ],
  },
  {
    id: 'seller-wallet-cod-payouts',
    audience: ['seller'],
    title: 'Wallet, COD and payouts',
    summary: 'How COD money reaches your wallet, how to top up, and how to withdraw.',
    keywords: [
      'wallet',
      'balance',
      'cod',
      'cash on delivery',
      'remittance',
      'payout',
      'withdraw',
      'withdrawal',
      'top up',
      'topup',
      'bank',
      'money',
    ],
    errorDomains: ['seller-wallet', 'wallet-topup', 'seller-bank-change'],
    sections: [
      {
        heading: 'What the wallet shows',
        steps: [
          'The wallet shows what is owed to you. It is COD net of charges per delivered order. Payouts reduce it as we pay you out.',
          'When COD reaches you and what is charged are set by Skydrop. Every rule is listed on the wallet page. Ask us if one looks wrong for your account.',
          'The value of the stock you hold with us is most of what lets the balance go below zero at all. It clears as those goods sell, or you can top up to clear it now.',
        ],
      },
      {
        heading: 'Top up',
        steps: [
          'Send money to one of our bank accounts first. Then record it on the wallet page.',
          'Give a transaction ID or upload a receipt. Both is better.',
          'We check every transfer against our bank statement by hand. It usually takes 24 to 48 hours. Your wallet is credited when it is matched, and we email you either way.',
          'If no bank account is shown, contact support before transferring anything.',
        ],
      },
      {
        heading: 'Withdraw',
        steps: [
          'Add your bank details on your profile first. Without them there is nowhere to send the money.',
          'Request a withdrawal. We review it and transfer to the bank account on your profile.',
          'Your balance changes when the transfer is recorded, not when you request it.',
          'You can switch on automatic withdrawals. We then raise a request for you at a set hour, leaving the balance you choose to keep (at least the minimum on your account). It passes the same checks as one you make by hand.',
        ],
      },
    ],
    sources: [S('wallet'), S('dashboard')],
  },
  {
    id: 'seller-tickets',
    audience: ['seller'],
    title: 'Tickets (issues about a parcel)',
    summary: 'Raise an issue about a parcel, and how a ticket ends.',
    keywords: [
      'ticket',
      'issue',
      'damage',
      'damaged',
      'missing',
      'lost',
      'dispute',
      'claim',
      'complaint',
      'support',
    ],
    errorDomains: ['ticket'],
    sections: [
      {
        heading: 'Raising one',
        steps: [
          'If a parcel arrives damaged, goes missing, or something else looks wrong, raise an issue from the order on the Tickets page.',
          'Damage we find on returns also appears here as a ticket.',
          'Our team may open a ticket with the courier when a delivery needs chasing. Anything they say appears on your ticket in their words.',
        ],
      },
      {
        heading: 'How a ticket ends',
        steps: [
          'A ticket closes in one of four ways: we refund you, we return the goods, you accept the write-off, or the claim is not upheld.',
          'Settled tickets that end in a refund credit your wallet.',
          'The full discussion stays on the ticket and is never edited afterwards.',
          'If a closed ticket still has a problem, raise a new issue.',
          'Tickets belong to the company account. If a colleague raised it from another login, ask them to open it.',
        ],
      },
    ],
    sources: [S('tickets')],
  },
  {
    id: 'seller-stuck',
    audience: ['seller'],
    title: 'Stuck? The most common situations',
    summary: 'Quick answers for the problems clients meet most.',
    keywords: ['stuck', 'help', 'problem', 'not working', 'cannot', "can't", 'why', 'error'],
    sections: [
      {
        heading: 'My order is not moving',
        steps: [
          'A new order waits for the confirmation call. Stock is held only when the customer confirms.',
          'If the customer did not answer, look under Needs attention. Nothing happens to those orders until you decide.',
          'If you switched calls off, the order confirms on its own when its time runs out.',
        ],
      },
      {
        heading: 'I cannot edit an order',
        steps: [
          'A draft can be changed in full. An order waiting on the call centre allows only the recipient and the notes. After that, the order is locked.',
        ],
      },
      {
        heading: 'There is no waybill or tracking yet',
        steps: [
          'A waybill is booked once the call centre has confirmed the order.',
          'After pickup, the first courier scan usually shows within a day.',
        ],
      },
      {
        heading: 'My CSV rows are not all orders',
        steps: [
          'Rows that are missing something or look like duplicates wait in the Pending list for your decision. Everything else imported already.',
        ],
      },
      {
        heading: 'My top-up is not in the wallet',
        steps: [
          'We match transfers to our bank statement by hand. It usually takes 24 to 48 hours.',
        ],
      },
      {
        heading: 'I cannot withdraw',
        steps: [
          'Add your bank details on your profile. Without them there is nowhere for us to send the money.',
        ],
      },
      {
        heading: 'I cannot open a page',
        steps: [
          'Some pages open only for roles that have the right permission, such as the wallet. Ask whoever manages access for your team to give you a role that includes it.',
        ],
      },
      {
        heading: 'Still stuck',
        steps: ['If this is not covered, raise a support ticket and a person will pick it up.'],
      },
    ],
    sources: [
      S('orderNew'),
      S('needsAttention'),
      S('callConfirmation'),
      S('orderEdit'),
      S('orderPending'),
      S('wallet'),
      'apps/associate/src/i18n/messages/orders.ts',
      'apps/seller/src/lib/page-access.ts',
    ],
  },
];
