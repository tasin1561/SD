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
];

/** Look one up by slug — the scripts take a slug on the command line. */
export function videoBySlug(slug) {
  const video = VIDEOS.find((v) => v.slug === slug);
  if (video === undefined) {
    throw new Error(`Unknown video "${slug}". Known: ${VIDEOS.map((v) => v.slug).join(', ')}`);
  }
  return video;
}
