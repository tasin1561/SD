import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, MinLength } from 'class-validator';

export class SetCourierActiveDto {
  @ApiProperty({
    description:
      'True lets this courier receive new parcels again. False stops NEW bookings only — parcels they already hold keep being tracked and can still be cancelled or re-attempted, because going quiet on a moving parcel is worse than not booking more.',
  })
  @IsBoolean()
  isActive!: boolean;

  @ApiProperty({
    description:
      'Why. Switching a courier off diverts every parcel that would have gone to them, so the reason belongs in the audit trail next to the change.',
    minLength: 10,
  })
  @IsString()
  @MinLength(10)
  reason!: string;
}
