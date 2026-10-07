import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import { SkipImpersonationGate } from '../../common/impersonation/skip-impersonation-gate.decorator';
import { ImpersonationExchangeDto } from './dto/impersonation-exchange.dto';
import {
  ImpersonationExchangeService,
  type ImpersonationSessionView,
} from './impersonation-exchange.service';

/**
 * Where a support session ARRIVES: the two endpoints that turn a handoff
 * token into a working session cookie, one per origin.
 *
 * ── WHY TWO ROUTES AND NOT ONE WITH A `kind` FIELD ──────────────────
 * The origin becomes part of the URL rather than part of the body, and
 * `redeemHandoff` checks it against the session row. A single endpoint
 * taking `kind: 'STORE'` would make that binding something the CALLER
 * asserts, and the caller here is a browser that has just followed a
 * redirect with a token in its fragment.
 *
 * ── WHY @Public ──────────────────────────────────────────────────────
 * There is nothing to authenticate with yet. The staff member has no
 * seller or store login — that is the entire premise — and the handoff
 * token IS the credential, single-use and sixty seconds old, verified by
 * the session service rather than by a guard. The ordinary refusals
 * apply from the next request on: it carries the cookie and meets both
 * the JWT guard and the deny list.
 *
 * ── WHY @SkipImpersonationGate ──────────────────────────────────────
 * A browser arriving here may still be holding the cookie of a session
 * that has ended or expired, and `ImpersonationGuard` refuses those. Left
 * gated, the previous visit would lock the support engineer out of the
 * next one and the only cure would be clearing cookies by hand. Safe
 * because an exchange touches nothing in the subject's account.
 */
@ApiTags('auth-impersonation')
@Controller('auth/seller/impersonation')
@ThrottleKey('ip')
export class SellerImpersonationExchangeController {
  constructor(private readonly svc: ImpersonationExchangeService) {}

  @Public()
  @SkipImpersonationGate()
  // Tight, and keyed on IP: a handoff token is single-use and
  // short-lived, so anybody presenting a stream of them is guessing.
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Spend a handoff token for a support session inside a seller account' })
  exchangeSeller(
    @Body() body: ImpersonationExchangeDto,
    @ClientInfo() client: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ImpersonationSessionView> {
    return this.svc.exchange({ token: body.handoffToken, origin: 'SELLER', res, client });
  }

  /**
   * Forget the cookie at this origin. It does not END the session — see
   * the service — so it is safe to call with a dead cookie, which is why
   * it skips the gate as well.
   */
  @Public()
  @SkipImpersonationGate()
  @Post('leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Drop the support session cookie at the seller origin' })
  leaveSeller(@Res({ passthrough: true }) res: Response): void {
    this.svc.leave(res);
  }

  /**
   * End the session for real, not just forget it here. The signed cookie
   * is the credential — it names one session and only its own staff
   * member holds it.
   */
  @Public()
  @SkipImpersonationGate()
  @Post('end')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End the support session from inside the seller account' })
  async endSeller(
    @Req() req: Request,
    @ClientInfo() client: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.svc.endFromInside({ req, res, client });
  }
}

/** The same two acts at the reseller store's origin. */
@ApiTags('auth-impersonation')
@Controller('auth/store/impersonation')
@ThrottleKey('ip')
export class StoreImpersonationExchangeController {
  constructor(private readonly svc: ImpersonationExchangeService) {}

  @Public()
  @SkipImpersonationGate()
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Spend a handoff token for a support session inside a reseller store' })
  exchangeStore(
    @Body() body: ImpersonationExchangeDto,
    @ClientInfo() client: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ImpersonationSessionView> {
    return this.svc.exchange({ token: body.handoffToken, origin: 'STORE', res, client });
  }

  @Public()
  @SkipImpersonationGate()
  @Post('leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Drop the support session cookie at the store origin' })
  leaveStore(@Res({ passthrough: true }) res: Response): void {
    this.svc.leave(res);
  }

  /**
   * End the session for real, not just forget it here. The signed cookie
   * is the credential — it names one session and only its own staff
   * member holds it.
   */
  @Public()
  @SkipImpersonationGate()
  @Post('end')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End the support session from inside the store account' })
  async endStore(
    @Req() req: Request,
    @ClientInfo() client: ClientInfoPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.svc.endFromInside({ req, res, client });
  }
}
