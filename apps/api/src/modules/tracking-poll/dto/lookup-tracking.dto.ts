import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Length } from 'class-validator';

export class LookupTrackingDto {
  @ApiProperty({
    description:
      'AWB numbers to look up. Delhivery accepts at most 50 per call, so that is the cap here too.',
    example: ['38061110518534'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(4, 40, { each: true })
  awbNumbers!: string[];
}
