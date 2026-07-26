import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SettingValueType } from '@skydrop/db';

/**
 * Set/replace a seller's override for a key. `value` is intentionally
 * `unknown` — the service parses + clamps per the system setting's
 * `valueType` and bounds (mirrors UpdateSystemSettingDto's shape).
 */
export class SetSellerSettingOverrideDto {
  @ApiProperty({ enum: SettingValueType })
  @IsEnum(SettingValueType)
  valueType!: SettingValueType;

  @ApiProperty({
    description:
      'New override value. Type depends on valueType (string / int / decimal / boolean / json / ISO-8601 date).',
  })
  @IsDefined()
  value!: unknown;

  @ApiPropertyOptional({ description: 'Optional note explaining why this override was set.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
