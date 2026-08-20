import { ApiProperty } from '@nestjs/swagger';
import { ReattemptRequestStatus } from '@skydrop/db';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}

export class ListReattemptRequestsQueryDto {
  @ApiProperty({ required: false, enum: ReattemptRequestStatus })
  @IsOptional()
  @IsEnum(ReattemptRequestStatus)
  status?: ReattemptRequestStatus;
}
