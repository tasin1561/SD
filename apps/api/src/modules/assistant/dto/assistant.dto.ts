import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  Matches,
  Max,
  Min,
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

/** Thumbs under one answer. `rating: null`-style removal is `DELETE`-like via `rating: 'none'`. */
export class AssistantFeedbackDto {
  @ApiProperty()
  @IsUUID('7')
  messageId!: string;

  @ApiProperty({ enum: ['up', 'down', 'none'] })
  @IsIn(['up', 'down', 'none'])
  rating!: 'up' | 'down' | 'none';

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

const bool = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : undefined;

/** Explorer filters (`assistant.conversations.read`). */
export class AssistantExplorerQueryDto {
  @ApiPropertyOptional({ enum: ['staff', 'seller', 'store', 'associate'] })
  @IsOptional()
  @IsIn(['staff', 'seller', 'store', 'associate'])
  portal?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() storeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;

  @ApiPropertyOptional({ description: 'Asia/Dhaka day, YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ description: 'Asia/Dhaka day, YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ enum: ['en', 'bn', 'hi'] })
  @IsOptional()
  @IsIn(['en', 'bn', 'hi'])
  language?: 'en' | 'bn' | 'hi';

  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() hasAttachment?: boolean;

  @ApiPropertyOptional({ enum: ['up', 'down'] })
  @IsOptional()
  @IsIn(['up', 'down'])
  rating?: 'up' | 'down';

  @ApiPropertyOptional({ enum: ['any', 'error'] })
  @IsOptional()
  @IsIn(['any', 'error'])
  hadNotice?: 'any' | 'error';

  @ApiPropertyOptional({ enum: ['flagged'] })
  @IsOptional()
  @IsIn(['flagged'])
  monitor?: 'flagged';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class AssistantControlDto {
  @ApiProperty({ description: 'The new value: a boolean, an integer or a decimal number.' })
  @IsDefined()
  value!: boolean | number | string;
}
