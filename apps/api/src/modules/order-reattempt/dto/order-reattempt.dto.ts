import { ApiProperty } from '@nestjs/swagger';
import { ReattemptRequestStatus } from '@skydrop/db';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateReattemptRequestDto {
  @ApiProperty({
    description:
      'Why this customer should be called again after declining. Required — it is the whole basis on which somebody approves it.',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  reason!: string;
}

export class DecideReattemptRequestDto {
  @ApiProperty({ required: false, description: 'Note recorded with the decision' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 5,
    default: 1,
    description:
      'Extra calls this approval grants on top of the seller’s cap (approve only). At least one, because an approval that grants none puts the order back already out of chances. Capped, because unlimited retries on a customer who declined is what the whole request flow exists to prevent.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  extraAttempts?: number;
}

export class ListReattemptRequestsQueryDto {
  @ApiProperty({ required: false, enum: ReattemptRequestStatus })
  @IsOptional()
  @IsEnum(ReattemptRequestStatus)
  status?: ReattemptRequestStatus;
}
