import { defineMessages } from '../define';

/** Copy owned by the "inventoryUnits" feature. */
export const inventoryUnits = defineMessages({
  'inventoryUnits.inventory': ['Inventory', 'Inventory'],
  'inventoryUnits.clientConsole': ['Client console', 'Client console'],
  'inventoryUnits.stock': ['Stock', 'Stock'],
  'inventoryUnits.unitDiscrepancies': ['Unit discrepancies', 'Unit discrepancies'],
  'inventoryUnits.forSkusTrackedPer': [
    'For SKUs tracked per unit by serial. Where a scan is missing, a parcel is unaccounted for, or the serials disagree with the stock count.',
    'For SKUs tracked per unit by serial. Where a scan is missing, a parcel is unaccounted for, or the serials disagree with the stock count.',
  ],
  'inventoryUnits.everythingReconciles': ['Everything reconciles', 'Everything reconciles'],
  'inventoryUnits.toLookAt': ['{totalIssues} to look at', '{totalIssues} to look at'],
  'inventoryUnits.strictMode': ['Strict mode', 'Strict mode'],
  'inventoryUnits.aSkuOnStrict': [
    'A SKU on strict mode carries a serial on every physical unit, and the warehouse scans it at receiving, pick and pack. Only those SKUs appear on this page. We set it, not you.',
    'A SKU on strict mode carries a serial on every physical unit, and the warehouse scans it at receiving, pick and pack. Only those SKUs appear on this page. We set it, not you.',
  ],
  'inventoryUnits.strictModeSkusOnly': ['Strict-mode SKUs only', 'Strict-mode SKUs only'],
  'inventoryUnits.read': ['Read {generatedAt}', 'Read {generatedAt}'],
  'inventoryUnits.couldNotLoadThe': ['Could not load the report.', 'Could not load the report.'],
  'inventoryUnits.needsAttention': ['Needs attention', 'Needs attention'],
  'inventoryUnits.everythingReconciles2': ['Everything reconciles.', 'Everything reconciles.'],
  'inventoryUnits.stuckMidLifecycle': ['Stuck mid-lifecycle', 'Stuck mid-lifecycle'],
  'inventoryUnits.unresolvedDispatches': ['Unresolved dispatches', 'Unresolved dispatches'],
  'inventoryUnits.countMismatches': ['Count mismatches', 'Count mismatches'],
  'inventoryUnits.pickedOrPackedFor': [
    'Picked or packed for over {stuckSlaHours}h.',
    'Picked or packed for over {stuckSlaHours}h.',
  ],
  'inventoryUnits.outForOverDays': [
    'Out for over {dispatchedUnresolvedDays} days, never delivered or returned.',
    'Out for over {dispatchedUnresolvedDays} days, never delivered or returned.',
  ],
  'inventoryUnits.serialsDisagreeWithThe': [
    'Serials disagree with the stock figure.',
    'Serials disagree with the stock figure.',
  ],
  'inventoryUnits.usuallyASkippedScan': [
    'Usually a skipped scan on the floor rather than a lost item.',
    'Usually a skipped scan on the floor rather than a lost item.',
  ],
  'inventoryUnits.nothingStuck': ['Nothing stuck', 'Nothing stuck'],
  'inventoryUnits.eachOfTheseIs': [
    'Each of these is a parcel to chase with the courier.',
    'Each of these is a parcel to chase with the courier.',
  ],
  'inventoryUnits.nothingUnaccountedFor': ['Nothing unaccounted for', 'Nothing unaccounted for'],
  'inventoryUnits.reportedNeverAutoCorrected': [
    'Reported, never auto-corrected — that would erase the evidence.',
    'Reported, never auto-corrected — that would erase the evidence.',
  ],
  'inventoryUnits.serialsAndStockAgree': ['Serials and stock agree', 'Serials and stock agree'],
  'inventoryUnits.forEveryStrictMode': [
    'For every strict-mode SKU, the number of in-stock serials matches the recorded quantity on hand.',
    'For every strict-mode SKU, the number of in-stock serials matches the recorded quantity on hand.',
  ],
  'inventoryUnits.sku': ['SKU', 'SKU'],
  'inventoryUnits.warehouse': ['Warehouse', 'Warehouse'],
  'inventoryUnits.serialsInStock': ['Serials in stock', 'Serials in stock'],
  'inventoryUnits.recordedOnHand': ['Recorded on hand', 'Recorded on hand'],
  'inventoryUnits.difference': ['Difference', 'Difference'],
  'inventoryUnits.retiredUnits': ['Retired units', 'Retired units'],
  'inventoryUnits.keptVisibleSoA': [
    'Kept visible so a loss stays countable rather than just disappearing.',
    'Kept visible so a loss stays countable rather than just disappearing.',
  ],
  'inventoryUnits.noUnitsWrittenOff': [
    'No units written off or lost',
    'No units written off or lost',
  ],
  'inventoryUnits.serial': ['Serial', 'Serial'],
  'inventoryUnits.status': ['Status', 'Status'],
  'inventoryUnits.timeInStatus': ['Time in status', 'Time in status'],
  'inventoryUnits.lastScan': ['Last scan', 'Last scan'],
  'inventoryUnits.neverScanned': ['Never scanned', 'Never scanned'],
  'inventoryUnits.traceASerial': ['Trace a serial', 'Trace a serial'],
  'inventoryUnits.theNumberPrintedOn': [
    'The number printed on a single unit. Its whole history, in the order it happened.',
    'The number printed on a single unit. Its whole history, in the order it happened.',
  ],
  'inventoryUnits.scanOrType': ['Scan or type', 'Scan or type'],
  'inventoryUnits.trace': ['Trace', 'Trace'],
  'inventoryUnits.tracing': ['Tracing…', 'Tracing…'],
  'inventoryUnits.noUnitOfYours': [
    'No unit of yours carries that serial. Either the number belongs to something we never received, or this SKU is not tracked per unit.',
    'No unit of yours carries that serial. Either the number belongs to something we never received, or this SKU is not tracked per unit.',
  ],
  'inventoryUnits.historyOf': ['History of {serialBarcode}', 'History of {serialBarcode}'],
  'inventoryUnits.when': ['When', 'When'],
  'inventoryUnits.moved': ['Moved', 'Moved'],
  'inventoryUnits.step': ['Step', 'Step'],
  'inventoryUnits.note': ['Note', 'Note'],
  'inventoryUnits.skus': ['SKUs', 'SKUs'],
  'inventoryUnits.everySerializedUnitThat': [
    'Every serialized unit that started a pick has been scanned through to the next stage.',
    'Every serialized unit that started a pick has been scanned through to the next stage.',
  ],
  'inventoryUnits.everyDispatchedUnitHas': [
    'Every dispatched unit has either been delivered or come back.',
    'Every dispatched unit has either been delivered or come back.',
  ],
  'inventoryUnits.nothingHasBeenRetired': [
    'Nothing has been retired from the serial ledger.',
    'Nothing has been retired from the serial ledger.',
  ],
});
