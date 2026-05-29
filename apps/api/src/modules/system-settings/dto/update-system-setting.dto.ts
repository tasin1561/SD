import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsEnum } from 'class-validator';
import { SettingValueType } from '@skydrop/db';

/**
 * Update DTO for a system setting. The `value` field is intentionally
 * typed as `unknown` (the service parses + validates per `valueType`).
 * class-validator only enforces presence + that `valueType` is a known
 * enum value; the deep validation is the service's job (and gives
 * better error messages keyed on the setting's key + type).
 */
export class UpdateSystemSettingDto {
  @ApiProperty({ enum: SettingValueType })
  @IsEnum(SettingValueType)
  valueType!: SettingValueType;

  @ApiProperty({
    description:
      'New value. Type depends on valueType (string / int / decimal / boolean / json / ISO-8601 date).',
  })
  @IsDefined()
  value!: unknown;
}
