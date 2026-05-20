import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ManifestStatus } from '@skydrop/db';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class MoveShipmentDto {
  @ApiProperty({ description: 'UUID v7 of the target DRAFT manifest' })
  @IsUUID('7')
  readonly targetManifestId!: string;
}

export class ListManifestsQueryDto {
  @ApiPropertyOptional({ enum: ManifestStatus })
  @IsOptional()
  @IsEnum(ManifestStatus)
  readonly status?: ManifestStatus;

  @ApiPropertyOptional({ description: 'Filter by courier_code' })
  @IsOptional()
  @IsString()
  readonly courierCode?: string;

  @ApiPropertyOptional({ description: 'Filter by origin warehouse id' })
  @IsOptional()
  @IsUUID('7')
  readonly warehouseId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize?: number;
}
