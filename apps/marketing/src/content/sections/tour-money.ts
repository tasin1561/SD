import type { TourVignetteContent } from './tour-types';

/**
 * Tour vignette 5 · Money (green).
 *
 * Words are the seller app's own. The two balance tiles are "Balance ·
 * INR" and "Your balance in BDT" with its `₹1 = ৳…` hint; the ledger
 * lines are `walletDirectionLabel` verbatim ("COD collected", "Order
 * charges", "Inbound freight", "Wallet top-up"); the top-up wizard's
 * three steps are "Choose account", "Payment details" and "Submitted",
 * and the two states a claim passes through are `topupStatusLabel`'s
 * payer wording — "Waiting for Skydrop to see it", then "Credited". The
 * honesty line under it is the wizard's own sentence. The withdrawal
 * switch is "Automatic withdrawals", and the summary either side of it
 * is what the app says in each state: "Withdrawals are yours to
 * request." when it is off, "We raise the request for you on a
 * schedule." when it is on. The last beat's two bands are the order
 * screen's, notes included: "Charges — What this parcel costs you." and
 * "Invoice — The tax document for this sale."
 *
 * Nothing here is a business figure, so nothing here is a `dummy()`.
 * The sample balances, the three ledger amounts, the transfer, the
 * exchange rate and the one parcel's charge live in the mock beside it,
 * inside the frame's `aria-hidden` box, and are plainly illustrative —
 * one wallet on one day, never a price list, a rate or a volume. The
 * Instant Pay fee is the one number deliberately ABSENT: it is a real
 * commercial rate, so the chip says a fee applies and stops there.
 */
export const tourMoney: TourVignetteContent = {
  id: 'money',
  hue: 'green',
  tab: 'Money',
  title: 'Your money, itemised',
  promise:
    'One wallet, in rupees and in taka: what the courier collected, what we charged, what the freight cost — every movement on its own named line, and a payout whenever you ask for it.',
  checklist: [
    {
      id: 'balance',
      text: 'One wallet: COD collected, charges, freight — every line itemised',
      beat: 'balance',
    },
    {
      id: 'topup',
      text: 'Top up by bank transfer — credited once a person has checked it against our statement',
      beat: 'topup',
    },
    {
      id: 'withdraw',
      text: 'Withdraw when you ask, or automatically',
      beat: 'withdraw',
    },
    {
      id: 'cod',
      text: 'COD credited on settlement, or instantly at delivery for a fee',
      beat: 'cod',
    },
    {
      id: 'order',
      text: 'Every order’s charges broken down, and a GST invoice once it is delivered',
      beat: 'order',
    },
  ],
  beats: [
    {
      id: 'balance',
      ms: 2100,
      caption:
        'Your balance in rupees, the same money read in taka, and every movement on a line that names itself.',
    },
    {
      id: 'topup',
      ms: 2200,
      caption:
        'You tell us about a transfer; it waits until a person has matched it to our statement, then it is credited.',
    },
    {
      id: 'withdraw',
      ms: 1800,
      caption:
        'Ask for a payout whenever you like — or turn automatic withdrawals on and we raise the request for you.',
    },
    {
      id: 'cod',
      ms: 1800,
      caption:
        'COD reaches you when the courier settles with us, or the moment the parcel is delivered if you are on Instant Pay.',
    },
    {
      id: 'order',
      ms: 2000,
      caption: 'And per parcel: exactly what it cost you, and the tax document for the sale.',
    },
  ],
};
