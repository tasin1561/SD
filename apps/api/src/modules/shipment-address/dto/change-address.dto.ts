import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * What a courier will let us correct on a moving parcel.
 *
 * City, state and pincode are deliberately ABSENT rather than optional:
 * the edit API has no parameter for them, and could not honour one — the
 * parcel has already been sorted against that pincode and is physically
 * somewhere because of it. Accepting them here would be taking a promise
 * we cannot keep.
 */
export class ChangeConsigneeDto {
  @ApiPropertyOptional({ description: "The customer's name, as the courier should have it." })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'E.164, e.g. +919876500000.' })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Phone must be E.164 — a + and the country code, e.g. +919876500000.',
  })
  phone?: string;

  @ApiPropertyOptional({
    description:
      'The street address only. City, state and pincode cannot change — the parcel is already routed on them.',
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(250)
  addressLine1?: string;
}
