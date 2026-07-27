import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ALLOWED_IMAGE_MIME } from '../image-key';

export class RegisterImageDto {
  @ApiProperty({ description: 'The exact spacesKey returned by the presign call' })
  @IsString()
  @MaxLength(512)
  spacesKey!: string;

  @ApiProperty({ enum: ALLOWED_IMAGE_MIME })
  @IsString()
  @IsIn(ALLOWED_IMAGE_MIME as readonly string[])
  mimeType!: string;

  @ApiProperty({ minimum: 1, description: 'Client-reported size; verified against Spaces HEAD' })
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
