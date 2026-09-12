import { Module } from '@nestjs/common';
import { ResendService } from './services/resend.service';
import { TemplateRenderService } from './services/template-render.service';
import { EmailDispatchService } from './services/email-dispatch.service';
import { EmailQueue } from './queue/email.queue';
import { EmailWorker } from './queue/email.worker';
import { EmailDeliveryWatchdogService } from './services/email-delivery-watchdog.service';
import { EmailWatchdogQueue } from './queue/email-watchdog.queue';

@Module({
  providers: [
    ResendService,
    TemplateRenderService,
    EmailDispatchService,
    EmailQueue,
    EmailWorker,
    // SystemIssueService reaches both through the @Global SystemIssuesModule,
    // the same way EmailWorker already does.
    EmailDeliveryWatchdogService,
    EmailWatchdogQueue,
  ],
  exports: [EmailQueue, EmailDispatchService, TemplateRenderService],
})
export class EmailModule {}
