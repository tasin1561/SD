import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { DeliveryActionKind, OrderCancellationReason } from '@skydrop/db';

/** At most this many orders per bulk click. */
export const BULK_MAX = 200;

export class BulkIdsDto {
  @ApiProperty({ type: [String], description: `1 to ${BULK_MAX} ids.` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX)
  @IsUUID('all', { each: true })
  orderIds!: string[];

  @ApiProperty({
    description:
      'A fresh random value per click (e.g. a UUID). Sending the same value again returns the first result instead of running twice.',
  })
  @IsString()
  @Length(8, 100)
  idempotencyKey!: string;
}

export class BulkCancelDto extends BulkIdsDto {
  @ApiPropertyOptional({ enum: OrderCancellationReason })
  @IsOptional()
  @IsEnum(OrderCancellationReason)
  reason?: OrderCancellationReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class BulkCancelRequestDto extends BulkIdsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class BulkDeliveryActionDto extends BulkIdsDto {
  @ApiProperty({ enum: DeliveryActionKind })
  @IsEnum(DeliveryActionKind)
  action!: DeliveryActionKind;

  @ApiProperty({ description: 'One reason for every selected parcel.' })
  @IsString()
  @Length(1, 500)
  reason!: string;
}

/** Staff decide clients' requests in bulk — ids here are REQUEST ids. */
export class BulkDecideDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX)
  @IsUUID('all', { each: true })
  requestIds!: string[];

  @ApiProperty()
  @IsString()
  @Length(8, 100)
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'Required (5+ chars) to reject; shown to the client.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
