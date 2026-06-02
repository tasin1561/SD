import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/**
 * Phase 1A create payload — URL + display name + subscribed events.
 * Secret is server-generated (32 random bytes hex). Hostname is
 * not restricted yet; sellers can subscribe to whatever event
 * codes they want — we don't validate them against a fixed set
 * because the M11 event vocabulary is large and the seller will
 * filter at their end (the schema's `subscribedEvents` array is
 * a free-form string[]).
 */
export class CreateWebhookEndpointDto {
  @ApiProperty({ example: 'https://example.com/skydrop/webhooks' })
  @IsUrl(
    { protocols: ['https'], require_protocol: true, require_tld: false },
    { message: 'url must be a https URL' },
  )
  @MaxLength(2048)
  url!: string;

  @ApiProperty({ required: false, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    type: [String],
    description: 'Event codes to subscribe to (e.g. order.confirmed, shipment.dispatched).',
    example: ['order.confirmed', 'shipment.dispatched', 'shipment.delivered'],
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  subscribedEvents!: string[];

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
