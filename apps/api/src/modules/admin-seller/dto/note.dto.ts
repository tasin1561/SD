import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { SellerNoteCategory } from '@skydrop/db';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSellerNoteDto {
  @ApiProperty({ enum: SellerNoteCategory, default: SellerNoteCategory.GENERAL })
  @IsEnum(SellerNoteCategory)
  category!: SellerNoteCategory;

  @ApiProperty({ minLength: 2, maxLength: 4000 })
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  content!: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

export class UpdateSellerNoteDto {
  @ApiProperty({ required: false, minLength: 2, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  content?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

export class ListSellerNotesQueryDto {
  @ApiProperty({ required: false, enum: SellerNoteCategory })
  @IsOptional()
  @IsEnum(SellerNoteCategory)
  category?: SellerNoteCategory;

  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
