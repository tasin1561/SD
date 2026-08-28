import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryActionKind, DeliveryActionStatus } from '@skydrop/db';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class RequestDeliveryActionDto {
  @ApiProperty({
    enum: DeliveryActionKind,
    description:
      'REATTEMPT asks the courier to try again. RECALL asks OUR agents to phone the customer. ' +
      'RTO sends it back. The first and last reach the courier and need an operator to approve.',
  })
  @IsEnum(DeliveryActionKind)
  readonly action!: DeliveryActionKind;

  @ApiProperty({
    description: 'What happened, in the seller’s words. An operator reads this before deciding.',
  })
  @IsString()
  @Length(10, 2000)
  readonly reason!: string;
}

export class DecideDeliveryActionDto {
  @ApiPropertyOptional({
    description: 'Why. Required on a rejection — a refusal without a reason is unanswerable.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  readonly note?: string;
}

export class ListDeliveryActionsQueryDto {
  @ApiPropertyOptional({ enum: DeliveryActionStatus })
  @IsOptional()
  @IsEnum(DeliveryActionStatus)
  readonly status?: DeliveryActionStatus;
}
