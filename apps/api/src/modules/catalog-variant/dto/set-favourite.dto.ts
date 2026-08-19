import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetFavouriteVariantDto {
  @ApiProperty({ description: 'true to star it, false to unstar.' })
  @IsBoolean()
  isFavourite!: boolean;
}
