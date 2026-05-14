import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * Bank details are nullable on the seller row (Phase 1B feature). All
 * fields are optional; passing null clears a field, undefined leaves it
 * unchanged. Validation is shape-only — KYC/format checks land with the
 * remittance flow in Phase 1B.
 */
export class UpdateSellerBankDetailsDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankAccountName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  bankAccountNumber?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(32)
  bankRoutingNumber?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(16)
  bankSwiftCode?: string | null;
}
