import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import { BinContentsQueryDto } from './dto/bin-contents.dto';
import {
  BinContentsService,
  type BinContentsPage,
  type BinOverview,
} from './services/bin-contents.service';

/**
 * What each bin holds — read-only. Same permission as the bins list
 * (`warehouse.view`): somebody who may see the shelving may see what is
 * on it. Its own prefix rather than `admin/warehouses/...` because the
 * overview spans every warehouse, and a static segment beside that
 * controller's `:id` route would be answered by the uuid pipe first.
 */
@ApiTags('admin-warehouses')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('warehouse.view')
@Controller('admin/bin-contents')
export class AdminBinContentsController {
  constructor(private readonly svc: BinContentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Every warehouse and bin, with the stock lines each bin holds (capped per bin)',
  })
  overview(): Promise<BinOverview> {
    return this.svc.overview();
  }

  @Get(':binId')
  @ApiOperation({ summary: 'One bin’s stock lines, paged, with when each last moved' })
  contents(
    @Param('binId', new ParseUUIDPipe({ version: '7' })) binId: string,
    @Query() query: BinContentsQueryDto,
  ): Promise<BinContentsPage> {
    return this.svc.binContents(binId, query);
  }
}
