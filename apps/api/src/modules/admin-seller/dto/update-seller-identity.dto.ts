import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const E164_BD = /^\+880\d{9,12}$/;

/**
 * A staff correction to the identity a seller was approved on.
 *
 * Both fields are optional because a correction is usually to one of
 * them — but the service refuses a call that changes NEITHER, so an
 * empty body cannot quietly write an audit row saying nothing happened.
 *
 * `reason` is the only required field, and it is required for a reason
 * that is not ceremony: this row is the sole record of why an approved
 * company name or phone number is no longer what an admin approved.
 * Whoever reads the audit trail later has nothing else to go on.
 */
export class UpdateSellerIdentityDto {
  @ApiPropertyOptional({ example: 'Nabeela Traders' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  readonly companyName?: string;

  @ApiPropertyOptional({ example: '+8801712345678' })
  @IsOptional()
  @IsString()
  @Matches(E164_BD, { message: 'phone must be E.164 BD format (e.g., +8801712345678)' })
  readonly phone?: string;

  @ApiProperty({
    description:
      'Why this identity is being corrected, and who asked. Stored on the audit row and nowhere else.',
    minLength: 20,
    maxLength: 500,
  })
  @IsString()
  @MinLength(20, {
    message:
      'reason must be at least 20 characters — it is the only record of why an approved identity changed',
  })
  @MaxLength(500)
  readonly reason!: string;
}
