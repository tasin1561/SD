import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * A member of staff debiting or crediting a seller's wallet.
 *
 * Deliberately thin: the length of the reason, the amount's precision and
 * the account rules are the SERVICE's to refuse (FE-2 — the page shows the
 * verdict verbatim), so the DTO checks only the shape.
 */
export class WalletTransferDto {
  @ApiProperty({ description: 'The seller whose wallet moves' })
  @IsUUID('7')
  sellerId!: string;

  @ApiProperty({
    enum: ['DEBIT', 'CREDIT'],
    description:
      "DEBIT: take money out of the seller's wallet — the cash they hold with us becomes ours. " +
      "CREDIT: put our money into the seller's wallet, in the account you choose.",
  })
  @IsIn(['DEBIT', 'CREDIT'])
  direction!: 'DEBIT' | 'CREDIT';

  @ApiProperty({ description: 'Rupees, positive, at most two decimal places' })
  @IsNumberString()
  amountInr!: string;

  @ApiPropertyOptional({
    description:
      'CREDIT only: the rupee account whose capital becomes the seller’s. A debit takes their ' +
      'money wherever it already sits, so it names none.',
  })
  @IsOptional()
  @IsUUID('7')
  bankAccountId?: string;

  @ApiProperty({ description: 'Why — shown to the seller on their wallet history' })
  @IsString()
  @Length(1, 500)
  reason!: string;

  @ApiPropertyOptional({ description: 'For staff only; kept on the audit row' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  internalNote?: string;

  @ApiPropertyOptional({
    description:
      'One key per opening of the form. A retry with the same key returns the original ' +
      'transfer and moves nothing.',
  })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}
