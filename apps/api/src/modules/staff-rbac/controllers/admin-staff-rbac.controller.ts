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
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { CreateStaffRoleDto, UpdateStaffRoleDto } from '../dto/staff-rbac.dto';
import {
  StaffRbacService,
  type CatalogueEntry,
  type RoleView,
} from '../services/staff-rbac.service';

/**
 * Roles and what each may do.
 *
 * Everything here is `rbac.manage`, including reading — the catalogue
 * doubles as a map of every capability the system has, which is not a
 * thing to hand out for free.
 */
@ApiTags('admin-staff-rbac')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('rbac.manage')
@Controller('admin/staff-roles')
export class AdminStaffRbacController {
  constructor(private readonly svc: StaffRbacService) {}

  @Get('catalogue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Every permission this system defines, grouped for display' })
  catalogue(): {
    readonly groups: readonly string[];
    readonly permissions: readonly CatalogueEntry[];
  } {
    return this.svc.catalogue();
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Roles, their permissions, and how many people hold each' })
  list(): Promise<readonly RoleView[]> {
    return this.svc.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a role' })
  create(
    @Body() body: CreateStaffRoleDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<RoleView> {
    return this.svc.create(body, staff.id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rename a role or replace its permissions' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStaffRoleDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<RoleView> {
    return this.svc.update(id, body, staff.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a role nobody holds' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ readonly deleted: true }> {
    return this.svc.remove(id, staff.id);
  }
}
