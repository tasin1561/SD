/**
 * Everything the simulator remembers, in memory.
 *
 * Deliberately not persisted. A simulator that survives a restart
 * accumulates state nobody reasoned about, and the first question when
 * something looks wrong becomes "is this left over from yesterday?".
 * Restarting is the reset.
 */

export type ScanStage =
  | 'MANIFESTED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'NDR'
  | 'RTO_INITIATED'
  | 'RTO_IN_TRANSIT'
  | 'RTO_DELIVERED'
  | 'LOST'
  | 'DAMAGED'
  | 'CANCELLED';

export interface SimScan {
  readonly stage: ScanStage;
  readonly at: string;
  readonly location: string;
  readonly note: string | null;
}

export interface SimParcel {
  readonly awb: string;
  readonly refnum: string;
  readonly orderRef: string;
  readonly destinationPin: string;
  readonly consigneeName: string;
  readonly codAmount: number;
  readonly weightGrams: number;
  stage: ScanStage;
  cancelled: boolean;
  readonly scans: SimScan[];
  readonly createdAt: string;
}

export interface SimPickup {
  readonly id: string;
  readonly location: string;
  readonly date: string;
  readonly createdAt: string;
}

/** Waybills the pool has handed out, so a create can be checked against them. */
const issuedWaybills = new Set<string>();
const parcels = new Map<string, SimParcel>();
const pickups: SimPickup[] = [];
const warehouses = new Set<string>();

/**
 * Pins the simulator refuses to deliver to.
 *
 * Chosen to mirror the in-process stub's conventions so a scenario
 * written against one behaves the same against the other:
 *   000000 — non-serviceable (permanent; supersedes the shipment)
 *   999999 — transient failure (the create call errors)
 * Anything else is serviceable.
 */
export const NON_SERVICEABLE_PIN = '000000';
export const TRANSIENT_FAIL_PIN = '999999';

/**
 * Where this process starts issuing waybills.
 *
 * Seeded from the clock, NOT from 1. The counter is in memory, so a
 * restart used to hand out `12345670000010` again — a number the API had
 * already persisted on an earlier shipment, permanently. `shipments.
 * awb_number` is UNIQUE (CUR-9: an AWB is generated exactly once and
 * never reassigned), so the second run died on a constraint violation
 * that looked like an application bug and was really the courier
 * reissuing a waybill, which the real one never does.
 *
 * Six digits of "seconds since an arbitrary epoch" wraps every ~11 days;
 * far longer than any dev database survives, and it keeps the AWB the
 * same shape and length as Delhivery's.
 */
let waybillSeq = Math.floor(Date.now() / 1000) % 900_000;

/** A waybill that looks like Delhivery's: numeric, 14 digits. */
export function issueWaybill(): string {
  const n = String(waybillSeq++).padStart(6, '0');
  const awb = `1234567${n}0`;
  issuedWaybills.add(awb);
  return awb;
}

export function waybillWasIssued(awb: string): boolean {
  return issuedWaybills.has(awb);
}

export function putParcel(p: SimParcel): void {
  parcels.set(p.awb, p);
}

export function getParcel(awb: string): SimParcel | undefined {
  return parcels.get(awb);
}

export function allParcels(): SimParcel[] {
  return [...parcels.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function addScan(awb: string, scan: SimScan): SimParcel | undefined {
  const p = parcels.get(awb);
  if (!p) return undefined;
  p.scans.push(scan);
  p.stage = scan.stage;
  return p;
}

export function addPickup(p: SimPickup): void {
  pickups.push(p);
}

export function allPickups(): SimPickup[] {
  return [...pickups];
}

export function registerWarehouse(name: string): void {
  warehouses.add(name);
}

export function warehouseRegistered(name: string): boolean {
  return warehouses.has(name);
}

export function reset(): void {
  parcels.clear();
  issuedWaybills.clear();
  pickups.length = 0;
  warehouses.clear();
  waybillSeq = 1;
}
