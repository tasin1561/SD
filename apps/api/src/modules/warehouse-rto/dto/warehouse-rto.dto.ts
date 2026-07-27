import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RtoDisposition, RtoItemCondition } from '@skydrop/db';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ReceiveRtoDto {
  @ApiProperty({ description: 'AWB number to look up the inbound parcel' })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  readonly awbNumber!: string;

  @ApiPropertyOptional({
    description:
      'R6 — the warehouse this parcel physically arrived at. Omit when it came back to the warehouse it shipped from (the common case). A different warehouse is recorded + audited, and blocks RESTOCK finalize until the stock location is resolved.',
  })
  @IsOptional()
  @IsUUID()
  readonly warehouseId?: string;
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
