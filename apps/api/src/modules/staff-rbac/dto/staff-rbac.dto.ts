import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length } from 'class-validator';

export class CreateStaffRoleDto {
  @ApiProperty({ example: 'Warehouse manager' })
  @IsString()
  @Length(2, 60)
  name!: string;

  @ApiPropertyOptional({ example: 'Runs the floor and closes manifests.' })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;

  @ApiProperty({
    isArray: true,
    type: String,
    description: 'Permission keys from GET /admin/staff-roles/catalogue.',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  permissions!: string[];
}

export class UpdateStaffRoleDto {
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
