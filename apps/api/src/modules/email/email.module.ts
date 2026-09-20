import { Module } from '@nestjs/common';
import { ResendService } from './services/resend.service';
import { SesService } from './services/ses.service';
import { EmailProviderRouter } from './services/email-provider-router.service';
import { TemplateRenderService } from './services/template-render.service';
import { EmailDispatchService } from './services/email-dispatch.service';
import { EmailQueue } from './queue/email.queue';
import { EmailWorker } from './queue/email.worker';
import { EmailDeliveryWatchdogService } from './services/email-delivery-watchdog.service';
import { EmailWatchdogQueue } from './queue/email-watchdog.queue';

@Module({
  providers: [
    // Two providers behind one router (CUR-12 applied to email).
    // SesService is INERT without AWS_SES_* credentials, so registering
    // it changes nothing until somebody configures it.
    ResendService,
    SesService,
    EmailProviderRouter,
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
