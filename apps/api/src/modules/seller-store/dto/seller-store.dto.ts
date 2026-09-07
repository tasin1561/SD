import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStoreDto {
  @ApiProperty({ description: 'What you call this shopfront', maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  readonly name!: string;

  @ApiPropertyOptional({ description: 'A note to yourself about which channel this is' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly note?: string;
}

export class UpdateStoreDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  readonly name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly note?: string;
}

export class SetStoreActiveDto {
  @ApiProperty({ description: 'False closes the shopfront to NEW orders; past ones are untouched' })
  @IsBoolean()
  readonly isActive!: boolean;
}
