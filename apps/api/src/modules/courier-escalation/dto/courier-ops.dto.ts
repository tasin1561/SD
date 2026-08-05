import { ApiProperty } from '@nestjs/swagger';
import { CourierOutboxStatus, CourierWriteMode } from '@skydrop/db';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class ListOutboxQueryDto {
  @ApiProperty({ required: false, enum: CourierOutboxStatus })
  @IsOptional()
  @IsEnum(CourierOutboxStatus)
  status?: CourierOutboxStatus;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class MarkSentDto {
  @ApiProperty({
    required: false,
    description:
      'The courier ticket id, if one was just created. Leaving it empty is allowed — the reconciler then returns the item to the queue rather than leaving it as a permanent unknown.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  externalTicketId?: string;
}

export class RequestModeChangeDto {
  @ApiProperty({ enum: CourierWriteMode })
  @IsEnum(CourierWriteMode)
  writeMode!: CourierWriteMode;

  @ApiProperty({
    type: [String],
    required: false,
    description:
      'Delhivery category IDs the worker may action unattended. Must be empty until the taxonomy has been fetched — the Claims/Finance and Protect VAS locks are enforced by ID.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  autoCategories?: string[];

  @ApiProperty({ description: 'Why. At least 30 characters; written to the audit log.' })
  @IsString()
  @Length(30, 2000)
  reason!: string;
}

export class ConfirmModeChangeDto {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  challengeId!: string;

  @ApiProperty({ description: 'The six-digit code from the email.' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class PauseChannelDto {
  @ApiProperty({ description: 'Minutes to pause for.' })
  @IsInt()
  @Min(1)
  @Max(10_080)
  minutes!: number;

  @ApiProperty()
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class PostReplyDto {
  @ApiProperty({
    description:
      'What to say to the courier. Stored and sent VERBATIM — never rewritten, never translated.',
  })
  @IsString()
  @Length(1, 5000)
  body!: string;
}

export class PromoteCandidateDto {
  @ApiProperty({ description: 'Stable code for the template, e.g. NDR_ACK_24_48.' })
  @IsString()
  @Length(2, 64)
  code!: string;

  @ApiProperty({
    description:
      'JS regex source WITHOUT delimiters, matched case-insensitively. Validated by compiling it AND checking it matches the candidate body.',
  })
  @IsString()
  @Length(3, 500)
  pattern!: string;

  @ApiProperty({ description: 'State label this implies, e.g. ACKNOWLEDGED.' })
  @IsString()
  @Length(2, 64)
  state!: string;

  @ApiProperty({ required: false, description: 'Action label, e.g. ASK_SELLER_ALT_PHONE.' })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  action?: string;

  @ApiProperty({ required: false, default: 50, description: 'Lower runs first.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;
}

export class RejectCandidateDto {
  @ApiProperty({ required: false, description: 'Why it was not promoted.' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;
}
