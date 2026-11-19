import { Module } from '@nestjs/common';
import { BulkRunnerService } from './bulk-runner.service';

/** The bulk-action loop + its idempotency guard. Redis comes from the global RedisModule. */
@Module({
  providers: [BulkRunnerService],
  exports: [BulkRunnerService],
})
export class BulkModule {}
