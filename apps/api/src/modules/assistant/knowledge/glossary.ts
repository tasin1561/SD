import type { GlossaryTerm } from './knowledge.types';

/**
 * ~40 plain-English terms. One line each, plus a short example. English
 * only: the model answers in the user's own language. Terms that are
 * internal (warehouse bench words) are STAFF-only.
 */
export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    term: 'AWB',
    meaning: "The courier's waybill number for one parcel. It is how the parcel is tracked.",
    example: 'Search tracking by AWB to find where a parcel is.',
  },
  {
    term: 'waybill',
    meaning: "Another word for the AWB: the courier's tracking number for a parcel.",
    example: 'No waybill shows until the call centre has confirmed the order.',
  },
  {
    term: 'COD',
    meaning: 'Cash on delivery. The courier collects the money from the customer at the door.',
    example: 'A COD order for ₹999 means the driver collects ₹999.',
  },
  {
    term: 'prepaid',
    meaning: 'An order the customer has already paid for. The driver collects nothing.',
    example: 'A prepaid order has a collectable amount of zero.',
  },
  {
    term: 'collectable amount',
    meaning: 'The money the courier must collect from the customer on a COD order.',
    example: 'Goods ₹900 plus an extra ₹99 gives a collectable of ₹999.',
  },
  {
    term: 'declared value',
    meaning: 'The value of the goods stated for customs. It is not the amount collected.',
    example: 'A COD order can have a collectable of ₹999 and a declared value of ₹700.',
  },
  {
    term: 'NDR',
    meaning:
      'A failed delivery attempt reported by the courier (non-delivery report). Someone must decide what happens next.',
    example: 'The customer was not home, so the courier reports an NDR.',
  },
  {
    term: 're-attempt',
    meaning: 'Asking the courier to try delivering a parcel again after a failed attempt.',
    example: 'The customer says they will be home Saturday, so ask for a re-attempt.',
  },
  {
    term: 'RTO',
    meaning:
      'Return to origin. A parcel that could not be delivered and is coming back to the warehouse.',
    example: 'A customer refuses the parcel, so it becomes an RTO.',
  },
  {
    term: 'return fee',
    meaning: 'The charge to a client when a parcel comes back.',
    example: 'The order page shows the return fee before you confirm a return.',
  },
  {
    term: 'consignment',
    meaning: 'A batch of stock a client sends to the warehouse.',
    example: 'Announce a consignment of 200 shirts before it ships.',
  },
  {
    term: 'inbound freight',
    meaning: 'The cost of moving a consignment into India when Skydrop moves it for the client.',
    example: 'Shipping to Dhaka and letting us move it to India means inbound freight is charged.',
  },
  {
    term: 'SKU',
    meaning: "A product's own code. Every variant has one. Orders, picks and stock counts use it.",
    example: 'TSHIRT-RED-M is the SKU of a red medium t-shirt.',
  },
  {
    term: 'variant',
    meaning: 'One version of a product, such as a size or colour.',
    example: 'Red and medium is one variant of a t-shirt.',
  },
  {
    term: 'PIN code',
    meaning: 'The Indian postal code. The courier routes on it, and a wrong one is costly.',
    example: 'PIN 411001 is in Pune.',
  },
  {
    term: 'address check',
    meaning:
      'A check that scores how deliverable an address looks, out of 100, and suggests an action.',
    example: 'A low score suggests confirming the address with the customer.',
  },
  {
    term: 'confirmation call',
    meaning:
      "The phone call where Skydrop's call centre confirms an order with the customer before it is packed.",
    example: 'The call centre rings the customer once the order is created.',
  },
  {
    term: 'call queue',
    meaning: 'The list of orders waiting for a confirmation call.',
    example: 'A new order joins the call queue.',
  },
  {
    term: 'pick list',
    meaning: 'The sheet a warehouse picker walks to collect the products for several parcels.',
    example: 'One consolidated picking sheet covers a batch of labelled parcels.',
    audience: ['staff'],
  },
  {
    term: 'picking',
    meaning: 'Taking the products for an order off the shelves.',
    example: 'Picked orders go to the packing bench.',
    audience: ['staff'],
  },
  {
    term: 'pack box',
    meaning:
      'A box opened at the pack bench by scanning the shipping label, then filled by scanning each product, then closed.',
    example: 'Scan the label to open a box, scan products in, scan the label to close.',
    audience: ['staff'],
  },
  {
    term: 'manifest',
    meaning: 'A record of which parcels went out together with one courier from one warehouse.',
    example: 'The manifest closes itself when its last parcel is handed over.',
    audience: ['staff'],
  },
  {
    term: 'handover',
    meaning:
      'Giving packed parcels to the courier driver. Scanning each parcel at handover dispatches it.',
    example: 'Scan every parcel as it goes onto the van.',
    audience: ['staff'],
  },
  {
    term: 'sort code',
    meaning: "The courier's routing code for a parcel, printed on the label.",
    example: 'A sort code looks like KLT/MDH.',
    audience: ['staff'],
  },
  {
    term: 'bin',
    meaning: 'A shelf location in the warehouse where stock is kept.',
    example: 'Stock in a Damaged bin is never sold.',
    audience: ['staff'],
  },
  {
    term: 'returns hold',
    meaning:
      'The place returned goods wait, unsellable, until someone decides what to do with them.',
    example: 'A received return waits in the returns hold until inspected.',
    audience: ['staff'],
  },
  {
    term: 'manual placement',
    meaning: 'Booking a parcel with a courier outside Skydrop when the usual courier refuses it.',
    example: 'Delhivery will not serve that PIN, so book it manually with another courier.',
    audience: ['staff'],
  },
  {
    term: 'serviceability',
    meaning: 'Whether a courier will carry a parcel to a PIN code.',
    example: 'A PIN with no service means the courier refuses the parcel.',
    audience: ['staff'],
  },
  {
    term: 'god mode',
    meaning: 'The one sanctioned way for staff to force a change on an order. It is fully audited.',
    example: 'Staff use it as a last resort and must give a reason.',
    audience: ['staff'],
  },
  {
    term: 'wallet',
    meaning:
      "A client's money balance with Skydrop: COD credited, charges taken out, payouts paid.",
    example: 'Delivered COD orders add to the wallet net of charges.',
    audience: ['seller', 'staff'],
  },
  {
    term: 'remittance',
    meaning: "A payout of money from Skydrop to a client's bank account.",
    example: 'A withdrawal request becomes a remittance once the transfer is recorded.',
    audience: ['seller', 'staff'],
  },
  {
    term: 'top up',
    meaning: 'Adding money to a wallet by bank transfer, then recording it for matching.',
    example: 'Send money to our bank, then enter the transaction ID.',
    audience: ['seller', 'store', 'staff'],
  },
  {
    term: 'settlement',
    meaning: 'The courier paying Skydrop the COD cash it collected.',
    example: 'A settlement is matched to orders by waybill.',
    audience: ['staff'],
  },
  {
    term: 'UTR',
    meaning: 'The unique reference of a bank transfer. Recording the same one twice is refused.',
    example: "Enter the courier's UTR when recording a settlement.",
    audience: ['staff'],
  },
  {
    term: 'client',
    meaning:
      'A business that ships its own orders through Skydrop (called a seller in some screens).',
    example: 'A Bangladeshi shop owner using Skydrop is a client.',
  },
  {
    term: 'member store',
    meaning: "A business that sells a client's products under its own name through Skydrop.",
    example: 'A member store pays the client a transfer price for each unit it sells.',
    audience: ['seller', 'store', 'associate', 'staff'],
  },
  {
    term: 'transfer price',
    meaning: 'What a member store pays the client for each unit it sells.',
    example: "Retail ₹500 minus a transfer price of ₹300 leaves ₹200 before Skydrop's fees.",
    audience: ['store', 'seller', 'staff'],
  },
  {
    term: 'associate',
    meaning: 'A person who places orders for a member store at prices the store sets for them.',
    example: 'An associate sees only the orders they placed themselves.',
    audience: ['store', 'associate', 'seller', 'staff'],
  },
  {
    term: 'ticket',
    meaning:
      'An issue raised about a parcel, for example damaged or lost. The discussion stays on the ticket.',
    example: 'Raise a ticket if a parcel arrives damaged.',
  },
  {
    term: 'needs attention',
    meaning: 'A list of orders and parcels waiting for a decision or being chased.',
    example: 'Orders where nobody answered the call appear there.',
    audience: ['seller'],
  },
  {
    term: 'out of stock',
    meaning:
      'An order that could not reserve stock when it was confirmed. It keeps its place until stock arrives.',
    example: 'Stock on its way in will cover it once counted.',
  },
  {
    term: 'tracking',
    meaning: "Following a parcel through the courier's scans until it is delivered or returned.",
    example: 'The first scan usually appears within a day of pickup.',
  },
];
