import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_QUESTION_CHARS } from '../services/assistant-chat.service';

export class CreateConversationDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

export class SendAssistantMessageDto {
  @ApiProperty({ maxLength: MAX_QUESTION_CHARS })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUESTION_CHARS)
  text!: string;
}
