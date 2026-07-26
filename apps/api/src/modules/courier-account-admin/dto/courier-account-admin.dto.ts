import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CredentialEnvironment } from '@skydrop/db';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCourierAccountDto {
  @ApiProperty({ description: 'Existing Courier.code, e.g. "delhivery"' })
  @IsString()
  @MinLength(1)
  courierCode!: string;

  @ApiProperty({ enum: CredentialEnvironment })
  @IsEnum(CredentialEnvironment)
  environment!: CredentialEnvironment;

  @ApiProperty({ description: 'Human label distinguishing this account, e.g. "Delhivery — Account 2"' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @ApiProperty({
    description:
      'Raw credential fields to encrypt at rest (e.g. { apiKey, clientId }). Field NAMES are audited on every decrypt; values never are.',
  })
  @IsObject()
  credentialFields!: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Make this the DEFAULT account for the (courier, environment) pair — sellers with no explicit link route here. At most one default per pair.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateCourierAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Promote to DEFAULT for its (courier, environment) pair.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class LinkSellerCourierAccountDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  courierAccountId!: string;

  @ApiPropertyOptional({ description: 'Relative share of this seller\'s parcels routed here (default 100).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  distributionWeight?: number;
}

export class UpdateSellerCourierAccountLinkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  distributionWeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
