import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ChooseCourierDto {
  @ApiProperty({
    description:
      'The aggregator’s id for the carrier. Must be one of the options recorded against this parcel — anything else is refused rather than sent on, because a carrier that was never quoted for this lane comes back as an unexplained booking failure.',
    example: 1,
  })
  @IsInt()
  @Min(1)
  courierCompanyId!: number;
}
