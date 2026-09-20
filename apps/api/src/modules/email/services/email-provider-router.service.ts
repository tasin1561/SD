import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationCategory } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { ResendService } from './resend.service';
import { SesService } from './ses.service';
import { ProviderPacer } from './provider-pacer';
import { applyMailRedirect } from '../mail-redirect';
import { failureKind, type EmailProvider, type SendEmailInput } from '../email-provider';
import type { SendEmailOutcome } from '../email-provider';

export interface EmailRouteResult {
  /** Whoever produced `outcome`. Goes to `notification_logs.provider`. */
  provider: string;
  outcome: SendEmailOutcome;
  /** Set when the first provider's failure was carried to the second. */
  failedOverFrom: string | null;
}

/**
 * THE ONE PLACE THAT DECIDES WHICH PROVIDER SENDS A MESSAGE.
 *
 * CUR-12 applied to email. `EmailDispatchService` has exactly one send
 * call and it is to this; no other code anywhere names a provider.
 *
 * ── THE ROUTING RULE, AND WHY IT IS THE CATEGORY THAT DECIDES ────────
 * CREDENTIAL always goes to Resend; everything else goes to SES.
 *
 * Credential mail — password reset, invitation, email verification — is
 * the one kind with NO fallback channel by construction (NOTIF-9: it is
 * EMAIL only, and immutably so, because a reset you can only read once
 * signed in is useless). Everything else has an in-app copy the person
 * can find. So the mail that cannot afford to be stuck behind anything
 * gets a pipe of its own.
 *
 * It also fits: credential mail runs at one or two a day across ~430
 * users, comfortably inside Resend's free 100/day, while the bulk —
 * order and shipment notifications — moves to SES where volume is
 * priced for it. And the arrangement means the SECOND path is exercised
 * every single day rather than sitting in reserve. A fallback that only
 * runs during an incident is a fallback nobody knows is broken.
 *
 * ── FAILOVER IS SYMMETRIC, AND CLASSIFIED BY THE ADAPTER ─────────────
 * Resend→SES and SES→Resend are the same code path (CUR-14). The saga
 * never names a courier; this never names a provider — it asks for "the
 * other live one". What it does NOT do is fail over on a MESSAGE
 * failure: a rejected address is a verdict the second provider will
 * share, and re-sending it doubles the bounce across both reputations
 * at once. See `EmailFailureKind`.
 *
 * ── A STUB MAY NEVER ANSWER FOR A LIVE PROVIDER (CUR-15) ─────────────
 * Resend with an empty `RESEND_API_KEY` is a dev stub that logs and
 * returns ok. That is right in dev and CI, where both providers are
 * stubbed, and catastrophic as a failover target for a LIVE SES: the
 * message would come back "sent", with a null provider id, and nobody
 * would ever receive it. The guard is as narrow as CUR-15's: refuse the
 * failover only when the ALTERNATE is not live and the refuser is.
 */
@Injectable()
export class EmailProviderRouter {
  private readonly logger = new Logger(EmailProviderRouter.name);
  private readonly pacer: ProviderPacer;
  private readonly redirectTo: string;

  constructor(
    private readonly resend: ResendService,
    private readonly ses: SesService,
    private readonly env: EnvService,
    // A TEST SEAM, and `@Optional()` is not decoration — a plain
    // optional TypeScript parameter is still a DI token Nest tries to
    // resolve, and `ProviderPacer` is not a provider. Without this the
    // whole application fails to start, which is precisely what
    // `app-module-boots.spec.ts` exists to catch (typecheck, lint and
    // every unit test stay green on an app that cannot boot).
    @Optional() pacer?: ProviderPacer,
  ) {
    this.pacer = pacer ?? new ProviderPacer();
    this.redirectTo = this.env.mailRedirectTo;

    // Loud on purpose. Diverting all mail is right for staging and
    // catastrophic in production — every seller and customer would
    // silently stop hearing from us, and nothing would look broken.
    if (this.redirectTo !== '' && !this.env.isTest) {
      this.logger.warn(
        `MAIL_REDIRECT_TO is set — EVERY outbound email will be sent to ${this.redirectTo} ` +
          `instead of its real recipient. Correct for staging; never set this in production.`,
      );
    }
  }

  /**
   * The rate the BullMQ worker's limiter should run at: the ceiling of
   * the fastest LIVE provider, so the queue never throttles it. Each
   * provider's own cap is held by the pacer underneath.
   *
   * With SES unconfigured this is Resend's 2/s — byte-identical to the
   * constant the worker carried before SES existed.
   */
  get queueRateLimitPerSecond(): number {
    const live = this.providers.filter((p) => p.isLive());
    if (live.length === 0) return this.resend.maxPerSecond;
    return Math.max(...live.map((p) => p.maxPerSecond));
  }

  private get providers(): readonly EmailProvider[] {
    return [this.resend, this.ses];
  }

  /** Which provider a category goes to first, if it can. */
  private primaryFor(category: NotificationCategory): EmailProvider {
    if (category === NotificationCategory.CREDENTIAL) return this.resend;
    // Everything else prefers SES, and falls back to Resend when SES is
    // not configured — which is the entire dark-ship posture: no
    // credentials, no change in behaviour.
    return this.ses.isLive() ? this.ses : this.resend;
  }

  private alternateFor(primary: EmailProvider): EmailProvider | null {
    const other = this.providers.find((p) => p.name !== primary.name) ?? null;
    if (other === null) return null;
    // CUR-15: a stub must never answer for a live provider. Both
    // stubbed is dev and CI and is fine; both live is what failover
    // exists for.
    if (!other.isLive() && primary.isLive()) return null;
    return other;
  }

  async send(input: SendEmailInput, category: NotificationCategory): Promise<EmailRouteResult> {
    // Applied ONCE, above every adapter, so a provider cannot leak real
    // mail from a staging box by forgetting to implement it.
    const message = applyMailRedirect(input, this.redirectTo);
    if (message.to !== input.to) {
      this.logger.log(`Email for ${input.to} redirected to ${message.to}`);
    }

    const primary = this.primaryFor(category);
    const first = await this.dispatch(primary, message);

    if (first.ok) {
      return { provider: primary.name, outcome: first, failedOverFrom: null };
    }

    if (failureKind(first) === 'MESSAGE') {
      // The provider read this message and refused it. The other one
      // will too, and asking it doubles the damage.
      return { provider: primary.name, outcome: first, failedOverFrom: null };
    }

    const alternate = this.alternateFor(primary);
    if (alternate === null) {
      this.logger.warn(
        {
          primary: primary.name,
          code: first.code,
          reason: this.providers.some((p) => p.name !== primary.name && !p.isLive())
            ? 'the alternate provider is not configured'
            : 'there is no alternate provider',
        },
        'Email transport failed and could not fail over',
      );
      return { provider: primary.name, outcome: first, failedOverFrom: null };
    }

    this.logger.warn(
      { from: primary.name, to: alternate.name, code: first.code, message: first.message },
      'Email transport failed — failing over to the other provider',
    );

    const second = await this.dispatch(alternate, message);
    return { provider: alternate.name, outcome: second, failedOverFrom: primary.name };
  }

  private async dispatch(
    provider: EmailProvider,
    message: SendEmailInput,
  ): Promise<SendEmailOutcome> {
    await this.pacer.take(provider.name, provider.maxPerSecond);
    return provider.send(message);
  }
}
