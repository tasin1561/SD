import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminAttributeController } from './admin-attribute.controller';
import { AttributeDefinitionService } from './services/attribute-definition.service';

@Module({
  controllers: [AdminAttributeController],
  providers: [AttributeDefinitionService, StaffJwtGuard],
  exports: [AttributeDefinitionService],
})
export class CatalogAttributeModule {}
