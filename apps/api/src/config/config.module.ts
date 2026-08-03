import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envSchema, type Env } from './env.schema';
import { EnvService } from './env.service';
import { WorkerRoleService } from '../common/queue/worker-role.service';

function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
  providers: [
    {
      provide: EnvService,
      useFactory: (): EnvService => new EnvService(validateEnv(process.env)),
    },
    // Global so every worker can ask whether this process owns the
    // queues without each module wiring it up.
    WorkerRoleService,
  ],
  exports: [EnvService, WorkerRoleService],
})
export class ConfigModule {}
