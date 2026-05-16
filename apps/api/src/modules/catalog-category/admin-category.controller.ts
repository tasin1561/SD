import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { MoveCategoryDto } from './dto/move-category.dto';
import {
  CategoryService,
  type CategoryTreeNode,
  type CategoryView,
} from './services/category.service';

/**
 * Admin-only category management. Categories are GLOBAL (not seller-scoped)
 * — sellers can't create them directly; they submit proposals (commits
 * 7-8). Any authenticated staff member may manage categories in Phase 1A;
 * RBAC scoping lands with Module 12 (tracked in phase-1a-debt).
 */
@ApiTags('admin-categories')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/categories')
export class AdminCategoryController {
  constructor(private readonly svc: CategoryService) {}

  @Get()
  @ApiOperation({ summary: 'Flat list of all categories (depth/sortOrder ordered)' })
  list(): Promise<CategoryView[]> {
    return this.svc.list();
  }

  @Get('tree')
  @ApiOperation({ summary: 'Nested category tree' })
  tree(): Promise<CategoryTreeNode[]> {
    return this.svc.getTree();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Single category by id' })
  getById(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<CategoryView> {
    return this.svc.getById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a category (derives depth + fullPath from parent)' })
  create(
    @Body() body: CreateCategoryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CategoryView> {
    return this.svc.create(body, staff.id, ctx);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update category fields (name change recomputes subtree fullPath)' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: UpdateCategoryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CategoryView> {
    return this.svc.update(id, body, staff.id, ctx);
  }

  @Patch(':id/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-parent a category; cycle-checked, recomputes subtree depth/path' })
  move(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: MoveCategoryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CategoryView> {
    return this.svc.move(id, body.newParentId, staff.id, ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a category (blocked if it has children or products)' })
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.softDelete(id, staff.id, ctx);
  }
}
