import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PUBLIC_MAX_QUESTION_CHARS } from '../services/assistant-chat.service';

/**
 * One question from the tracking page. The AWB is NOT in the body: it is the
 * route's `:awb`, so the visitor's words can never name a different parcel.
 */
export class PublicParcelMessageDto {
  @ApiProperty({ maxLength: PUBLIC_MAX_QUESTION_CHARS })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(PUBLIC_MAX_QUESTION_CHARS)
  text!: string;

  /** A random per-chat key the page makes up. It is the owner of the conversation, nothing more. */
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  visitorKey!: string;

  /** Absent on a chat's first question. Another key's, or another parcel's, is a 404. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('7')
  conversationId?: string;
}
