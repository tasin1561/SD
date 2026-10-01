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
  {
    slug: 'add-a-shopfront',
    title: 'Selling under more than one name',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Say you sell under two names — your own label, and a boutique brand. Skydrop calls each one a store, and this is how you add the second.',
      },
      {
        id: 'open-settings',
        say: 'Stores live under Settings, at the bottom of the Account group. Everything about how your account behaves is on this one hub.',
      },
      {
        id: 'open-stores',
        say: 'The Stores tile, under Account. And its description is the whole lesson in a sentence: a store decides which brand an order belongs to, and nothing else.',
      },
      {
        id: 'shared',
        say: 'Read that twice, because the word invites the opposite. Products, stock, your wallet and your couriers are shared across every store — the same goods on the same shelf.',
      },
      {
        id: 'tiles',
        say: 'Three standing facts. How many shopfronts you have, how many orders are filed across all of them, and the one that matters most — where a new order goes by default.',
      },
      {
        id: 'add',
        say: 'Add a store. Read what it promises before you have typed anything: a new store never becomes the default, so adding one cannot move where your orders are filed.',
      },
      {
        id: 'name',
        say: 'Give it a name — this is the brand your customer sees, not a code — and a note to yourself about which channel it is.',
      },
      {
        id: 'saved',
        say: 'And there it is. Open, no orders yet, and not the default. Nothing about the orders you have already placed moved, because nothing about them was asked to.',
      },
      {
        id: 'close',
        say: 'Closing one asks first. New orders stop being filed under it, the orders already there are untouched, and you can reopen it whenever you like.',
      },
      {
        id: 'make-default',
        say: 'Making it the default asks too, and names both stores — because this is what decides where an order with no store named on it lands, including every row of a spreadsheet upload.',
      },
      {
        id: 'outro',
        say: 'So a store is a name on an order, not a separate business. One catalogue, one shelf, one wallet — and as many brands standing in front of them as you need.',
      },
    ],
  },
  {
    slug: 'set-your-delivery-fee',
    title: 'The delivery fee your customer pays',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Most customers in India pay cash when the parcel arrives, and part of what they hand over is delivery. This is where you set what that normally comes to.',
      },
      {
        id: 'open-settings',
        say: 'Settings again, and this time the second group — the answers you would otherwise type on every single order you place.',
      },
      {
        id: 'open-defaults',
        say: 'Order defaults is one field, and the page leads with the reason: everything here stays editable on the order itself. It only saves you typing the usual answer.',
      },
      {
        id: 'whose-figure',
        say: 'Look at the badge beside the heading first. Skydrop default means nobody here has chosen this number — and an inherited figure and one you picked look identical in the box.',
      },
      {
        id: 'not-ours',
        say: 'The line underneath draws the distinction the field exists for. This is what you charge your customer. It is not what Skydrop charges you to move the parcel.',
      },
      {
        id: 'type',
        say: 'So type what you normally charge. It is added to the collectable amount on every new order from here on, and nothing else in Skydrop reads it.',
      },
      {
        id: 'save',
        say: 'Save, and the badge changes to say it is your own figure. New orders start there, and any single order that needs a different number can still have one.',
      },
      {
        id: 'outro',
        say: 'That is the whole page. A default is not a rule — it is the answer you would have typed anyway, filled in for you, and overridable every time.',
      },
    ],
  },
  {
    slug: 'be-told-before-you-run-out',
    title: 'Being told before you run out',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'The worst way to find out a product has run out is a customer ordering one. Skydrop can warn you first, and this is where you say when.',
      },
      {
        id: 'open-settings',
        say: 'Settings, then Stock alerts — in the same group as the order defaults, because it is the same kind of thing: a standing answer you set once.',
      },
      {
        id: 'state',
        say: 'And read the badge before anything else. Off means exactly that: no product you sell will warn you about anything, however low it gets.',
      },
      {
        id: 'blank-vs-zero',
        say: 'Which is the distinction this page turns on. An empty box never warns you. Zero warns you — but only once the product is completely gone, which is usually too late.',
      },
      {
        id: 'set-default',
        say: 'So pick a number you could still reorder from. Ten units means every product tells you when it drops below ten, without you setting anything per product.',
      },
      {
        id: 'saved',
        say: 'Saved, and the badge now says what it will do. That covers everything in your catalogue that has no opinion of its own.',
      },
      {
        id: 'open-variant',
        say: 'Some products need their own number though. Open Products, pick one, and open the SKU itself — the code underneath the product name.',
      },
      {
        id: 'per-sku',
        say: 'Stock handling, on the SKU. The same three states, said the same way: blank means use your default, zero means warn me only when it is empty.',
      },
      {
        id: 'override',
        say: 'Set twenty-five here and this SKU ignores your default entirely. Worth doing for anything slow to restock — a product six weeks from Dhaka needs more warning than one you can reprint.',
      },
      {
        id: 'outro',
        say: 'That is the whole mechanism. One number for the catalogue, a different one wherever it matters, and a warning that reaches you before a customer does.',
      },
    ],
  },
  {
    slug: 'keep-a-product-up-to-date',
    title: 'Keeping a product up to date',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A product is never finished. Sizes get added, a box turns out bigger than you thought, and some things stop selling. All of that happens on one screen.',
      },
      {
        id: 'open-product',
        say: 'Open Products and pick one. Everything about it is here — what it weighs, what box it ships in, what it is worth, and every version of it you sell.',
      },
      {
        id: 'defaults',
        say: 'These four are the product’s defaults. Every variant inherits them unless it says otherwise, so filling them in once here saves typing them on every size you add.',
      },
      {
        id: 'edit',
        say: 'Edit product opens the same facts up to be changed. The name, your own reference, the weight, the box and the declared value are all yours to correct.',
      },
      {
        id: 'box-size',
        say: 'The box was never filled in, and it is worth doing. Couriers charge on the space a parcel takes as well as its weight, and they bill whichever comes out higher.',
      },
      {
        id: 'saved',
        say: 'Save, and the tile reads it back. From now on any size that sets no box of its own ships in that one.',
      },
      {
        id: 'add-variant',
        say: 'A new size goes in from the same page. Add variant opens right where the list is, because that is the thing you are already looking at.',
      },
      {
        id: 'sku',
        say: 'It asks two things. The SKU is the code everything else points at — every order line, every pick, every stock count — so it has to be unique across your catalogue.',
      },
      {
        id: 'added',
        say: 'Add it, and it joins the list. It set no weight of its own, so it is showing the product’s. That is the inheriting, working.',
      },
      {
        id: 'open-variant',
        say: 'Click the code to open the variant itself. Weight, box, declared value, tax rate and barcode can all be set here, one variant at a time.',
      },
      {
        id: 'sku-immutable',
        say: 'Edit it, and the SKU is the one field greyed out. It is permanent on purpose — change it, and every order and stock count still pointing at the old code loses its thread.',
      },
      {
        id: 'inherit',
        say: 'Leave a field blank and it inherits. Fill one in and this variant alone differs — a heavier version, a bigger carton — without touching any of its siblings.',
      },
      {
        id: 'archive',
        say: 'When something stops selling, archive it. Skydrop asks first and says what follows: no new orders, no more stock taken in, and everything already shipped left exactly as it is.',
      },
      {
        id: 'restore',
        say: 'Restoring brings the product back — but read that line carefully. Its variants stay archived. Bringing a product back is not the same as bringing back everything you once sold under it.',
      },
    ],
  },
  {
    slug: 'add-product-photos',
    title: 'Product photos',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A code tells nobody anything. A picture beside it means the packer, the call-centre agent and you all recognise the thing without decoding it.',
      },
      {
        id: 'open-variant',
        say: 'Pictures belong to a variant, not to the product — sizes share a photograph, colours do not. So open the product, then open the code itself.',
      },
      {
        id: 'empty',
        say: 'Pictures sits at the bottom of the variant. Drop files on it or browse for them — JPEGs, PNGs or WEBPs, up to five in one go.',
      },
      {
        id: 'first',
        say: 'Start with one, and make it the shot you want a customer to see. It goes up on its own, and the badge beside it keeps you posted.',
      },
      {
        id: 'upload-steps',
        say: 'Three things just happened. Skydrop found somewhere to put the file, your browser sent it straight there, and Skydrop then recorded it against this code.',
      },
      {
        id: 'more',
        say: 'Now the rest, dragged in together. Each file gets its own row and its own verdict, so one that fails does not take the others down with it.',
      },
      {
        id: 'gallery',
        say: 'And they are all here, each with the space it takes. Nothing was resized on the way in, so a phone photograph arrives at a phone photograph’s size.',
      },
      {
        id: 'order',
        say: 'One of them stands for the rest, and it is the one uploaded earliest. There is no way to promote a different one — which is why the good shot went first.',
      },
      {
        id: 'delete',
        say: 'Removing one asks first, and it names which of them it is about rather than making you count. That matters when three of them look alike.',
      },
      {
        id: 'gone',
        say: 'Gone, and customers stop seeing it. There is no recycle bin here — putting it back means uploading it again, which is exactly what the dialog said.',
      },
      {
        id: 'outro',
        say: 'That is all of it. The pictures follow this code everywhere it goes: your own catalogue, the order screen, and the call the customer takes.',
      },
    ],
  },
  {
    slug: 'invite-a-colleague',
    title: 'Inviting someone',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'You are not going to run this alone. Somebody packs, somebody answers the phone, somebody watches the money — and each of them should see their part and no more.',
      },
      {
        id: 'open-team',
        say: 'Team, in the sidebar. Who is already here, who has been invited and not turned up yet, and how many different kinds of access you have defined.',
      },
      {
        id: 'invite',
        say: 'Invite member asks three things: their name, the address they will sign in with, and what they are able to do from the moment they arrive.',
      },
      {
        id: 'role',
        say: 'The list here is the six roles every account starts with. A role you built yourself on the Roles screen is given after they join, not from this box.',
      },
      {
        id: 'create',
        say: 'Create it, and two things happen. Skydrop emails them a link that sets their password, and it shows you that same link here.',
      },
      {
        id: 'link-once',
        say: 'This is the only time you will see it. Copy it now if you would rather send it yourself — leave this page and it is gone for good.',
      },
      {
        id: 'outstanding',
        say: 'The invitation is on the list underneath now, with the day it stops working. Until somebody uses it, it counts against the outstanding figure at the top.',
      },
      {
        id: 'resend',
        say: 'If it goes astray, resend. That issues a fresh link and shows it to you again — and the one you sent before stops working, which is rather the point.',
      },
      {
        id: 'revoke',
        say: 'Revoke is for one you should not have sent: a typo in the address, or somebody who left before they started. The link dies the moment you confirm.',
      },
      {
        id: 'role-change',
        say: 'Somebody already here changes role from their own row. Skydrop restates the move before making it — who, from what, to what — because this is access, not a preference.',
      },
      {
        id: 'yourself',
        say: 'Your own row has no dropdown and no remove button. You cannot take your own access away, and that is what stops this screen being a mistake nobody can undo.',
      },
      {
        id: 'outro',
        say: 'Deactivating somebody stops them signing in and leaves everything they did exactly where it is. Nothing about the past changes — only what happens next.',
      },
    ],
  },
  {
    slug: 'take-money-out',
    title: 'Taking money out',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Money reaches your wallet as parcels are delivered and couriers settle up. Getting it into your own bank is a request, and this is where you make one.',
      },
      {
        id: 'open-wallet',
        say: 'The wallet leads with what you have, and the strip along the bottom keeps the same figure in front of you wherever you go next.',
      },
      {
        id: 'request',
        say: 'Request a withdrawal opens the form on the tab where the request will appear. It shows what is actually available, which is not always the whole balance.',
      },
      {
        id: 'amount',
        say: 'Type what you want sent. You do not choose where it goes — it is paid to the bank account on your profile, and that is the only account it can reach.',
      },
      {
        id: 'confirm',
        say: 'Skydrop asks once more, and the sentence to read is the last one. Your balance does not move now. It moves when the transfer is actually recorded.',
      },
      {
        id: 'requested',
        say: 'So the request is on the list, pending, and the outcome column is empty because nothing has happened to it yet. Somebody at Skydrop reviews it next.',
      },
      {
        id: 'ledger',
        say: 'And the ledger has not moved. That is the whole distinction: a request is a thing you asked for, and the ledger is money that genuinely changed hands.',
      },
      {
        id: 'open-limits',
        say: 'Doing that by hand every week is a chore, so it can be arranged to happen on its own. The wallet rules page is where that lives.',
      },
      {
        id: 'auto',
        say: 'Turn automatic withdrawals on and Skydrop raises the request for you. It confirms that separately, because this is a standing instruction rather than a one-off click.',
      },
      {
        id: 'hour',
        say: 'Pick the hour, and note whose clock it runs on. Yours, not ours — the page names your own timezone beside it, and the sweep reads it there.',
      },
      {
        id: 'keep',
        say: 'And say what to leave behind. The automatic withdrawal stops at this figure instead of emptying the wallet — your own working float, on top of whatever minimum Skydrop sets.',
      },
      {
        id: 'outro',
        say: 'Each automatic request then passes exactly the same checks as one you make by hand. Nothing is approved differently because a machine asked for it.',
      },
    ],
  },
  {
    slug: 'keys-and-webhooks',
    title: 'API keys and webhooks',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'If you have a system of your own, these two screens connect it. A key lets your software ask Skydrop things; a webhook lets Skydrop tell your software things.',
      },
      {
        id: 'open-keys',
        say: 'Both live under Settings, in Integrations. API keys first — one key per thing that calls us, so you can switch one off without switching off the rest.',
      },
      {
        id: 'issue',
        say: 'A key needs a name you will recognise later, and optionally a life. Leave the days blank and it never expires, which is convenient and not what you want.',
      },
      {
        id: 'confirm-create',
        say: 'Skydrop restates it before issuing, including whether it expires — and warns you now that the key itself is shown exactly once, straight afterwards.',
      },
      {
        id: 'once',
        say: 'And there it is. Copy it into your system before you leave this page, because we keep only a fingerprint of it. Lose it and you issue another.',
      },
      {
        id: 'list',
        say: 'What survives is the first few characters, so you can tell one key from another, and when it was last used — which is how you find the one nobody needs any more.',
      },
      {
        id: 'revoke',
        say: 'Revoking is the switch-off, and Skydrop says plainly what it costs: everything using that key stops at once, and there is no bringing it back.',
      },
      {
        id: 'revoked',
        say: 'Revoked keys stay on the list with no actions left. The one below ran out of days by itself and reads Expired — a different word, because only one of them was a decision.',
      },
      {
        id: 'open-webhooks',
        say: 'Webhooks are the other direction. Instead of your system asking us what happened, we post to an address of yours the moment it does.',
      },
      {
        id: 'endpoint',
        say: 'An endpoint is an https address of yours and the list of events you want. It must be reachable from the internet — Skydrop checks before saving it.',
      },
      {
        id: 'secret',
        say: 'Every endpoint gets a secret, shown once like the key. We sign every message we send with it, so your system can prove the message really came from us.',
      },
      {
        id: 'rotate',
        say: 'Rotating issues a new one and keeps the old working for a day, so you can change it on your side without dropping anything in between.',
      },
      {
        id: 'auto-disabled',
        say: 'And this is the one to know about. If an endpoint keeps refusing our messages, Skydrop stops sending — and says so, with when it last worked.',
      },
      {
        id: 'back-on',
        say: 'Fix your end, switch it back on, and the failure count starts again from nothing. Skydrop is not holding the old run against you — only what happens next.',
      },
      {
        id: 'outro',
        say: 'That is the whole integration surface. One key per caller, one endpoint per listener, a secret for each, and both of them revocable the moment you need them to be.',
      },
    ],
  },
  {
    slug: 'open-a-reseller-store',
    title: 'Opening a reseller store',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A reseller store is another business selling your stock under its own name. Their customers, their shopfront — your goods, your warehouse, your courier, and your money at risk.',
      },
      {
        id: 'open-stores',
        say: 'They live under Reselling. The four figures here are the whole picture: how many stores, how many are selling, how many are waiting on you, and how many people can sign in.',
      },
      {
        id: 'open-form',
        say: 'Opening one is a single form, and read the line under the title: a store you open is active straight away. There is nobody to approve it, because you are the somebody.',
      },
      {
        id: 'names',
        say: 'Two names, and the difference matters. The first is what you call them. The second is what a customer reads on their parcel and on the tracking page.',
      },
      {
        id: 'contact',
        say: 'An address and a phone number, both required. The email carries their invitation and every notice after it; the phone is how anybody rings them about a parcel that is already moving.',
      },
      {
        id: 'wallet',
        say: 'Then who runs their wallet. Keep it yourself and you top them up and pay them out directly; hand it to Skydrop and they do both through us, like you do.',
      },
      {
        id: 'invite',
        say: 'And their first person, which is not optional. A store with nobody able to sign in is a row that looks open and can do nothing, so Skydrop will not make one.',
      },
      {
        id: 'created',
        say: 'Open, and selling. The figures at the top have moved, and their owner has an email with a link that gives them a login of their own.',
      },
      {
        id: 'detail',
        say: 'The store’s own page gathers everything about it. Its orders and its reports are a click away, and the four tabs cover what it may sell, on what terms, and what it may do.',
      },
      {
        id: 'details',
        say: 'Details is the record of what you just typed, plus who opened it and when its status last changed. History underneath keeps every change, oldest last, and is never edited.',
      },
      {
        id: 'pause',
        say: 'Pausing stops it taking new orders while everything already placed carries on. Skydrop asks first, because this is somebody else’s trading day.',
      },
      {
        id: 'outro',
        say: 'And only from paused can it be closed for good — which is final, and refused while it still has parcels moving, credits to run or money in its wallet.',
      },
    ],
  },
  {
    slug: 'set-a-reseller-price',
    title: 'The price a reseller store pays',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A reseller store sells your goods, so two prices matter: what they pay you for each one, and what they are allowed to charge their customer for it.',
      },
      {
        id: 'open-list',
        say: 'The reseller price list is your whole catalogue with those two answers beside it. The figures at the top say how much of it is priced and how much is actually being sold.',
      },
      {
        id: 'table',
        say: 'A product with no price here cannot be sold by a store on your terms. That is the default and it is the safe one — nothing reaches a shelf until you have said what it costs.',
      },
      {
        id: 'open-form',
        say: 'Set price opens four figures. They are all about one unit, and none of them is what you paid for it — your cost stays yours.',
      },
      {
        id: 'transfer',
        say: 'The transfer price is what the store owes you for every unit it sells. This is the one that has to be right; the others are guidance and guard rails.',
      },
      {
        id: 'range',
        say: 'Then the range they may sell inside. A floor stops them undercutting you into your own customers; a ceiling stops your name on a parcel somebody feels overcharged for.',
      },
      {
        id: 'suggested',
        say: 'And a suggested price, which is the number their screen fills in for them. Most stores take it, which is quietly how a range stays a range rather than an argument.',
      },
      {
        id: 'saved',
        say: 'Saved, and the row now carries all four. Every store you have sees this price from now on, unless one of them has been given a price of its own.',
      },
      {
        id: 'override',
        say: 'And that is the sentence at the top worth reading twice. A price for one particular store is set on that store’s own page, not here. This screen is everybody.',
      },
      {
        id: 'remove',
        say: 'Removing a price takes the product back off the shelf — and Skydrop names any store already selling it at this price, because they need one of their own first.',
      },
      {
        id: 'outro',
        say: 'That is the whole arrangement. One price you set once, a range you are comfortable with, and a catalogue where anything you have not priced simply is not for sale.',
      },
    ],
  },
  {
    slug: 'upload-a-catalogue',
    title: 'Uploading a catalogue from a spreadsheet',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Your products are already in a spreadsheet somewhere. This is how they get into Skydrop without anybody typing them in twice.',
      },
      {
        id: 'open-import',
        say: 'Bulk catalogue import, from the Products screen. Read the line under the title: uploading the same file again updates what is there rather than making a second copy of it.',
      },
      {
        id: 'template',
        say: 'The template is worth downloading once, just to see what Skydrop calls each column. You do not have to use it — and the rest of this video is about not using it.',
      },
      {
        id: 'upload',
        say: 'Here is the file as it actually comes out of our own stock sheet. Upload and check reads it and tells us what it made of it. Nothing is imported yet.',
      },
      {
        id: 'matched',
        say: 'Some of it it worked out by itself. The SKU column, the barcode and the options were all recognised without being told anything.',
      },
      {
        id: 'missing',
        say: 'And the rest it will ignore, including the one it cannot do without. Our sheet calls the product name Item, and Skydrop will not import a single row until it knows that.',
      },
      {
        id: 'mapping',
        say: 'You could rename the columns in the spreadsheet every month. Or you tell Skydrop once: a saved mapping is our field name on the left, your header on the right.',
      },
      {
        id: 'default',
        say: 'Make it the default and it is applied to every catalogue file you upload from now on, over the top of whatever was recognised anyway.',
      },
      {
        id: 're-upload',
        say: 'So upload the same untouched file again. Nothing about it changed — the only thing that changed is that Skydrop now speaks your spreadsheet.',
      },
      {
        id: 'import',
        say: 'Everything is matched, nothing is missing, and the button will import. Twelve rows, and each one is a product or one version of a product.',
      },
      {
        id: 'running',
        say: 'It runs in the background, and reports what it did rather than just that it finished — products made, versions made, and anything it could not use.',
      },
      {
        id: 'catalogue',
        say: 'And they are in your catalogue, with the weight and the box size the spreadsheet carried. Nothing here was typed into Skydrop by hand.',
      },
      {
        id: 'outro',
        say: 'Next month you export the same sheet, upload it, and the prices and weights update in place. The mapping is saved; you only ever teach it once.',
      },
    ],
  },
  {
    slug: 'where-is-my-parcel',
    title: 'Where is my parcel',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A customer messages asking where their order is. You can answer that yourself, in about ten seconds, without ringing anybody.',
      },
      {
        id: 'open-tracking',
        say: 'Tracking is every parcel that has actually left. One still being picked is not here — it has not been handed to anyone, so there is nothing yet to track.',
      },
      {
        id: 'tiles',
        say: 'Three figures, and read the small print under them: they count the parcels shown, not your whole fleet. Filter the list and they follow it.',
      },
      {
        id: 'register',
        say: 'Each row is a parcel: its waybill, the order it belongs to, who it is going to, and the last thing the courier scanned, with when and where.',
      },
      {
        id: 'failed',
        say: 'Delivery failed is the filter you will come here for. The courier went and could not hand it over — which is not the same as lost, and not yet the same as coming back.',
      },
      {
        id: 'coming-back',
        say: 'Coming back is the other one. Once a parcel turns round it is on its way to our warehouse, and the note says the part that costs you money: you pay the leg home.',
      },
      {
        id: 'history',
        say: 'History opens the whole scan trail underneath. This is what you read to the customer — every place it has been, in order, with the courier’s own words.',
      },
      {
        id: 'search',
        say: 'And when they give you a number rather than a story, search takes the waybill, our own parcel number, or just the name on the box.',
      },
      {
        id: 'read-only',
        say: 'Notice there is nothing to press. This screen only tells you things — there is no button here that makes a courier do anything, because there is no such button.',
      },
      {
        id: 'outro',
        say: 'Acting on a parcel happens on its order, which is one click from every row. This screen is for the question the customer actually asked.',
      },
    ],
  },
  {
    slug: 'the-customer-was-not-there',
    title: 'The customer was not there',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A courier went to your customer’s door and came away still holding the parcel. Nothing is lost, and nothing has been decided — but somebody has to decide, and that somebody is you.',
      },
      {
        id: 'open-order',
        say: 'A failed delivery is an ordinary order in your list, with its own tab. Open it, and the first thing to read is the tracker.',
      },
      {
        id: 'tracker',
        say: 'This is the whole journey in one column. Picked, packed, handed to the courier, carried, taken out for delivery — and then it stopped, which is where you come in.',
      },
      {
        id: 'panel',
        say: 'Further down, we say what happened and what we are already doing about it: a call to your customer is queued, so somebody finds out why before you spend anything.',
      },
      {
        id: 'history',
        say: 'Beside it is every call we have made to them and what the agent was told. Read this first — nobody answered and they have moved house lead to opposite decisions.',
      },
      {
        id: 'ask-open',
        say: 'Then tell us what you want. Ask admin to act sits at the top of the order, and it offers three things. They are not the same size, so it is worth knowing what each one costs you.',
      },
      {
        id: 'reattempt',
        say: 'Try delivering again asks the courier to go back. That sends a van, which is why it is worth asking for only when you know the customer will actually be in.',
      },
      {
        id: 'sendback',
        say: 'Send it back is the only one that does not wait for us. It is your parcel, so it reaches the courier the moment you press it, it cannot be undone, and a return fee applies.',
      },
      {
        id: 'recall',
        say: 'And in the middle, the cheapest of the three: have one of our agents ring them. Nothing moves and nothing is charged — you are buying an answer before you spend anything.',
      },
      {
        id: 'reason',
        say: 'The box underneath is required, and it is not a formality. A person reads it before they act, so write what you actually know rather than what you would like to happen.',
      },
      {
        id: 'sent',
        say: 'Send it, and it lands on the order itself: what you asked for, what we said back, and a ticket you can follow the answer on.',
      },
      {
        id: 'outro',
        say: 'That is the shape of it. You say what you know, we weigh what it costs, and the answer comes back on the order rather than in somebody’s inbox.',
      },
    ],
  },
  {
    slug: 'what-needs-you-today',
    title: 'What needs you today',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Most mornings there is one question worth asking: is anything of mine stuck. There is a screen that answers exactly that, and on a good day it is empty.',
      },
      {
        id: 'open',
        say: 'Needs attention, under Selling. Its subtitle gives you the two halves before you read a single row — orders we could not confirm, and parcels that went out and never arrived.',
      },
      {
        id: 'tiles',
        say: 'Two figures, and they are two completely different jobs. The first is waiting on you. The second is waiting on a courier, and nothing you do will make it move faster.',
      },
      {
        id: 'could-not-reach',
        say: 'Could not reach comes first, because it is the half only you can settle. Our agents rang, nobody answered, and now somebody has to say what happens to the order.',
      },
      {
        id: 'waiting-row',
        say: 'The row carries the order, the customer, when it was placed and what is riding on it — and then tells you what the order page will actually offer when you open it.',
      },
      {
        id: 'overdue',
        say: 'Underneath, the parcels. Out for delivery and still not arrived, counted in nights rather than hours, because a courier’s day ends in the evening.',
      },
      {
        id: 'chasing',
        say: 'And under each one, where we have got to with it. Flagged, and nobody here has picked it up yet. When one of us does, that shows here too, with the time.',
      },
      {
        id: 'no-buttons',
        say: 'Now notice something: there is no button anywhere on this page. You cannot make a courier deliver, and a button pretending otherwise would just be theatre.',
      },
      {
        id: 'through-to-order',
        say: 'What every row does instead is take you to the order — and there is the point of the whole screen. The decision waiting on you has a button on it, right at the top.',
      },
      {
        id: 'outro',
        say: 'So open it in the morning, clear the top half yourself, and leave the bottom half with us. On a quiet day it says nothing needs you, and it means it.',
      },
    ],
  },
  {
    slug: 'the-customer-would-not-answer',
    title: 'The customer would not answer',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Before anything ships, we ring your customer to confirm the order. Usually they answer. When they never do, the order stops — and it waits for you rather than being thrown away.',
      },
      {
        id: 'open',
        say: 'Unreachable customers is where those wait. Read the subtitle, because it is the promise: nothing happens to any of these until you say so.',
      },
      {
        id: 'tiles',
        say: 'Two figures. How many orders are waiting on you, and how many calls we made in total getting nowhere. That second one is worth a glance before you decide anything.',
      },
      {
        id: 'units',
        say: 'You may expect a third, for stock held against these orders. Holding stock the moment an order is placed is something you switch on, and this account has not — so rather than show you a zero, we show you nothing.',
      },
      {
        id: 'register',
        say: 'The register itself. The order, units held, calls made, where it stands, and a button. A dash rather than a zero in that column, for the same reason.',
      },
      {
        id: 'decide-open',
        say: 'Decide opens the question in as few words as we can manage: we tried this many times, nobody answered, and nothing happens until you tell us what you want.',
      },
      {
        id: 'let-it-go',
        say: 'Let it go rejects the order and returns anything held to your available stock. It is the end of that sale — though you can still ask us to call again afterwards.',
      },
      {
        id: 'confirm',
        say: 'Because that is not reversible on its own, pressing it asks once more, naming the order, and says in plain words what will happen. Cancel steps back out.',
      },
      {
        id: 'keep-trying',
        say: 'Keep trying is the other half, and it is what the dialog opens on. The order goes back into the call queue and we ring again. It is the choice you can undo tomorrow.',
      },
      {
        id: 'note',
        say: 'Add a note if you know something we do not — they are abroad this week, this number is their office. It goes to the agent who makes the next call.',
      },
      {
        id: 'send',
        say: 'Send it, and the order leaves this list straight away, because it is no longer waiting on anybody. That is what the empty screen underneath is telling you.',
      },
      {
        id: 'decided',
        say: 'The decisions you have already made are still here under All — what you chose, and when. Nothing is deleted, so the question of what happened to an order always has an answer.',
      },
    ],
  },
  {
    slug: 'something-arrived-damaged',
    title: 'Something arrived damaged',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A parcel came back to our warehouse, and when somebody opened it one of the two things inside was ruined. This is what happens next, and where the money ends up.',
      },
      {
        id: 'open',
        say: 'Tickets is where that conversation lives. Two kinds share the list — damage we found ourselves on a return, and anything you raise about a parcel.',
      },
      {
        id: 'tiles',
        say: 'How many are still being argued, how much has actually been refunded to you, and how many you are looking at. The middle one reads as a dash until something has landed.',
      },
      {
        id: 'register',
        say: 'The column worth reading is Raised by. Skydrop means we found it and told you. You means the other way round. Same queue, same settlement, either way.',
      },
      {
        id: 'our-ticket',
        say: 'This one is ours. A return came in, somebody at the bench inspected it, one unit was written off — and a ticket opened against your account without you asking for it.',
      },
      {
        id: 'refund-banner',
        say: 'And the first thing it tells you is the money, because that is what you came for. Credited to your wallet, with the date, and the ledger line it turned into.',
      },
      {
        id: 'facts',
        say: 'Underneath, the facts. What kind of ticket, where it stands, the courier, and the order and parcel it belongs to — so a phone call about it has something to quote.',
      },
      {
        id: 'conversation',
        say: 'Then the conversation itself. It opens with what the warehouse actually found, in words rather than a code, and carries everything said since.',
      },
      {
        id: 'wallet-link',
        say: 'The link at the end goes where the money went. There it is in your ledger as a credit — part of your balance now, and going out with your next withdrawal.',
      },
      {
        id: 'raise',
        say: 'The other half is yours to start, and the place to start it is the order itself. Raise an issue asks the courier’s own question first — these are Delhivery’s categories, not ours.',
      },
      {
        id: 'describe',
        say: 'Then say what happened. Notice the title is built from what you chose rather than typed, so the label on the ticket and the story inside it cannot disagree.',
      },
      {
        id: 'raised',
        say: 'Raised, and it joins the same list — saying this time that it came from you. We answer on the ticket, rather than in an email you then have to go and find.',
      },
      {
        id: 'outro',
        say: 'Both kinds end the same way: a conversation with a record, a decision, and where money is owed, a credit in your wallet you can point at.',
      },
    ],
  },
  {
    slug: 'what-skydrop-charges',
    title: 'What Skydrop charges, and what it lets you take out',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Every wallet has rules behind it — what you can take out, when money reaches you, what is deducted. They are all on one page, and this is it.',
      },
      {
        id: 'open-limits',
        say: 'Wallet, under Money. The balance and the history are here, and the rules behind both are one link away, at the top.',
      },
      {
        id: 'framing',
        say: 'Notice there are no big number tiles. Every figure on this page is a threshold — a cap, a floor, a percentage — not a position, and a tile would read like a balance.',
      },
      {
        id: 'withdrawals',
        say: 'The withdrawal rules first. A minimum you must leave behind, a smallest request we will accept, and how often you may ask — which is a count, not an amount.',
      },
      {
        id: 'cod-timing',
        say: 'Then the one that decides your cash flow: when cash on delivery reaches you. On settlement means when the courier pays us; instantly at delivery is the other option, and it carries a fee.',
      },
      {
        id: 'deductions',
        say: 'What comes off that cash before it lands in your wallet, as a percentage, so you can work out any order yourself rather than reverse-engineering a credit.',
      },
      {
        id: 'charges',
        say: 'And what we charge to move a parcel. When the delivery fee is taken, how inbound freight from Bangladesh is billed, and what paying later costs if you do.',
      },
      {
        id: 'outro',
        say: 'None of this is yours to change — that is the point of writing it down. But every one is set per account, so if a rule looks wrong for your business, ask us.',
      },
    ],
  },
  {
    slug: 'pay-money-in',
    title: 'Putting money into your wallet',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Your wallet pays for deliveries, and it is topped up by bank transfer. The one thing to understand first: recording a transfer here is a claim, not a payment.',
      },
      {
        id: 'open-wallet',
        say: 'Wallet, under Money. Your balance, what is on its way, and every movement that has ever happened — and the button to record a transfer you have made.',
      },
      {
        id: 'choose-account',
        say: 'First, which of our accounts you paid into. They are shown in full — bank, account name, account number — because you pay from your own banking app, not from here.',
      },
      {
        id: 'pick-bd',
        say: 'Pick the one you actually used. We hold accounts in both countries, so a Bangladeshi seller transfers taka at home rather than paying to send rupees.',
      },
      {
        id: 'amount',
        say: 'Then what you paid, in that bank\u2019s own currency. Skydrop shows the rupee equivalent underneath, because your wallet is kept in rupees whatever you sent.',
      },
      {
        id: 'evidence',
        say: 'And something we can match it against — your bank\u2019s transaction reference, or the receipt itself. One of the two is required; without either there is nothing to find on our statement.',
      },
      {
        id: 'submit',
        say: 'Record it, and that is your part done. It goes to whoever checks our statements, and they either match it or come back to you.',
      },
      {
        id: 'claim',
        say: 'Read this carefully, because it is the sentence people are surprised by. Nothing has been added to your balance. We check every transfer by hand, and that usually takes a day or two.',
      },
      {
        id: 'outro',
        say: 'Which is why it appears under Top-ups, still pending, and your ledger has not moved. Money reaches the ledger when somebody has seen it in the bank, and not before.',
      },
    ],
  },
  {
    slug: 'build-a-role',
    title: 'Building a role that fits your team',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Most systems give you three fixed roles and leave you to fit your business around them. Skydrop lets you invent the ones you actually need.',
      },
      {
        id: 'open-roles',
        say: 'Roles is under Account, beside Team. A role is simply a set of permissions, and the permissions themselves are the part we fix.',
      },
      {
        id: 'the-list',
        say: 'These are the ones we ship, and you can change or delete any of them. Except the first: Owner is locked, and the padlock is the only one on this page.',
      },
      {
        id: 'new-role',
        say: 'So let us build one. Say you have taken on somebody to run the warehouse — they need stock and parcels, and nothing to do with money.',
      },
      {
        id: 'purpose',
        say: 'Describe what it is for while you remember. In six months this line is the difference between reading a role and re-deriving it from its ticks.',
      },
      {
        id: 'groups',
        say: 'Every permission the system has, grouped by area, and each one carries a sentence explaining what it actually lets somebody do rather than just its name.',
      },
      {
        id: 'search',
        say: 'The search matches those keys as well as the words — because the moment you need this, somebody has been refused, and a refusal names a key and nothing else.',
      },
      {
        id: 'pick',
        say: 'Turn on what the job needs. Each group keeps its own count, so you can see at a glance how much of an area you have handed over.',
      },
      {
        id: 'sensitive',
        say: 'And watch this line as you go. Some permissions can move money or stock, and Skydrop counts the ones you have selected — so a role that quietly grew teeth says so before you save it.',
      },
      {
        id: 'save',
        say: 'Save, and it joins the list as an ordinary role. Invite somebody into it, or move an existing person across, exactly as you would with one of ours.',
      },
      {
        id: 'remove',
        say: 'Now the part worth knowing. Open it again and take a permission away — and Skydrop stops you, naming what goes and how many people lose it the moment you save.',
      },
      {
        id: 'owner',
        say: 'One last thing. You cannot edit Owner, and that is deliberate: it is the way back in from any mistake made on this screen, so it is not yours to lock yourself out of.',
      },
      {
        id: 'outro',
        say: 'Build the roles your business actually has, name them after the jobs people do, and nobody has to hold access they never needed.',
      },
    ],
  },
  {
    slug: 'sign-out-everywhere',
    title: 'Sign-in and sessions',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A laptop left at a desk, a phone sold, someone who has left the company. This is the page for the moment you need every session on the account to end.',
      },
      {
        id: 'open-security',
        say: 'Settings, then Sign-in and sessions. It is first in the list on purpose — it is the one somebody comes looking for in a hurry.',
      },
      {
        id: 'this-session',
        say: 'The top half is just this browser: who you are signed in as, whether that address is verified, and the role you hold on this account.',
      },
      {
        id: 'no-list',
        say: 'And there is no list of your other sessions. We could draw a table here, but we would be inventing it — nothing in Skydrop records where else you are signed in.',
      },
      {
        id: 'what-it-does',
        say: 'So the action is all or nothing, and the page is careful about what that means. Every browser and app signed in as this account, including the one you are reading this on.',
      },
      {
        id: 'not-touched',
        say: 'What it does not do matters just as much. Your password is unchanged, and your API keys keep working — a key is a separate credential, revoked on its own page.',
      },
      {
        id: 'confirm',
        say: 'It asks once, naming the account, because this is the kind of action people click while thinking about something else.',
      },
      {
        id: 'done',
        say: 'And it tells you what the server actually did, rather than simply claiming success. Sign in again, and every other device has to do the same.',
      },
    ],
  },
  {
    slug: 'ask-for-a-parcel-back',
    title: 'Asking for a parcel back',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Sometimes you want a parcel back. There are two ways to ask, they cost different amounts, and one of them reaches the courier the instant you press it.',
      },
      {
        id: 'open-live',
        say: 'Start with a parcel still on the road — out for delivery, nobody has signed for it yet. Orders, then the tab for parcels in transit.',
      },
      {
        id: 'on-order',
        say: 'This is the panel for a parcel in trouble, and it renders while one is. The button that matters sits at the top, next to the order number, where you look for something to do.',
      },
      {
        id: 'ask-open',
        say: 'It opens on the gentlest of the three choices. Read the line under the heading: an operator reads this and acts on it, and nothing reaches the courier by itself.',
      },
      {
        id: 'pick-sendback',
        say: 'Now choose Send it back, and watch three things change at once. That sentence, the hint underneath, and the colour of the button.',
      },
      {
        id: 'the-fee',
        say: 'The hint is the whole lesson. This one is your decision about your own goods, so it goes straight to the courier, it cannot be undone, and it names the return fee right there.',
      },
      {
        id: 'reason',
        say: 'Tell us why anyway. Nobody has to approve this, but the warehouse reads it when the carton lands and it decides whether the stock goes back on your shelf.',
      },
      {
        id: 'confirm',
        say: 'Pressing it asks once more, names the order, and repeats the fee and the fact that it is final. This is the last moment you can change your mind.',
      },
      {
        id: 'sent',
        say: 'Done, and the card underneath is the proof: asked for, and carried out. The order still reads out for delivery, because its status follows the courier\u2019s own scans and changes when they make the next one.',
      },
      {
        id: 'open-delivered',
        say: 'The other way starts later. This parcel arrived, the customer has it, and now they want to send it back.',
      },
      {
        id: 'request-return',
        say: 'Request return only appears on a delivered order, and that is deliberate. Before delivery a parcel that cannot be handed over comes home on its own, so offering a button would suggest a choice you do not have.',
      },
      {
        id: 'return-dialog',
        say: 'This one costs more, and the dialog says why in its own words: the parcel travels the same distance a second time, so it is charged as a second delivery. The figure is in the sentence.',
      },
      {
        id: 'return-reason',
        say: 'The same reason field, doing more work. Damaged, or simply not what they expected, decides whether we can sell the unit again — so this is the line the returns bench acts on.',
      },
      {
        id: 'booked',
        say: 'And this one does something the first did not. It books the collection, and the message names the waybill the return travels home under. Then the order itself moves.',
      },
      {
        id: 'outro',
        say: 'Two asks, two fees, and one thing in common. Neither is charged until the goods are actually back with us, and both appear on the order and in your wallet when they are.',
      },
    ],
  },
  {
    slug: 'read-your-wallet',
    title: 'Reading your wallet',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Your wallet is the account between you and Skydrop. Everything that has actually happened to your money is on one screen, and so is everything that merely has been asked for.',
      },
      {
        id: 'open',
        say: 'Wallet, under Money. Read the line under the title: what is owed to you, cash on delivery net of charges, and payouts going the other way.',
      },
      {
        id: 'balance',
        say: 'Two tiles, but one balance. Everything Skydrop stores is in rupees; the second is that same money read in taka, which is why it says so rather than calling itself a second balance.',
      },
      {
        id: 'rate',
        say: 'And it tells you the rate it used, underneath. A figure you cannot check is a figure you have to take on trust, and this is money.',
      },
      {
        id: 'three-tabs',
        say: 'Now the part worth slowing down for. Three tabs, and they are not three filters — they answer different questions.',
      },
      {
        id: 'ledger-is-truth',
        say: 'Ledger is the only one of the three that is about things that happened. Every movement, oldest last, each one leaving a new balance behind it.',
      },
      {
        id: 'columns',
        say: 'When, what it was, what it was about, how much, and where that left you. The linked column is a click through to the order, when there is one.',
      },
      {
        id: 'charges',
        say: 'Here is a delivery charge. One per parcel, taken when the parcel is delivered or when its label is made — which of those is your account setting, over on limits.',
      },
      {
        id: 'cod',
        say: 'And here is the one you are waiting for: cash on delivery, collected from your customer and credited to you in full. What matters about this row is when it gets written.',
      },
      {
        id: 'cod-timing',
        say: 'On the default setting, it is written when the courier pays us — not when your customer paid them. Those are different days, and that gap is the thing to plan your cash around.',
      },
      {
        id: 'gst',
        say: 'Directly underneath it, the tax deduction. It is taken out of what was collected rather than added on top, so the amount you see is the collection minus this.',
      },
      {
        id: 'refund',
        say: 'A credit going the other way: a damage settlement. Something came back broken, we agreed it, and the money is here rather than in an email promising it.',
      },
      {
        id: 'topups',
        say: 'Second tab: money you have told us you sent. The top one is a claim and nothing more — in no ledger and no balance until somebody has seen it arrive. The one below it has been seen.',
      },
      {
        id: 'withdrawals',
        say: 'Third tab, the mirror image: money you have asked us to send you. Also not a movement, and awaiting review. Both of these tables are about the future, which is why neither is on the first one.',
      },
      {
        id: 'export',
        say: 'And if you keep your own books, export the whole ledger. It fetches every page first, not just the rows on screen, so what you download is all of it.',
      },
      {
        id: 'outro',
        say: 'One rule carries the whole screen. If it is on the Ledger it has happened; if it is on either of the others it has not. Nothing here needs interpreting beyond that.',
      },
    ],
  },
  {
    slug: 'what-one-store-sells',
    title: 'What one store sells',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A reseller store sells your stock under its own name. Which of your products it may sell, at what price, and how much of your stock it can have, are all yours to decide — per store, per product.',
      },
      {
        id: 'open-store',
        say: 'Open the store from Reseller stores, and go to its Catalogue and stock tab. This is the store you already opened; everything here is about it and no other.',
      },
      {
        id: 'table',
        say: 'Every active product you have, and what this store may do with each. Read the last two columns together, because the gap between them is the whole idea on this page.',
      },
      {
        id: 'sold-here',
        say: 'Sold here, and every one of them is off. That is the safe default: a store you open sees nothing at all until you turn products on, one at a time.',
      },
      {
        id: 'price-source',
        say: 'The transfer price is what the store pays you per unit. These say default, meaning they come from your price list — the page says so in its own subtitle, and links to it.',
      },
      {
        id: 'edit-open',
        say: 'Edit opens everything about one product for this one store. The line under the title is the number to read first: what is really available, and how much of it could be set aside here.',
      },
      {
        id: 'enable',
        say: 'First switch: this store may sell it. That alone is enough — leave everything else and it sells at your default price out of your shared stock.',
      },
      {
        id: 'own-price',
        say: 'Second switch gives this store a price of its own. Use it when one store has earned a better rate, or when you are testing a higher one somewhere.',
      },
      {
        id: 'price-fields',
        say: 'The same four figures as your price list: what they pay you, and the range they may charge their own customer within, with a suggestion inside it.',
      },
      {
        id: 'stock-shared',
        say: 'Then stock, and this is the decision worth understanding. Shared means this store draws from the same pile as everyone else — first come, first served.',
      },
      {
        id: 'stock-setaside',
        say: 'A set-aside reserves units for this store alone. Nobody else can sell them, and the hint tells you how many are free to commit right now.',
      },
      {
        id: 'hidden',
        say: 'And the hidden share holds a percentage back from what they are shown. Not from what exists — from what they see, which keeps a buffer you can still sell yourself.',
      },
      {
        id: 'overlay',
        say: 'The rest is what their customers read: their own name for the product, their own description, and their own pictures. Leave any of them blank and yours is used.',
      },
      {
        id: 'confirm',
        say: 'Saving restates the terms in one sentence before it commits them, because four settings on one form is exactly where a mistake hides.',
      },
      {
        id: 'result',
        say: 'And now the two columns disagree, which is the point. That is what you have; this is what the store is shown — the set-aside and the hidden share between them.',
      },
      {
        id: 'outro',
        say: 'Do that for every product you want the store selling. Nothing you have not turned on will ever appear to them, and nothing about your other stores has changed.',
      },
    ],
  },
  {
    slug: 'the-deal',
    title: 'The deal with a reseller store',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A reseller store sells your stock, and Skydrop charges fees on every parcel. Who pays which share of those, and when each of you is paid, is the deal — and you write it.',
      },
      {
        id: 'open-terms',
        say: 'On the store, the Terms tab. Nothing is published yet, which is why the page is offering to publish the first version rather than showing you one.',
      },
      {
        id: 'fees-intro',
        say: 'Six fees, and for each one the percentage the STORE pays. You pay the rest. Read the note above them: inbound freight from Bangladesh is always yours and is not on this list.',
      },
      {
        id: 'delivery-share',
        say: 'Start with the delivery fee, the one charged on every parcel. Half and half is a reasonable place to begin — and watch the sentence underneath as you type.',
      },
      {
        id: 'live-example',
        say: 'That is not a hint. Skydrop is working the split out against your actual fee, as you type, so you can see what you are agreeing to rather than the percentage you typed.',
      },
      {
        id: 'returns',
        say: 'Now the returns, which is where a deal is actually decided. A store that pays nothing towards a failed delivery has no reason to care how good its addresses are.',
      },
      {
        id: 'cod',
        say: 'The cash-on-delivery fees and the tax on them. These follow the money the store collects, so a store keeping the retail margin usually carries a share of these too.',
      },
      {
        id: 'example-table',
        say: 'And the whole thing worked through, fee by fee, in rupees. This is the table to read out loud to the store before you publish anything.',
      },
      {
        id: 'store-credit',
        say: 'Then the other half of the deal: when each of you is paid. The store first — on the courier payout plus some days, or a number of days after delivery.',
      },
      {
        id: 'seller-credit',
        say: 'And you, separately, on your own trigger. The words underneath each are the rule in plain English, computed from what you chose rather than written down once.',
      },
      {
        id: 'note',
        say: 'A note to the store, which they see with the version. On a first set of terms it is a greeting; on a later one it is what changed, which is the more useful case.',
      },
      {
        id: 'publish',
        say: 'Publishing asks first, and what it says is the important part: they must accept it before their next order, and orders already placed keep the terms they were placed under.',
      },
      {
        id: 'in-force',
        say: 'Published, and waiting. Until the store accepts, this version is on the record but the deal is not yet theirs — which the panel states rather than leaving you to infer.',
      },
      {
        id: 'versions',
        say: 'Every version is kept. Change the deal next quarter and this one does not disappear — it becomes the terms that last quarter’s orders were placed under, for ever.',
      },
      {
        id: 'outro',
        say: 'That is the whole arrangement: what each of you pays, when each of you is paid, and a record of both that no later change can rewrite.',
      },
    ],
  },
  {
    slug: 'what-a-store-may-do',
    title: 'What a store may do without asking',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A reseller store takes the order, but the parcel is your stock and the fees are partly your money. So some of what they might want to do, you may want to see first.',
      },
      {
        id: 'open-tab',
        say: 'On the store, the tab called What they can do. Read the note above the table: it is running on the defaults, because you have not set this store yet.',
      },
      {
        id: 'two-questions',
        say: 'Seven tasks, and each one asks two questions rather than one. Can the store do this at all — and only if yes, does it happen directly or does it come to you first.',
      },
      {
        id: 'row-anatomy',
        say: 'Every row carries the answer to a third question you did not ask: what the setting you have chosen actually causes. That line changes as you change the row.',
      },
      {
        id: 'recall',
        say: 'Start with the gentlest. Asking us to ring the customer back costs an agent a few minutes and moves no parcel — the sort of thing there is little reason to stand in the way of.',
      },
      {
        id: 'recall-direct',
        say: 'So it comes set to directly, and the row says what that means: the call is queued with our call centre the moment the store asks, with nobody in between.',
      },
      {
        id: 'sendback-on',
        say: 'Now the other end of the scale. Sending a parcel back turns it round mid-journey, ends the sale, and puts a return fee on the order that your terms split between you.',
      },
      {
        id: 'sendback-direct',
        say: 'And this is why the page spells each one out. Directly here means the courier is asked to return the parcel the moment they click — nobody checks it first, and it cannot be undone.',
      },
      {
        id: 'sendback-ask',
        say: 'Which is why it does not come set that way. On your approval, the request goes to your staff, nothing happens until somebody answers, and an unanswered one closes itself after a few days.',
      },
      {
        id: 'cancel-off',
        say: 'And a task can simply be No. The store is not offered it at all, and the note says who does it instead — you. Turning it back on remembers how it was set before.',
      },
      {
        id: 'save',
        say: 'Saving lists exactly what you are changing — from what, to what — before it commits. Nothing you left alone is touched, and nothing you left alone is listed.',
      },
      {
        id: 'saved',
        say: 'And the note at the top has changed: these are your settings for this store now, not the defaults. Every other store keeps its own.',
      },
      {
        id: 'told',
        say: 'One thing worth knowing whichever way you set it: the store is always told what happened. Approved and carried out, approved and refused by the courier, or turned down with your reason.',
      },
      {
        id: 'outro',
        say: 'Anything you put on approval arrives in one place — Waiting on you, in the sidebar, with a count on it. That queue is the next tutorial.',
      },
    ],
  },
  {
    slug: 'answer-what-a-store-asked',
    title: 'Answering what a store has asked',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Once a store is running, some of what it wants to do stops with you. Everything you put on your approval arrives in one place, and until you answer it, nothing happens.',
      },
      {
        id: 'open-queue',
        say: 'It is Waiting on you, under Reselling, and it carries a count. That number is why this queue does not sit unread — it is on the sidebar of every screen you open.',
      },
      {
        id: 'three-queues',
        say: 'Three kinds of thing arrive here, and they are three different jobs. A decision to make, one that spends real money, and a comparison to check.',
      },
      {
        id: 'only-held',
        say: 'Read the line under the title. Nothing at all happens until you answer — and only the tasks you marked ask me first arrive here. Anything you let a store do itself has already been done.',
      },
      {
        id: 'cancel-row',
        say: 'The first table is the store making a decision about an order. Who asked, which order and what state it is in, what they want, and the reason in their own words.',
      },
      {
        id: 'approve-open',
        say: 'Approving asks first, and read what it says before you agree. It runs the request exactly as if the store had been allowed to do it themselves.',
      },
      {
        id: 'approved',
        say: 'Agreed, and carried out. The order is called off, the row has gone from the queue, and the store has been told — which matters, because they have a customer to ring back.',
      },
      {
        id: 'issue-row',
        say: 'The same table carries a different kind of ask entirely. The store wants something raised with Skydrop about a parcel, and approving is what actually opens it with us.',
      },
      {
        id: 'delivery-row',
        say: 'The second table is the expensive one. A parcel already out for delivery, and the store asking for it to be turned round and sent back to your warehouse.',
      },
      {
        id: 'reject-open',
        say: 'You do not have to agree. Turning it down asks for a reason, and the box will not let you send one without it.',
      },
      {
        id: 'reject-type',
        say: 'Write it for the store, not for yourself. Somebody there has to go back to a customer with your answer, and a refusal with nothing in it is a dead end for them.',
      },
      {
        id: 'rejected',
        say: 'Turned down, and sent. Nothing was done to the parcel, the courier was never asked, and the store has your reason. Either way, they find out what happened.',
      },
      {
        id: 'change-row',
        say: 'And the last table is the comparison. The store says a detail is wrong; the queue shows what the order carries today beside what they would put in its place.',
      },
      {
        id: 'outro',
        say: 'Answer them and that count clears. Leave one and it closes itself after a few days, and the store is told nobody answered — which is worse for them than a straight no.',
      },
    ],
  },
  {
    slug: 'how-your-stores-are-doing',
    title: 'How your reseller stores are doing',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A reseller store is somebody else’s business selling your stock. You cannot run it for them — but you can see what it is doing to your goods and your money, and decide.',
      },
      {
        id: 'open-reports',
        say: 'Reseller reports, under Reselling. Two facts before anything else: how many stores you have, and the window everything below is measured over.',
      },
      {
        id: 'cards',
        say: 'Four figures across every store. How many orders they placed, how many units actually stayed with a customer, what those were worth to you, and how many stores are armed to pause themselves.',
      },
      {
        id: 'coverage',
        say: 'And read the line under the margin. It says how many of the lines it could put a cost against — because margin needs what you paid, and Skydrop shows you the coverage rather than a number that looks complete.',
      },
      {
        id: 'window',
        say: 'The window is yours to move, and days are counted in Indian time, the same as everything else on your account. Every figure on this page follows it.',
      },
      {
        id: 'scorecard-rates',
        say: 'Then a scorecard per store. The rates divide by orders whose outcome is actually known — so a store with nothing settled yet shows dashes rather than a flattering zero.',
      },
      {
        id: 'margin-column',
        say: 'Its own margin sits beside its coverage again, and then the store’s wallet balance — what that business owes you, or what you are holding for it, right now.',
      },
      {
        id: 'ranking',
        say: 'Underneath, the stores ranked. Read the note: this is the money that has actually moved on your wallet, less what the goods you delivered cost you.',
      },
      {
        id: 'timing',
        say: 'Which is why a store that has delivered can still show a loss. The goods have gone; the credit for them falls due on the timing in that store’s terms, and until it runs, only the charges are on your wallet.',
      },
      {
        id: 'transfer-revenue',
        say: 'The last table is that same money, opened up: what each store put on your wallet, what it took off, the net of the two, and the transfer value of everything it got delivered.',
      },
      {
        id: 'auto-pause-open',
        say: 'One thing on this page writes rather than reads. A store can be told to stop itself when too many of its parcels come back.',
      },
      {
        id: 'auto-pause-fields',
        say: 'Three numbers: the return rate you will not go past, how many parcels must have an outcome before it counts, and over how many days. Pausing stops new orders only — what is placed carries on.',
      },
      {
        id: 'forecast',
        say: 'And the other half of watching a store is watching what it is selling. Stock forecast turns recent sales into days of stock left, for every product any of your stores may sell.',
      },
      {
        id: 'outro',
        say: 'Under your own reorder threshold a product is flagged and you are told in-app once a week. Your own channel counts here too — your stores and your shop draw on the same shelf.',
      },
    ],
  },
  {
    slug: 'finding-an-order',
    title: 'Finding an order',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'A customer rings. They have a phone number, a name, maybe an order number — and you have one screen. This one, and it takes all of them.',
      },
      {
        id: 'open-orders',
        say: 'Orders is everything you have ever sent us. Two facts before the list: how many you have placed altogether, and how many are on the road right now.',
      },
      {
        id: 'tiles',
        say: 'Four figures, and each carries a second line that is the useful half — the cash placed, how many are waiting on the call, what is still to collect, and how many are coming back.',
      },
      {
        id: 'search-what',
        say: 'Then the search, and read what it says it takes. The order number, your own reference, a waybill, a name, or a phone. Whatever the person in front of you actually has.',
      },
      {
        id: 'search-do',
        say: 'A phone number is usually what they have, and part of one is enough. One order, found from the thing a customer can read off their own handset.',
      },
      {
        id: 'reload',
        say: 'And what you filtered to is written into the page’s own address. Reload it and the filter is still there — which is what makes a list like this something you can send somebody.',
      },
      {
        id: 'reset',
        say: 'Reset clears everything at once, and the marker beside the word Filters tells you whether anything is narrowing the list before you wonder why an order is missing.',
      },
      {
        id: 'chips',
        say: 'Under the filters, every status you actually have, with a count on it. This is the row people open this page for: how many are stuck at the call, how many are out today.',
      },
      {
        id: 'chip-click',
        say: 'Clicking one narrows the list to it. The counts come from all your orders, not from the page in front of you, so they do not change as you page through.',
      },
      {
        id: 'placed-when',
        say: 'Placed when takes the ordinary questions as presets, and a custom range underneath for the awkward one. Days are counted in Indian time, like everything else.',
      },
      {
        id: 'store',
        say: 'And if you have reseller stores, you can look at one shop at a time. An order a store took says so under its number — the goods are yours, the sale was theirs.',
      },
      {
        id: 'columns',
        say: 'Every row carries what you would ask for: the order number, your own reference under it, who it is going to, their phone, where it has got to, the cash, and when it was placed.',
      },
      {
        id: 'paging',
        say: 'Then the page size and the count, so you know how much of your own list you are looking at. Twenty at a time by default.',
      },
      {
        id: 'outro',
        say: 'The order number is a link into everything else about it. And the search along the top of every screen does the same job from wherever you happen to be.',
      },
    ],
  },
  {
    slug: 'reading-an-order',
    title: 'Reading an order',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'One order, one page, and every question anybody will ask you about it. This tutorial presses nothing — it is the map, and each button on it has a tutorial of its own.',
      },
      {
        id: 'open-order',
        say: 'The order number, its status, how it is paid for, and your own reference underneath — the one from your spreadsheet, so you know you are looking at the right thing.',
      },
      {
        id: 'four-facts',
        say: 'Four facts you would otherwise scroll for. Where it has got to, what is being collected at the door, how many lines and how heavy, and when it was placed.',
      },
      {
        id: 'tracker',
        say: 'Then the tracker, which is the whole journey stage by stage. Each step says who recorded it — us, in our warehouse, or the courier, out on the road.',
      },
      {
        id: 'tracker-detail',
        say: 'That distinction is worth having. Everything up to the handover is ours and we can answer for it; everything after is the courier telling us where they have been.',
      },
      {
        id: 'recipient',
        say: 'On the right, the recipient exactly as it was when the order was placed. It is a snapshot, not a link — changing a customer’s details later never rewrites a parcel that has already gone.',
      },
      {
        id: 'payment',
        say: 'What it is worth and what it weighs. The amount to collect is what the courier asks for at the door; the declared value is what it is worth if it goes missing.',
      },
      {
        id: 'items',
        say: 'The lines, by your own SKU. This is the snapshot too — the product can be renamed or archived afterwards and this order still says what was sold.',
      },
      {
        id: 'charges',
        say: 'Charges is what the parcel costs you, line by line, with tax on its own row. Estimated means the figure is worked out and not yet taken from your wallet.',
      },
      {
        id: 'invoice',
        say: 'And the tax document for the sale, with its own number, downloadable as a PDF. Skydrop issues it when the parcel is delivered.',
      },
      {
        id: 'parcel',
        say: 'Back on the left: the parcel itself. The waybill, which courier is carrying it, and a tracking link written for your customer rather than for you.',
      },
      {
        id: 'parcel-figures',
        say: 'Under it, what the COURIER says rather than what you declared — the weight they charged on, and whether they have handed the money over. Here they have told us neither, and the page says so rather than guessing.',
      },
      {
        id: 'history',
        say: 'Full history is the same journey without the shaping: our handling and every courier scan, newest first, and it is never edited. This is what an argument gets settled from.',
      },
      {
        id: 'outro',
        say: 'And the two buttons at the top are the actions — raise an issue, or ask for it back. Each has its own tutorial; from here you can read any order without pressing a thing.',
      },
    ],
  },
  {
    slug: 'changing-an-order',
    title: 'Changing an order before it is confirmed',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'An order you have not sent to the call centre yet is still entirely yours. Everything on it can be corrected — and there is a moment when that stops being true.',
      },
      {
        id: 'open-draft',
        say: 'A draft is an order you have started and not submitted. It sits in your list like any other, with nothing held for it and nothing booked against it.',
      },
      {
        id: 'edit',
        say: 'Edit, and read the line under the title. A draft can be changed in full; once it is waiting on the call centre, the recipient and the notes are still yours to correct.',
      },
      {
        id: 'rail',
        say: 'Four parts to an order, and the rail says so before you scroll: what is in it, where it is going, what the customer pays, and what you want us to know.',
      },
      {
        id: 'items',
        say: 'The lines first, with the catalogue underneath it. Each product carries what you have in stock right now, because the commonest correction is one you can only make if you know that.',
      },
      {
        id: 'quantity',
        say: 'Change a quantity here rather than cancelling and starting again. A wrong product on an order nobody has confirmed is a correction, not a reason to begin twice.',
      },
      {
        id: 'cod-warning',
        say: 'And the payment section notices. The parcel is now worth more than the amount you are asking the customer for, so the page says so — and offers you the figure it worked out.',
      },
      {
        id: 'use-figure',
        say: 'Taking it makes the two agree. That sum is what the courier will ask for at the door, and nothing else on this page will remind you if it is wrong.',
      },
      {
        id: 'recipient',
        say: 'The recipient, and the two lines of help worth reading. The first line takes the address and nothing else — the PIN code decides the rest of it.',
      },
      {
        id: 'landmark',
        say: 'The second line is the landmark on its own, and it is the field that decides whether a rural address gets found at all. It is what we print for the driver.',
      },
      {
        id: 'notes',
        say: 'Notes are for the agent who rings your customer and the person who packs the box. Your customer never reads them.',
      },
      {
        id: 'bar',
        say: 'Then the bar that stays with you. Discard throws the draft away, Save keeps it a draft, and Save and submit is the one that closes the window.',
      },
      {
        id: 'submit',
        say: 'It asks first, and it asks with the two things worth checking: which order, and what the customer will be handing over.',
      },
      {
        id: 'outro',
        say: 'Submitted, and in the call queue. From here the contents are settled — stock is about to be held and a waybill booked — and Edit reaches only the customer’s own details.',
      },
    ],
  },
  {
    slug: 'cancelling-an-order',
    title: 'Cancelling an order',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Calling an order off is one button. What it actually costs depends on how far along the order is — and the page tells you which of those you are about to do before you agree.',
      },
      {
        id: 'open-pending',
        say: 'This one is waiting on our call centre. Nobody has rung the customer yet, nothing has been picked, and no stock is being held anywhere for it.',
      },
      {
        id: 'buttons',
        say: 'Three actions along the top of an order this early — raise an issue about it, edit it, or call it off. Cancel is the last of them.',
      },
      {
        id: 'dialog',
        say: 'It names the order in its own title, and it opens with the sentence that matters most. This cannot be undone: to ship to this customer afterwards you would place a new order.',
      },
      {
        id: 'consequence-pending',
        say: 'Then what cancelling does at this particular point. It comes out of the call queue, so nobody will phone this customer about it, and there is no stock to give back because none was ever held.',
      },
      {
        id: 'reason',
        say: 'The reason is optional and it is kept on the order. Worth typing anyway — in a month it is the only thing that will tell you why this one was called off.',
      },
      {
        id: 'confirm',
        say: 'And that is it. The order is cancelled, the actions on it have gone, and it stays in your list as a record rather than disappearing out of it.',
      },
      {
        id: 'history',
        say: 'The history carries the whole thing — when it happened and the words you typed. Like every line on this page, it is written once and never edited.',
      },
      {
        id: 'open-confirmed',
        say: 'Now one that has got further. An agent has spoken to this customer and confirmed the order, and that is the moment stock is set aside for it and a waybill is booked.',
      },
      {
        id: 'tracker',
        say: 'The tracker says exactly that. Confirmed by phone, and the warehouse steps still to come — nothing has been picked and no box has been packed.',
      },
      {
        id: 'cancel-confirmed',
        say: 'The same button, and the same dialog. Read the middle of it, because the order is somewhere else now and so is the sentence.',
      },
      {
        id: 'consequence-confirmed',
        say: 'The stock held for this order goes back to available straight away. That is the whole difference between the two: a moment ago there was nothing to give back, and now there is.',
      },
      {
        id: 'confirm-confirmed',
        say: 'Confirm, and it is called off — and the parcel has gone from the page with it. The waybill that was booked is ours to close with the courier; you do not have to ring anybody.',
      },
      {
        id: 'window',
        say: 'Once the box is packed and sealed this is past. Here is a parcel already out with a driver, and there is no Cancel button on it at all.',
      },
      {
        id: 'outro',
        say: 'What you get instead is the other button up here — ask us to act on the parcel. Chase the courier, ring the customer, or turn it round and send it back. Each is a different job, and they have their own tutorial.',
      },
    ],
  },
  {
    slug: 'fix-the-rows-that-failed',
    title: 'Fixing the rows that would not import',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Most of a spreadsheet becomes orders without anybody looking at it. This is about the rows that did not — and how to fix one without touching the file again.',
      },
      {
        id: 'pending-button',
        say: 'You find them here, and only when there are any. Nothing in the sidebar links this page, because on most days there is nothing to link to.',
      },
      {
        id: 'open',
        say: 'Rows from an upload that need a decision before they can become orders. Everything else in that file is already an order — these are all that is left of it.',
      },
      {
        id: 'tiles',
        say: 'Three counts, all of them from the list below. How many are waiting, how many have a value that is wrong, and how many look like a parcel this customer is already getting.',
      },
      {
        id: 'band',
        say: 'One band per row, headed by the row number from your own spreadsheet and your own reference. Those are the two things you can match against the file open beside you.',
      },
      {
        id: 'problem',
        say: 'And the page marks the field that stopped it, in its own words. This address has no second line — and our second line is the landmark, which is what decides whether a driver finds the place at all.',
      },
      {
        id: 'fix',
        say: 'So type one in. The whole row is here and every field of it can be edited, not only the one that was wrong, so anything else you notice can go at the same time.',
      },
      {
        id: 'buttons',
        say: 'Three things you can do with a row. Turn it into an order, save the correction and come back to it, or throw the row away.',
      },
      {
        id: 'discard',
        say: 'Throwing it away asks first, and says exactly what that means: it leaves this list and no order is made from it. That is for the line you never meant to send us.',
      },
      {
        id: 'keep',
        say: 'This one we do want, so back out of that. Import as an order saves what you typed before it imports — a correction is never lost to pressing the wrong button.',
      },
      {
        id: 'confirm',
        say: 'It asks too, and it tells you the same thing from the other side: it becomes an order and it leaves this list.',
      },
      {
        id: 'empty',
        say: 'And nothing is waiting, which is the state you are aiming for. Every row of that upload is now an order.',
      },
      {
        id: 'outro',
        say: 'There it is on the orders list with the rest of the file, waiting on the call centre like every other order you have placed.',
      },
    ],
  },
  {
    slug: 'quieten-your-notifications',
    title: 'What Skydrop tells you, and how to quieten it',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Skydrop tells you a great deal — every call, every scan, every rupee. This is where all of it lands, and where you decide how much of it you want.',
      },
      {
        id: 'inbox',
        say: 'The bell opens your inbox. Everything sent to you: what a courier did, what the warehouse checked in, and what moved in your wallet.',
      },
      {
        id: 'counts',
        say: 'How many you have not read, how many are on the page, and a button for the ones further back. It loads a screenful at a time rather than everything you have ever been sent.',
      },
      {
        id: 'filters',
        say: 'Two rows of filters. The first is simply read or unread; the second is the kinds that happen to be on this page, so it changes with what you have been sent lately.',
      },
      {
        id: 'message',
        say: 'A message is a paragraph, not a document. What kind it is, when it arrived, a link to the order it is about, and its own name at the end — that last one matters in a moment.',
      },
      {
        id: 'open',
        say: 'Click it and it opens in place, and it stops being new — because opening something is what reading it means. There is no page to go to and come back from.',
      },
      {
        id: 'unread',
        say: 'Which is what makes the unread filter useful. The one just read has gone from this list, so what is left is what you have not seen.',
      },
      {
        id: 'dismiss',
        say: 'Dismiss asks first, and it names the message. It clears it from your feed and nobody else’s — a colleague who was sent the same thing still has their copy.',
      },
      {
        id: 'settings',
        say: 'Now the other half. Settings, and read the sentence at the top, because the whole page turns on it.',
      },
      {
        id: 'tiles',
        say: 'Two separate choices. What reaches you, and what this company is emailed about. Both of them only ever take a message away — neither can turn one on that the other switched off.',
      },
      {
        id: 'yours',
        say: 'Yours first, grouped the way the messages are. Every one carries the same name you saw at the bottom of the message, so you can find the switch for the thing that is bothering you.',
      },
      {
        id: 'off',
        say: 'Switch one off and it is off. There is no save button on this page, because every flip is its own request — the page would have nothing left to do when you pressed it.',
      },
      {
        id: 'company',
        say: 'Below it, the company’s email, by category rather than by message. Flipping one of these changes what everybody here is sent, not only you — which is why it is a separate list on the same page.',
      },
      {
        id: 'outro',
        say: 'And some things cannot be switched off at all. Anything about your account, your password or the bank account we pay you into always reaches your email, and neither list contains them.',
      },
    ],
  },
  {
    slug: 'follow-a-consignment',
    title: 'Following a consignment from Dhaka to the shelf',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Stock you send us through Dhaka is counted twice — once when it reaches Bangladesh and again when it lands in India. This page is where you see both.',
      },
      {
        id: 'register',
        say: 'Everything you have announced, and where each one has got to. One is still travelling, one has landed, and one of them was counted differently from what was declared.',
      },
      {
        id: 'tiles',
        say: 'The three tiles are the whole register in one line. Nothing is blocked by a difference in a count — your stock is simply what was counted.',
      },
      {
        id: 'open',
        say: 'Open the one that has landed, because it has the full story on it: announced, counted, flown, and counted again.',
      },
      {
        id: 'route',
        say: 'The route is the first thing, and it is the sentence that decides your bill. You ship to Dhaka, we move it to India for you, and the inbound freight for that move is ours to charge.',
      },
      {
        id: 'detail-tiles',
        say: 'How many products, how many units are on the shelf in India, how many are not yet, and whether freight has been billed for it.',
      },
      {
        id: 'timeline',
        say: 'Then what has actually happened to it, oldest first, and labelled by what each step means rather than by a status word. Nobody has to ask us for this.',
      },
      {
        id: 'dhaka',
        say: 'The first stop. This is what our Bangladesh warehouse found when it opened the cartons, against what you told us was coming.',
      },
      {
        id: 'dhaka-lines',
        say: 'And the difference, per product. One line came up short of the declaration, which is a conversation between you and whoever packed it — we simply record what we found.',
      },
      {
        id: 'india',
        say: 'The second stop, and the second count. Here the comparison is not against your declaration — it is against what Bangladesh actually dispatched.',
      },
      {
        id: 'india-lines',
        say: 'Short again, on the same product, and this difference is a different problem. It left Dhaka and it did not land, which is ours to take up with the forwarder.',
      },
      {
        id: 'why-two',
        say: 'That is the whole reason there are two counts. One tells you what left; the other tells you what arrived. With a single number at the end you could not tell those two apart.',
      },
      {
        id: 'freight',
        say: 'Below it, the freight for that move — what it cost to get this consignment into India, and how much of that has been charged to you so far. Why it is only partly charged has a tutorial of its own.',
      },
      {
        id: 'outro',
        say: 'And back at the top, the unit that did not arrive is named. What landed is sellable from the moment it was counted; what did not is said out loud rather than quietly missing from a total.',
      },
    ],
  },
  {
    slug: 'read-your-stock',
    title: 'Reading your stock',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Having stock and being able to sell it are two different things, and this page keeps them apart on purpose. Once you can read it you will never over-sell a product again.',
      },
      {
        id: 'open',
        say: 'Inventory is everything of yours we hold, by SKU. You cannot add to it from here — receiving happens at the warehouse, and the page says so rather than offering a button that would lie.',
      },
      {
        id: 'india',
        say: 'The first tile is the one that matters. India stock is every unit on a shelf in India, and underneath it the number splits in two.',
      },
      {
        id: 'held',
        say: 'Sellable now, and held for orders. A confirmed order has already claimed its units — they are still yours and still on the shelf, but they are spoken for, so the page will not offer them twice.',
      },
      {
        id: 'transit',
        say: 'Then the number that is never added to the others. Goods between Dhaka and India are in neither building, so they cannot be picked, and folding them into a stock figure is how a seller sells something that has not landed.',
      },
      {
        id: 'value',
        say: 'What it is all worth, at what you paid rather than what you sell it for — and split the same way, because stock in the air is not stock you can turn into money this week.',
      },
      {
        id: 'uncovered',
        say: 'And the honest line under it: units we have no cost for are left out of that total rather than counted as worthless. The unit cost is optional when you announce a consignment, and this is where skipping it shows up.',
      },
      {
        id: 'register',
        say: 'Then the register itself, one row per SKU, with the same three numbers side by side so you can compare products rather than one at a time.',
      },
      {
        id: 'row',
        say: 'India stock, reserved, available — and available is simply the first minus the second. It is the only one of the three you should ever promise a customer.',
      },
      {
        id: 'transit-column',
        say: 'In transit sits in its own column and is added to nothing. These are the two products on the consignment that is still in the air; the others have a dash, because nothing of theirs is travelling.',
      },
      {
        id: 'low',
        say: 'The last column is the low-stock warning, which is per SKU and which you set yourself. That has a tutorial of its own.',
      },
      {
        id: 'outro',
        say: 'So: one page, and two questions it answers separately. What do I own, and what may I sell today. They are rarely the same number, and this is the only place that says which is which.',
      },
    ],
  },
  {
    slug: 'what-the-freight-cost',
    title: 'What the freight cost',
    subtitle: 'Skydrop for sellers',
    steps: [
      {
        id: 'intro',
        say: 'Getting your stock from Dhaka to our warehouse in India costs money, and that cost is yours. This page is the whole of it — and the one idea behind it surprises most sellers.',
      },
      {
        id: 'open',
        say: 'Inbound freight, under Money. There is nothing to press on it. A bill is raised by us once the forwarder has invoiced us, and it is settled out of your wallet.',
      },
      {
        id: 'owed',
        say: 'The first tile is the one you came for: what is still to be taken from your wallet. It is not due on a date. It comes out a little at a time.',
      },
      {
        id: 'billed',
        say: 'Beside it, the two figures that make the point. What you have been billed altogether, and underneath, what has actually been charged so far. They are not the same, and nothing is wrong.',
      },
      {
        id: 'units',
        say: 'Here is the reason, in one line. A unit is charged its share when it is delivered. The bill is divided across every unit that landed, and each one pays as it leaves.',
      },
      {
        id: 'terms',
        say: 'One row per bill, because a bill is raised per arrival. The terms on this one are pay as it sells, which is the only kind that works a share at a time.',
      },
      {
        id: 'total',
        say: 'The total, and underneath it the figure that was actually agreed — in taka, with the rupees it came to at the rate on the day it was billed. That is what makes it checkable.',
      },
      {
        id: 'progress',
        say: 'Then the same story along the row. Charged so far, still to come, and how many of the consignment’s units have gone. The rest are on a shelf in India, and they have been charged nothing.',
      },
      {
        id: 'tabs',
        say: 'The tabs are every state a bill can be in. Nothing charged yet, partly charged, fully charged, forgiven — and withdrawn, which means the bill was wrong and anything it took has gone back.',
      },
      {
        id: 'note',
        say: 'The page says it in its own words at the bottom, and it is worth reading once. A bill can stay partly owed for a very long time without anything being wrong with it.',
      },
      {
        id: 'consignment',
        say: 'The bill names the arrival it belongs to, and that name is a link. It goes to the consignment itself, where the same figures sit next to what was actually counted off the plane.',
      },
      {
        id: 'panel',
        say: 'Here is the bill in full. The total, what has been charged, what is still to come, the terms in a sentence, and how many units have been through.',
      },
      {
        id: 'service',
        say: 'And the line that is easy to miss. Credit terms can carry a service charge on top of the freight. Yours do not, and the page says so out loud rather than leaving the row off.',
      },
      {
        id: 'invoice',
        say: 'Underneath, what the bill actually was — the forwarder, their invoice number, and how the weight was arrived at. If you want to query it, that is the sentence to quote.',
      },
      {
        id: 'timeline',
        say: 'And further up, the day it was raised, on the same timeline as the counts. You are told a bill exists at the moment it is made, rather than finding it in your wallet later.',
      },
      {
        id: 'outro',
        say: 'So: freight is one bill, spread over the units it brought in, and paid off as those units are delivered. Stock still sitting on the shelf owes nothing yet.',
      },
    ],
  },
  /*
    THE FIRST ADMIN VIDEO, and deliberately a tour rather than a
    demonstration: it presses nothing anywhere. Every screen it visits
    carries warning copy written by whoever built it, and the job here
    is to read that copy out beside what the act actually writes.
  */
  {
    slug: 'what-we-cannot-undo',
    title: 'What we cannot undo',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Almost everything in this console can be put right afterwards. A handful of things cannot. This is that list — what each one writes, and what it costs to get wrong.',
      },
      {
        id: 'god-mode',
        say: 'God mode forces an order into a state the rules forbid. The panel says the price out loud: audited as critical, and the order carries an override flag that is set once and never cleared.',
      },
      {
        id: 'god-mode-stock',
        say: 'And the half people miss. A forced status does everything a real one does — notifications, webhooks, money — except stock. So the claim on the shelf is released, or restored, on its own.',
      },
      {
        id: 'receive',
        say: 'Completing a goods receipt writes stock for what was counted. There is no cancel afterwards: a miscount is corrected with a stock adjustment, which is a second entry rather than an erasure.',
      },
      {
        id: 'force-outcome',
        say: 'On the call queue you can overrule a stuck call. It is recorded as a real attempt against your own name, and attempts are append-only — nobody can take it back out of the history.',
      },
      {
        id: 'pack',
        say: 'At the pack bench a box is opened by scanning its label, and the scan is what proves the right things went into it. You can pack without one — recorded under your name, with a reason.',
      },
      {
        id: 'pickups',
        say: 'A pickup is one request per warehouse per day. Freeing a day is the dangerous one, and the page says why: when a call fails we cannot tell whether the courier registered it.',
      },
      {
        id: 'rto',
        say: 'A return the courier has handed back waits here until a person receives it. Nothing does that automatically, on purpose — receiving is what starts the inspection that puts stock back or writes it off.',
      },
      {
        id: 'bins',
        say: 'The switch here moves no stock either way. The one act that would — collapsing every bin into the floor — has no button at all. It takes a super admin, and a code sent to them.',
      },
      {
        id: 'topups',
        say: 'Accepting a top-up credits a seller’s wallet, and the screen asks you to check it against the statement first. That credit is money they can ask us to send them.',
      },
      {
        id: 'bank-change',
        say: 'Approving a bank change moves where a seller’s money is sent. Until somebody approves it, their withdrawals keep going to the account already on file — which is the whole reason this screen exists.',
      },
      {
        id: 'month',
        say: 'And closing a month freezes its figures for good. A closed month is never reopened; anything that changes it afterwards is carried into whichever month is open when we find it.',
      },
      {
        id: 'outro',
        say: 'None of these is forbidden. Each one asks you for a reason and records who you are. If you cannot write the reason down, that is the sign to ask somebody before you press it.',
      },
    ],
  },
  /*
    H1 — the admin dashboard, read-only. One screen, three bands, and
    the lesson is that they answer three different questions.

    NO FIGURE IS SPOKEN. The tiles print every one of them, and on this
    box the call-centre tile counts 157 ORDERS awaiting confirmation
    while the queue it links to holds three live entries — 153 of the
    difference is a bulk load somebody left behind. Describing the
    SHAPE is right anyway (the standing rule) and here it is also what
    keeps this video and I1's from contradicting each other.
  */
  {
    slug: 'the-ops-dashboard',
    title: 'What needs a person today',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'This is the staff console’s front page, and it answers one question before any other: what is waiting on somebody right now. Everything below that is history.',
      },
      {
        id: 'attention',
        say: 'The top band is the work queue. Seven areas, each with a count, and the ones with something in them are lit — so the screen reads as a shape before you read a single number.',
      },
      {
        id: 'call-centre',
        say: 'The call centre is first because nothing moves until a customer says yes. These are orders nobody has reached yet, and the P zero badge is the console telling you where to start.',
      },
      {
        id: 'merchant',
        say: 'The next is not yours to clear. These rang out until the cap, and the seller has been asked whether to keep trying or let them go — so it waits on them, not on us.',
      },
      {
        id: 'warehouse',
        say: 'Then the floor. Confirmed orders with stock behind them, waiting for somebody to print a picking sheet. That number is a morning’s work, not a problem.',
      },
      {
        id: 'quiet',
        say: 'Two of them are quiet, and that is the point of the band. Nothing a courier refused to carry, nothing confirmed against an empty shelf. A zero here is genuinely good news.',
      },
      {
        id: 'support',
        say: 'Support is damage claims and seller issues, and it carries an Action badge because every one of them has somebody at the other end waiting to hear back from us.',
      },
      {
        id: 'settlements',
        say: 'And the last is money. Sellers who have asked to be paid out and have not been yet — marked Escrow, because we are holding cash that belongs to somebody else.',
      },
      {
        id: 'performance',
        say: 'The second band is a different question. Not what is waiting, but how the last thirty days have gone — and every figure in it is a rate with its own denominator underneath.',
      },
      {
        id: 'rates',
        say: 'Confirmed on call, out of the orders placed. Delivered, out of everything dispatched. Returned, the same. Read together they say where parcels are being lost, which is the useful reading.',
      },
      {
        id: 'money',
        say: 'The third band is the money the last thirty days moved. What the couriers collected, what we charged for carrying it, and what we have actually paid out to sellers.',
      },
      {
        id: 'outstanding',
        say: 'The last tile is the one to read carefully. It is not revenue — it is seller balances we hold and have not paid out. That is a debt, and the link goes to the ledger behind it.',
      },
      {
        id: 'outro',
        say: 'So: the top band is today, the middle is the month, and the bottom is whose money is where. Every tile is a link to the screen that clears it.',
      },
    ],
  },
  /*
    H2 — reading ONE order, and nothing else. Every control on this page
    is taught somewhere later and separately, and the closing line says
    so; the promise here is that you can answer any question about an
    order without asking anybody.

    Filmed against `RSH-LIFE-RESTOCKED`, the richest order D0 leaves: a
    whole forward journey, a failed delivery with the courier's own
    reason code, a return, a receipt at the bench and a disposition —
    so every band on the page has something in it.
  */
  {
    slug: 'find-an-order',
    title: 'Reading an order',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Every order on the platform is on this one list, whoever sold it. The job of this video is reading one — not changing it. Nothing here gets pressed.',
      },
      {
        id: 'filters',
        say: 'Four filters over the top. Status is the whole lifecycle, thirty of them; then how the order arrived, which seller it belongs to, and the day it was placed — read in India time, not yours.',
      },
      {
        id: 'search',
        say: 'And one search box that takes several things: our order number, the seller’s own reference, the recipient’s name or their phone. Whichever the person on the phone happens to have.',
      },
      {
        id: 'open',
        say: 'Rows link straight through. This one came back — delivery failed, the parcel returned, and the goods are on our shelf again, which makes it the fullest page to read.',
      },
      {
        id: 'snapshot',
        say: 'The recipient block is a SNAPSHOT, frozen when the order was placed. Editing the customer record later never rewrites it, because this is where the parcel was actually sent.',
      },
      {
        id: 'reputation',
        say: 'Above it, what we know about this customer: how many orders they have had, how many arrived, and how many came back. That last number is the one a call agent wants before ringing.',
      },
      {
        id: 'payment',
        say: 'Then the money the customer is in. What they hand over at the door, and separately what the goods were declared to be worth — the courier needs both, and they are not the same figure.',
      },
      {
        id: 'items',
        say: 'The items are a snapshot too, down to the SKU and the weight. Reserved is stock actually held for this order — on one that has already shipped, it is back to nothing.',
      },
      {
        id: 'charges',
        say: 'Charges are what the seller was billed, line by line, with a visibility column: this is the page that tells you whether the seller can see the same line you are looking at.',
      },
      {
        id: 'parcel',
        say: 'The parcel carries its waybill and which of our courier accounts booked it. Underneath, the panel says plainly what the courier will no longer accept, and why.',
      },
      {
        id: 'tracker',
        say: 'The tracker is the journey as rungs. It ends where the parcel actually got to — this one has no delivery step at all, because it never had one, and it finishes back in stock.',
      },
      {
        id: 'history',
        say: 'Under that is everything, newest first: our own events and the courier’s scans in one column, so you never have to hold two timelines in your head at once.',
      },
      {
        id: 'attempt',
        say: 'And the failed delivery is drawn on the scan it belongs to, not as a second line — with the courier’s own reason code, and whether that code even allows another attempt.',
      },
      {
        id: 'outro',
        say: 'Everything below is an action, and each one has a tutorial of its own. If you only ever read this page, you can still answer almost any question about an order.',
      },
    ],
  },
  /*
    H4 — the permission model, taught through the screen that edits it.
    `ready`: it needs no seeding at all, which makes it the cheapest
    admin entry in the library.

    IT SAVES NOTHING. The editor is opened on a real role and closed
    again with Cancel, because the thing being taught is how to READ the
    catalogue — and a role saved on camera would be a role somebody has
    to unpick afterwards.
  */
  {
    slug: 'the-permission-model',
    title: 'Who can see what',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Somebody cannot see a screen, and you have been asked to fix it. This is where that is decided — and the page says the important half in its own first line.',
      },
      {
        id: 'roles',
        say: 'A role is a set of permissions, and you make as many as the work needs. The permissions themselves are fixed by the system: you choose which ones a role has, never what one means.',
      },
      {
        id: 'list',
        say: 'Each role says what it covers and how many people hold it. Look at that last column first — a role nobody holds is safe to change, and one held by thirty is not.',
      },
      {
        id: 'superadmin',
        say: 'One row has a padlock and no Delete. Super admin holds everything, including permissions that do not exist yet, which is what stops a new feature being invisible to everybody on the day it ships.',
      },
      {
        id: 'open',
        say: 'Open a real role to see the catalogue. This is the whole model on one screen — every permission the system has, grouped, with the ones this role holds already ticked.',
      },
      {
        id: 'counts',
        say: 'The line above the list is worth reading before anything else. How many of the total this role holds, and separately, how many of those can move money or stock.',
      },
      {
        id: 'groups',
        say: 'They are grouped by the part of the business they belong to. And every single one carries a sentence: not what it is called, but what somebody holding it can actually do.',
      },
      {
        id: 'dangerous',
        say: 'A triangle means it can move money or stock. Not a different check — the server treats them all alike — but a mark, so a role that quietly collects six says so before it is saved.',
      },
      {
        id: 'search',
        say: 'The search covers the name, the explanation and the key, which is how you answer the question you were actually asked. Somebody cannot finish a return, so search for return.',
      },
      {
        id: 'lookalike',
        say: 'And this is why the sentences matter. Finalise a return sounds like paperwork, and it permanently removes stock. Act on a parcel at the courier sounds like admin, and it sends a van.',
      },
      {
        id: 'cancel',
        say: 'Close it without saving. Nothing here was going to be lost, but a role is held by real people and changing one is not something to do while looking around.',
      },
      {
        id: 'boundary',
        say: 'Last, the thing that keeps all of this honest. Hiding a button is a courtesy. The server checks the permission on every request, so a hidden control is refused anyway if somebody finds it.',
      },
      {
        id: 'outro',
        say: 'So: roles are yours to shape, permissions are not, every one explains itself, and the marked ones move money or stock. That is the whole model.',
      },
    ],
  },
  {
    slug: 'things-the-system-has-raised',
    title: 'Things the system has raised',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Some failures break nothing you can see. A login expires, a nightly job stops running, and the only sign is a figure that quietly stops moving. Everything like that lands here.',
      },
      {
        id: 'why',
        say: 'The page says it in its own words. These are the things the system could not fix by itself, gathered in one place instead of left in a log nobody reads.',
      },
      {
        id: 'counts',
        say: 'Three numbers, answering three different questions. How many are open, how many nobody has claimed yet, and how many are urgent — which is the one to look at on a busy morning.',
      },
      {
        id: 'severity',
        say: 'They are sorted worst first, and the severity is a word on the chip and not only a colour. High means money or parcels are affected right now.',
      },
      {
        id: 'detail',
        say: 'The body of the card is the point of it. This one is a cancelled order whose waybill was never cancelled with the courier — so the courier charged for it, has not credited it back, and could still collect the box.',
      },
      {
        id: 'link',
        say: 'Where an issue is about one order, it links straight to it. You are not meant to copy anything out of here: the card takes you to the screen that fixes the thing.',
      },
      {
        id: 'meta',
        say: 'Underneath, three facts. Which part of the system said it, when it was first seen, and how often. Seen once is usually one bad row. Seen every hour for days is not going to fix itself.',
      },
      {
        id: 'acknowledge',
        say: 'I am on it records that somebody is chasing it, so two people do not ring the same courier. Now read what it did not do. The issue is still open, because the problem is still there.',
      },
      {
        id: 'medium',
        say: 'Further down, a different kind of wrong. Nothing is broken; an exchange rate has not been touched in a while and fees are being priced from it. Medium means stopped, and staying stopped.',
      },
      {
        id: 'closedialog',
        say: 'Closing asks what was done, and insists on a few words, because that note is the record. Acknowledging is about people not colliding. Closing is a statement about the problem.',
      },
      {
        id: 'cancelclose',
        say: 'And this one gets cancelled, on purpose. Its own text says it clears itself once the rate is set. Closing by hand is for the ones that genuinely needed a person.',
      },
      {
        id: 'history',
        say: 'Show closed too brings back the ones already dealt with, each carrying when it closed and the note somebody left. Nothing is deleted here — a closed issue is the record that it happened.',
      },
      {
        id: 'notify',
        say: 'Last, the button that reaches people. It sends a notification for every open issue nobody was ever told about, so it asks first and says what it is about to do. Cancel.',
      },
      {
        id: 'outro',
        say: 'So: worst first, read the body, claim it so nobody duplicates you, and close it only when it needed you. An empty page here is the good outcome, not a missing feature.',
      },
    ],
  },
  {
    slug: 'taking-calls',
    title: 'Taking calls',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'In India most parcels are paid in cash at the door, so somebody rings first and asks whether the customer still wants it. This is that desk, and this is your whole shift on one screen.',
      },
      {
        id: 'availability',
        say: 'It opens saying you are not taking calls, and that is deliberate. Being signed in is not the same as being at your desk, and an order handed to an empty chair just waits.',
      },
      {
        id: 'start',
        say: 'One switch, and you are on the roster. This is the control that matters most: leave it on when you walk away and customers wait on you without anybody knowing.',
      },
      {
        id: 'arrives',
        say: 'You do not ask for work. The next customer in the queue is handed to you, oldest first, and claimed the moment it appears so no two agents can be given the same one.',
      },
      {
        id: 'purpose',
        say: 'Read this line before you dial. A call to confirm a new order and a call because a seller asked us to chase one open with completely different sentences, and the wrong one loses the customer.',
      },
      {
        id: 'risk',
        say: 'Then the customer themselves. This strip only appears when there is something to say — here, parcels of theirs have come back before, which is worth knowing before you agree to send another.',
      },
      {
        id: 'recipient',
        say: 'Who they are, where it is going and what they will be asked to hand over at the door. That last figure is the thing to say out loud: agreeing to the parcel is agreeing to the money.',
      },
      {
        id: 'outcome',
        say: 'Then you record what happened. Nine outcomes, and the line underneath tells you what each one does before you pick it rather than after.',
      },
      {
        id: 'permanent',
        say: 'Confirmed is the one to be careful with. It holds stock for this order and sends it to the warehouse. And every attempt you log is permanent and counts toward the limit before we stop trying.',
      },
      {
        id: 'note',
        say: 'Write what they actually said. This is read by other people later — the next agent who rings them, and the seller asking why their order has not moved.',
      },
      {
        id: 'record',
        say: 'Record it. The attempt is written, the order moves by itself, and nothing here needs a second confirmation — which is exactly why you check the outcome before pressing rather than after.',
      },
      {
        id: 'next',
        say: 'And the next one is already on the screen. You were not asked; the desk simply carries on, which is the point of marking yourself available in the first place.',
      },
      {
        id: 'release',
        say: 'If you cannot take this one, release it. No attempt is recorded and it goes back in the queue for somebody else, which is the honest thing to do rather than logging a call you did not make.',
      },
      {
        id: 'stop',
        say: 'And at the end of your shift, the same switch the other way. Nothing new is assigned, the queue keeps its place, and the next person on takes over. That is the whole job.',
      },
    ],
  },
  {
    slug: 'supervising-the-queue',
    title: 'Supervising the queue',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'The station hands agents one call at a time and shows them nothing else. This is the other view — everything waiting to be confirmed, and whose hands it is in.',
      },
      {
        id: 'tiles',
        say: 'Four counts across the top. Open is the two live states together; then how many nobody has taken, how many somebody has, and how many people are holding work right now.',
      },
      {
        id: 'filter',
        say: 'It opens on open, and that is deliberate. A finished attempt leaves its own row behind, and an order we retried has one per round, so showing everything buries the live queue in history.',
      },
      {
        id: 'row',
        say: 'Each row is one order. How long it has been waiting, when it next becomes callable, how many calls have actually been logged against the limit, and how many times it has been picked up.',
      },
      {
        id: 'stuck',
        say: 'Those last two columns are the whole reason this page exists. This one has been picked up once and called zero times. Somebody took it and never rang, and until now nobody could see that.',
      },
      {
        id: 'reassign',
        say: 'So move it. Read what the dialog promises first: the order keeps its place in the queue and every attempt already logged against it. Only the name changes.',
      },
      {
        id: 'pick',
        say: 'Only agents marked available are offered, and each one says what they are already carrying — because handing a stuck call to somebody who is also at their limit moves the problem rather than solving it.',
      },
      {
        id: 'moved',
        say: 'Done. The row still says assigned, the attempt count has not moved, and the name beside it is somebody who is actually at their desk.',
      },
      {
        id: 'reschedule',
        say: 'The other lever is timing. Every queued call has a time it becomes callable, and until this existed there was no way to bring one forward when a customer rang back.',
      },
      {
        id: 'when',
        say: 'Three shortcuts for the cases that actually happen, and a reason of your own. Moving when somebody gets telephoned is a decision you should be able to account for later.',
      },
      {
        id: 'rescheduled',
        say: 'And the callable column moves with it. Nothing else did: not the attempt count, not the order, not its place in the list. Only when somebody gets rung.',
      },
      {
        id: 'force',
        say: 'The third button is not like these two. It records a call that did not happen, under your name, permanently. It is sometimes the right answer, and it has a video of its own.',
      },
      {
        id: 'agents',
        say: 'Then the people. Who is on, what hours they work, which languages they speak, and how many calls each is carrying against their cap.',
      },
      {
        id: 'holding',
        say: 'Off does not mean empty. Going off shift hands nothing back, which is why that call had somebody\u2019s name on it at all. And an amber figure is an agent at their limit.',
      },
      {
        id: 'capacity',
        say: 'And the cap itself. One at a time is the default, so an agent who has just taken a call is already full. Raise it only when somebody is genuinely idle, and lower it when they are drowning.',
      },
      {
        id: 'outro',
        say: 'So: watch the picked-up column against the called column, move work off anybody who is not there, and change the timing rather than inventing a conversation. That is supervising.',
      },
    ],
  },
  {
    slug: 'forcing-an-outcome',
    title: 'Forcing an outcome on a stuck call',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Here is a call nobody is going to make. Somebody picked it up and then went off shift, and we already know how it ends — the seller emailed to say their customer has cancelled.',
      },
      {
        id: 'why',
        say: 'Neither of the other two levers helps. Reassigning hands the same dead call to another person, and closing the queue entry leaves the order sitting where it is for ever, waiting on a call that will never come.',
      },
      {
        id: 'open',
        say: 'So there is a third button. Notice what it does before you have typed anything — it goes red and it puts a gavel on the panel. That is the screen telling you which kind of act this is.',
      },
      {
        id: 'same',
        say: 'Read the line under the title, because it is the whole warning. This is recorded as a real attempt, against your name, with exactly the effect it would have had if an agent had made the call.',
      },
      {
        id: 'permanent',
        say: 'Three consequences, stated before you choose anything. The attempt is permanent. It counts toward the number of times we may ring this customer. And confirming here holds stock.',
      },
      {
        id: 'outcomes',
        say: 'Nine outcomes, the same nine an agent sees. Read the line underneath rather than the label — the words are ordinary and what each one does to the order is not.',
      },
      {
        id: 'confirmed',
        say: 'Confirmed is the expensive one. It reserves stock and sends the order to the warehouse, which is a van and a parcel set moving on a conversation you are asserting happened.',
      },
      {
        id: 'declined',
        say: 'Ours is declined, and the line says the word that matters: terminal. The order is rejected and this screen has no way back from that.',
      },
      {
        id: 'when',
        say: 'Then when the call happened — not when you are typing. The ledger is a record of real conversations, so putting the real time in is telling the truth rather than bending it.',
      },
      {
        id: 'notes',
        say: 'And say why. The attempt log is append-only, nothing here can be edited afterwards, and this box is the only place your reason will ever live.',
      },
      {
        id: 'record',
        say: 'One press, and it is done. No second confirmation, which is exactly why everything worth reading is above the button rather than after it.',
      },
      {
        id: 'landed',
        say: 'And it reports rather than predicts. The outcome it recorded, and where the order actually landed \u2014 and it would say so here too if the attempt limit had been reached.',
      },
      {
        id: 'gone',
        say: 'The call has left the queue and the order is rejected. Nothing on this page will put either of those back, and the attempt now sits in the ledger under your name for good.',
      },
      {
        id: 'outro',
        say: 'So: only when you already know, record what actually happened rather than what is convenient, and write down why. There is one way back out of a rejected order, and the seller has to ask for it.',
      },
    ],
  },
  {
    slug: 'sellers-asking-to-call-again',
    title: 'Sellers asking us to call again',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Every order here has a customer who was rung, answered, and said no. The seller thinks that was a misunderstanding and is asking us to try once more.',
      },
      {
        id: 'why',
        say: 'A refusal is a terminal state on purpose, and approving here is the only way back out of it. That is why it is a request the seller makes rather than a button the seller has.',
      },
      {
        id: 'card',
        say: 'Which is also why a card is mostly its reason, printed at full width instead of squeezed into a column. You are being asked to ring somebody who already declined; the reason is the decision.',
      },
      {
        id: 'read',
        say: 'This one says the customer rang the shop back an hour later and does want it. That is a good reason — it is new information from the customer rather than the seller hoping.',
      },
      {
        id: 'approve',
        say: 'Approve, and read what the dialog restates. The order comes out of rejected, goes back to waiting for confirmation, and joins the call queue like any other.',
      },
      {
        id: 'extra',
        say: 'Then the part nobody expects. Its attempt count is untouched, so unless you grant extra calls it comes back already out of chances and the first unanswered ring rejects it again.',
      },
      {
        id: 'note',
        say: 'A note, if the decision needs one. It is optional here because the seller already wrote the reason — this is only for anything you know that they do not.',
      },
      {
        id: 'approved',
        say: 'And it is gone from the waiting list. Somewhere in the call centre that customer is now sitting in a queue again, with the extra calls you just allowed.',
      },
      {
        id: 'second',
        say: 'The other one is different. Nothing new has happened — the customer declined over the delivery charge and the seller would simply like another go at them.',
      },
      {
        id: 'decline',
        say: 'So decline it \u2014 and say why, because the seller reads this. The order stays rejected, and they may ask again the moment something actually does change.',
      },
      {
        id: 'declined',
        say: 'Empty, which is the state this page should be in most days. A queue here means somebody is waiting on a decision that only a person can make.',
      },
      {
        id: 'history',
        say: 'Nothing is deleted, though. Switch the filter and both decisions are still here, each carrying what was granted and whatever was written beside it.',
      },
      {
        id: 'outro',
        say: 'So: read the reason rather than the order, ask whether anything has actually changed, and remember that approving without granting a call is the same as declining slowly.',
      },
    ],
  },
  {
    slug: 'where-things-live',
    title: 'Where things live',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'A warehouse is shelves, and this is where the shelves are described. Two halves: what is standing in every bin across the business, and the layout of one building.',
      },
      {
        id: 'overview',
        say: 'The top half is every bin we have, with the product, the seller and the batch on each one. Filter by building, by kind of bin, by seller, or by a SKU you are hunting for.',
      },
      {
        id: 'holds',
        say: 'Some of it is deliberately not sellable. In transit means it has left one warehouse and not arrived at the other — counted here so that neither building goes looking for it.',
      },
      {
        id: 'building',
        say: 'Everything below that is about one building at a time, and this is where you choose it. Our Dhaka intake warehouse is brand new: one floor, no shelving, nothing on it.',
      },
      {
        id: 'tracking',
        say: 'Here is the switch, and it is off. Off means everything lands on the floor and picking sheets name no shelf. Note that you cannot turn it on yet, and the line above says why.',
      },
      {
        id: 'compose',
        say: 'Because there is nowhere to put anything. So build a shelf. It goes in a zone — zones carry pick order, so a picker walks the building in a sensible sequence — and it is an ordinary shelf.',
      },
      {
        id: 'preview',
        say: 'Then three coordinates, and you never type the name. Aisle A, rack one, shelf three — and it tells you what that becomes before you commit. That is what stops one shelf having three spellings.',
      },
      {
        id: 'added',
        say: 'And there it is in the layout, empty, pickable, in the main zone. The building now has somewhere to put goods, so the switch above has come alive.',
      },
      {
        id: 'on',
        say: 'Turn it on, and read what the box promises. From now on receiving asks which bin the goods went into and picking sheets name a shelf.',
      },
      {
        id: 'notcollapse',
        say: 'And this is the sentence worth taking away. Turning it back off stops the system asking. It does not collapse what you have built — everything stays exactly where it is recorded.',
      },
      {
        id: 'off',
        say: 'Which is two different questions, and the page keeps them apart on purpose. What exists is one thing; whether anybody is asked about it is another.',
      },
      {
        id: 'move',
        say: 'Below that, re-shelving. You do not list what is in a bin — the server reads it and moves the lot in one transaction, or a list of lines that all commit or none do.',
      },
      {
        id: 'collapse',
        say: 'And one line at the very bottom for abandoning shelving altogether. That merges every bin into the floor, it cannot be undone from here, and it has a video of its own.',
      },
      {
        id: 'outro',
        say: 'So: coordinates rather than names, at least one shelf before you switch anything on, and remember that the switch changes what you are asked — never where anything is.',
      },
    ],
  },
  {
    slug: 'receive-a-consignment',
    title: 'Receiving a consignment',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Goods have arrived at the door. Until somebody counts them they are a promise on a screen; the moment this receipt is completed they become stock a customer can be sold.',
      },
      {
        id: 'queue',
        say: 'The receive station opens on what is waiting, and that is the only list that matters on a delivery morning. A row says which consignment it belongs to and who sent it.',
      },
      {
        id: 'open',
        say: 'Open it and you get the declaration — who the seller is, their own reference for it, which building it landed at, and what they say is in the boxes.',
      },
      {
        id: 'declared',
        say: 'Two products, and the expected figures are the SELLER’s. Nothing here has been counted by anybody yet, which is why every line says recorded nought.',
      },
      {
        id: 'start',
        say: 'Start receiving. That claims the receipt in your name, so two people cannot count the same pallet from two ends of the building and each overwrite the other.',
      },
      {
        id: 'fields',
        say: 'Now each line asks three things: how many good ones you found, how many arrived damaged, and which shelf you are putting them on.',
      },
      {
        id: 'exact',
        say: 'The first one is exact: ten declared, ten in the carton, none of them damaged. Every line also wants somewhere to put them, and this building keeps no shelf numbers, so the floor.',
      },
      {
        id: 'short',
        say: 'The second is not. Twenty declared, eighteen good ones and one damaged — so one is missing outright and one arrived broken. Record what you found, not what was promised.',
      },
      {
        id: 'recorded',
        say: 'Both lines now carry a count, and the damaged one is shown beside it. Nothing has been written to stock yet; this is still just what the person on the bench says.',
      },
      {
        id: 'confirm',
        say: 'Complete, and read this before pressing. Stock is written for what was counted, the receipt closes, and it cannot be cancelled afterwards — a mistake needs a stock adjustment.',
      },
      {
        id: 'variance',
        say: 'And the line that matters most: a variance does not block. We record the gap and the goods carry on, because holding a seller’s stock hostage over a count helps nobody.',
      },
      {
        id: 'written',
        say: 'Done. The receipt is closed, it is marked as counted differently, and those units are now on a shelf with your name against when they got there.',
      },
      {
        id: 'labels',
        say: 'One more thing while the boxes are open. Print product labels makes a sticker per unit you actually received — not per unit anybody expected — because spares end up on the wrong thing.',
      },
      {
        id: 'outro',
        say: 'So: claim it, count what is really there, put it somewhere, and complete. The gap is a number on a record, and the only way back from a wrong one is an adjustment.',
      },
    ],
  },
  {
    slug: 'print-and-pick',
    title: 'Labels and the picking sheet',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'This is the morning. Every confirmed order is already carrying a waybill, and this screen turns a list of them into paper somebody can walk the building with.',
      },
      {
        id: 'order',
        say: 'Labels first, then the picking sheet, and the subtitle says the rule the whole page turns on: nothing moves until somebody confirms the paper actually came out.',
      },
      {
        id: 'queue',
        say: 'So here is what is waiting on a label. Order, seller, courier, waybill, where it is going, what the customer owes at the door, and how many things are in it.',
      },
      {
        id: 'select',
        say: 'You do not print the whole queue. Pick the parcels you are going to walk in one go — these three are all going to the same part of the city.',
      },
      {
        id: 'printed',
        say: 'Print, and the file goes to the printer. Then it asks whether the paper came out, and names anything it could not print rather than quietly leaving it out of the stack.',
      },
      {
        id: 'confirm',
        say: 'Confirm only what is really in your hand. Saying yes marks those parcels labelled and moves them along; saying it for paper that jammed puts a parcel on a walk with nothing on it.',
      },
      {
        id: 'picking',
        say: 'They have moved to the picking tab. Same parcels, second sheet — and this is the one that tells a person which shelves to visit and in what order.',
      },
      {
        id: 'list',
        say: 'Print the picking list, and it tells you how many lines there are to walk. If something could not be allocated it says so and marks it on the sheet rather than hiding it.',
      },
      {
        id: 'allocates',
        say: 'And confirming this one does the real work. It claims the exact units on the exact shelves, and sends every order on it to be picked. That is why a shortfall surfaces here and not in an aisle.',
      },
      {
        id: 'batches',
        say: 'Every sheet is a batch, and past batches is where they live — when it was made, who made it, when it printed, and whether more than one copy is loose in the building.',
      },
      {
        id: 'walk',
        say: 'Now somebody actually walks it. When they come back with the trolley, the batch is marked picked and those parcels arrive at the packing bench.',
      },
      {
        id: 'strict',
        say: 'And it names the one exception before you press. Anything tracked unit by unit stays behind for the pick station, because a serial has to be scanned rather than counted off a sheet.',
      },
      {
        id: 'outro',
        say: 'So: select a walk, print it, confirm only what printed, and mark it picked when the trolley comes back. The paper is the plan; confirming it is what makes the plan true.',
      },
    ],
  },
  {
    slug: 'pack-a-parcel',
    title: 'Packing a parcel',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'This is the packing bench, and it has one field on it. Scan the shipping label to open a box, scan each product in, scan the label again to close. The packer never touches a keyboard.',
      },
      {
        id: 'queue',
        say: 'With nothing in hand it shows what is coming, oldest first. Nothing here claims a parcel — the box does that — and anything with no printed label is called out, because there is nothing to scan.',
      },
      {
        id: 'open',
        say: 'Reading the label is how a packer finds out what the parcel is. Scanning it opens a box, and that box is the claim — one per parcel, one per packer, held by the database itself.',
      },
      {
        id: 'lines',
        say: 'Now the biggest thing on the screen is what still has to go in, with the quantity beside each line. That is the question somebody asks from across a bench, so it gets the room.',
      },
      {
        id: 'first',
        say: 'Scan the first one in. The count moves, and a satisfied line goes quiet rather than vanishing — a line that disappeared would leave a packer wondering whether they scanned it or imagined it.',
      },
      {
        id: 'set',
        say: 'The second of the same product finishes that line. Look at the box now: two of one thing and none of the other. A count of what is inside would wave that through.',
      },
      {
        id: 'toomany',
        say: 'So try one too many. It is refused at the scan, with the item still in your hand — not at the end, when the box is taped and something in it is wrong.',
      },
      {
        id: 'fixed',
        say: 'And a refusal stops the bench. Nothing went into the box, and the field stays dead until somebody says they have dealt with it, because a scanner types and presses Enter on its own.',
      },
      {
        id: 'third',
        say: 'Back at it, and scan the one that is genuinely missing. The box is full, and it says so along with what to do next rather than leaving you to work it out.',
      },
      {
        id: 'close',
        say: 'Scanning the label again is the packer saying the box in front of them is the one they opened. The contents are checked as a set, product by product and unit by unit.',
      },
      {
        id: 'manifest',
        say: 'And here it is. The parcel joined a manifest without anybody asking for one — a manifest being the record of what went out on a van, not a step. Made for you at the bench, finished for you at the door.',
      },
      {
        id: 'second',
        say: 'Now a box that is not going to be finished. Open the next parcel, scan its product in — and then find the outer carton crushed, which is the ordinary reason for what comes next.',
      },
      {
        id: 'cancel',
        say: 'Cancelling says the important part plainly. The scans are discarded and the parcel goes back in the queue, and nothing returns to inventory — packing takes the stock out, and this box never got there.',
      },
      {
        id: 'cancelled',
        say: 'Gone, with the parcel back on the list for whoever picks it up next. The reason is required, and it is the only record anywhere that this box was ever opened.',
      },
      {
        id: 'outro',
        say: 'So: the label opens the box, the products go in one scan at a time, and the label closes it. Everything the bench refuses, it refuses while the thing is still in your hand.',
      },
    ],
  },
  {
    slug: 'pack-without-scanning',
    title: 'Packing without a scan',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Sometimes the goods in front of you have nothing on them to scan. Stock that was shelved before we printed product labels at all, or a sticker torn off in transit.',
      },
      {
        id: 'open',
        say: 'The box opens the same way, off the shipping label, because that part still works. What is on the parcel is right. What is missing is the proof.',
      },
      {
        id: 'stuck',
        say: 'And here is where an ordinary packer stops. Nothing goes in, the box cannot be closed, and the parcel sits on the bench while a customer waits on it.',
      },
      {
        id: 'hatch',
        say: 'There is a way past it — and notice where it is not. Not beside the close, not a tick box on the ordinary pack. Its own control, below the cancel, and most people never see it.',
      },
      {
        id: 'who',
        say: 'Because it is not a packer’s to press. Nobody waives the check they are the one performing, so this needs a supervisor — and the server enforces it, not the fact that you can see the button.',
      },
      {
        id: 'cost',
        say: 'Read what it says before anything else. This packs the parcel without checking what is inside it — and an unverified box is a wrong item at somebody’s door, with nothing saying which step was skipped.',
      },
      {
        id: 'short',
        say: 'So it wants a reason, and a short one will not do. Under twenty characters the button stays dead — because “broken” tells nobody anything when it is read back in six weeks.',
      },
      {
        id: 'reason',
        say: 'Say what was actually wrong and what you did instead. That sentence is the only thing standing between this parcel and a complete blank in the record.',
      },
      {
        id: 'press',
        say: 'And now it goes. Packed, on a manifest, out of the queue — exactly as though it had been scanned, which is the point and also the danger.',
      },
      {
        id: 'recorded',
        say: 'But not recorded the same way. It lands as its own action, high severity, under your name, with that reason on it — not a flag inside an ordinary pack nobody would filter for.',
      },
      {
        id: 'outro',
        say: 'So: use it when the labels are genuinely not there, say why in a sentence somebody can read later, and go and fix the labels. A bench that stops verifying stops being worth having.',
      },
    ],
  },
  {
    slug: 'hand-over-to-the-courier',
    title: 'Handing parcels to the courier',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'The van is at the door. This is the last look at a parcel before a driver takes it, and the subtitle is the rule the whole screen turns on.',
      },
      {
        id: 'waiting',
        say: 'First, what is still standing at the bench. Not a list of what you have done — a list of what is left, which is the question somebody loading a van actually has.',
      },
      {
        id: 'first',
        say: 'Scan the label as the box goes on. And that is it: no form to submit afterwards, no button to press when the van pulls away. The parcel is dispatched the moment it is read.',
      },
      {
        id: 'why',
        say: 'Which is the point. A scan happens per parcel, at the door, as the box leaves. A form afterwards is one person asserting that forty parcels went, and only one of those two was there.',
      },
      {
        id: 'second',
        say: 'The next one, and the session list grows rather than clearing. Did I do all forty is a question this screen can answer; a form that empties itself cannot.',
      },
      {
        id: 'manifest',
        say: 'And the manifest closes itself once its last parcel has gone. Nobody opens it, nobody closes it — it is the record of what went out on this van, kept for when somebody asks.',
      },
      {
        id: 'again',
        say: 'Now the mistake this is really guarding against. Scan a box that has already gone — and instead of a shrug, everything stops.',
      },
      {
        id: 'stop',
        say: 'Because it means one of two things, and both get worse the longer they run: two boxes carrying one waybill, or a pile that has already been done and whose rest is now suspect.',
      },
      {
        id: 'operator',
        say: 'The stop follows the person, not the bench. Four packers keep working; this one is held — and held at the packing station too, because the pile is what is in doubt.',
      },
      {
        id: 'clear',
        say: 'And it takes an admin to lift, which is deliberate. Somebody who is not holding the box goes and counts: is there a second one with this label on it?',
      },
      {
        id: 'outro',
        say: 'So: scan every box onto the van, watch what is left go down, and if it ever stops you, stop with it. A duplicate found at the door costs far less than one found by a customer.',
      },
    ],
  },
  {
    slug: 'book-the-van',
    title: 'Booking the van',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Most days nobody opens this. The van is asked for automatically when the day’s first box is packed — which is why there is already a request here that nobody raised.',
      },
      {
        id: 'grain',
        say: 'And read the grain, because it is the thing people get wrong. One request per warehouse per day covers the whole handover. Not one per parcel.',
      },
      {
        id: 'row',
        say: 'A row is a day. Who is collecting, where from, under which registered name, what time, and how many parcels we told them to expect.',
      },
      {
        id: 'close',
        say: 'When the driver has been, mark it collected. That is housekeeping rather than anything the courier sees — it is how tomorrow knows today is finished.',
      },
      {
        id: 'failed',
        say: 'Now the row this screen really exists for. An attempt that failed, with the courier’s own words on it rather than a code we invented for them.',
      },
      {
        id: 'danger',
        say: 'And the sharp edge. Freeing the day lets a new request be raised for it — which is the right thing when nothing registered, and sends a second van when something did.',
      },
      {
        id: 'probably',
        say: 'Read what it admits. They returned no id, so it probably never reached them. Probably is exactly why this is a deliberate act with your name on it.',
      },
      {
        id: 'check',
        say: 'So go and look in the courier’s own panel first, and say what you found. Two vans at one door is a real cost and an awkward phone call.',
      },
      {
        id: 'raise',
        say: 'Raising one by hand is a live call that books a real vehicle. The form is short because the courier needs very little — and that is exactly what makes it easy to do twice.',
      },
      {
        id: 'outro',
        say: 'So: it mostly looks after itself, mark the day collected when the driver has gone, and treat freeing a day as something you do after checking, never instead of it.',
      },
    ],
  },
  {
    slug: 'what-went-out-together',
    title: 'Manifests',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'A manifest answers one question: what went out on Tuesday’s van. And the subtitle is the important part — nothing here needs doing unless something has gone wrong.',
      },
      {
        id: 'columns',
        say: 'One row is one van-load. Which courier, how many parcels, when it was opened, and when it was closed out — which happens on its own as the last box is scanned.',
      },
      {
        id: 'filter',
        say: 'Filter by status if you are looking for something in particular. Draft is still collecting; dispatched has gone. Most of the time you are looking for one specific day.',
      },
      {
        id: 'draft',
        say: 'The draft at the top is today. It was created for you when the first box was packed, and it has been filling up ever since without anybody opening this screen.',
      },
      {
        id: 'open',
        say: 'Inside is the list itself. This is what you would read out to a driver, or send to the courier if they ever asked which parcels we say we handed over.',
      },
      {
        id: 'shipments',
        say: 'Parcel by parcel, with its waybill and where each one is. A parcel that has already been scanned onto the van reads differently from one still on the bench.',
      },
      {
        id: 'move',
        say: 'Moving a parcel to another sheet is the one repair this screen offers — and today there is nowhere to move it to, which it says rather than offering an empty list.',
      },
      {
        id: 'why',
        say: 'Because a second draft only exists when a second one is open for the same courier and the same building. With one courier and one warehouse, that is a situation you have to go and create.',
      },
      {
        id: 'close',
        say: 'And closing one by hand is a fallback, not a step. The handover scan does it as the last parcel goes, so pressing this means something stopped before that happened.',
      },
      {
        id: 'outro',
        say: 'So: it keeps itself. Come here to answer a question about a past day, or to repair something; the rest of the time it is paperwork that writes itself.',
      },
    ],
  },
  {
    slug: 'take-a-return-in',
    title: 'Taking a return in',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'A parcel has come back. It opens on the only urgent tab — these are standing at our door, and every hour they do is an hour the seller still thinks their goods are moving.',
      },
      {
        id: 'door',
        say: 'And read what it says about how one gets off this list. Receiving it is what starts the inspection, and nothing does that automatically. That is deliberate, not an omission.',
      },
      {
        id: 'why',
        say: 'Because the courier saying a parcel is back is not a parcel being back. Everything after this point moves real stock, and it needs somebody with the carton in front of them.',
      },
      {
        id: 'transit',
        say: 'The second tab is what is still travelling. Nothing to do here — it exists so the bench knows what is coming, and so a return on the road for weeks is visible somewhere.',
      },
      {
        id: 'bench',
        say: 'The third is what is already here and not finished with. Two different hold-ups live on it: boxes nobody has opened, and lines somebody looked at and could not decide about.',
      },
      {
        id: 'pick',
        say: 'Back to the door, and click the waybill. That fills it into the receive box and takes you to the bench — because the person doing this has a parcel in their hands, not a mouse.',
      },
      {
        id: 'receive',
        say: 'Receive. One press, and the parcel is ours again: the order moves, the clock on it stops, and its units are booked into the returns hold at this exact moment.',
      },
      {
        id: 'hold',
        say: 'That hold matters. Until a decision is made these units are somewhere real rather than nowhere — counted, not sellable, and findable by anybody who asks where they went.',
      },
      {
        id: 'lines',
        say: 'And here is what came back, line by line, each one waiting on somebody to say what condition it is in and what should happen to it.',
      },
      {
        id: 'outro',
        say: 'So: it arrives, somebody receives it, and the units land in the hold. Deciding what becomes of them is the next job — and that one cannot be taken back.',
      },
    ],
  },
  {
    slug: 'inspect-and-finalise-a-return',
    title: 'Inspecting and finalising',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'A parcel has been taken in and nobody has decided about it yet. That is this list, and it counts the two hold-ups apart, because they need different people.',
      },
      {
        id: 'open',
        say: 'Open it. Here is what came back, line by line, with no verdict on any of it — and from this point on, everything you press moves real stock.',
      },
      {
        id: 'where',
        say: 'They are not nowhere in the meantime. Taking the parcel in booked its units into the returns hold: a real place on the shelf plan, counted, and deliberately not sellable.',
      },
      {
        id: 'condition',
        say: 'Two questions per line, and the first is what you actually found in the box. Damaged or missing opens a claim with the seller, and that is where any money is settled.',
      },
      {
        id: 'choices',
        say: 'The second is what happens to it, and the screen will tell you what each choice does. Back in stock, kept aside, written off, or decide later. Read it rather than remembering it.',
      },
      {
        id: 'mismatch',
        say: 'And when the pair does not make sense it says so without refusing you. Damaged, back in stock, means that unit goes to the next customer. It is your call; it is just not a quiet one.',
      },
      {
        id: 'split',
        say: 'But this line holds more than one, and they need not have come back in the same state. That is what splitting by quantity is for, and it appears only when there is something to split.',
      },
      {
        id: 'arith',
        say: 'The rows have to add up to the units on the line exactly, and the sentence above them keeps the count. Anything else and the server refuses the whole save.',
      },
      {
        id: 'good',
        say: 'The first row is the good one, so correct it and the warning goes. Put it back in stock, and read what that means: at finalise it leaves the hold for a sellable shelf.',
      },
      {
        id: 'aside',
        say: 'The second is the damaged one, and this is the choice people forget exists. Keep it aside: it goes to the damaged bin, stays the seller’s, and is never sold to anybody.',
      },
      {
        id: 'save',
        say: 'Save, and the line is marked inspected. Nothing has moved yet — this is a verdict written down, and you can come back and change it.',
      },
      {
        id: 'confirm',
        say: 'Finalising is the part that cannot be taken back, so it restates what it is about to do in units rather than lines, and says plainly that stock moves now.',
      },
      {
        id: 'press',
        say: 'Press it. One unit is back on a shelf and sellable this second, one is in the damaged bin, and the order has moved on to say the return has been dealt with.',
      },
      {
        id: 'outro',
        say: 'So: condition, then consequence, per unit when they differ. And if you genuinely do not know, decide later is honest — it just leaves the parcel on this bench until somebody does.',
      },
    ],
  },
  {
    slug: 'correct-a-count',
    title: 'Adjusting stock',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'A stock adjustment is how a count gets put right — the one way a figure changes without a parcel being involved. The screen opens on the only thing here that is a job.',
      },
      {
        id: 'tiles',
        say: 'Everything else is history. These say what is waiting and what it stands to move: the value those corrections would take off the books, or put back on.',
      },
      {
        id: 'open',
        say: 'Review opens the case for it. Somebody counted, somebody else is being asked to agree, and nothing has moved yet — which is the only reason this screen exists.',
      },
      {
        id: 'facts',
        say: 'Direction, reason, what it is worth, and the threshold it was measured against — written down when it was raised. Change that setting tomorrow and this row still says what the rule was.',
      },
      {
        id: 'why',
        say: 'Then the words, and they carry the whole thing: the approver reads this and nothing else. Underneath is the line itself — a product, a shelf, a batch, and how many.',
      },
      {
        id: 'choices',
        say: 'Two ways out. Rejecting wants a reason and keeps it for good, which is the answer to why this never happened. The other button says what it does rather than what it is called.',
      },
      {
        id: 'approve',
        say: 'Because approving is not agreeing on paper. It writes the movement, the shelf count changes from that press, and nothing on this screen can put it back.',
      },
      {
        id: 'history',
        say: 'The queue is empty and the rest is history — a correction small enough to apply on its own sitting beside the one that needed two people, each with what it actually moved.',
      },
      {
        id: 'form',
        say: 'Raising one asks for identifiers rather than dropdowns, and that is on purpose: stock is held per batch per shelf, and whoever types this has the numbers on a count sheet in front of them.',
      },
      {
        id: 'held',
        say: 'Most corrections start somewhere else, though. Filter what is in every bin down to damaged, and here is stock deliberately held back — nothing is ever picked from one of these.',
      },
      {
        id: 'bin',
        say: 'Open the shelf itself. It says plainly that it is not pickable, and the control beside the line is not called adjust here, because there are only two places a unit on this shelf can go.',
      },
      {
        id: 'prefilled',
        say: 'It opens filled in. Product, shelf, batch, and the reason already chosen — something on a damaged shelf goes back to the seller or it gets scrapped, and nothing else.',
      },
      {
        id: 'cost',
        say: 'How many, and what one of them is worth. That second figure is the gate: quantity times value is what decides whether this applies now or waits for somebody.',
      },
      {
        id: 'raise',
        say: 'This one is under it, so it applies as you press. Read which the message says — applied, or waiting — because that is the whole difference between a correction and a conversation.',
      },
      {
        id: 'outro',
        say: 'So: small ones apply themselves, large ones wait for somebody else, and the reason you type is read by a person next year trying to explain a number that will not add up.',
      },
    ],
  },
  {
    slug: 'how-seller-money-works',
    title: 'How seller money works',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'This is the money desk. Seller wallets adds up everything Skydrop owes a seller and everything a seller owes us, and holds every line behind those two numbers.',
      },
      {
        id: 'owed',
        say: 'The first figure is a liability, payable on demand — any seller in credit can ask for it today. The second is the other direction: a wallet that has gone negative is money we are owed.',
      },
      {
        id: 'not-yet',
        say: 'These two are deliberately not inside those totals in the same way. A withdrawal asked for is still in the balance, because a request is not a payment. A top-up claimed is in no balance at all.',
      },
      {
        id: 'row',
        say: 'One row per seller, with what they can draw and what is waiting on us. Open the ledger behind it.',
      },
      {
        id: 'balance',
        say: 'Balance is what we owe them. Available to withdraw is that, less the floor we hold back and anything already requested — so the two agree only when nothing is pending.',
      },
      {
        id: 'held',
        say: 'Where their money is held answers what a balance cannot: which of our own accounts the cash is actually sitting in. Paying taka out of an account holding only rupees is not something a balance warns you about.',
      },
      {
        id: 'rules',
        say: 'Then the rules in force for this seller. Read-only here, and already resolved — the figure shown is the one being applied, not the two places it might have come from. Anything marked override was agreed with them.',
      },
      {
        id: 'ledger',
        say: 'The ledger is the whole history, newest first, and only money that actually moved is on it. Six kinds of line here, and you should be able to explain every one.',
      },
      {
        id: 'topup',
        say: 'A top-up is money the seller sent us, matched against our statement and credited. The reference on the row is the one off their own transfer — that is the thing it was matched on.',
      },
      {
        id: 'cod',
        say: 'A COD credit is cash the courier collected from the customer at the door. It lands when the courier pays us, not when the parcel arrived — crediting at delivery would mean fronting every seller a week of their own takings.',
      },
      {
        id: 'gst',
        say: 'Beside it, the tax line. It is extracted from a price that already included the tax, never added on top, and it is its own row rather than netted into the credit — so what was withheld can be summed.',
      },
      {
        id: 'charges',
        say: 'Order charges are what we billed for carrying the parcel. A return fee is what the round trip cost when it came back, and it has a direction of its own so that what returns cost this month is answerable from here alone.',
      },
      {
        id: 'refund',
        say: 'A damage settlement is us paying for goods spoiled in our hands. It is written in the same transaction as the ticket that closed, so a refund with no ticket behind it cannot exist.',
      },
      {
        id: 'tabs',
        say: 'The other two tabs are what has merely been asked for. A claim on one, a request on the other, and neither has moved a rupee — which is why the ledger does not know about either of them yet.',
      },
      {
        id: 'outro',
        say: 'So the ledger is history, and it is append-only — nothing on this screen edits a line. Every screen after this one writes to what you have just read.',
      },
    ],
  },
  {
    slug: 'is-the-money-picture-true',
    title: 'Is the money picture true',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Profit and loss. What each part of the business earns against what it costs — and, more usefully than either, how much of that we can actually see.',
      },
      {
        id: 'headline',
        say: 'Three figures at the top: the margin from the four sources, what it costs to exist, and the net of the two. Read the label underneath the net before you read the net.',
      },
      {
        id: 'honest',
        say: 'Because a cost nobody has recorded is reported as missing, never as zero. Zero would report the whole of that revenue as profit, and the page says plainly that nothing here is guessed to fill the gap.',
      },
      {
        id: 'sources',
        say: 'Underneath, every part of the business on a line of its own, each carrying a coverage figure — how many of the records on that line have a real cost against them, out of how many there are.',
      },
      {
        id: 'delivery',
        say: 'Delivery is the one to read carefully. It names, in words, every reason a parcel on it has no cost yet: the courier has not billed us, a manual courier has no ledger at all, or the parcel never got a waybill.',
      },
      {
        id: 'quoted',
        say: 'And the distinction most people miss. A charge that was worked out but never debited to the seller is a quote, not revenue — so it is named and left out, rather than counted because it exists.',
      },
      {
        id: 'open',
        say: 'Parcels still moving are on no line at all. An order is recognised when its fate is known — delivered, returned, or called off — and not when it was booked, because a booked parcel can still become any of them.',
      },
      {
        id: 'returns',
        say: 'Returns say the same thing in their own words. A return whose return cost was never recorded makes that margin flattering, and the line tells you so rather than letting you find out later.',
      },
      {
        id: 'lines',
        say: 'Then the smaller lines, and the rule they exist for: every rupee this business earns or spends is on one of them. A money flow the report cannot see reads as profit.',
      },
      {
        id: 'drill',
        say: 'Open a line and you get what it is made of, and then every record behind it, one row each. The total above and the rows below are the same computation — so a figure you cannot explain is a figure you can click.',
      },
      {
        id: 'costsync',
        say: 'Which leaves the obvious question: why is so much of it uncovered? This is the answer. Every night we sign in to the courier’s own portal and record what each parcel actually cost us.',
      },
      {
        id: 'silence',
        say: 'And this page exists because of the way that fails. It does not throw — it goes quiet, the figures simply stop moving, and nobody notices until a margin looks wrong weeks later.',
      },
      {
        id: 'counts',
        say: 'So the coverage is stated as a fraction here too, and the wording is deliberate. A parcel whose charge we have not read is uncovered, and uncovered is not the same as free.',
      },
      {
        id: 'runs',
        say: 'The run history is the thing to check first, and it is blunt about not knowing: either it has never run, or it has never finished far enough to say so. Both look identical from the margin.',
      },
      {
        id: 'outro',
        say: 'So read the coverage before you read the margin. The figure at the top is only as true as the fraction underneath it, and these two pages are the only things that tell you which.',
      },
    ],
  },
  {
    slug: 'count-the-shelves',
    title: 'Counting stock',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'A cycle count is the floor checking the system rather than the other way round. Somebody walks the shelves with a list, and what they find is recorded against what we believe.',
      },
      {
        id: 'tiles',
        say: 'What is open, and how much disagreed. A count that finds nothing is still worth running — it is the only evidence you have that the numbers mean anything.',
      },
      {
        id: 'schedule',
        say: 'Scheduling one changes nothing at all. Read that line: it is created and it waits, because the count is a job somebody has to go and do before it can say anything.',
      },
      {
        id: 'scope',
        say: 'The scope is what the counters are being asked to walk — a whole building, one zone, a sample, a handful of products. Choose what the people have time for, not what you would like to know.',
      },
      {
        id: 'open',
        say: 'There it is, scheduled and empty. Open it, and the only thing it offers is the one act that makes it real: somebody has gone to the shelves.',
      },
      {
        id: 'start',
        say: 'Now it will take lines, and the sentence above them is the one to remember. What the system believed is read when you record, not when the count was scheduled.',
      },
      {
        id: 'ids',
        say: 'A count is per shelf and per batch, so it wants both, and this is the awkward part — those identifiers are not printed on any screen here. They come off the sheet the floor is working from.',
      },
      {
        id: 'record',
        say: 'Then the only number that matters: what was actually on the shelf. Record it, and it lands as a line beside what we thought was there.',
      },
      {
        id: 'diff',
        say: 'And there is the disagreement, said in three columns rather than one. Nothing has changed yet — this is still just two people with different numbers.',
      },
      {
        id: 'button',
        say: 'Which the button counts for you before you press it. Not complete: complete, and raise this many corrections. A screen that makes you work out the consequence is a screen people press blind.',
      },
      {
        id: 'complete',
        say: 'Press it, and notice what it does NOT do. A cycle count never moves stock itself. Every difference becomes a correction, and a correction has to be agreed by somebody.',
      },
      {
        id: 'queue',
        say: 'Which is exactly where it has gone. Waiting, with the count it came from on it — and priced at nothing, because nobody ever recorded what this batch cost us.',
      },
      {
        id: 'outro',
        say: 'So: schedule it, walk it, record what is really there, and complete. The count is evidence. What it changes goes through the same pair of eyes everything else does.',
      },
    ],
  },
  {
    slug: 'accept-a-top-up',
    title: 'Accepting a top-up',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Top-ups. A seller telling us they have sent money — and until somebody here says otherwise, that is all a claim is. It has moved nothing.',
      },
      {
        id: 'stakes',
        say: 'Which makes this screen one of the sharpest in the console, because accepting IS the credit. There is no second step. The wallet moves as you press it, and the seller can draw against it from that moment.',
      },
      {
        id: 'row',
        say: 'So read the row before you touch anything. Who claimed it, which of our accounts they say they paid into, how much, and what evidence they gave for it.',
      },
      {
        id: 'account',
        say: 'The account matters as much as the figure. The label is our own filing name; the number underneath is what will appear on the statement you are about to check this against.',
      },
      {
        id: 'evidence',
        say: 'Evidence is a bank reference, an uploaded receipt, or both — and one of the two is required when the claim is made. Without something to match on, there is nothing to check.',
      },
      {
        id: 'statement',
        say: 'And that is the job. Go to the bank, find that reference, confirm the amount and the date. The claim is a sentence somebody typed; the statement is the only fact in this process.',
      },
      {
        id: 'accept',
        say: 'Once you have seen it, accept. The dialog names the amount and the account it was claimed against, so a mis-click on the wrong row has one more chance to be caught.',
      },
      {
        id: 'warning',
        say: 'And it says the rest plainly: this adds the money immediately, and it is not reversible without an adjusting entry. There is no undo on this screen, only a correction on another one.',
      },
      {
        id: 'note',
        say: 'The note is optional and worth writing anyway. It is what you will be reading in three months when somebody asks why this particular transfer was credited.',
      },
      {
        id: 'credit',
        say: 'Then credit it.',
      },
      {
        id: 'credited',
        say: 'The claim moves to Credited, and it carries your note, the time and your name — because a decision about somebody else’s money with nobody against it is one nobody can be asked about later.',
      },
      {
        id: 'reject',
        say: 'The other way out needs a reason, and the reason is mandatory for a plain cause: the seller reads it. Write what did not match, or what you need from them.',
      },
      {
        id: 'outro',
        say: 'So: match it first, accept second, and remember that nothing about this is reversible from here. A claim you are unsure about is a claim you reject with a reason and ask again.',
      },
    ],
  },
  {
    slug: 'pay-a-seller-out',
    title: 'Paying a seller out',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Withdrawals. A seller asking for their money back, and the one sentence to keep in mind is at the top: nothing on this page moves any.',
      },
      {
        id: 'request',
        say: 'The row says who asked, how much, what they will actually receive in their own currency at the rate when they asked for it, and how long they have been waiting against what we promised.',
      },
      {
        id: 'rule',
        say: 'What they may ask for is the balance, less the floor we hold back, less anything already requested. And a request the balance can no longer cover is rejected for them automatically, rather than sitting here unpayable.',
      },
      {
        id: 'approve',
        say: 'Approving is the first of two steps and it is deliberately not the payment. Pressing it here re-checks the wallet against this exact amount.',
      },
      {
        id: 'confirm',
        say: 'The dialog says so: nothing is paid yet. Pay the account on the seller’s profile, record the remittance, and that is what closes this request.',
      },
      {
        id: 'approved',
        say: 'So the row is approved and still owes them every rupee. An approved request can still be rejected, because a bank transfer that bounces is a real thing and the money has not left.',
      },
      {
        id: 'remittances',
        say: 'The payment is recorded on Remittances, and this is where the money actually moves — each entry debits the seller’s wallet. The approved request is waiting at the top with a button to pay it.',
      },
      {
        id: 'destination',
        say: 'Which opens with the destination beside it: the seller’s own bank, masked, with the full number behind a deliberate reveal — reading it is an act at the moment of typing a transfer, not a side effect of opening a form.',
      },
      {
        id: 'cover',
        say: 'And underneath, whether we can actually send it. Every account in that currency with what it holds, so an account that cannot cover the payout is something you find out here rather than halfway through a bank transfer.',
      },
      {
        id: 'currencies',
        say: 'Two currencies, one payment. The wallet is debited in rupees — and that figure comes straight off the request, already filled in — while the bank sends taka. So the only thing to choose here is the currency the money really left in.',
      },
      {
        id: 'rate',
        say: 'The taka figure is not typed. It is the rupees multiplied by the rate we quoted the seller — and whatever we actually achieved on the day is a different number. That gap is ours either way, recorded as a spread rather than taken off their balance.',
      },
      {
        id: 'fee',
        say: 'A bank fee goes in its own field, because it is our cost and not theirs. Netting it into the payout would charge the seller for our bank.',
      },
      {
        id: 'reference',
        say: 'Then the bank’s own reference, which is the only thing that ties this entry to a line on a statement somebody will reconcile later.',
      },
      {
        id: 'record',
        say: 'And recording it is the debit. The wallet moves, our account moves, and the request closes — one transaction, so a payment without its cause cannot exist.',
      },
      {
        id: 'outro',
        say: 'Approve, pay the bank, record it, and the request closes itself. Only the last of those four moves money, and it is the only one that cannot be undone from this screen.',
      },
    ],
  },
  {
    slug: 'approve-a-bank-change',
    title: 'Approving a change of bank account',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Bank detail changes. The shortest screen in this console and the one with the highest stakes on it, because what it decides is where a seller’s money goes.',
      },
      {
        id: 'until',
        say: 'Nothing has changed yet. Their withdrawals keep going to the account already on file until somebody here approves this — which is the whole reason the request exists rather than the edit simply saving.',
      },
      {
        id: 'first',
        say: 'And only a CHANGE needs approving. A seller adding bank details for the first time writes straight through, because there is no account to divert money away from.',
      },
      {
        id: 'diff',
        say: 'So the card is a diff. What is on file, what they are asking for, and a marker on every field that actually moved — read the marks rather than the rows.',
      },
      {
        id: 'number',
        say: 'The account number is the one that matters most, and here it has moved — the chip beside it says so. When it has not, the card says that too, because a request moving a branch name is a different kind of request from one moving the destination.',
      },
      {
        id: 'attack',
        say: 'Which is the thing to hold on to here. Somebody who gets into a seller’s account cannot take their money out — they can only ask us to send it somewhere else. This screen is the step that stops them.',
      },
      {
        id: 'verify',
        say: 'So verify it outside the software. Ring the number you already had for them, on the contact you already had, and ask whether they made this request. Not the number on the request.',
      },
      {
        id: 'open',
        say: 'The dialog names the seller and the destination, and it is blunt about the consequence: from this moment every withdrawal goes to the account below, and the one they had stops receiving money.',
      },
      {
        id: 'undo',
        say: 'Undoing it takes another request and another approval. So approve it because you recognise the account, as it says — not because the form was filled in correctly.',
      },
      {
        id: 'approve',
        say: 'Then approve.',
      },
      {
        id: 'after',
        say: 'The queue empties, and the new account is now the one every payout is typed against. The next remittance anybody records for this seller goes there.',
      },
      {
        id: 'outro',
        say: 'Rejecting is the other way out, and it needs a reason the seller reads — so when you are not sure, that is the button. A payout delayed by a phone call costs nothing that a payout to the wrong account does. And this is where the decision shows up: the next withdrawal anybody pays for this seller is typed against the account you just let through.',
      },
    ],
  },
  {
    slug: 'record-a-courier-payout',
    title: 'Recording what the courier paid us',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Courier settlements. Every rupee the courier pays us, matched to the orders it covers — and whatever is not matched is money we are carrying on a seller’s behalf.',
      },
      {
        id: 'float',
        say: 'That is the figure at the top. Delivered COD that no payout covers yet: the customer paid, the courier is holding it, and we are the ones who owe the seller in the meantime.',
      },
      {
        id: 'window',
        say: 'Which is why there is a window rather than a deadline. The courier states five to ten days; this is set at the top of that, and anything past it is listed as overdue rather than merely waiting.',
      },
      {
        id: 'record',
        say: 'When the money lands in our account, record it. The amount, the date, and the courier’s own payout reference — and that reference is doing more work than it looks.',
      },
      {
        id: 'reference',
        say: 'It is unique per account, so recording the same bank credit twice is a refusal instead of a double count. Without it, a payout entered twice would make us believe the courier had paid us money they have not.',
      },
      {
        id: 'allocate',
        say: 'Then allocate it to the orders it covers. The payout is one bank credit; the orders are what it was actually for, and until those are named it is just a number.',
      },
      {
        id: 'expected',
        say: 'Each line snapshots what the order was worth when it was delivered, so what the courier settled can be compared against what they collected — permanently, on that line, not worked out again later.',
      },
      {
        id: 'short',
        say: 'And where they paid less, the difference is recorded and absorbed. The seller is credited what the ORDER was worth, not what the courier remitted — a short payment is our dispute with the courier, not a clawback from somebody who was paid in good faith.',
      },
      {
        id: 'credit',
        say: 'Which is what recording this does. In the same transaction it credits the seller, withholds the tax, and writes the bank entry for the cash — so a credit with no payment behind it cannot exist.',
      },
      {
        id: 'ledger',
        say: 'Here it is on the seller’s side: the COD credit, the tax taken out of it, and both naming the order the money came from.',
      },
      {
        id: 'reversal',
        say: 'The other direction is a reversal. A parcel the courier paid out on and then brought back — the customer never paid, so the credit is taken back, and the payout has to name the orders rather than just carry a total.',
      },
      {
        id: 'unexplained',
        say: 'And a payout whose parts do not add up to its whole is flagged rather than accepted. Money we cannot explain is the one thing a settlement ledger must not quietly swallow.',
      },
      {
        id: 'outro',
        say: 'So: record it against its own reference, allocate it to real orders, and let the shortfall sit visibly against our money. Correct a mistake with another payout — never by editing this one.',
      },
    ],
  },
  {
    slug: 'move-money-by-hand',
    title: 'Moving money by hand',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Wallet transfers. Taking money out of a seller’s wallet into our bank, or putting ours into theirs — by hand, when nothing in the ordinary flow has a way to do it.',
      },
      {
        id: 'notacorrection',
        say: 'The first thing the screen says is what it is not. This is not an adjustment. An adjustment corrects a figure and moves no cash; this moves the cash with it, which is why it is on a page of its own behind a permission of its own.',
      },
      {
        id: 'seller',
        say: 'So: find the seller. Everything after this is about one account, and the page shows you theirs before it shows you a form.',
      },
      {
        id: 'direction',
        say: 'Which way, and the two options are written as sentences rather than as words. Debit takes from their wallet into our bank; credit gives from our bank into theirs.',
      },
      {
        id: 'debit',
        say: 'A debit takes their money where it already sits with us — rupees first, then any other currency at the rate it was credited at. Anything beyond what they actually hold is in no bank at all: their wallet goes negative and they owe it to us.',
      },
      {
        id: 'reason',
        say: 'Then the reason, and this is the field that matters. The seller reads it on their own wallet history, word for word, so write the thing they will need rather than the thing you would file.',
      },
      {
        id: 'internal',
        say: 'The internal note is the other half. Only staff see it, it is kept with the audit record, and it is where the ticket number and the half of the story the seller does not need goes.',
      },
      {
        id: 'preview',
        say: 'Preview before posting. Nothing has moved yet, and what comes back is a sentence rather than a form — what this does, said in words you can check against what you meant.',
      },
      {
        id: 'numbers',
        say: 'Underneath it, the two figures that are not the same thing: their wallet before and after, and the cash we actually hold for them before and after. On a seller already in debt the second one does not move at all.',
      },
      {
        id: 'confirm',
        say: 'And the confirm says the rest: it moves real money and cannot be undone. A mistake here is put right with a transfer the other way, which is a second entry on the seller’s history and not an erasure of the first.',
      },
      {
        id: 'post',
        say: 'Post it.',
      },
      {
        id: 'history',
        say: 'Every staff transfer is listed, with its reason, its internal note and who posted it — because this is the one money path with no document behind it, and the name is the whole record.',
      },
      {
        id: 'outro',
        say: 'So use it when the ordinary flow has no answer, write the reason for the seller rather than for the file, and remember it is the one screen here that can put a wallet into debt on purpose.',
      },
    ],
  },
  {
    slug: 'read-the-stock-ledger',
    title: 'Reading the stock ledger',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'The stock ledger. Every change to a quantity we have ever made, and what caused it \u2014 which makes it the last page of almost every argument about inventory.',
      },
      {
        id: 'appendonly',
        say: 'Read the line under the title, because it is a promise about this screen. Append only. Nothing here was ever edited, nothing was ever deleted, and there is no endpoint that could do either.',
      },
      {
        id: 'row',
        say: 'A row is one movement. When it happened, what kind, which product, which shelf \u2014 and then the two numbers that make it evidence rather than a note.',
      },
      {
        id: 'change',
        say: 'What it changed, and what the shelf held afterwards. The second one is the part people forget to ask for: without it you can see every step and still not know whether they add up.',
      },
      {
        id: 'cause',
        say: 'And what caused it. An order, a parcel, or a correction somebody raised \u2014 said in a word, because the identifier beside it would be the same shape whichever of the three it was.',
      },
      {
        id: 'types',
        say: 'The kinds are a vocabulary worth knowing, because each one means a different thing happened in the building. Receiving is goods arriving. Pack confirm is goods leaving.',
      },
      {
        id: 'pack',
        say: 'That one surprises people. Stock comes off the shelf when the box is sealed, not when the van takes it \u2014 so a parcel that is packed and still here has already been taken out of what we can sell.',
      },
      {
        id: 'transfer',
        say: 'And a move between shelves is always two rows, never one. Out of somewhere and into somewhere else, at the same moment, with the same cause. Stock is never created here and never destroyed.',
      },
      {
        id: 'variant',
        say: 'Then the filters, which are the two questions people actually arrive with. Paste a product and you get its whole history \u2014 what happened to this SKU.',
      },
      {
        id: 'trace',
        say: 'Read it downwards and the story is there: what came in, what went out, and where the number you are arguing about came from.',
      },
      {
        id: 'bin',
        say: 'The other question is about a place rather than a product. Pick the warehouse first \u2014 a shelf belongs to one building \u2014 and then the shelf, and you get everything that has happened on it.',
      },
      {
        id: 'reason',
        say: 'Corrections carry a reason, and this is where it earns its keep. Lost, returned to the seller, a counting error, something that never finished its journey \u2014 months later that word is the whole of what anybody remembers.',
      },
      {
        id: 'outro',
        say: 'So come here when a number does not add up, filter by the product or the shelf, and read until the rows stop agreeing with you. Nothing on this page can be changed, which is exactly why it settles it.',
      },
    ],
  },
  {
    slug: 'courier-accounts-and-credentials',
    title: 'Courier accounts and credentials',
    subtitle: 'Skydrop for ops',
    steps: [
      {
        id: 'intro',
        say: 'Courier accounts. One courier can have more than one, and the difference between them is whose money and whose contract a parcel goes out on.',
      },
      {
        id: 'several',
        say: 'Which account carried a parcel is recorded on the parcel. That is the whole reason this list exists rather than one set of credentials in a settings file \u2014 months later, somebody asks which account a charge came from, and the answer has to be on the shipment.',
      },
      {
        id: 'credentials',
        say: 'Now the sentence that governs everything else here. The credentials are encrypted, the key that opens them is in the environment and never in the database, and no endpoint anywhere will give one back to you.',
      },
      {
        id: 'rotate',
        say: 'So read what it tells you to do instead. To change a token, you add a new account and deactivate the old one \u2014 which sounds like extra work and is actually the only way the question stays answerable.',
      },
      {
        id: 'switches',
        say: 'Above the accounts, the switch that decides whether any of them are used at all. One per courier, and it governs new parcels only.',
      },
      {
        id: 'notakill',
        say: 'Read that carefully, because it is not a kill switch. A courier you switch off is still holding real parcels moving towards real customers \u2014 so they keep being tracked, and they can still be cancelled or re-attempted. All it stops is new ones.',
      },
      {
        id: 'table',
        say: 'Then the accounts themselves. What each one is called, whose it is, whether it points at the real courier or a sandbox, and which pickup registration it ships from.',
      },
      {
        id: 'default',
        say: 'And the default is marked. It is one per courier AND per environment, which is why both of these carry it \u2014 a seller nobody has routed anywhere ships on whichever is in force. So making something default is a decision about every seller at once, not about one account.',
      },
      {
        id: 'add',
        say: 'Adding one. The courier, whether it is production or sandbox, and a label \u2014 which is what everybody will read this account by, so name it for the thing it actually is.',
      },
      {
        id: 'shape',
        say: 'The credential fields come with their names already filled in, and that matters more than it looks. Each courier reads its own: a token for one, an email and a password for another. A name typed wrong does not fail here \u2014 it fails at the first booking.',
      },
      {
        id: 'secret',
        say: 'The value is a password box, and it is the only time it will ever be legible. Typed once, sent once, encrypted. Nothing reads it back \u2014 not this form, not any screen, not any endpoint.',
      },
      {
        id: 'save',
        say: 'Saved. It is not the default, so nothing routes to it yet \u2014 which is the right order: an account exists first, and you decide what uses it afterwards.',
      },
      {
        id: 'retire',
        say: 'And retiring one is the other half of rotation. Deactivate, and no new parcel is booked on it \u2014 while every parcel it already carried keeps its record of it, which is the whole point.',
      },
      {
        id: 'outro',
        say: 'So: one account per contract, named for what it is, credentials written once and never read. Change one by adding and retiring, never by editing \u2014 and the parcel will always be able to tell you which was in force.',
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
