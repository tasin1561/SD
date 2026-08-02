import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsUUID } from 'class-validator';

export class ListStagedRowsQueryDto {
  @ApiPropertyOptional({ description: 'Narrow to one upload' })
  @IsOptional()
  @IsUUID('7')
  uploadId?: string;
}

export class PatchStagedRowDto {
  @ApiProperty({
    description:
      'The fields to set, merged over what the file supplied. The whole row is re-validated afterwards.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  data!: Record<string, unknown>;
}
