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
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { CreateSellerRoleDto, UpdateSellerRoleDto } from '../dto/seller-rbac.dto';
import {
  SellerRbacService,
  type SellerCatalogueEntry,
  type SellerRoleView,
} from '../services/seller-rbac.service';

/**
 * A company's roles, and what each covers.
 *
 * Everything here is `roles.manage`, reads included — the catalogue is a
 * map of every capability the account has, which is not something to
 * hand to whoever happens to be logged in.
 *
 * The seller id comes from the SESSION, never the URL. There is no
 * `/sellers/:id/roles` shape to get wrong.
 */
@ApiTags('seller-rbac')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('roles.manage')
@Controller('seller/roles')
export class SellerRbacController {
  constructor(private readonly svc: SellerRbacService) {}

  @Get('catalogue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Every permission a team member can be given, grouped for display' })
  catalogue(): {
    readonly groups: readonly string[];
    readonly permissions: readonly SellerCatalogueEntry[];
  } {
    return this.svc.catalogue();
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'This company’s roles, and how many people hold each' })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<readonly SellerRoleView[]> {
    return this.svc.list(seller.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a role' })
  create(
    @Body() body: CreateSellerRoleDto,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<SellerRoleView> {
    return this.svc.create(seller.id, body, seller.userId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rename a role or replace its permissions' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSellerRoleDto,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<SellerRoleView> {
    return this.svc.update(seller.id, id, body, seller.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a role nobody holds' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<{ readonly deleted: true }> {
    return this.svc.remove(seller.id, id, seller.userId);
  }
}
