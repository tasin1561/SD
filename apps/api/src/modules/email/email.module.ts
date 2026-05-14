import { Module } from '@nestjs/common';
import { ResendService } from './services/resend.service';
import { TemplateRenderService } from './services/template-render.service';
import { EmailDispatchService } from './services/email-dispatch.service';
import { EmailQueue } from './queue/email.queue';
import { EmailWorker } from './queue/email.worker';

@Module({
  providers: [ResendService, TemplateRenderService, EmailDispatchService, EmailQueue, EmailWorker],
  exports: [EmailQueue, EmailDispatchService, TemplateRenderService],
})
export class EmailModule {}
