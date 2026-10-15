# Translating the narration into Bangla and Hindi

The videos are narrated in three languages over **one English screen
recording**. That single fact decides almost every rule below.

## The rule that matters most

**When the narration names something the viewer must click, say the
English label exactly as it appears on screen.**

The UI is English and is not being translated. A viewer hearing
"তালিকা থেকে পণ্য নির্বাচন করুন" while looking at a button that says
**Add product** has to translate back before they can act, and a beginner
cannot. So:

> ✅ "এখন **Add product** বোতামে ক্লিক করুন — এখান থেকেই নতুন পণ্য যোগ হয়।"
> ❌ "এখন পণ্য-যোগ বোতামে ক্লিক করুন।"

Explain in Bangla or Hindi; **name in English**. The explanation is what
the language is for; the label is what the eye is looking for.

## Terms kept in English, always

These are the words the trade already uses in Dhaka and in India, and a
translated version would be less clear, not more:

`COD` · `AWB` / waybill · `RTO` · `PIN code` · `SKU` · `CSV` ·
`PDF` · every screen name (`Dashboard`, `Orders`, `Catalogue`,
`Inventory`, `Wallet`, `Consignments`, `Tickets`) · every button label ·
every status word shown on screen (`Delivered`, `Confirmed`,
`Pending pick`).

Write them in Latin script inside the sentence. Do not transliterate a
screen label into Bengali or Devanagari — the viewer is matching letters.

## Terms to translate, with the agreed wording

| English | Bangla | Hindi |
|---|---|---|
| warehouse | গুদাম | गोदाम |
| stock | স্টক | स्टॉक |
| parcel | পার্সেল | पार्सल |
| courier | কুরিয়ার | कूरियर |
| customer | ক্রেতা | ग्राहक |
| client | `client` † | `client` † |
| order | অর্ডার | ऑर्डर |
| price | দাম | कीमत |
| delivery fee | ডেলিভারি চার্জ | डिलीवरी शुल्क |
| return | ফেরত | वापसी |
| wallet balance | ওয়ালেট ব্যালেন্স | वॉलेट बैलेंस |
| landmark | ল্যান্ডমার্ক | लैंडमार्क |

Fixed on first use so three videos in two languages cannot drift.

† **Said in English, in Latin script — and that is a DECISION, open to
being overruled by somebody who speaks the language.**

CON-2 renamed the English words: the business shipping the stock is a
**client** rather than a seller, and a business reselling that stock under
its own name is a **member store** rather than a reseller store. বিক্রেতা
and विक्रेता both say *seller*, so both cells used to carry those words
with a note saying they were the old wording and must not be guessed at.

Twenty-three lines in each language then said *seller* while every screen
the viewer was looking at said **Client** — which is the exact defect
CON-2 existed to remove, in the flagship deliverable. Waiting on a word
was costing more than deciding, and there was a decision available that
invents nothing:

**use the English word.** It is what the table's own first rule says to
do with anything the viewer reads on screen, and the member-store portal
says *client* on screen 241 times. It is also already this file's
convention for the sibling word — `member store` is written in Latin
inside the very first Bangla scene, and `portal`, `Terms`, `Catalogue`,
`Wallet`, `Place order`, `ticket`, `transfer price`, `You pay`,
`Out for delivery` and `sign up` all are too. Bangla case endings attach
with a hyphen exactly as they already do on `portal-গুলোতে`:
`client-এর`, `client-কে`. Hindi needs nothing — its postpositions are
separate words already (`client का`, `client को`).

**What is still open, and what overruling it costs.** If a Bangla or
Hindi word is the better call, it is one substitution across
`reseller.mjs` and `seller.mjs` (46 lines) plus a re-voice: the clips are
cached on a hash of their text, so changing the words is all that is
needed and the audio rebuilds itself. What must NOT happen is a word
appearing in one video and not the others — that is what this table is
for. **member store** still has no row, and is still written in English
everywhere for the same reason as above.

## Tone

- **Bangla** addresses the client as **আপনি**. Plain spoken Bangla, not
  literary — these are instructions, not prose. Avoid Sanskritised
  vocabulary where an everyday word exists.
- **Hindi** addresses the viewer as **आप**. Everyday Hindustani; where a
  common Urdu-derived word is the one people actually say, use it rather
  than a formal Sanskrit equivalent.
- The **associate** videos pitch lower than the other two in every
  language — short sentences, no compound clauses.

## Length

Measured on this account: Bangla speaks at **~11 characters a second**,
Hindi **~16**, English **~20**. So a faithful translation RUNS LONGER
than the English take, and that is expected and handled — each scene is
held for its own clip. **Do not compress the meaning to match the English
runtime.** A rushed instruction is worse than a long one.

## What a translation must not do

- Do not add a sentence the English does not have. Every claim was
  checked against the system; a new one has not been.
- Do not drop a sentence because it feels redundant in the target
  language. If the English says it, something needed saying.
- Do not translate a number, a currency symbol or an SKU.
- `₹` stays `₹` and `৳` stays `৳`. The two are not interchangeable and
  the difference is the whole business.
