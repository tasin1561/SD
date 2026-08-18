import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * Bank details are nullable on the seller row (Phase 1B feature). Every
 * field here is optional at the DTO level: this is a PATCH, so passing
 * null clears a field and undefined leaves it unchanged.
 *
 * The ALL-OR-NOTHING rule — if any of the six is set, all six must be —
 * is NOT expressible here. A class-validator rule sees only the request
 * body, and the body carries just the fields the seller edited; whether
 * the row ends up complete depends on the five columns it did not
 * mention. So the rule lives in `SellerProfileService.updateBankDetails`,
 * evaluated against the MERGE of this patch onto the stored row, inside
 * the same transaction as the write.
 *
 * Format validation stays shape-only — KYC/format checks land with the
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

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Branch the account is held at — routing is branch-scoped.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankBranchName?: string | null;

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
  @MinLength(1)
  @MaxLength(32)
  bankRoutingNumber?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  bankSwiftCode?: string | null;
}
