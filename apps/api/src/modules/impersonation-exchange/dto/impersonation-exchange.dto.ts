import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ImpersonationExchangeDto {
  /**
   * The handoff token the admin console minted, spent here for a session
   * cookie. Bounded in length so a malformed paste is refused by the pipe
   * rather than by the signature check, which is the cheaper refusal.
   */
  @ApiProperty({ description: 'The one-time handoff token from the admin console' })
  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  handoffToken!: string;
}
