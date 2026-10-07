import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  EndImpersonationDto,
  ListImpersonationQueryDto,
  StartImpersonationDto,
  VerifyImpersonationDto,
} from '../dto/impersonation.dto';
import {
  ImpersonationService,
  type ImpersonationHandoff,
  type ImpersonationSessionSummary,
  type StartImpersonationResult,
} from '../services/impersonation.service';

/**
 * Where a support session is opened, proved, closed and reviewed.
 *
 * ── WHY THE START AND THE REVIEW ARE DIFFERENT PERMISSIONS ──────────
 * `support.impersonate` lets you go in. `support.impersonate.review`
 * lets you see what everybody else did and stop them. They are split
 * because oversight that the person being overseen can grant themselves
 * is not oversight — and because the people who should be reading this
 * screen (whoever is accountable for the estate) are usually not the
 * people using the feature.
 *
 * Reading somebody else's session needs the review permission, so an
 * operator sees their own sessions only by filtering to themselves.
 * That is not an accident of the design: a list of which accounts
 * colleagues have been inside is itself sensitive.
 *
 * ── NO ENDPOINT RETURNS A SECRET TWICE ──────────────────────────────
 * `/start` returns an id and two deadlines; the code goes to the staff
 * member's inbox and nowhere else. `/:id/verify` returns the handoff
 * token exactly once, on its way to the browser. Nothing here can be
 * polled to get either of them back.
 */
/**
 * A session id that is not a uuid is a 400, not a 500. Without this the
 * value reaches Postgres as a `@db.Uuid` comparison and comes back as a
 * P2023 the caller cannot act on.
 */
const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

@ApiTags('admin-impersonation')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/impersonation')
export class AdminImpersonationController {
  constructor(private readonly sessions: ImpersonationService) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('support.impersonate')
  @ApiOperation({
    summary: 'Ask to go inside a seller’s or a store’s account',
    description:
      'Records the request with its reason and mails a six-digit code to YOUR address. Grants nothing on its own — the session is unusable until the code comes back. Asking for `mayWrite` additionally requires `support.impersonate.write`, which is checked against the body rather than the route, because the requirement depends on what you asked for.',
  })
  start(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: StartImpersonationDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StartImpersonationResult> {
    return this.sessions.start({
      staffUserId: staff.id,
      // The conditional write check lives in the service; it needs the
      // permission set, and `@RequirePermissions` cannot express "A and
      // also B when the body says so" because several keys mean ANY.
      staffPermissions: staff.permissions,
      subject: { kind: body.subjectKind, id: body.subjectId },
      reason: body.reason,
      mayWrite: body.mayWrite ?? false,
      ctx,
    });
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('support.impersonate')
  @ApiOperation({
    summary: 'Enter the emailed code and get the way in',
    description:
      'On success the session becomes usable and you get a single-use handoff token valid for 60 seconds, plus the URL to send the browser to. The token is in that URL’s FRAGMENT so it never reaches a server log. Five wrong codes closes the session for good.',
  })
  async verify(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: VerifyImpersonationDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ sessionId: string; handoff: ImpersonationHandoff }> {
    const result = await this.sessions.verify({
      sessionId: id,
      staffUserId: staff.id,
      code: body.code,
      ctx,
    });
    return { sessionId: result.sessionId, handoff: result.handoff };
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  // EITHER key opens the route, because `@RequirePermissions(a, b)` is
  // an OR. A pure reviewer — somebody holding `.review` and nothing
  // else, which is the oversight role this feature is supposed to have
  // — was refused at the route and could never end anything, removing
  // the review screen's only action. The route decides who may ASK; the
  // service decides whether this particular session is theirs to close,
  // because that is a fact about the row.
  @RequirePermissions('support.impersonate', 'support.impersonate.review')
  @ApiOperation({
    summary: 'Close a support session',
    description:
      'Your own, always. Somebody else’s needs `support.impersonate.review` — which is checked in the service, because whether this is your own session is a fact about the row and not about the route. Ending takes effect on the impersonated app’s very next request.',
  })
  end(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: EndImpersonationDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ImpersonationSessionSummary> {
    return this.sessions.end({
      sessionId: id,
      actorStaffUserId: staff.id,
      actorPermissions: staff.permissions,
      reason: body.reason,
      ctx,
    });
  }

  @Get()
  @RequirePermissions('support.impersonate.review')
  @ApiOperation({
    summary: 'Every support session, newest first',
    description:
      'Including the ones nobody verified, because a request that was abandoned is a fact worth seeing. Filter by staff member, seller or store.',
  })
  list(@Query() query: ListImpersonationQueryDto): Promise<readonly ImpersonationSessionSummary[]> {
    return this.sessions.list({
      staffUserId: query.staffUserId,
      sellerId: query.sellerId,
      storeId: query.storeId,
      limit: query.limit,
    });
  }

  @Get('active')
  @RequirePermissions('support.impersonate.review')
  @ApiOperation({
    summary: 'Who is inside somebody’s account right now',
    description:
      'Verified, not ended, not past its deadline. The one question this screen exists to answer, and the list a reviewer acts on.',
  })
  active(): Promise<readonly ImpersonationSessionSummary[]> {
    return this.sessions.active();
  }
}
