import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddTicketNoteDto {
  @ApiProperty({
    description:
      'What to tell the seller. This is shown to them verbatim on the ticket, so write it to be read by them rather than as an internal shorthand.',
    example: 'We rang the customer — they will be home Saturday and asked us to try again then.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note!: string;
}
