import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** E.164 — the same shape the order DTO and CustomerService enforce. */
const E164 = /^\+[1-9]\d{7,14}$/;

export class CustomerLookupQueryDto {
  @ApiProperty({
    description:
      'Recipient phone in E.164 (+91…). Normalise before calling: a seller typing a local format and silently matching nothing is worse than an error.',
    example: '+919876543210',
  })
  @IsString()
  @Matches(E164, { message: 'phoneE164 must be E.164, e.g. +919876543210' })
  phoneE164!: string;
}
