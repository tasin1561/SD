import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RequestBinCollapseDto {
  @ApiProperty({
    minLength: 30,
    description:
      'Why. At least 30 characters — this is the only explanation anyone reading the audit log later will have.',
  })
  @IsString()
  @MinLength(30)
  @MaxLength(1000)
  reason!: string;
}

export class ConfirmBinCollapseDto {
  @ApiProperty()
  @IsUUID('7')
  challengeId!: string;

  @ApiProperty({ description: 'The six-digit code emailed to you' })
  @IsString()
  @Length(6, 6)
  code!: string;

  @ApiProperty({ description: 'Type the warehouse code exactly, to prove you meant this one' })
  @IsString()
  @MaxLength(32)
  typedWarehouseCode!: string;
}

export class BulkTransferLineDto {
  @ApiProperty()
  @IsUUID('7')
  sellerId!: string;

  @ApiProperty()
  @IsUUID('7')
  variantId!: string;

  @ApiProperty({ description: 'Unchanged by the move — a transfer answers WHERE, not WHAT' })
  @IsUUID('7')
  batchId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number;

  @ApiProperty()
  @IsUUID('7')
  sourceBinId!: string;

  @ApiProperty()
  @IsUUID('7')
  destBinId!: string;
}

export class BulkTransferDto {
  @ApiProperty({ type: [BulkTransferLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkTransferLineDto)
  lines!: BulkTransferLineDto[];
}

export class MoveWholeBinDto {
  @ApiProperty({ description: 'Where everything currently in the source bin is going' })
  @IsUUID('7')
  destBinId!: string;
}
