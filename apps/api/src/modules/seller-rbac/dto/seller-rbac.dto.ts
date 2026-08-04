import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length } from 'class-validator';

export class CreateSellerRoleDto {
  @ApiProperty({ example: 'Warehouse clerk' })
  @IsString()
  @Length(2, 60)
  name!: string;

  @ApiPropertyOptional({ example: 'Sends stock in and checks what arrived.' })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;

  @ApiProperty({ isArray: true, type: String })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  permissions!: string[];
}

export class UpdateSellerRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;

  /** Omit to leave permissions alone; send the FULL intended set to replace them. */
  @ApiPropertyOptional({ isArray: true, type: String })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  permissions?: string[];
}
