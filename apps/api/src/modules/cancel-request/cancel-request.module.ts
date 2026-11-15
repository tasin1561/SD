import { Module } from '@nestjs/common';
import { CancelRequestReadService } from './cancel-request-read.service';

/** R3 primitive — see `CancelRequestReadService`. PrismaService is global. */
@Module({ providers: [CancelRequestReadService], exports: [CancelRequestReadService] })
export class CancelRequestModule {}
