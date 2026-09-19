import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationSubscriptionMode,
  StoreNotificationCategory,
} from '@skydrop/db';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class FeedQueryDto {
  @ApiPropertyOptional({ description: 'Id of the last item on the previous page' })
  @IsOptional()
  @IsUUID('7')
  cursor?: string;
}

export class SetSubscriptionDto {
  @ApiProperty({ description: 'Template code, or a coarser topic key' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  topic!: string;

  @ApiProperty({ enum: NotificationSubscriptionMode })
  @IsEnum(NotificationSubscriptionMode)
  mode!: NotificationSubscriptionMode;

  @ApiPropertyOptional({
    enum: NotificationChannel,
    isArray: true,
    description: 'Silence only these channels; omit to silence the topic entirely.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsEnum(NotificationChannel, { each: true })
  mutedChannels?: NotificationChannel[];
}

export class BroadcastPreviewDto {
  @ApiProperty({
    description:
      'Audience selectors, e.g. [{"kind":"ALL_SELLERS"}] or [{"kind":"STAFF_PERMISSION","permission":"warehouse.pack"}]',
    isArray: true,
    type: Object,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsObject({ each: true })
  audience!: Record<string, unknown>[];

  @ApiProperty({ enum: NotificationCategory })
  @IsEnum(NotificationCategory)
  category!: NotificationCategory;

  @ApiProperty({ enum: NotificationChannel, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsEnum(NotificationChannel, { each: true })
  channels!: NotificationChannel[];
}

export class SendBroadcastDto extends BroadcastPreviewDto {
  @ApiProperty({ minLength: 3, maxLength: 160 })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @ApiProperty({ minLength: 3, maxLength: 4000 })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({
    description:
      'How many people the sender was shown. A mismatch refuses the send rather than surprising them.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRecipientCount?: number;
}

/**
 * The STORE's own say about one category (2026-09-19).
 *
 * Both switches are REQUIRED rather than optional: a PUT that left one
 * out would have to mean "keep whatever it was", which makes the body's
 * meaning depend on stored state nobody sent — and the screen always
 * knows both, because it renders both.
 */
export class SetStoreNotificationPreferenceDto {
  @ApiProperty({ enum: StoreNotificationCategory })
  @IsEnum(StoreNotificationCategory)
  category!: StoreNotificationCategory;

  @ApiProperty({ description: 'May this category be emailed to the store at all?' })
  @IsBoolean()
  emailEnabled!: boolean;

  @ApiProperty({ description: 'May it reach the bells of the people at this store?' })
  @IsBoolean()
  inAppEnabled!: boolean;
}
