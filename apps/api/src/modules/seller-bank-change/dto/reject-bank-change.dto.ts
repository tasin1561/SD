import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectBankChangeDto {
  @ApiProperty({
    description:
      'Why the change is refused. The SELLER reads this word for word, so it has to say what did not match or what is needed — "rejected" on its own just sends the same request back.',
    minLength: 10,
    maxLength: 500,
  })
  @IsString()
  @MinLength(10, {
    message: 'reason must be at least 10 characters — the seller reads it verbatim',
  })
  @MaxLength(500)
  readonly reason!: string;
}
