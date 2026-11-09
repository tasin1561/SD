import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PresignOrderCsvDto {
  @ApiProperty({ example: 'orders-batch.csv' })
  @IsString()
  @MaxLength(255)
  @Matches(/\.(csv|xlsx)$/i, { message: 'fileName must end in .csv or .xlsx' })
  fileName!: string;
}

export class PreviewOrderCsvDto {
  @ApiProperty({ description: 'spacesKey returned by the presign call' })
  @IsString()
  @MaxLength(512)
  spacesKey!: string;

  @ApiProperty({
    required: false,
    additionalProperties: true,
    description:
      'Optional manual mapping override (order field → CSV header), merged over auto-detect.',
  })
  @IsOptional()
  @IsObject()
  mappingOverride?: Record<string, string>;
}

export class ProcessOrderCsvDto {
  @ApiProperty({ description: 'spacesKey returned by the presign call' })
  @IsString()
  @MaxLength(512)
  spacesKey!: string;

  @ApiProperty({ example: 'orders-batch.csv' })
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    required: false,
    additionalProperties: true,
    description: 'Optional manual mapping override (order field → CSV header)',
  })
  @IsOptional()
  @IsObject()
  mappingOverride?: Record<string, string>;

  /**
   * The client's deliberate answer to `IMPORT_OVERSELLS_HELD_STOCK`.
   *
   * Sending `true` is ONE act with two steps, in this order: it switches
   * this client's `inventory.early_reservation_enabled` override to false
   * — account-wide and lasting, which the refusal says in its own
   * sentence — and then imports the file. It is honoured ONLY when the
   * file really does oversell and the setting really is on; otherwise it
   * is ignored, so a stale flag from an earlier preview can never change
   * an account on its own.
   */
  @ApiProperty({
    required: false,
    description:
      'Switch "Book Stock At Order Placement" off for this client and then import. Only ' +
      'honoured when the file oversells and that setting is on; needs the holds.manage permission.',
  })
  @IsOptional()
  @IsBoolean()
  switchToConfirmationHold?: boolean;
}

export class ListOrderCsvUploadsQueryDto {
  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
