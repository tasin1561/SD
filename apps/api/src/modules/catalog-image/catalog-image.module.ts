import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerImageController } from './seller-image.controller';
import { CatalogImageService } from './services/catalog-image.service';
import { OrphanCleanupService } from './services/orphan-cleanup.service';
import { ImageQueue } from './queue/image.queue';
import { ImageWorker } from './queue/image.worker';

@Module({
  controllers: [SellerImageController],
  providers: [
    CatalogImageService,
    OrphanCleanupService,
    ImageQueue,
    ImageWorker,
    SellerJwtGuard,
  ],
  exports: [CatalogImageService, ImageQueue, OrphanCleanupService],
})
export class CatalogImageModule {}
