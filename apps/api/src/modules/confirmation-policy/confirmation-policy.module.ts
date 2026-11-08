import { Module } from '@nestjs/common';
import { CallQueueModule } from '../call-queue/call-queue.module';
import { SettingsModule } from '../settings/settings.module';
import { ConfirmationPolicyService } from './confirmation-policy.service';

/**
 * R3 primitive: "is this client's order phoned automatically, and when
 * does the no-call TTL expire". Depends only on the call-queue primitive
 * and settings; imported by `order` (post-commit enqueue sites) and
 * `call-center` (the TTL sweeper), importing neither.
 */
@Module({
  imports: [CallQueueModule, SettingsModule],
  providers: [ConfirmationPolicyService],
  exports: [ConfirmationPolicyService],
})
export class ConfirmationPolicyModule {}
