import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  LinkSellerCourierAccountDto,
  UpdateSellerCourierAccountLinkDto,
} from '../dto/courier-account-admin.dto';
import {
  CourierAccountAdminService,
  type SellerCourierAccountLinkView,
} from '../services/courier-account-admin.service';

/** Admin surface for assigning a seller to specific courier accounts (R1). */
@ApiTags('admin-seller-courier-accounts')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/sellers/:sellerId/courier-accounts')
export class AdminSellerCourierAccountController {
  constructor(private readonly svc: CourierAccountAdminService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List a seller's courier-account links" })
  list(@Param('sellerId') sellerId: string): Promise<readonly SellerCourierAccountLinkView[]> {
    return this.svc.listLinks(sellerId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link (or update the weight of) a seller-to-courier-account assignment',
  })
  link(
    @Param('sellerId') sellerId: string,
    @Body() body: LinkSellerCourierAccountDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<SellerCourierAccountLinkView> {
    return this.svc.linkSeller(sellerId, body, staff.id);
  }

  @Patch(':courierAccountId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Update a link's distribution weight or active state" })
  update(
    @Param('sellerId') sellerId: string,
    @Param('courierAccountId') courierAccountId: string,
    @Body() body: UpdateSellerCourierAccountLinkDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<SellerCourierAccountLinkView> {
    return this.svc.updateLink(sellerId, courierAccountId, body, staff.id);
  }

  @Delete(':courierAccountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a seller-to-courier-account link (reverts to the default account)',
  })
  unlink(
    @Param('sellerId') sellerId: string,
    @Param('courierAccountId') courierAccountId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<void> {
    return this.svc.unlinkSeller(sellerId, courierAccountId, staff.id);
  }
}
