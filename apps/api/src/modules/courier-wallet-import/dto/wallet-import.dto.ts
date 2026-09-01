import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
