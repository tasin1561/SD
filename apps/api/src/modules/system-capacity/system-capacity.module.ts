import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminCapacityController } from './controllers/admin-capacity.controller';
import { CapacityService } from './services/capacity.service';
import { TrackingIngestionModule } from '../tracking-ingestion/tracking-ingestion.module';

/**
 * Module 26 — the capacity monitor.
 *
 * A LEAF: it reads Postgres, Redis and the environment, and exports
 * nothing. Nothing in the product should ever make a decision from
 * these numbers — they exist to be read by a person deciding what to
 * buy next.
 */
@Module({
  // For the retained-payload reading. tracking-ingestion is a leaf and
  // imports nothing of ours, so this cannot close a cycle.
  imports: [TrackingIngestionModule],
  controllers: [AdminCapacityController],
  providers: [CapacityService, StaffJwtGuard],
})
export class SystemCapacityModule {}
