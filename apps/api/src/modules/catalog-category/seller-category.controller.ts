import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import {
  CategoryService,
  type CategoryTreeNode,
  type CategoryView,
} from './services/category.service';

/**
 * Read-only category access for sellers. Categories are global, so there
 * is no seller scoping on reads. All endpoints allow SUSPENDED sellers
 * (read-only) — they may still browse the catalog taxonomy.
 *
 * The effective-attributes endpoint lands in commit 6 with the attribute
 * inheritance resolution service.
 */
@ApiTags('seller-categories')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/categories')
export class SellerCategoryController {
  constructor(private readonly svc: CategoryService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flat list of all categories' })
  list(): Promise<CategoryView[]> {
    return this.svc.list();
  }

  @Get('tree')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nested category tree' })
  tree(): Promise<CategoryTreeNode[]> {
    return this.svc.getTree();
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Single category by id' })
  getById(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<CategoryView> {
    return this.svc.getById(id);
  }
}
