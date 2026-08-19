import { ApiProperty } from '@nestjs/swagger';
import { WarehouseStatus } from '@skydrop/db';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateWarehouseDto {
  @ApiProperty({ description: 'Stable natural key, e.g. "CCU-01"', maxLength: 32 })
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @Matches(/^[A-Z0-9-]+$/, { message: 'code must be uppercase alphanumeric/dash' })
  code!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ required: false, enum: WarehouseStatus, default: WarehouseStatus.ACTIVE })
  @IsOptional()
  @IsEnum(WarehouseStatus)
  status?: WarehouseStatus;

  @ApiProperty({ required: false, default: 'IN', minLength: 2, maxLength: 2 })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @ApiProperty({ required: false, default: 'Asia/Kolkata', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({
    required: false,
    default: true,
    description:
      'Can customer orders ship FROM this building? Set false for an intake-only site ' +
      'such as the Bangladesh warehouse — its stock is on its way to India and is not ' +
      'sellable from there. Must be set at CREATE for an intake site: creating it as a ' +
      'fulfilment warehouse and turning the flag off afterwards leaves a window in which ' +
      'its stock is offered to customers.',
  })
  @IsOptional()
  @IsBoolean()
  fulfilsOrders?: boolean;
}

/**
 * code is immutable through the API, and the reason is NOT the one this
 * comment used to give: `ops.default_warehouse_id` holds the UUID, not
 * the code. The real reason is the SEED — it upserts on `code`, and
 * deploy re-runs it whenever seed.ts changes, so a code changed out of
 * band means the next deploy creates a second warehouse rather than
 * updating this one. Renaming a code is a migration plus a seed edit in
 * the same commit; see 20260819160000_rename_indian_warehouse.
 */
export class UpdateWarehouseDto {
  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiProperty({ required: false, enum: WarehouseStatus })
  @IsOptional()
  @IsEnum(WarehouseStatus)
  status?: WarehouseStatus;

  @ApiProperty({ required: false, minLength: 2, maxLength: 2 })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @ApiProperty({ required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({
    required: false,
    default: true,
    description:
      'Can customer orders ship FROM this building? Set false for an intake-only site ' +
      'such as the Bangladesh warehouse — its stock is on its way to India and is not ' +
      'sellable from there. Must be set at CREATE for an intake site: creating it as a ' +
      'fulfilment warehouse and turning the flag off afterwards leaves a window in which ' +
      'its stock is offered to customers.',
  })
  @IsOptional()
  @IsBoolean()
  fulfilsOrders?: boolean;
}

export class ListWarehousesQueryDto {
  @ApiProperty({ required: false, enum: WarehouseStatus })
  @IsOptional()
  @IsEnum(WarehouseStatus)
  status?: WarehouseStatus;
}

export class SetBinTrackingDto {
  @ApiProperty({
    description:
      'Turn location tracking on or off for this warehouse. Off routes every putaway to the FLOOR bin; on requires at least one real bin to exist. Moves no stock either way.',
  })
  @IsBoolean()
  enabled!: boolean;
}
