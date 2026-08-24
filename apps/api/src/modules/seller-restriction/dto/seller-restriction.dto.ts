import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SellerCapability } from '@skydrop/db';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumberString,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ApplyRestrictionDto {
  @ApiProperty({ enum: SellerCapability, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(SellerCapability, { each: true })
  readonly capabilities!: SellerCapability[];

  @ApiProperty({
    description:
      'The wallet balance that lifts the hold automatically. Usually 0 — the point at which they ' +
      'no longer owe us.',
  })
  @IsNumberString()
  readonly clearAtBalanceInr!: string;

  @ApiProperty({
    description: 'Shown to the SELLER, so write it as you would say it to them.',
    minLength: 20,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  readonly reason!: string;
}

export class LiftRestrictionDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  readonly reason!: string;
}
