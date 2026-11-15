import { defineMessages } from '../define';

/**
 * "Cancel order" once the parcel is past the point the client can cancel it
 * themselves (2026-11-15): the button asks Skydrop by ticket instead.
 */
export const cancelRequest = defineMessages({
  'cancelRequest.title': [
    'Ask Skydrop to cancel {orderNumber}',
    '{orderNumber} বাতিল করতে Skydrop-কে বলুন',
  ],
  'cancelRequest.body': [
    'This parcel has already been packed, so it cannot be cancelled with one tap. We will open a ticket with Skydrop, and they will try to stop it with the courier.',
    'এই পার্সেল ইতিমধ্যে প্যাক হয়ে গেছে, তাই এক ট্যাপে বাতিল করা যায় না। আমরা Skydrop-এর কাছে একটি টিকিট খুলব, তারা কুরিয়ারের সাথে থামানোর চেষ্টা করবে।',
  ],
  'cancelRequest.noteLabel': [
    'Anything Skydrop should know? (optional)',
    'Skydrop-এর কিছু জানা দরকার? (ঐচ্ছিক)',
  ],
  'cancelRequest.send': ['Send request', 'অনুরোধ পাঠান'],
  'cancelRequest.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'cancelRequest.notNow': ['Not now', 'এখন না'],
  'cancelRequest.raised': [
    'Request sent — ticket {number}',
    'অনুরোধ পাঠানো হয়েছে — টিকিট {number}',
  ],
  'cancelRequest.alreadyOpen': [
    'A cancel request is already open — ticket {number}',
    'বাতিলের অনুরোধ আগেই খোলা আছে — টিকিট {number}',
  ],
  'cancelRequest.viewTicket': ['View ticket', 'টিকিট দেখুন'],
  'cancelRequest.done': ['Done', 'ঠিক আছে'],
  'cancelRequest.open': [
    'Cancel requested — ticket {number} is open',
    'বাতিলের অনুরোধ করা হয়েছে — টিকিট {number} খোলা আছে',
  ],
});
