import { defineMessages } from '../define';

/** Copy owned by the "settingsStock" feature. */
export const settingsStock = defineMessages({
  'settingsStock.defaultThresholdClearedSkus': [
    'Default threshold cleared — SKUs without their own will not alert.',
    'Default threshold cleared — SKUs without their own will not alert.',
  ],
  'settingsStock.defaultLowStockThreshold': [
    'Default low-stock threshold saved.',
    'Default low-stock threshold saved.',
  ],
  'settingsStock.lowStockAlerts': ['Low-stock alerts', 'Low-stock alerts'],
  'settingsStock.offNothingAlertsBy': [
    'Off — nothing alerts by default',
    'Off — nothing alerts by default',
  ],
  'settingsStock.warningBelowUnits': [
    'Warning below {defaultLowStockThreshold} units',
    'Warning below {defaultLowStockThreshold} units',
  ],
  'settingsStock.couldNotLoadYour': [
    'Could not load your alert settings.',
    'Could not load your alert settings.',
  ],
  'settingsStock.defaultThreshold': ['Default threshold', 'Default threshold'],
  'settingsStock.emptyNoSkuAlerts': [
    'Empty — no SKU alerts unless it carries its own threshold.',
    'Empty — no SKU alerts unless it carries its own threshold.',
  ],
  'settingsStock.unitsWholeNumber0': [
    'Units. Whole number, 0–{maxThreshold}.',
    'Units. Whole number, 0–{maxThreshold}.',
  ],
  'settingsStock.off': ['Off', 'Off'],
  'settingsStock.save': ['Save', 'Save'],
  'settingsStock.saving': ['Saving…', 'Saving…'],
  'settingsStock.saved': ['Saved', 'Saved'],
  'settingsStock.cancel': ['Cancel', 'Cancel'],
  'settingsStock.aSkuWithIts': [
    'A SKU with its own threshold ignores this one — set that on the variant page. Leaving this empty turns alerts off for everything else; zero still alerts, but only once the SKU is completely out.',
    'A SKU with its own threshold ignores this one — set that on the variant page. Leaving this empty turns alerts off for everything else; zero still alerts, but only once the SKU is completely out.',
  ],
  'settingsStock.clientConsole': ['Client console', 'Client console'],
  'settingsStock.account': ['Account', 'Account'],
  'settingsStock.settings': ['Settings', 'Settings'],
  'settingsStock.stockAlerts': ['Stock alerts', 'Stock alerts'],
  'settingsStock.whenWeWarnYou': [
    'When we warn you that a SKU is running out. A SKU with its own threshold ignores this one.',
    'When we warn you that a SKU is running out. A SKU with its own threshold ignores this one.',
  ],
  'settingsStock.enterAWholeNumber': [
    'Enter a whole number between 0 and {maxThreshold}, or leave empty to turn alerts off.',
    'Enter a whole number between 0 and {maxThreshold}, or leave empty to turn alerts off.',
  ],
  'settingsStock.notSaved': ['Not saved', 'Not saved'],
});
