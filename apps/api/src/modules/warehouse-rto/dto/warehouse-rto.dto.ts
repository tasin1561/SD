import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RtoDisposition, RtoItemCondition } from '@skydrop/db';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ReceiveRtoDto {
  @ApiProperty({ description: 'AWB number to look up the inbound parcel' })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  readonly awbNumber!: string;
}

export class InspectRtoItemDto {
  @ApiProperty({ enum: RtoItemCondition })
  @IsEnum(RtoItemCondition)
  readonly condition!: RtoItemCondition;

  @ApiProperty({ enum: RtoDisposition })
  @IsEnum(RtoDisposition)
  readonly disposition!: RtoDisposition;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly notes?: string;
}
