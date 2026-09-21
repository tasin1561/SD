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
  trustCount: dummy('120+'),
  trustLine: 'Bangladeshi sellers ship with Skydrop',
  /** Estimator — ILLUSTRATIVE until the owner supplies the rate card. Each rate is its own placeholder. */
  estimator: {
    currency: dummy('BDT'),
    slabs: [
      { upToKg: dummy(0.5), price: dummy(450) },
      { upToKg: dummy(1), price: dummy(650) },
      { upToKg: dummy(2), price: dummy(950) },
      { upToKg: dummy(5), price: dummy(1800) },
    ],
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
