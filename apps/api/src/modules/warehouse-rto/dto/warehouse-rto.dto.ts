import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { RtoDisposition, RtoItemCondition } from '@skydrop/db';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

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

/** WMS-8d — one row of a line split by quantity. */
export class InspectRtoRowDto {
  @ApiProperty({ minimum: 1, description: 'How many of the line’s units this row covers' })
  @IsInt()
  @Min(1)
  @Max(100_000)
  readonly quantity!: number;

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

/**
 * Either one verdict for the whole line (`condition` + `disposition`), or
 * `rows` splitting it by quantity — never both (the service refuses
 * `RTO_INSPECTION_AMBIGUOUS`). The rows must add up to the line's quantity
 * (`RTO_SPLIT_QUANTITY_MISMATCH`).
 */
export class InspectRtoItemDto {
  @ApiPropertyOptional({ enum: RtoItemCondition, description: 'Required unless rows are sent' })
  @ValidateIf((o: InspectRtoItemDto) => o.rows === undefined)
  @IsEnum(RtoItemCondition)
  readonly condition?: RtoItemCondition;

  @ApiPropertyOptional({ enum: RtoDisposition, description: 'Required unless rows are sent' })
  @ValidateIf((o: InspectRtoItemDto) => o.rows === undefined)
  @IsEnum(RtoDisposition)
  readonly disposition?: RtoDisposition;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly notes?: string;

  @ApiPropertyOptional({
    type: [InspectRtoRowDto],
    description: 'WMS-8d — the line split by quantity; rows sum to the line quantity',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InspectRtoRowDto)
  readonly rows?: InspectRtoRowDto[];
}

export class RtoPutawayLineDto {
  @ApiProperty({ description: 'The inspected shipment item being shelved' })
  @IsUUID('7')
  shipmentItemId!: string;

  @ApiProperty({ description: 'The bin it is being put into (must be pickable)' })
  @IsUUID('7')
  destBinId!: string;
}

export class RtoPutawayDto {
  @ApiProperty({ type: [RtoPutawayLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RtoPutawayLineDto)
  lines!: RtoPutawayLineDto[];
}
