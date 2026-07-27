import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerOnboardingStep, type SellerStatus } from '@skydrop/db';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { ListSellersQueryDto } from './dto/list-sellers.dto';
import { UpdateSellerStatusDto } from './dto/update-status.dto';
import { CreateSellerNoteDto, ListSellerNotesQueryDto, UpdateSellerNoteDto } from './dto/note.dto';
import { OnboardingStepOverrideDto } from './dto/onboarding-override.dto';
import {
  AdminSellerService,
  type SellerDetailView,
  type SellerListResponse,
  type SellerNoteView,
} from './services/admin-seller.service';
import type { OnboardingProgressView } from '../seller-onboarding/services/seller-onboarding.service';

/**
 * Admin endpoints — every method requires a valid staff JWT.
 *
 * Phase 1A note: any authenticated staff member may list/manage sellers.
 * Role-based scoping (SUPER_ADMIN + SELLER_APPROVAL_ADMIN only for the
 * destructive operations) lands with the RBAC module — see
 * docs/phase-1a-debt.md.
 */
@ApiTags('admin-sellers')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/sellers')
export class AdminSellerController {
  constructor(private readonly svc: AdminSellerService) {}

  @Get()
  @ApiOperation({ summary: 'Paginated list of sellers with filters' })
  list(@Query() query: ListSellersQueryDto): Promise<SellerListResponse> {
    return this.svc.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full seller detail incl. addresses, onboarding, recent audit, notes' })
  getDetail(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<SellerDetailView> {
    return this.svc.getDetail(id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspend or reapprove a seller (delegates to SellerAccountStatusService)',
  })
  updateStatus(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: UpdateSellerStatusDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ sellerId: string; newStatus: SellerStatus }> {
    return this.svc.updateStatus(id, body, staff.id, ctx);
  }

  @Post(':id/bank-account/reveal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Decrypt + return the seller bank account number (HIGH audit; SUPER_ADMIN + FINANCE only)',
  })
  revealBankAccount(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: { reason?: string },
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ accountNumber: string | null }> {
    return this.svc.revealBankAccount(id, { staffId: staff.id }, ctx, body?.reason);
  }

  @Get(':id/notes')
  @ApiOperation({ summary: 'Paginated notes for a seller (optional category filter)' })
  listNotes(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Query() query: ListSellerNotesQueryDto,
  ): Promise<{ items: SellerNoteView[]; total: number; page: number; pageSize: number }> {
    return this.svc.listNotes(id, query);
  }

  @Post(':id/notes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a note on a seller' })
  createNote(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: CreateSellerNoteDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<SellerNoteView> {
    return this.svc.createNote(id, body, staff.id, ctx);
  }

  @Patch(':id/notes/:noteId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a note (any staff can edit per RBAC debt)' })
  updateNote(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Param('noteId', new ParseUUIDPipe({ version: '7' })) noteId: string,
    @Body() body: UpdateSellerNoteDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<SellerNoteView> {
    return this.svc.updateNote(id, noteId, body, staff.id, ctx);
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a note' })
  async deleteNote(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Param('noteId', new ParseUUIDPipe({ version: '7' })) noteId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.deleteNote(id, noteId, staff.id, ctx);
  }

  @Get(':id/onboarding')
  @ApiOperation({ summary: 'Detailed onboarding progress + who completed each step' })
  getOnboarding(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<OnboardingProgressView> {
    return this.svc.getOnboarding(id);
  }

  @Post(':id/onboarding/:stepCode/override')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin marks an onboarding step complete; captures reason in audit' })
  overrideStep(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Param('stepCode', new ParseEnumPipe(SellerOnboardingStep))
    stepCode: SellerOnboardingStep,
    @Body() body: OnboardingStepOverrideDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<OnboardingProgressView> {
    return this.svc.overrideOnboardingStep(id, stepCode, body, staff.id, ctx);
  }
}
