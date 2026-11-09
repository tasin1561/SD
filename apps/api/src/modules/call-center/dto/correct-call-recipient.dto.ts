import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * What an agent may correct DURING a confirmation call. The phone is not
 * here and cannot be added: it is the customer's identity (ORD-7). City
 * and state are optional and may be '' (ORD-5); the landmark line may not
 * be cleared. Everything else (PIN format, allowed states, whether the
 * order may change at all) is the order module's call, not this DTO's.
 */
export class CorrectCallRecipientDto {
  @ApiProperty({ required: false, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipientName?: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientAddressLine1?: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'recipientAddressLine2 (landmark) may not be cleared' })
  @MaxLength(200)
  recipientAddressLine2?: string;

  @ApiProperty({ required: false, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientCity?: string;

  @ApiProperty({ required: false, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientStateProvince?: string;

  @ApiProperty({ required: false, example: '560001' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  recipientPostalCode?: string;
}
