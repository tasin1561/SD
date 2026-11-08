import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Bounds mirror `ops.call_auto_confirm_ttl_hours` (1-168); the resolver re-clamps at write time (SET-1). */
export class SetConfirmationCallsDto {
  @ApiProperty({ description: 'false = do not phone new orders automatically.' })
  @IsBoolean()
  callsRequired!: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 168 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  ttlHours?: number;
}
