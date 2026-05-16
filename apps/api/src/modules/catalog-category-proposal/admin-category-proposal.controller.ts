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
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import {
  ApproveProposalDto,
  ListAllProposalsQueryDto,
  RejectProposalDto,
} from './dto/review-proposal.dto';
import {
  AdminCategoryProposalService,
  type ApprovalResult,
} from './services/admin-category-proposal.service';
import type { CategoryProposalView } from './services/seller-category-proposal.service';

/**
 * Admin review of seller category proposals. Any authenticated staff in
 * Phase 1A (RBAC deferred — phase-1a-debt). Approval is fully
 * transactional: category creation + attribute-def seeding + proposal
 * update + audit + email all commit or roll back together.
 */
@ApiTags('admin-category-proposals')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/category-proposals')
export class AdminCategoryProposalController {
  constructor(private readonly svc: AdminCategoryProposalService) {}

  @Get()
  @ApiOperation({ summary: 'List all proposals (filter by status/seller)' })
  list(
    @Query() query: ListAllProposalsQueryDto,
  ): Promise<{ items: CategoryProposalView[]; total: number; page: number; pageSize: number }> {
    return this.svc.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a proposal by id' })
  getById(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<CategoryProposalView> {
    return this.svc.getById(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a proposal — creates the category (+ optional attribute defs) in one tx',
  })
  approve(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: ApproveProposalDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ApprovalResult> {
    return this.svc.approve(id, body, staff.id, ctx);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a proposal with a decision note' })
  reject(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: RejectProposalDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CategoryProposalView> {
    return this.svc.reject(id, body, staff.id, ctx);
  }
}
