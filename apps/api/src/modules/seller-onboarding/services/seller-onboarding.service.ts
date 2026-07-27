import { Injectable } from '@nestjs/common';
import {
  NotificationRecipientType,
  OnboardingStepActor,
  Prisma,
  SellerOnboardingStep,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { EmailQueue } from '../../email/queue/email.queue';

export const REQUIRED_STEPS: ReadonlyArray<SellerOnboardingStep> = [
  SellerOnboardingStep.REGISTRATION_COMPLETED,
  SellerOnboardingStep.EMAIL_VERIFIED,
  SellerOnboardingStep.COMPANY_INFO_FILLED,
  SellerOnboardingStep.BD_ORIGIN_ADDRESS_ADDED,
];

export const OPTIONAL_STEPS: ReadonlyArray<SellerOnboardingStep> = [
  SellerOnboardingStep.IN_RETURN_ADDRESS_ADDED,
  SellerOnboardingStep.BD_OFFICE_ADDRESS_ADDED,
  SellerOnboardingStep.BANK_DETAILS_ADDED,
  SellerOnboardingStep.NOTIFICATION_PREFS_REVIEWED,
];

const ALL_STEPS: ReadonlyArray<SellerOnboardingStep> = [...REQUIRED_STEPS, ...OPTIONAL_STEPS];

const ONBOARDING_COMPLETE_TEMPLATE = 'seller.onboarding_complete.email';

export interface OnboardingStepView {
  stepCode: SellerOnboardingStep;
  isRequired: boolean;
  completedAt: Date | null;
  completedBy: OnboardingStepActor | null;
  metadata: Prisma.JsonValue | null;
}

export interface OnboardingProgressView {
  isComplete: boolean;
  missingRequired: SellerOnboardingStep[];
  steps: OnboardingStepView[];
}

type TxOrClient = Prisma.TransactionClient | PrismaService['client'];

@Injectable()
export class SellerOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly email: EmailQueue,
  ) {}

  /**
   * Inserts all 8 step rows for a newly registered seller.
   *
   * REGISTRATION_COMPLETED and COMPANY_INFO_FILLED are marked complete=now
   * immediately — registration captures both. The remaining 6 rows have
   * null completedAt and will be marked by their respective flows
   * (email verification, address creation, bank details, etc.).
   *
   * MUST be called inside the registration transaction so a registration
   * rollback doesn't leave orphan onboarding rows.
   */
  async initializeProgress(sellerId: string, tx: Prisma.TransactionClient): Promise<void> {
    const now = new Date();
    const data: Prisma.SellerOnboardingProgressCreateManyInput[] = ALL_STEPS.map((stepCode) => {
      const isRequired = REQUIRED_STEPS.includes(stepCode);
      const completedNow =
        stepCode === SellerOnboardingStep.REGISTRATION_COMPLETED ||
        stepCode === SellerOnboardingStep.COMPANY_INFO_FILLED;
      return {
        sellerId,
        stepCode,
        isRequired,
        completedAt: completedNow ? now : null,
        completedBy: completedNow ? OnboardingStepActor.SYSTEM : null,
      };
    });
    await tx.sellerOnboardingProgress.createMany({ data });
  }

  /**
   * Idempotent: marking an already-completed step is a no-op (the original
   * completedAt is preserved). Required so that re-creating a previously
   * deleted address doesn't reset the corresponding step's timestamp.
   *
   * On the transition that completes the LAST required step, enqueues the
   * onboarding-complete email — but only if no prior onboarding-complete
   * email is recorded in notification_logs for this seller. This makes the
   * email fire-once even across retries.
   *
   * Caller passes a tx when the step transition is part of a larger atomic
   * operation (address creation, email verification confirm). Standalone
   * calls (admin override) can pass undefined.
   */
  async markStepComplete(
    sellerId: string,
    stepCode: SellerOnboardingStep,
    completedBy: OnboardingStepActor,
    metadata?: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ): Promise<{ marked: boolean; onboardingCompleted: boolean }> {
    const client = tx ?? this.prisma.client;

    const existing = await client.sellerOnboardingProgress.findUnique({
      where: { sellerId_stepCode: { sellerId, stepCode } },
      select: { id: true, completedAt: true },
    });
    if (!existing) {
      // Defensive: row should exist (initializeProgress runs at registration).
      // If it doesn't, we don't try to backfill — the absence indicates a
      // bug upstream that the caller should surface.
      return { marked: false, onboardingCompleted: false };
    }
    if (existing.completedAt !== null) {
      return { marked: false, onboardingCompleted: false };
    }

    await client.sellerOnboardingProgress.update({
      where: { id: existing.id },
      data: {
        completedAt: new Date(),
        completedBy,
        metadata: metadata ?? Prisma.DbNull,
      },
    });

    // Only check completion if this step was a required one.
    if (!REQUIRED_STEPS.includes(stepCode)) {
      return { marked: true, onboardingCompleted: false };
    }

    const onboardingCompleted = await this.isOnboardingComplete(sellerId, client);
    if (!onboardingCompleted) {
      return { marked: true, onboardingCompleted: false };
    }

    await this.maybeEnqueueOnboardingCompleteEmail(sellerId, client);
    return { marked: true, onboardingCompleted: true };
  }

  async getProgress(sellerId: string): Promise<OnboardingProgressView> {
    const rows = await this.prisma.client.sellerOnboardingProgress.findMany({
      where: { sellerId },
      orderBy: { stepCode: 'asc' },
      select: {
        stepCode: true,
        isRequired: true,
        completedAt: true,
        completedBy: true,
        metadata: true,
      },
    });

    const missingRequired = rows
      .filter((r) => r.isRequired && r.completedAt === null)
      .map((r) => r.stepCode);

    return {
      isComplete: missingRequired.length === 0,
      missingRequired,
      steps: rows,
    };
  }

  async isOnboardingComplete(sellerId: string, tx?: TxOrClient): Promise<boolean> {
    const client = tx ?? this.prisma.client;
    const missing = await client.sellerOnboardingProgress.count({
      where: { sellerId, isRequired: true, completedAt: null },
    });
    return missing === 0;
  }

  async getMissingRequiredSteps(sellerId: string): Promise<SellerOnboardingStep[]> {
    const rows = await this.prisma.client.sellerOnboardingProgress.findMany({
      where: { sellerId, isRequired: true, completedAt: null },
      select: { stepCode: true },
    });
    return rows.map((r) => r.stepCode);
  }

  // ---------- internal ----------

  private async maybeEnqueueOnboardingCompleteEmail(
    sellerId: string,
    client: TxOrClient,
  ): Promise<void> {
    const prior = await client.notificationLog.findFirst({
      where: {
        templateCode: ONBOARDING_COMPLETE_TEMPLATE,
        recipientType: NotificationRecipientType.SELLER,
        recipientId: sellerId,
      },
      select: { id: true },
    });
    if (prior) return;

    const seller = await client.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, email: true, companyName: true },
    });
    if (!seller) return;

    await this.email.enqueue({
      templateCode: ONBOARDING_COMPLETE_TEMPLATE,
      recipient: {
        type: NotificationRecipientType.SELLER,
        id: seller.id,
        email: seller.email,
      },
      variables: {
        company_name: seller.companyName,
        support_email: this.env.supportEmail,
        app_url: this.env.sellerAppUrl,
      },
      triggerEvent: 'seller.onboarding.completed',
    });
  }
}
