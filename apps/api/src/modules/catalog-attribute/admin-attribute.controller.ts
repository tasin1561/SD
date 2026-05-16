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
import { CreateAttributeDefinitionDto } from './dto/create-attribute.dto';
import { UpdateAttributeDefinitionDto } from './dto/update-attribute.dto';
import {
  AttributeDefinitionService,
  type AttributeDefinitionView,
} from './services/attribute-definition.service';

/**
 * Admin attribute-definition management, scoped under a category. Returns
 * only the category's OWN definitions; the inherited/effective set is a
 * separate resolver endpoint (commit 6). RBAC deferred (phase-1a-debt).
 */
@ApiTags('admin-category-attributes')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/categories/:categoryId/attributes')
export class AdminAttributeController {
  constructor(private readonly svc: AttributeDefinitionService) {}

  @Get()
  @ApiOperation({ summary: "List a category's own attribute definitions" })
  list(
    @Param('categoryId', new ParseUUIDPipe({ version: '7' })) categoryId: string,
  ): Promise<AttributeDefinitionView[]> {
    return this.svc.listForCategory(categoryId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an attribute definition on the category' })
  create(
    @Param('categoryId', new ParseUUIDPipe({ version: '7' })) categoryId: string,
    @Body() body: CreateAttributeDefinitionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<AttributeDefinitionView> {
    return this.svc.create(categoryId, body, staff.id, ctx);
  }

  @Patch(':attributeId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an attribute definition' })
  update(
    @Param('categoryId', new ParseUUIDPipe({ version: '7' })) categoryId: string,
    @Param('attributeId', new ParseUUIDPipe({ version: '7' })) attributeId: string,
    @Body() body: UpdateAttributeDefinitionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<AttributeDefinitionView> {
    return this.svc.update(categoryId, attributeId, body, staff.id, ctx);
  }

  @Delete(':attributeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an attribute definition' })
  async remove(
    @Param('categoryId', new ParseUUIDPipe({ version: '7' })) categoryId: string,
    @Param('attributeId', new ParseUUIDPipe({ version: '7' })) attributeId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.softDelete(categoryId, attributeId, staff.id, ctx);
  }
}
