import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ALL_SELLER_API_KEY_SCOPES,
  SELLER_API_KEY_SCOPES,
} from '../../../common/auth/seller-api-key-scopes';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Production integration', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    required: false,
    description: 'Optional TTL in days. Omit for no expiry.',
    minimum: 1,
    maximum: 730,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  expiresInDays?: number;

  /**
   * REQUIRED, and at least one: a key with nothing ticked can do
   * nothing, so accepting one would mint a credential that fails on
   * first use with no hint as to why. The list is closed — an unknown
   * scope is refused here rather than silently dropped when permissions
   * are derived, because at CREATE time a typo is still fixable.
   */
  @ApiProperty({
    isArray: true,
    enum: ALL_SELLER_API_KEY_SCOPES,
    description:
      'What this key may reach. At least one. Money and identity — the wallet, withdrawals, ' +
      'the company profile and its bank account, the team, roles, other keys, webhooks, ' +
      'charges, freight and reseller stores — have no scope and are not reachable by a key.',
  })
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(ALL_SELLER_API_KEY_SCOPES.length)
  @ArrayUnique()
  @IsIn(ALL_SELLER_API_KEY_SCOPES, { each: true })
  scopes!: string[];
}

export class CreatedApiKeyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  keyPrefix!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true })
  expiresAt!: Date | null;

  @ApiProperty({ isArray: true, enum: ALL_SELLER_API_KEY_SCOPES })
  scopes!: string[];

  @ApiProperty({
    description:
      'Plaintext API key — shown ONLY ONCE in this response. Store it securely; it cannot be retrieved later.',
  })
  plaintext!: string;
}

export class ApiKeyListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: 'skd_AbCdEfGh', description: 'Displayable prefix (first 12 chars)' })
  keyPrefix!: string;

  @ApiProperty({ nullable: true })
  lastUsedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true })
  expiresAt!: Date | null;

  @ApiProperty({ nullable: true })
  revokedAt!: Date | null;

  @ApiProperty({ isArray: true, enum: ALL_SELLER_API_KEY_SCOPES })
  scopes!: string[];
}

/** The scope vocabulary, so the UI can label the boxes it draws. */
export class ApiKeyScopeDto {
  @ApiProperty({ example: 'orders:read' })
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  description!: string;
}

export const API_KEY_SCOPE_CATALOGUE: ApiKeyScopeDto[] = SELLER_API_KEY_SCOPES.map((s) => ({
  key: s.key,
  label: s.label,
  description: s.description,
}));
