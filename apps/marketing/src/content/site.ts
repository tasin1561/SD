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
    },
    {
      quote: dummy('I see the parcel, the call and the money in one place.'),
      name: dummy('Nusrat Jahan'),
      company: dummy('Nusrat Beauty'),
    },
  ],
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
