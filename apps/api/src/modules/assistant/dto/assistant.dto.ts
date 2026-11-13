import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_QUESTION_CHARS } from '../services/assistant-chat.service';

export class CreateConversationDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

export class AssistantLastErrorDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;
}

/** Untrusted: the browser says where the user is and what just failed. */
export class AssistantPageContextDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  path?: string;

  @ApiPropertyOptional({ type: AssistantLastErrorDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantLastErrorDto)
  lastError?: AssistantLastErrorDto;
}

export class SendAssistantMessageDto {
  @ApiProperty({ maxLength: MAX_QUESTION_CHARS })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUESTION_CHARS)
  text!: string;

  @ApiPropertyOptional({ type: AssistantPageContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantPageContextDto)
  context?: AssistantPageContextDto;

  /** Files uploaded to THIS conversation and not yet sent. Anyone else's, or another conversation's, is a 404. */
  @ApiPropertyOptional({ type: [String], maxItems: 3 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('7', { each: true })
  attachmentIds?: string[];
}
