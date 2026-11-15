import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { CancelRequestDto } from '../dto/cancel-request.dto';
import { CancelRequestService, type CancelRequestResult } from '../services/cancel-request.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/** The member store's and the associate's side of the same (an associate is a store user at OWN scope). */
@ApiTags('store-tickets')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.cancel')
@Controller('store/orders')
export class StoreCancelRequestController {
  constructor(private readonly cancelRequests: CancelRequestService) {}

  @Post(':id/cancel-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ask Skydrop to cancel one of this store’s orders that is past the direct-cancel window. Refused when the seller has turned cancelling off for the store.',
  })
  raise(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
    @Body() body: CancelRequestDto,
  ): Promise<CancelRequestResult> {
    return this.cancelRequests.raise(
      {
        kind: 'STORE',
        storeId: user.storeId,
        storeUserId: user.id,
        orderScope: user.orderScope,
      },
      id,
      body.note ?? null,
    );
  }
}
