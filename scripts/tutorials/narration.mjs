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
];

/** Look one up by slug — the scripts take a slug on the command line. */
export function videoBySlug(slug) {
  const video = VIDEOS.find((v) => v.slug === slug);
  if (video === undefined) {
    throw new Error(`Unknown video "${slug}". Known: ${VIDEOS.map((v) => v.slug).join(', ')}`);
  }
  return video;
}
