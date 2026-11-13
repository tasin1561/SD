import { Injectable } from '@nestjs/common';
import type { CallerScope } from '../assistant.types';
import { AssistantBudgetService } from './assistant-budget.service';

/**
 * The permission keys the "what needs my attention" card gates its lines on.
 * Only these are ever handed to the browser (the console already knows its own
 * permissions; this just spares the widget a second source for them).
 */
export const GREETING_PERMISSIONS = [
  'orders.view',
  'wallet.view',
  'callcenter.queue.view',
  'courier.manual_placement',
  'tickets.view',
] as const;

export interface AssistantStatusView {
  /** The kill switch AND this console's switch, read now. */
  readonly enabled: boolean;
  readonly permissions: readonly string[];
}

@Injectable()
export class AssistantStatusService {
  constructor(private readonly budget: AssistantBudgetService) {}

  async status(scope: CallerScope): Promise<AssistantStatusView> {
    const enabled =
      (await this.budget.enabled()) && (await this.budget.portalEnabled(scope.audience));
    return {
      enabled,
      permissions: GREETING_PERMISSIONS.filter((p) => scope.permissions.includes(p)),
    };
  }
}
