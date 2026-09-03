import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class HandoverScanDto {
  @ApiProperty({ description: 'The AWB printed on the label in the operator’s hand' })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  awbNumber!: string;
}
