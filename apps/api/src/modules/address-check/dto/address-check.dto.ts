import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * What the browser may ask us to check.
 *
 * Note what is NOT here, and cannot be added by accident: the
 * customer's name, phone or email. The request body sent onward is
 * assembled field by field in `buildValidateBody` from named scalars,
 * so even a DTO that grew a field could not carry one into the payload
 * — but the DTO is the first of the two guards and is kept narrow for
 * the same reason.
 */
export class CheckAddressDto {
  @ApiProperty({
    description:
      'The draft id the page minted when it opened. One per order form — billing is one unit per reference per month, so a refresh must reuse it rather than mint a new one.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^draft-[A-Za-z0-9-]{8,}$/, {
    message: 'referenceId must look like draft-<uuid>',
  })
  referenceId!: string;

  @ApiProperty({ description: 'The address as the operator typed it, 3-500 characters' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  address!: string;

  @ApiProperty({ example: '743383' })
  @IsString()
  @Matches(/^[1-9]\d{5}$/, { message: 'pincode must be six digits and not start with 0' })
  pincode!: string;

  @ApiPropertyOptional({
    description:
      'Only when the console has a SEPARATE landmark field. The client console does not — there line 2 is the landmark and is already inside `address`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  @ApiProperty({ enum: ['cod', 'prepaid'] })
  @IsIn(['cod', 'prepaid'])
  paymentType!: 'cod' | 'prepaid';
}

export class PincodeParamDto {
  @ApiProperty({ example: '743383' })
  @IsString()
  @Matches(/^[1-9]\d{5}$/, { message: 'pincode must be six digits and not start with 0' })
  pincode!: string;
}
