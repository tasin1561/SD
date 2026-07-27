import { ApiProperty } from '@nestjs/swagger';
import { NotificationFrequency } from '@skydrop/db';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const IANA_TZ = /^[A-Za-z_]+\/[A-Za-z_+\-/]+$/;

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  smsEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  webhookEnabled?: boolean;

  @ApiProperty({ required: false, enum: NotificationFrequency })
  @IsOptional()
  @IsEnum(NotificationFrequency)
  frequency?: NotificationFrequency;

  @ApiProperty({
    required: false,
    nullable: true,
    description: '24h "HH:MM" local-tz quiet-hour start. Null clears.',
  })
  @IsOptional()
  @Matches(HH_MM, {
    each: false,
    message: 'quietHoursStart must be in HH:MM (24h) format or null',
  })
  quietHoursStart?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: '24h "HH:MM" local-tz quiet-hour end. Null clears.',
  })
  @IsOptional()
  @Matches(HH_MM, { message: 'quietHoursEnd must be in HH:MM (24h) format or null' })
  quietHoursEnd?: string | null;

  @ApiProperty({
    required: false,
    description: 'IANA timezone (e.g., "Asia/Dhaka"). Defaults to Asia/Dhaka.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  @Matches(IANA_TZ, { message: 'timezone must look like "Region/City"' })
  timezone?: string;
}
