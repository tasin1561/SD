import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  ResellerStoreTermsService,
  type StoreTermsView,
} from '../services/reseller-store-terms.service';

/**
 * The store's own view of the seller's terms (RS-4), and accepting them.
 * Always the caller's OWN store: the id comes from the token, never the
 * request — a version id belonging to another store is a 404.
 */
@ApiTags('store-terms')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('terms.view')
@Controller('store/terms')
export class StoreTermsController {
  constructor(private readonly terms: ResellerStoreTermsService) {}

  @Get()
  @ApiOperation({ summary: 'The terms in force, whether they are accepted, and every version' })
  view(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StoreTermsView> {
    return this.terms.viewForStore(user);
  }

  @Post(':versionId/accept')
  @RequireStorePermissions('terms.accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Accept the version in force on the store’s behalf (recorded with who, when and from where)',
  })
  accept(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('versionId', new ParseUUIDPipe({ version: '7' })) versionId: string,
    @Req() req: Request,
  ): Promise<StoreTermsView> {
    return this.terms.accept(user, versionId, {
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
  }
}
