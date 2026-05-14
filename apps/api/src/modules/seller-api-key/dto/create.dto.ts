import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

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
}
