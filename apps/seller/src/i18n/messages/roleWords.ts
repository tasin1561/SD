import { defineMessages } from '../define';

/** Copy owned by the "roleWords" feature. */
export const roleWords = defineMessages({
  'roleWords.noRole': ['No role', 'কোনো ভূমিকা নেই'],
  'roleWords.noRolesSelected': [
    'No roles are selected. {fullName} must hold at least one — somebody with none cannot sign in at all.',
    'কোনো ভূমিকা বেছে নেওয়া হয়নি। {fullName}-এর কমপক্ষে একটি ভূমিকা থাকতে হবে — কোনোটিই না থাকলে সাইন ইন করাই যায় না।',
  ],
  'roleWords.changeBoth': [
    '{fullName} gains {added} and loses {removed}. They end up holding {after}, and what they can see and change is everything those roles cover between them.',
    '{fullName} {added} পাবেন এবং {removed} হারাবেন। শেষে তাঁর কাছে থাকবে {after}, এবং তিনি যা দেখতে ও বদলাতে পারবেন তা এই ভূমিকাগুলো মিলিয়ে যা কিছু কভার করে সেটাই।',
  ],
  'roleWords.changeGains': [
    '{fullName} gains {added}. They end up holding {after}, and what they can see and change is everything those roles cover between them.',
    '{fullName} {added} পাবেন। শেষে তাঁর কাছে থাকবে {after}, এবং তিনি যা দেখতে ও বদলাতে পারবেন তা এই ভূমিকাগুলো মিলিয়ে যা কিছু কভার করে সেটাই।',
  ],
  'roleWords.changeLoses': [
    '{fullName} loses {removed}. They end up holding {after}, and what they can see and change is everything those roles cover between them.',
    '{fullName} {removed} হারাবেন। শেষে তাঁর কাছে থাকবে {after}, এবং তিনি যা দেখতে ও বদলাতে পারবেন তা এই ভূমিকাগুলো মিলিয়ে যা কিছু কভার করে সেটাই।',
  ],
  'roleWords.changeSame': [
    '{fullName} keeps the same roles. They end up holding {after}, and what they can see and change is everything those roles cover between them.',
    '{fullName}-এর ভূমিকা একই থাকছে। শেষে তাঁর কাছে থাকবে {after}, এবং তিনি যা দেখতে ও বদলাতে পারবেন তা এই ভূমিকাগুলো মিলিয়ে যা কিছু কভার করে সেটাই।',
  ],
});
