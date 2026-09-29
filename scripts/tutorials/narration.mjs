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
];

/** Look one up by slug — the scripts take a slug on the command line. */
export function videoBySlug(slug) {
  const video = VIDEOS.find((v) => v.slug === slug);
  if (video === undefined) {
    throw new Error(`Unknown video "${slug}". Known: ${VIDEOS.map((v) => v.slug).join(', ')}`);
  }
  return video;
}
