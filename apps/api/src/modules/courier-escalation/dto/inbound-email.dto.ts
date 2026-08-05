import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * What the Cloudflare Worker sends.
 *
 * The API runs `forbidNonWhitelisted`, so every field the Worker sends
 * must be declared here — a field added on the Worker side without a
 * matching property makes the whole request a 400, which is the correct
 * failure but an obscure one to debug. Keep the two in step.
 *
 * Sizes are capped because this is an open endpoint: an unbounded body
 * is memory somebody else controls.
 */
export class InboundEmailDto {
  @ApiProperty({ description: 'Envelope sender.' })
  @IsString()
  @MaxLength(320)
  from!: string;

  @ApiProperty({ description: 'Envelope recipient (our dedicated mailbox).' })
  @IsString()
  @MaxLength(320)
  to!: string;

  @ApiProperty({ description: 'Subject line — usually where the ticket id is.' })
  @IsString()
  @MaxLength(1000)
  subject!: string;

  @ApiProperty({ required: false, description: 'text/plain part, when present.' })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  text?: string;

  @ApiProperty({ required: false, description: 'text/html part, used when there is no text part.' })
  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  html?: string;

  @ApiProperty({ required: false, description: 'RFC Message-ID, for tracing.' })
  @IsOptional()
  @IsString()
  @MaxLength(998)
  messageId?: string;

  @ApiProperty({
    required: false,
    description: "The Date: header. The courier's own timestamp, not our receipt time.",
  })
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;
}
