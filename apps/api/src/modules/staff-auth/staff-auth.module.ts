import { Module } from '@nestjs/common';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [StaffAuthController],
  providers: [StaffAuthService, StaffJwtGuard],
  exports: [StaffJwtGuard],
})
export class StaffAuthModule {}
