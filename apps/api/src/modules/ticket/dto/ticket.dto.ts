import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketStatus } from '@skydrop/db';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSellerTicketDto {
  @ApiPropertyOptional({
    description:
      "The courier's own category for this problem. Chosen from GET /seller/tickets/issue-categories, so ops can triage without reading every sentence first.",
    example: 'damage-missing',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  issueCategoryExternalId?: string;

  @ApiPropertyOptional({
    description:
      "The subcategory, when the chosen category has any. Several go straight to the description — that is how the courier's own form behaves.",
    example: 'damage-missing.damage',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  issueSubcategoryExternalId?: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  readonly subject!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  readonly description?: string;

  @ApiPropertyOptional({ description: 'Order this issue is about.' })
  @IsOptional()
  @IsUUID()
  readonly orderId?: string;

  @ApiPropertyOptional({ description: 'Shipment/parcel this issue is about.' })
  @IsOptional()
  @IsUUID()
  readonly shipmentId?: string;
}

export class TransitionTicketDto {
  @ApiProperty({ enum: TicketStatus })
  @IsEnum(TicketStatus)
  readonly to!: TicketStatus;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly notes?: string;

  @ApiPropertyOptional({
    description:
      'Decimal string, up to 2dp. REQUIRED when `to` is RESOLVED_REFUND, and rejected for any other target status.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'refundAmountInr must be a decimal string with up to 2 decimal places',
  })
  readonly refundAmountInr?: string;
}
