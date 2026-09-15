import { OrderStatus, ResellerCreditStatus } from '@skydrop/db';
import { OrderStateMachineService } from '../../src/modules/order/services/order-state-machine.service';
import {
  CREDIT_STILL_TO_RUN,
  FINISHED_FOR_STORE_CLOSE,
  orderBlocksStoreClose,
} from '../../src/modules/order/services/store-close-rule';

/**
 * RS-1, amended 2026-09-15 (owner): a store closes when its business is
 * DONE, which is not the same as every order being terminal. The old rule
 * read terminality, DELIVERED has outgoing edges (a customer return), and so
 * a store that had ever delivered a parcel could never close. Pinned against
 * the REAL state machine, so a future edge out of a status cannot quietly
 * change the answer.
 */
describe('store close rule (RS-1, amended)', () => {
  const machine = new OrderStateMachineService();
  const isTerminal = (s: OrderStatus): boolean => machine.isTerminal(s);

  it('the case that stuck a real store: DELIVERED is not terminal, and still does not block', () => {
    expect(machine.isTerminal(OrderStatus.DELIVERED)).toBe(false);
    expect(orderBlocksStoreClose(OrderStatus.DELIVERED, isTerminal)).toBe(false);
  });

  it('a return received at our warehouse does not block', () => {
    expect(orderBlocksStoreClose(OrderStatus.RTO_RECEIVED, isTerminal)).toBe(false);
  });

  it('every terminal status is finished', () => {
    for (const s of Object.values(OrderStatus).filter(isTerminal)) {
      expect(orderBlocksStoreClose(s, isTerminal)).toBe(false);
    }
  });

  it('a parcel still moving blocks — out for delivery, coming back, in the warehouse, awaiting a call', () => {
    for (const s of [
      OrderStatus.PENDING_CONFIRMATION,
      OrderStatus.CONFIRMED,
      OrderStatus.PICKED,
      OrderStatus.PACKED,
      OrderStatus.DISPATCHED,
      OrderStatus.IN_TRANSIT,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERY_FAILED,
      OrderStatus.RTO_INITIATED,
      OrderStatus.RTO_IN_TRANSIT,
    ]) {
      expect(orderBlocksStoreClose(s, isTerminal)).toBe(true);
    }
  });

  it('exactly the non-terminal statuses other than the two finished ones block', () => {
    const blocking = Object.values(OrderStatus).filter((s) => orderBlocksStoreClose(s, isTerminal));
    const expected = Object.values(OrderStatus).filter(
      (s) => !isTerminal(s) && !FINISHED_FOR_STORE_CLOSE.has(s),
    );
    expect(blocking.sort()).toEqual(expected.sort());
    expect(blocking).not.toContain(OrderStatus.DELIVERED);
  });

  it('a credit waiting or due is still to run; credited, reversed and skipped are final', () => {
    expect([...CREDIT_STILL_TO_RUN].sort()).toEqual(
      [ResellerCreditStatus.WAITING, ResellerCreditStatus.DUE].sort(),
    );
    for (const s of [
      ResellerCreditStatus.CREDITED,
      ResellerCreditStatus.REVERSED,
      ResellerCreditStatus.SKIPPED,
    ]) {
      expect(CREDIT_STILL_TO_RUN).not.toContain(s);
    }
  });
});
