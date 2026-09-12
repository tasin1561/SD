import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RecordRechargeBankSideDto {
  @ApiProperty({ description: 'Which of our accounts the money left' })
  @IsUUID()
  bankAccountId!: string;

  @ApiPropertyOptional({ description: 'Anything worth saying about this payment' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ResolveRechargeDto {
  @ApiProperty({
    description:
      'What this recharge actually was. The only record of why money at the courier ' +
      'has no payment of ours behind it.',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  reason!: string;
}

export class RecordOutgoingRechargeDto {
  @ApiProperty()
  @IsUUID()
  bankAccountId!: string;

  @ApiProperty({ description: 'Which courier wallet was topped up' })
  @IsUUID()
  courierAccountId!: string;

  @ApiProperty({ example: '20000.00' })
  // A string, not a number: a rupee figure through JSON's float is how
  // 20000.10 becomes 20000.099999999999.
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'Amount must be a number with up to 2 decimals' })
  amountInr!: string;

  @ApiProperty({ description: 'When the bank actually moved it' })
  @IsDateString()
  occurredAt!: string;

  @ApiProperty({
    description:
      "The bank's own transaction reference — what the courier prints beside their " +
      'recharge, and the only thing the two sides are matched on.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reference!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description:
      'The client’s key for this request, generated once when the form opens. A replay with the same key returns the original entry and records nothing.',
  })
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;
}

export class ListRechargesQueryDto {
  @ApiPropertyOptional({ enum: ['UNRECORDED', 'MATCHED', 'AMOUNT_MISMATCH', 'RESOLVED'] })
  @IsOptional()
  @IsIn(['UNRECORDED', 'MATCHED', 'AMOUNT_MISMATCH', 'RESOLVED'])
  matchState?: 'UNRECORDED' | 'MATCHED' | 'AMOUNT_MISMATCH' | 'RESOLVED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courierAccountId?: string;
}
