import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { TrackingPollModule } from '../tracking-poll/tracking-poll.module';

/**
 * Imports TrackingPollModule for its `health()` read only. The direction
 * is one-way — tracking knows nothing about health — so no cycle.
 */
@Module({
  imports: [TrackingPollModule],
  controllers: [HealthController],
})
export class HealthModule {}
