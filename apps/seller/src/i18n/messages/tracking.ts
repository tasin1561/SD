import { defineMessages } from '../define';

/** Copy owned by the "tracking" feature. */
export const tracking = defineMessages({
  'tracking.noScansYet': ['No scans yet', 'এখনো কোনো স্ক্যান নেই'],
  'tracking.theCourierHasThe': [
    'The courier has the parcel but has not reported on it — the first scan usually appears within a day of pickup.',
    'কুরিয়ারের কাছে পার্সেল আছে কিন্তু এখনো কিছু জানায়নি — পিকআপের এক দিনের মধ্যে সাধারণত প্রথম স্ক্যান দেখা যায়।',
  ],
  'tracking.enteredByOurTeam': ['· entered by our team', '· আমাদের টিম এন্ট্রি করেছে'],
  'tracking.attempt': ['Attempt {attemptNumber} — {outcome}', 'চেষ্টা {attemptNumber} — {outcome}'],
  'tracking.nextAttempt': [
    'Next attempt {nextAttemptScheduledAt}',
    'পরবর্তী চেষ্টা {nextAttemptScheduledAt}',
  ],
  'tracking.parcelHistory': ['Parcel history', 'পার্সেলের ইতিহাস'],
  'tracking.clientConsole': ['Client console', 'ক্লায়েন্ট কনসোল'],
  'tracking.selling': ['Selling', 'বিক্রি'],
  'tracking.tracking': ['Tracking', 'ট্র্যাকিং'],
  'tracking.whereYourParcelsAre': [
    'Where your parcels are, and why any of them have not arrived.',
    'আপনার পার্সেলগুলো কোথায় আছে, আর কোনোটি কেন পৌঁছায়নি।',
  ],
  'tracking.failedDelivery': ['{failed} failed delivery', '{failed}টি ডেলিভারি ব্যর্থ'],
  'tracking.comingBack': ['{comingBack} coming back', '{comingBack}টি ফিরে আসছে'],
  'tracking.onTheMove': ['On the move', 'চলমান'],
  'tracking.inTransitOrOut': [
    'In transit or out for delivery, of the parcels shown.',
    'দেখানো পার্সেলগুলোর মধ্যে পথে বা ডেলিভারির জন্য বেরিয়েছে এমন।',
  ],
  'tracking.deliveryFailed': ['Delivery failed', 'ডেলিভারি ব্যর্থ'],
  'tracking.theCourierTriedAnd': [
    'The courier tried and could not hand it over.',
    'কুরিয়ার চেষ্টা করেছে কিন্তু হস্তান্তর করতে পারেনি।',
  ],
  'tracking.nothingShownHasFailed': [
    'Nothing shown has failed a delivery.',
    'দেখানো কোনোটির ডেলিভারি ব্যর্থ হয়নি।',
  ],
  'tracking.comingBack2': ['Coming back', 'ফিরে আসছে'],
  'tracking.onTheirWayTo': [
    'On their way to our warehouse. You pay the leg home.',
    'আমাদের ওয়্যারহাউসের পথে আছে। ফেরার পথের খরচ আপনার।',
  ],
  'tracking.nothingShownIsReturning': ['Nothing shown is returning.', 'দেখানো কোনোটিই ফিরছে না।'],
  'tracking.parcelRegister': ['Parcel register', 'পার্সেল রেজিস্টার'],
  'tracking.searchParcels': ['Search parcels', 'পার্সেল খুঁজুন'],
  'tracking.awbParcelNumberOr': [
    'AWB, parcel number or recipient…',
    'AWB, পার্সেল নম্বর বা প্রাপক…',
  ],
  'tracking.searchParcelsByWaybill': [
    'Search parcels by waybill, number or recipient',
    'ওয়েবিল, নম্বর বা প্রাপক দিয়ে পার্সেল খুঁজুন',
  ],
  'tracking.filterParcelsByStatus': [
    'Filter parcels by status',
    'স্ট্যাটাস অনুযায়ী পার্সেল ফিল্টার',
  ],
  'tracking.loadingParcels': ['Loading parcels…', 'পার্সেল লোড হচ্ছে…'],
  'tracking.failedToLoad': ['Failed to load.', 'লোড করা যায়নি।'],
  'tracking.parcels': ['Parcels', 'পার্সেল'],
  'tracking.parcel': ['Parcel', 'পার্সেল'],
  'tracking.goingTo': ['Going to', 'গন্তব্য'],
  'tracking.status': ['Status', 'স্ট্যাটাস'],
  'tracking.lastUpdate': ['Last update', 'সর্বশেষ আপডেট'],
  'tracking.history': ['History', 'ইতিহাস'],
  'tracking.nothingOnItsWay': [
    'Nothing on its way yet. A parcel appears here once it has been handed to the courier.',
    'এখনো কিছু পথে নেই। কুরিয়ারের হাতে দেওয়া হলে পার্সেল এখানে দেখা যাবে।',
  ],
  'tracking.noParcelMatchesThat': [
    'No parcel matches that. Try another filter, or clear the search.',
    'এর সাথে কোনো পার্সেল মেলেনি। অন্য ফিল্টার দিন, অথবা খোঁজা মুছে ফেলুন।',
  ],
  'tracking.failedAttempt': [
    '{failedAttempts} failed attempt{plural}',
    '{failedAttempts}টি ব্যর্থ চেষ্টা',
  ],
  'tracking.hide': ['Hide', 'লুকান'],
  'tracking.loadingTheParcelHistory': [
    'Loading the parcel history…',
    'পার্সেলের ইতিহাস লোড হচ্ছে…',
  ],
  'tracking.showEarlierScans': ['Show {n} earlier scans', 'আগের {n}টি স্ক্যান দেখান'],
  'tracking.hideEarlierScans': ['Hide earlier scans', 'আগের স্ক্যান লুকান'],
  'tracking.allParcels': ['All parcels', 'সব পার্সেল'],
  'tracking.inTransit': ['In transit', 'পথে আছে'],
  'tracking.outForDelivery': ['Out for delivery', 'ডেলিভারির জন্য বেরিয়েছে'],
  'tracking.delivered': ['Delivered', 'ডেলিভারি হয়েছে'],
});
