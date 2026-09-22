import { dummy } from './dummy';

/**
 * Site content, in one place.
 *
 * `platform` is what the PRODUCT does — read from the code base, true by
 * construction, and NEVER wrapped in `dummy()` (the scanner refuses it).
 * `business` is what the COMPANY says about itself — volumes, prices,
 * partners, people, places — and every value there is a `dummy()` until
 * the owner supplies the real one.
 *
 * Copy lives here rather than inline in components so a section can be
 * rewritten without touching its markup, and so the Bengali locale can
 * be added by adding a second object of the same shape.
 */

export const platform = {
  brand: {
    name: 'Skydrop',
    domain: 'skydrop.online',
    tagline: 'Sell in India. We carry the rest.',
    corridor: 'Bangladesh ⇄ India',
    email: 'hello@skydrop.online',
    apps: {
      seller: 'https://app.skydrop.online',
      store: 'https://reseller.skydrop.online',
      track: 'https://track.skydrop.online',
    },
  },
  nav: {
    primary: [
      { href: '/#services', label: 'Services' },
      { href: '/#platform', label: 'Platform' },
      { href: '/#resellers', label: 'Reseller stores' },
      { href: '/#pricing', label: 'Pricing' },
      { href: '/#faq', label: 'FAQ' },
    ],
    signIn: [
      { href: 'https://app.skydrop.online/login', label: 'Seller sign-in' },
      { href: 'https://reseller.skydrop.online/login', label: 'Store sign-in' },
    ],
    cta: { href: '/request-invite', label: 'Request an invite' },
    track: { href: 'https://track.skydrop.online', label: 'Track a parcel' },
    /** Mega-menu rows (u21) under two of the primary items; the rest are plain links. */
    mega: {
      Services: [
        {
          href: '/#services',
          label: 'Send to India',
          helper: 'Any Bangladeshi pickup to any Indian door',
          hue: 'saffron',
        },
        {
          href: '/#services',
          label: 'Send to Bangladesh',
          helper: 'The same rails, in reverse',
          hue: 'green',
        },
        {
          href: '/#services',
          label: 'Stock in India',
          helper: 'One consignment, then sellable stock',
          hue: 'teal',
        },
        {
          href: '/#services',
          label: 'Sell in India',
          helper: 'Phone-confirmed COD, picked, packed, paid',
          hue: 'violet',
        },
      ],
      Platform: [
        {
          href: '/#platform',
          label: 'Get your stock into India',
          helper: 'Consignments, counts, freight billing',
          hue: 'teal',
        },
        {
          href: '/#platform',
          label: 'Know what is on the shelf',
          helper: 'Catalogue, live stock, serials',
          hue: 'violet',
        },
        {
          href: '/#platform',
          label: 'Every order confirmed',
          helper: 'Call desk, journey, customer register',
          hue: 'saffron',
        },
        {
          href: '/#platform',
          label: 'Returns, unit by unit',
          helper: 'Inspection, dispositions, tickets',
          hue: 'magenta',
        },
        {
          href: '/#platform',
          label: 'Your money, itemised',
          helper: 'Wallet, top-ups, withdrawals, invoices',
          hue: 'green',
        },
        {
          href: '/#platform',
          label: 'Run it with your team',
          helper: 'Roles, notifications, your limits',
          hue: 'blue',
        },
      ],
    },
  },
  /** Jargon explained on hover — what the product means by each word. */
  glossary: {
    cod: {
      term: 'COD',
      title: 'Cash on delivery',
      body: 'The customer pays the courier at the door. The courier pays us; we credit you.',
      points: ['Every COD order confirmed by phone first', 'Credited to your wallet on settlement'],
    },
    rto: {
      term: 'RTO',
      title: 'Return to origin',
      body: 'A parcel the customer did not take comes back to our Indian warehouse.',
      points: ['Inspected unit by unit', 'Restocked, kept aside, or written off — your call'],
    },
    volumetric: {
      term: 'volumetric weight',
      title: 'Volumetric weight',
      body: 'Length × width × height ÷ 5000, in cm. Couriers charge the higher of this and the scale.',
      points: ['A big light box costs more than it weighs', 'Shown before you book'],
    },
    waybill: {
      term: 'waybill',
      title: 'Waybill (AWB)',
      body: "The courier's tracking number for one parcel — the code on the label and the tracking page.",
    },
    gstInvoice: {
      term: 'GST invoice',
      title: 'GST invoice',
      body: 'The tax document for a sale into India, issued from your seller account for every delivered order.',
    },
    instantPay: {
      term: 'Instant Pay',
      title: 'Instant Pay',
      body: "Your COD credited the moment the parcel is delivered, for a small fee — instead of waiting for the courier's payout.",
      points: ['Opt in per seller', 'Fee shown before you switch it on'],
    },
  },
  /** Section 2 — the four services, one scene each (what the product does, no figures). */
  services: [
    {
      id: 'to-india',
      hue: 'saffron',
      label: 'Send to India',
      ghost: 'INDIA',
      title: 'Send to India, door to door',
      body: 'A parcel from anywhere in Bangladesh to any Indian address. Booked with a courier the moment it is confirmed, tracked from our scan to the doorstep, in English and Hindi.',
      points: [
        'Pan-India delivery through integrated couriers',
        'Public tracking page in English and Hindi',
        'Returns come back to our Indian warehouse, inspected unit by unit',
      ],
    },
    {
      id: 'to-bangladesh',
      hue: 'green',
      label: 'Send to Bangladesh',
      ghost: 'DHAKA',
      title: 'Send to Bangladesh, the same way',
      body: 'From an Indian city to a Bangladeshi doorstep, on the same rails in reverse: confirmation, courier, tracking, and a person to ring if anything slips.',
      points: [
        'Booked and tracked like every Skydrop parcel',
        'One quote, agreed before anything moves',
        'Customer support on both sides of the border',
      ],
    },
    {
      id: 'import',
      hue: 'teal',
      label: 'Stock in India',
      ghost: 'STOCK',
      title: 'Your stock, held in India',
      body: 'Ship a consignment once — straight to India or via our Bangladesh warehouse. We count it in, hold it in bins and batches, and it becomes sellable stock you watch from Dhaka.',
      points: [
        'Straight to India, or via our Bangladesh warehouse',
        'Counted on arrival; a short count opens a ticket, nothing is blocked',
        'Live stock: on hand, reserved, available, in transit',
      ],
    },
    {
      id: 'sell',
      hue: 'magenta',
      label: 'Sell in India',
      ghost: 'SELL',
      title: 'Sell in India without an Indian operation',
      body: 'Orders come in, our call centre confirms each one by phone, the warehouse picks and packs against your stock, the courier delivers, and the COD lands in your wallet — itemised.',
      points: [
        'Every COD order confirmed by phone before it ships',
        'Picked, packed and scanned into the box the same day',
        'Your money itemised: COD collected, charges, freight, payouts',
      ],
    },
  ],
  /** Who we serve — three tabs, each true of the product today. */
  whoWeServe: [
    {
      id: 'sellers',
      label: 'Sellers',
      title: 'Bangladeshi e-commerce sellers',
      body: 'Sell to Indian customers with your stock already in India: phone-confirmed COD, same-day dispatch, returns handled, money sent home.',
      hue: 'blue',
    },
    {
      id: 'stores',
      label: 'Reseller stores',
      title: "Stores that sell a seller's stock under their own name",
      body: 'A store logs in to its own portal, sees only what the seller shows it, places orders, and gets its own wallet and reports — the seller decides the terms.',
      hue: 'violet',
    },
    {
      id: 'shippers',
      label: 'Shippers',
      title: 'Businesses moving goods across the corridor',
      body: 'Consignments from Dhaka to India, counted at both ends, freight billed per kilo or per piece, and a timeline you can show your own customers.',
      hue: 'teal',
    },
  ],
  /** How it works — the COURIER track first (this is a courier site), then the seller track. */
  howItWorksParcel: [
    {
      id: 'book',
      title: 'Book',
      body: 'Tell us where it is going and how big it is. The rate is agreed before anything moves, and a waybill is booked with the courier the moment you confirm.',
      runs: ['Quote agreed first', 'Waybill booked on confirmation', 'Tracking link issued'],
    },
    {
      id: 'pickup',
      title: 'Pickup',
      body: 'A courier collects from your door in Bangladesh or India. Label it or let us; the scan at pickup is where tracking starts.',
      runs: ['Door pickup', 'Labelled at pickup', 'First scan starts the timeline'],
    },
    {
      id: 'border',
      title: 'Border & customs',
      body: 'The parcel crosses as part of a declared consignment. We handle the paperwork; you see when it has left and when it has landed.',
      runs: ['Declared as a consignment', 'Paperwork ours', 'Left → landed, both stamped'],
    },
    {
      id: 'lastmile',
      title: 'Last-mile courier',
      body: 'On the far side it is handed to our courier network for the run to the address, with every scan flowing to the public tracking page.',
      runs: [
        'Handed to the courier network',
        'Every scan on the tracking page',
        'English and Hindi',
      ],
    },
    {
      id: 'delivered',
      title: 'Delivered',
      body: 'Signed for at the door. If it cannot be delivered it comes back to us, is inspected, and you are told — never lost in the gap.',
      runs: ['Signed for', 'Failed → returned and inspected', 'You are told either way'],
    },
  ],
  howItWorks: [
    {
      id: 'stock',
      title: 'Ship your stock once',
      body: 'You send inventory to our Indian warehouse — one consignment, not one parcel per order. We count it in and it becomes sellable stock you can watch.',
      runs: ['Counted on arrival', 'Straight to India or via Dhaka', 'Live stock figures'],
    },
    {
      id: 'call',
      title: 'We phone every buyer',
      body: 'An order is not dispatched because it was placed. Our call desk reaches the customer first and confirms the order, the address and the amount they will pay.',
      runs: ['Every attempt logged', 'No answer → re-queued', 'Unreachable → held, never shipped'],
    },
    {
      id: 'pack',
      title: 'Pick, pack, dispatch',
      body: 'Confirmed orders are picked against the batch they were reserved from, verified at the pack bench by scanning what goes in the box, and booked with a courier.',
      runs: ['Scanned into the box', 'Waybill via courier API', 'Refused lane → second courier'],
    },
    {
      id: 'deliver',
      title: 'Delivered, or properly returned',
      body: 'Tracking runs off courier scans. What comes back is opened and inspected — and the COD that was collected is remitted to you in Bangladesh.',
      runs: ['Public tracking · EN + HI', 'Returns inspected per item', 'COD remitted to BD'],
    },
  ],
  /** Why Skydrop — six instruments, each true of the product. */
  why: [
    {
      icon: 'boxes',
      title: 'A real stock system',
      body: 'Bins, batches, an append-only ledger and low-stock alerts — so what the screen says is on the shelf is what is on the shelf.',
      hue: 'teal',
    },
    {
      icon: 'truck',
      title: 'More than one courier',
      body: 'Booked through the courier API. A lane the first one will not carry is re-routed to the second; if both refuse, a person places it by hand.',
      hue: 'saffron',
    },
    {
      icon: 'undo',
      title: 'Returns you can see',
      body: 'Every returned parcel is opened and inspected at the warehouse. Restock, keep aside or write off is your call, item by item, and the stock moves to match.',
      hue: 'magenta',
    },
    {
      icon: 'chart',
      title: 'The numbers that matter',
      body: 'Confirmation rate, failed-delivery rate, return rate, dispatch times — reported per order, not summarised into one figure that hides the bad week.',
      hue: 'blue',
    },
    {
      icon: 'languages',
      title: 'Answered in Hindi',
      body: 'Your customers reach a desk that speaks their language, on their clock — for the confirmation call and for whatever they ask afterwards.',
      hue: 'green',
    },
    {
      icon: 'home',
      title: 'You stay in Bangladesh',
      body: 'No Indian office, no Indian staff, no GST registration to begin. Stock is held and dispatched under ours until you outgrow that.',
      hue: 'violet',
    },
  ],
  /** Compare — the same eight questions of all three routes. Estimates are marked. */
  compare: {
    columns: [
      { key: 'skydrop', name: 'Skydrop', note: 'this service' },
      { key: 'diy', name: 'Do it yourself', note: 'your own Indian entity' },
      { key: 'marketplace', name: 'Marketplace', note: 'sell on theirs' },
    ],
    rows: [
      // `kind` is the BENEFIT to the reader — good / bad / mixed — never the literal yes/no
      // (owner, Phase 4 review: "Indian entity required" showed Skydrop a red ✗ for the
      // GOOD answer). The word carries the fact; the tone carries what it means for you.
      {
        label: 'Time to first dispatch',
        skydrop: { kind: 'good', label: 'Under 3 weeks', estimate: true },
        diy: { kind: 'bad', label: '6+ months', estimate: true },
        marketplace: { kind: 'mixed', label: '1–2 months', estimate: true },
      },
      {
        label: 'Capital before order one',
        skydrop: { kind: 'good', label: 'Pay per order' },
        diy: { kind: 'bad', label: '₹50 lakh+', estimate: true },
        marketplace: { kind: 'good', label: 'Low' },
      },
      {
        label: 'Indian entity required',
        skydrop: { kind: 'good', label: 'Not needed to start' },
        diy: { kind: 'bad', label: 'Required' },
        marketplace: { kind: 'mixed', label: 'Varies' },
      },
      {
        label: 'COD confirmed by phone',
        skydrop: { kind: 'good', label: 'Every order' },
        diy: { kind: 'mixed', label: 'Build the desk yourself' },
        marketplace: { kind: 'bad', label: 'Not offered' },
      },
      {
        label: 'Stock held in India',
        skydrop: { kind: 'good', label: 'Our warehouse' },
        diy: { kind: 'mixed', label: 'Lease and staff it' },
        marketplace: { kind: 'mixed', label: 'On their terms' },
      },
      {
        label: 'Returns handling',
        skydrop: { kind: 'good', label: 'Inspected, per unit' },
        diy: { kind: 'mixed', label: 'Yours to solve' },
        marketplace: { kind: 'mixed', label: 'Limited visibility' },
      },
      {
        label: 'Brand and customer data',
        skydrop: { kind: 'good', label: 'Yours' },
        diy: { kind: 'good', label: 'Yours' },
        marketplace: { kind: 'bad', label: 'Theirs' },
      },
      {
        label: 'Money back to Bangladesh',
        skydrop: { kind: 'good', label: 'Built in' },
        diy: { kind: 'mixed', label: 'Arrange it yourself' },
        marketplace: { kind: 'mixed', label: 'Marketplace terms' },
      },
    ],
  },
  /** What you can and cannot send — border rules, stated plainly. */
  goods: [
    {
      name: 'Apparel and textiles',
      verdict: 'allowed',
      note: "Kurtis, sarees, menswear — the corridor's staple.",
    },
    {
      name: 'Handicrafts and home',
      verdict: 'allowed',
      note: 'Jute, cane, brass, ceramics — packed for the road.',
    },
    {
      name: 'Beauty and skincare',
      verdict: 'allowed',
      note: 'Sealed retail packs; declare ingredients.',
    },
    {
      name: 'Packaged snacks and dry food',
      verdict: 'allowed',
      note: 'Sealed, labelled, within shelf life.',
    },
    { name: 'Books and stationery', verdict: 'allowed', note: 'No customs surprises.' },
    {
      name: 'Electronics and accessories',
      verdict: 'case',
      note: 'Case by case — batteries and value limits apply.',
    },
    {
      name: 'Jewellery and watches',
      verdict: 'case',
      note: 'Declared value decides insurance and duty.',
    },
    {
      name: 'Liquids, aerosols and perfume',
      verdict: 'restricted',
      note: 'Restricted in air freight.',
    },
    {
      name: 'Loose batteries',
      verdict: 'restricted',
      note: 'Not accepted; installed batteries are case by case.',
    },
    {
      name: 'Perishables and fresh food',
      verdict: 'restricted',
      note: 'No cold chain across the border.',
    },
    { name: 'Currency, documents of value', verdict: 'restricted', note: 'Not carried.' },
    { name: 'Weapons, tobacco, alcohol', verdict: 'restricted', note: 'Prohibited at the border.' },
  ],
  /** Coverage — the six named lanes; transit figures are the business's. */
  coverageCities: ['Dhaka', 'Kolkata', 'Delhi', 'Mumbai', 'Bengaluru', 'Chennai'],
  /** Geography for the estimator's cascading pickers — public facts. */
  geography: {
    BD: {
      name: 'Bangladesh',
      regions: {
        Dhaka: ['Dhaka', 'Gazipur', 'Narayanganj', 'Tangail'],
        Chattogram: ['Chattogram', "Cox's Bazar", 'Cumilla'],
        Rajshahi: ['Rajshahi', 'Bogura', 'Pabna'],
        Khulna: ['Khulna', 'Jashore', 'Kushtia'],
        Sylhet: ['Sylhet', 'Moulvibazar'],
        Rangpur: ['Rangpur', 'Dinajpur'],
        Barishal: ['Barishal', 'Patuakhali'],
        Mymensingh: ['Mymensingh', 'Jamalpur'],
      },
    },
    IN: {
      name: 'India',
      regions: {
        'West Bengal': ['Kolkata', 'Howrah', 'Siliguri', 'Durgapur'],
        Delhi: ['New Delhi', 'Dwarka', 'Rohini'],
        Maharashtra: ['Mumbai', 'Pune', 'Nagpur', 'Nashik'],
        Karnataka: ['Bengaluru', 'Mysuru', 'Mangaluru'],
        'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai'],
        Telangana: ['Hyderabad', 'Warangal'],
        Gujarat: ['Ahmedabad', 'Surat', 'Vadodara'],
        'Uttar Pradesh': ['Lucknow', 'Noida', 'Kanpur', 'Varanasi'],
        Assam: ['Guwahati', 'Silchar'],
        Bihar: ['Patna', 'Gaya'],
        Odisha: ['Bhubaneswar', 'Cuttack'],
        Rajasthan: ['Jaipur', 'Udaipur'],
      },
    },
  },
  /** Parcel types and goods categories the estimator offers. */
  parcelTypes: [
    { id: 'document', title: 'Documents', helper: 'Up to 0.5 kg, flat' },
    { id: 'parcel', title: 'Parcel', helper: 'A box, up to 5 kg' },
    { id: 'bulk', title: 'Consignment', helper: 'Stock for the warehouse' },
  ],
  goodsCategories: [
    'Apparel',
    'Handicrafts',
    'Beauty',
    'Snacks',
    'Books',
    'Electronics',
    'Jewellery',
    'Home',
  ],
  /**
   * 3A — the owner's verbatim capability list (2026-09-21). THE source of
   * truth for every on-page claim: FEATURES-COVERAGE.md maps each bullet to
   * the beat, checklist line or section element that shows it, and no
   * heading, promise or caption may claim more than these say.
   */
  claims: {
    'SELLER — Getting stock into India': [
      'Declare a consignment: direct to India, or two-leg via your Dhaka intake (goods counted in BD, flown, counted again in India)',
      'Per-leg counts with variance recorded in both directions — a short count opens a ticket naming the leg; a surplus sends a notice. Neither blocks your stock',
      'Cancel before dispatch (goods go back to you, recorded as returned — not written off)',
      "Inbound freight billed three ways, your choice per seller or per consignment: pay now (on arrival), pay later (each unit's share taken as it's delivered), pay in advance (billed at the Dhaka count, before it flies). Rate agreed in taka or rupees and converted at the moment you're charged",
    ],
    'SELLER — Catalogue & inventory': [
      'Products, variants, images (drag-and-drop), CSV import',
      'Live stock across warehouses, bins and batches; low-stock alerts',
      'STRICT mode: per-unit serials, scanned at pick and pack, with a discrepancy report',
    ],
    'SELLER — Orders': [
      'Single entry, bulk CSV, or your own system via API key + webhooks',
      'Full lifecycle timeline, edit, cancel',
      'Our call centre confirms every COD order by phone; you see each attempt and outcome',
      'Customer list with per-customer order history and reputation',
    ],
    'SELLER — Returns': [
      'RTO tracked to your warehouse; inspect per unit — two of an item can go different ways (restock / keep aside damaged / write off)',
      'Scrap and damage tickets opened automatically with the details, and refunds settled onto them',
    ],
    'SELLER — Money': [
      'Wallet with a full ledger; top-ups against a bank transfer (checked by a human before crediting), withdrawals manual or automatic',
      'COD credited on settlement, or Instant Pay at delivery for a fee',
      'Charges broken down per order; GST invoices on delivered orders',
    ],
    'SELLER — Running the business': [
      'Team members with roles and permissions',
      'Notification inbox plus email, silenceable per topic',
      'Per-seller settings overrides — fee currency, courier choice policy, call-attempt caps, credit timing',
    ],
    'RESELLER STORE — headline': [
      "A store sells your goods under its own name. The customer never sees you: the tracking page, the courier label and the emails all carry the store's name and logo",
    ],
    'RESELLER — What you control': [
      'Which products a store may sell, and at what transfer price',
      "How much stock it's shown — hide a share, or set units aside for it",
      'Versioned terms it must accept: which share of each Skydrop fee it pays, and when each of you gets credited',
      'Per store, per task: may it recall a parcel, change an order, cancel, send back, chase us — and does it happen directly or wait for your approval',
      'Auto-pause on a return rate you set; fraud signals surfaced to us',
    ],
    'RESELLER — What the store gets': [
      'Its own login, team and permissions',
      'A catalogue showing its price and its visible stock — never your cost, real stock, or other stores',
      'Orders by portal, CSV or API key; COD or prepaid from its wallet',
      'Its own wallet, P&L and expense book',
      'Disputes with you, settled between your two wallets — never from ours',
    ],
  },
  /** A one-line-per-group SUMMARY of 3A for the page's short lists — never a substitute for `claims`. */
  capabilities: [
    'Stock held in our Indian warehouse, counted on arrival',
    'Every COD order confirmed by phone before it ships',
    'Picked, packed and handed to the courier the same day',
    'Live tracking from our scan to the customer’s door',
    'Returns received, inspected unit by unit, restocked or written off',
    'Your money itemised: COD collected, charges, freight, payouts',
    'Reseller stores that sell your stock under their own name',
  ],
  footer: {
    columns: [
      {
        title: 'Service',
        links: [
          { href: '/#services', label: 'Send to India' },
          { href: '/#services', label: 'Send to Bangladesh' },
          { href: '/#platform', label: 'The seller platform' },
          { href: '/#resellers', label: 'Reseller stores' },
          { href: '/#pricing', label: 'Pricing' },
        ],
      },
      {
        title: 'Access',
        links: [
          { href: '/request-invite', label: 'Request an invite' },
          { href: 'https://app.skydrop.online/login', label: 'Seller sign-in', external: true },
          { href: 'https://reseller.skydrop.online/login', label: 'Store sign-in', external: true },
          { href: 'https://track.skydrop.online', label: 'Track a parcel', external: true },
        ],
      },
      {
        title: 'Company',
        links: [
          { href: 'mailto:hello@skydrop.online', label: 'hello@skydrop.online' },
          { href: '/#contact', label: 'Contact' },
          { href: '/privacy', label: 'Privacy' },
        ],
      },
    ],
    legal: '© 2026 Skydrop · cross-border fulfilment, Bangladesh ⇄ India',
  },
} as const;

export const business = {
  /** Utility bar and contact fan. Every FACT is its own dummy() — never one wrapper around an object. */
  hotline: dummy('+880 1XXX-XXXXXX'),
  hotlineHref: dummy('tel:+8801000000000'),
  whatsappHref: dummy('https://wa.me/8801000000000'),
  hoursDays: dummy('Sat–Thu'),
  hoursTime: dummy('10:00–19:00'),
  hoursZone: 'Dhaka',
  /** Hero trust row + KPI card. Real figures replace these. */
  stats: [
    { value: dummy(18240), suffix: '', label: 'parcels delivered' },
    { value: dummy(96), suffix: '%', label: 'confirmed before dispatch' },
    { value: dummy(4), suffix: '–7 days', label: 'Dhaka to an Indian doorstep' },
  ],
  /** Social profiles — each URL is the owner's to supply. */
  social: [
    { id: 'facebook', label: 'Facebook', href: dummy('https://facebook.com/skydrop') },
    { id: 'instagram', label: 'Instagram', href: dummy('https://instagram.com/skydrop') },
    { id: 'linkedin', label: 'LinkedIn', href: dummy('https://linkedin.com/company/skydrop') },
    { id: 'whatsapp', label: 'WhatsApp', href: dummy('https://wa.me/8801000000000') },
  ],
  /** The ILLUSTRATIVE tracking card beside the hero's Track tab — labelled "Sample". */
  sampleTracking: {
    orderId: dummy('SD-2026-41-018240'),
    status: dummy('Out for delivery'),
    expectedDay: dummy('Today'),
    expectedTime: dummy('by 6 pm'),
    progress: dummy(78),
    steps: [
      {
        label: 'Order confirmed',
        detail: dummy('Confirmed by phone with the customer'),
        time: dummy('Mon 11:20'),
        state: 'done',
      },
      {
        label: 'Packed in Bengaluru',
        detail: dummy('Scanned at our warehouse'),
        time: dummy('Mon 16:05'),
        state: 'done',
      },
      {
        label: 'With the courier',
        detail: dummy('Delhivery · in transit'),
        time: dummy('Tue 08:40'),
        state: 'done',
      },
      {
        label: 'Out for delivery',
        detail: dummy('Chennai hub → doorstep'),
        time: dummy('Today 09:15'),
        state: 'current',
      },
      { label: 'Delivered', state: 'todo' },
    ],
  },
  trustCount: dummy(120),
  trustLine: 'Bangladeshi sellers ship with Skydrop',
  /**
   * Estimator — ILLUSTRATIVE until the owner supplies the rate cards. One
   * card per DIRECTION, each priced in the currency the sender pays in:
   * taka from Bangladesh, rupees from India. Each rate is its own placeholder.
   */
  estimator: {
    toIndia: {
      currency: 'BDT',
      symbol: '৳',
      slabs: [
        { upToKg: dummy(0.5), price: dummy(450) },
        { upToKg: dummy(1), price: dummy(650) },
        { upToKg: dummy(2), price: dummy(950) },
        { upToKg: dummy(5), price: dummy(1800) },
      ],
    },
    toBangladesh: {
      currency: 'INR',
      symbol: '₹',
      slabs: [
        { upToKg: dummy(0.5), price: dummy(380) },
        { upToKg: dummy(1), price: dummy(540) },
        { upToKg: dummy(2), price: dummy(790) },
        { upToKg: dummy(5), price: dummy(1500) },
      ],
    },
    codFeePercent: dummy(1),
    note: 'Estimated. Your quote is agreed before anything ships.',
  },
  /** Serviceability — a list shaped for a real endpoint later. */
  serviceability: {
    indiaPinFirstDigits: dummy('12345678'),
    bdPostcodeFirstDigits: dummy('123456789'),
    transitDaysIndia: dummy('4–7 days'),
    transitDaysBangladesh: dummy('3–5 days'),
  },
  /** The two couriers we book through (block 3B — real, so not placeholders). No other company is named on the page. */
  partners: ['Delhivery', 'Shiprocket'],
  partnersLine: 'and the couriers in their networks',
  testimonials: [
    {
      quote: dummy('Our returns dropped once every order was confirmed by phone first.'),
      name: dummy('Rahim Uddin'),
      company: dummy('Dhaka Threads'),
      role: dummy('Founder'),
    },
    {
      quote: dummy('I see the parcel, the call and the money in one place.'),
      name: dummy('Nusrat Jahan'),
      company: dummy('Nusrat Beauty'),
      role: dummy('Owner'),
    },
    {
      quote: dummy(
        'Two hundred kurtis to Kolkata in one consignment, and the stock figures matched to the piece.',
      ),
      name: dummy('Tanvir Hasan'),
      company: dummy('Mirpur Fabrics'),
      role: dummy('Operations'),
    },
  ],
  /** Transit per named lane, in the coverage section — the business's figures. */
  coverageTransit: {
    Dhaka: dummy('Origin · same day pickup'),
    Kolkata: dummy('3–4 days'),
    Delhi: dummy('4–6 days'),
    Mumbai: dummy('4–6 days'),
    Bengaluru: dummy('5–7 days'),
    Chennai: dummy('5–7 days'),
  },
  offices: {
    dhakaLine1: dummy('Mirpur DOHS'),
    dhakaLine2: dummy('Dhaka 1216'),
    indiaCity: dummy('Bengaluru'),
    indiaState: dummy('Karnataka'),
  },
} as const;

/** Feature switches for things with no endpoint yet. A switch that is off renders NOTHING. */
export const features = {
  newsletter: false,
} as const;

export const site = { platform, business, features } as const;

/** Section 13 content — one file per vignette under `sections/`, owned by that vignette. */
export { tour } from './sections/tour';
/** Section 14 content — owned by the reseller-stores section. */
export { reseller } from './sections/reseller';
/** Section 15 content — owned by the FAQ section. */
export { faq, faqCategories } from './sections/faq';
/** Section 16 content — owned by the contact section. */
export { contact } from './sections/contact';
/** Import & export panels — owned by that section. */
export { importExport } from './sections/import-export';
/** Credentials & trust — owned by that section. */
export { trust } from './sections/trust';
/** Section 17 content — owned by the final CTA band. */
export { cta } from './sections/cta';
