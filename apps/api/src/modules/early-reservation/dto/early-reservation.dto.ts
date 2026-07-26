import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideReviewDto {
  @ApiProperty({
    enum: ['RELEASE', 'REQUEST_MORE_ATTEMPTS'],
    description:
      'RELEASE gives the held stock back. REQUEST_MORE_ATTEMPTS keeps the hold and re-opens the call queue for this order.',
  })
  @IsIn(['RELEASE', 'REQUEST_MORE_ATTEMPTS'])
  readonly decision!: 'RELEASE' | 'REQUEST_MORE_ATTEMPTS';

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly note?: string;
}
