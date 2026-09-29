/**
 * The narration, and the ONLY place the words live.
 *
 * Every other script reads this file: the voice generator turns each
 * `say` into an mp3, the recorder times its scene block to that mp3's
 * measured length, and the composer places the mp3 at the scene's real
 * start in the video. So changing a line here is the whole edit — nothing
 * is duplicated into a timeline, a subtitle file or a shot list.
 *
 * Keep each line to 8–15 seconds of speech. At the configured rate that
 * is roughly 20–36 words; `generate-voice.mjs` prints the measured length
 * of every clip and WARNS on anything outside the window, so a line that
 * has grown too long announces itself rather than quietly running past
 * the action it describes.
 *
 * `id` is the scene key. It appears in the audio filename, in the marker
 * colour assignment and in the verification report, so it must be stable
 * and unique within a video.
 */

/** Held after each clip so a step does not cut on the last syllable. */
export const SCENE_TAIL_SECONDS = 0.6;

/** @typedef {{ id: string, say: string }} Step */

/** @type {{ slug: string, title: string, subtitle: string, steps: Step[] }[]} */
export const VIDEOS = [
  {
    slug: 'place-an-order',
    title: 'Placing an order',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: "This is the Skydrop seller dashboard. We're going to place an order by hand for a customer in India — who it goes to, what is in it, and what they pay when it arrives.",
      },
      {
        id: 'open-form',
        say: 'Orders is in the sidebar, and everything you have ever shipped is listed there. To type one in yourself, open Orders and choose New order.',
      },
      {
        id: 'recipient',
        say: 'Start with who it goes to. The customer’s name, an Indian mobile number, and the street address they gave you. Skydrop checks the number is a real one as you type it.',
      },
      {
        id: 'landmark',
        say: 'The second address line is the landmark, and it matters more than it looks: on a rural address it is the line that decides whether the driver finds the door.',
      },
      {
        id: 'pincode',
        say: 'Then the PIN code. That is all the courier needs — Delhivery routes on the PIN and works the city out itself, so there is nothing else to type.',
      },
      {
        id: 'reference',
        say: 'Add your own reference so the order lines up with your books, and a note for the call centre — anything they should know before they ring the customer.',
      },
      {
        id: 'products',
        say: 'Now the products. Price and stock sit on every row, so you can see both before you commit to anything. Click a row once to add it to the order.',
      },
      {
        id: 'quantity',
        say: 'Add a second product the same way, then set the quantity on the line itself. The subtotal keeps up with you, and so does the parcel weight underneath.',
      },
      {
        id: 'payment',
        say: 'Cash on delivery is the norm in India, so that is the default. Type what the customer hands over when the parcel arrives.',
      },
      {
        id: 'submit',
        say: 'Then submit it for confirmation. The order joins the call-centre queue, an agent rings the customer, and only once they say yes does Skydrop hold your stock and book the courier.',
      },
      {
        id: 'detail',
        say: 'And there it is, with its own Skydrop order number and a timeline you can follow all the way from the call centre to the customer’s door.',
      },
    ],
  },
  {
    slug: 'add-a-product-with-variations',
    title: 'Adding a product with variations',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Now a product that comes in more than one version. In Skydrop, stock is counted against variants — never against the product itself — so getting these right is what makes everything downstream work.',
      },
      {
        id: 'open-form',
        say: 'Products sits under Catalogue in the sidebar, and everything you sell is listed there. Choose New product to start one from scratch.',
      },
      {
        id: 'name',
        say: 'Give it a name, and your own product ID if you keep codes of your own. This is the thing itself — the individual versions of it come further down the page.',
      },
      {
        id: 'shared',
        say: 'Weight and declared value are asked once, here, and inherited by every variant. You only type them again when one version genuinely differs.',
      },
      {
        id: 'option-colour',
        say: 'An option is what the product varies by. Add one called Colour, and list its values. Never put a quantity here — an option is a choice, not a count.',
      },
      {
        id: 'option-size',
        say: 'Add a second option and call it Size. Notice that it asks per colour — because the sizes you actually stock are rarely the same for every colour you sell.',
      },
      {
        id: 'size-values',
        say: 'So list them under each colour in turn. Medium and Large for Emerald, then the same two for Indigo. A colour you leave blank simply produces no variant at all.',
      },
      {
        id: 'variants',
        say: 'Skydrop multiplies the two options out for you — four variants, one row each, and every one of them with a SKU suggested from the product name.',
      },
      {
        id: 'sku',
        say: 'Edit any SKU now, while you still can. Once saved it is permanent, because every order, every pick and every stock count refers to it by that code.',
      },
      {
        id: 'save',
        say: 'Now create the product. All four variants are created together in one go, and every one of them is ready to receive stock and go onto an order.',
      },
      {
        id: 'done',
        say: 'And here is the finished product with its four variants listed underneath. Receive stock against any of them and that variant is on sale straight away.',
      },
    ],
  },
  {
    slug: 'upload-bulk-orders',
    title: 'Uploading orders in bulk',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Typing orders in one at a time is fine for a handful. For a day\u2019s worth, Skydrop takes a spreadsheet instead. It starts from the same place \u2014 your orders list.',
      },
      {
        id: 'open-import',
        say: 'CSV import sits next to New order, at the top. This is the whole of bulk ordering: one page, one file, and a look at what we made of it before anything is placed.',
      },
      {
        id: 'template',
        say: 'Start from our template. It carries every column we read, with an example filled in \u2014 and the example is two rows sharing one reference. That part is deliberate.',
      },
      {
        id: 'choose-file',
        say: 'Here is that template filled in: six rows of orders for six deliveries. Drop the file onto the page, or choose it from your computer. Nothing has been sent anywhere yet.',
      },
      {
        id: 'preview',
        say: 'Upload and check reads the file and imports none of it. Every column we matched is listed. And it counts orders, not rows: one row is one line, and rows sharing a reference are one order.',
      },
      {
        id: 'problem-row',
        say: 'It also says which rows will not import, and why. This one has no landmark \u2014 and the courier address is line one plus line two, so without it nobody finds the door.',
      },
      {
        id: 'import',
        say: 'So four orders go, and the one we cannot place stays behind for you to fix. It does not hold the others up, and nothing is imported until you press this.',
      },
      {
        id: 'processing',
        say: 'Every import is a job you can watch. Six rows in, four orders created, one failed \u2014 with an errors file telling you exactly what was wrong with that row.',
      },
      {
        id: 'orders-list',
        say: 'And there they are: four new orders waiting on the call centre to ring each customer. The row we could not place is counted at the top, waiting for you to finish it.',
      },
      {
        id: 'multi-line',
        say: 'Open the order those two rows became and it is one order with two lines \u2014 the saree and the scarves together. Send that same reference again and this order is updated, never placed twice.',
      },
    ],
  },
  {
    slug: 'find-your-way-around',
    title: 'Finding your way around',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Before anything else, a look at the place itself. This is the Skydrop seller dashboard, and everything you will ever do is reachable from this one screen.',
      },
      {
        id: 'dashboard',
        say: 'The dashboard answers one question: what needs you today. Money in your wallet, money still moving, and anything waiting on a decision from you.',
      },
      {
        id: 'sidebar',
        say: 'Everything else lives on the left, in five groups. They are ordered the way the work actually happens, and each one folds away if you never use it.',
      },
      {
        id: 'selling',
        say: 'Selling is where you spend most of your time. Orders you have placed, where the parcels are, and the customers you have shipped to. It is first because it is what you open every morning.',
      },
      {
        id: 'stock',
        say: 'Stock is the goods themselves. What you sell, how much of it is sitting in India right now, and how you tell us more is on the way.',
      },
      {
        id: 'money',
        say: 'Money is your wallet and what it cost to get your goods into the country. Reselling is for other businesses selling your stock under their own name.',
      },
      {
        id: 'account',
        say: 'And Account is the setup you do once: who is on your team, what each of them can reach, your company details, and your settings.',
      },
      {
        id: 'search',
        say: 'At the top there is a search box that follows you everywhere. Type an order number, a waybill or a customer, because the moment you need an order is rarely the moment you are on the orders page.',
      },
      {
        id: 'quick-actions',
        say: 'Quick actions is the shortcut to the two things you do most — placing an order and adding a product — from wherever you happen to be standing.',
      },
      {
        id: 'bell',
        say: 'The bell is how Skydrop tells you something. A parcel came back, stock ran low, a top-up was accepted. On a phone this is the only control that stays on screen.',
      },
      {
        id: 'strip',
        say: 'Along the bottom sit the standing facts: whether your account is active, which currency the figures are in, and the rate they were converted at.',
      },
      {
        id: 'outro',
        say: 'That is the whole console. If you are new, start with your company profile and your first product — everything after that is placing orders and watching them move.',
      },
    ],
  },
  {
    slug: 'set-up-your-profile',
    title: 'Setting up your company profile',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Your profile is three separate things: who you are, what your customers see, and where your money goes. They are edited separately, on purpose.',
      },
      {
        id: 'open-profile',
        say: 'Profile sits under Account in the sidebar. The top of the page is the account as we hold it — your status, the currency you read amounts in, and where payouts are sent.',
      },
      {
        id: 'edit-company',
        say: 'Company info is who we ring when something needs a person. Open Edit and you can change the contact name, a WhatsApp number, and how you would like figures shown to you.',
      },
      {
        id: 'fixed',
        say: 'Two things are shown but cannot be typed over: your company name and your phone. They are the identity your account was approved on, so changing them is a request rather than an edit.',
      },
      {
        id: 'save-company',
        say: 'Save, and that is done. Nothing here affects an order that has already been placed — an order keeps the details it was created with, whatever the profile says afterwards.',
      },
      {
        id: 'logo-pick',
        say: 'Next, your logo. This is the one thing on this page your customers actually see: it goes on the tracking page they open when they are waiting for a parcel.',
      },
      {
        id: 'logo-done',
        say: 'A square image, up to one megabyte. It is uploaded straight away — there is no separate save — and you can take it off again at any point.',
      },
      {
        id: 'bank-open',
        say: 'And then bank details. This is where Skydrop sends your money, so it is worth being slow and careful about exactly once.',
      },
      {
        id: 'bank-approval',
        say: 'Save, and read what the button says. The first time, these are simply stored. Changing an account already on file goes to Skydrop for approval — because this is the field that decides where your money lands.',
      },
    ],
  },
  {
    slug: 'announce-a-consignment',
    title: 'Telling us stock is coming',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Your goods are in Bangladesh and your customers are in India. A consignment is how you tell Skydrop a batch of stock is on its way, before it ships.',
      },
      {
        id: 'open-inbound',
        say: 'Add stock is under the Stock group. Everything you have ever sent us is listed here, with where each one is now and what we counted when it arrived.',
      },
      {
        id: 'open-form',
        say: 'Announce a consignment opens the form. Announce it before it ships, so our warehouse knows to expect it — and so you can follow it the whole way.',
      },
      {
        id: 'route',
        say: 'The first question is the one that matters most, because it decides what you are charged. Where are you sending it?',
      },
      {
        id: 'route-info',
        say: 'Straight to India means you have arranged the crossing yourself: one arrival, one count, no freight bill from us. Via Bangladesh means you ship to Dhaka and we move it on for you.',
      },
      {
        id: 'route-pick',
        say: 'Choose Bangladesh and we collect it in Dhaka, carry it across, and bill you the freight once the forwarder invoices us. That bill is spread across the units, not charged up front.',
      },
      {
        id: 'first-line',
        say: 'Then what is in it. Search your own catalogue by name or SKU, say how many you are sending, and add the line.',
      },
      {
        id: 'unit-cost',
        say: 'Unit cost is optional, and worth filling in. It is what makes landed cost and margin real later — leave it out and your stock valuation simply has a gap where that batch should be.',
      },
      {
        id: 'second-line',
        say: 'Add as many products as the shipment holds. This is a declaration of what you believe you are sending, not a promise — the count that counts is the one our warehouse makes.',
      },
      {
        id: 'details',
        say: 'Finally, when you expect it to land, and your own reference so this matches whatever you call it in your own records.',
      },
      {
        id: 'announce',
        say: 'Announce it, and it appears in the register as still travelling. From here you can open it and watch each leg — including what was counted at each stop.',
      },
      {
        id: 'outro',
        say: 'Nothing is sellable yet. Stock becomes yours to sell the moment our Indian warehouse counts it in, and until then it is shown separately so it can never be sold by mistake.',
      },
    ],
  },
];

/** Look one up by slug — the scripts take a slug on the command line. */
export function videoBySlug(slug) {
  const video = VIDEOS.find((v) => v.slug === slug);
  if (video === undefined) {
    throw new Error(`Unknown video "${slug}". Known: ${VIDEOS.map((v) => v.slug).join(', ')}`);
  }
  return video;
}
