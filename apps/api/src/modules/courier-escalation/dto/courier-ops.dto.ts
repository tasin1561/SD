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
