import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import { ListAdminMovementsQueryDto } from './dto/list-movements.dto';
import {
  InventoryMovementService,
  type MovementListResult,
} from './services/inventory-movement.service';

/**
 * Cross-seller stock-movement ledger for staff (read-only). RBAC scoping
 * arrives with the Module 12 roll-out (see phase-1a-debt).
 */
@ApiTags('admin-stock-movements')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/stock-movements')
export class AdminMovementController {
  constructor(private readonly svc: InventoryMovementService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paginated, filterable cross-seller stock-movement ledger' })
  list(@Query() query: ListAdminMovementsQueryDto): Promise<MovementListResult> {
    return this.svc.listForAdmin(query);
  }
}
