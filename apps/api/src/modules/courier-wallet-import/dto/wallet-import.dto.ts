import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsUUID, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ImportWalletLedgerDto {
  @ApiProperty({
    description:
      "The courier's wallet export (.xlsx), base64-encoded. Delhivery ONE → Finances → " +
      'Download Ledger. Export a MONTH at a time: the request body is capped at 1MB, and a ' +
      'monthly file is roughly a fifth of that.',
  })
  @IsString()
  @IsNotEmpty()
  fileBase64!: string;

  @ApiPropertyOptional({
    description:
      'Parse and report what WOULD change, writing nothing. Worth running first on any ' +
      'export you have not seen before.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description:
      "Import even when the rows do not add up to the file's own stated total. Only for a " +
      'known-partial export — otherwise the mismatch means the parse went wrong, and a wrong ' +
      'cost is worse than no cost.',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    description:
      "Which courier account's wallet this export is. Each account is its own company at " +
      'Delhivery with its own ledger, and every transaction is stored under the account it ' +
      'came from. Omitted, the default active Delhivery account is used — and the import is ' +
      'REFUSED if there is none, because a ledger stored under no account cannot be netted.',
  })
  @IsOptional()
  @IsUUID()
  courierAccountId?: string;
}
