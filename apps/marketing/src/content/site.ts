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
    cta: { href: '/request-invite', label: 'Book a shipment' },
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
      hue: 'violet',
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
  /** How it works — four phases, with what each one actually does. */
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
      {
        label: 'Time to first dispatch',
        skydrop: { kind: 'text', label: 'Under 3 weeks', estimate: true },
        diy: { kind: 'text', label: '6+ months', estimate: true },
        marketplace: { kind: 'text', label: '1–2 months', estimate: true },
      },
      {
        label: 'Capital before order one',
        skydrop: { kind: 'text', label: 'Pay per order' },
        diy: { kind: 'text', label: '₹50 lakh+', estimate: true },
        marketplace: { kind: 'text', label: 'Low' },
      },
      {
        label: 'Indian entity required',
        skydrop: { kind: 'no', label: 'Not to start' },
        diy: { kind: 'yes', label: 'Yes' },
        marketplace: { kind: 'partial', label: 'Varies' },
      },
      {
        label: 'COD confirmed by phone',
        skydrop: { kind: 'yes', label: 'Every order' },
        diy: { kind: 'partial', label: 'Build the desk' },
        marketplace: { kind: 'no', label: 'No' },
      },
      {
        label: 'Stock held in India',
        skydrop: { kind: 'yes', label: 'Our warehouse' },
        diy: { kind: 'partial', label: 'Lease and staff it' },
        marketplace: { kind: 'partial', label: 'Their terms' },
      },
      {
        label: 'Returns handling',
        skydrop: { kind: 'yes', label: 'Inspected, per item' },
        diy: { kind: 'partial', label: 'Yours to solve' },
        marketplace: { kind: 'partial', label: 'Limited visibility' },
      },
      {
        label: 'Brand and customer data',
        skydrop: { kind: 'yes', label: 'Yours' },
        diy: { kind: 'yes', label: 'Yours' },
        marketplace: { kind: 'no', label: 'Theirs' },
      },
      {
        label: 'Money back to Bangladesh',
        skydrop: { kind: 'yes', label: 'Built in' },
        diy: { kind: 'partial', label: 'Arrange it yourself' },
        marketplace: { kind: 'partial', label: 'Marketplace terms' },
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
  /** What ships, in the seller's own words — never more than the app does. */
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
          { href: '/request-invite', label: 'Book a shipment' },
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
  partners: [
    dummy('Delhivery'),
    dummy('Shiprocket'),
    dummy('Blue Dart'),
    dummy('DTDC'),
    dummy('Ekart'),
    dummy('Xpressbees'),
  ],
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
