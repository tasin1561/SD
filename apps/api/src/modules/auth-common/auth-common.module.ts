import { Global, Module } from '@nestjs/common';
import { PasswordService } from './services/password.service';
import { JwtService } from './services/jwt.service';
import { TokenHashService } from './services/token-hash.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { AuditLogService } from './services/audit-log.service';

@Global()
@Module({
  providers: [PasswordService, JwtService, TokenHashService, RefreshTokenService, AuditLogService],
  exports: [PasswordService, JwtService, TokenHashService, RefreshTokenService, AuditLogService],
})
export class AuthCommonModule {}
