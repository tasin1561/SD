import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateCategoryProposalDto {
  @ApiProperty({ example: 'Premium Apparel', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  proposedName!: string;

  @ApiProperty({
    example: 'premium-apparel',
    description: 'Lowercase kebab; must be unique among categories',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(140)
  @Matches(SLUG, { message: 'proposedSlug must be lowercase alphanumeric with single hyphens' })
  proposedSlug!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Existing category to nest under; omit/null = root',
  })
  @IsOptional()
  @IsUUID('7')
  proposedParentId?: string;

  @ApiProperty({ minLength: 10, maxLength: 2000, description: 'Why this category is needed' })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  rationale!: string;
}
