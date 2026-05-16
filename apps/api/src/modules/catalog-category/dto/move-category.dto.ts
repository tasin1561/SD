import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class MoveCategoryDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'New parent id. null moves the category to the root.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('7')
  newParentId!: string | null;
}
