import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export const MAX_CONFIRMATION_CALL_ORDERS = 100;

export class ListAwaitingConfirmationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class AdminListAwaitingConfirmationQueryDto extends ListAwaitingConfirmationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Narrow to one client.' })
  @IsOptional()
  @IsUUID('7')
  sellerId?: string;
}

export class SendConfirmationCallsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: MAX_CONFIRMATION_CALL_ORDERS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CONFIRMATION_CALL_ORDERS)
  @IsUUID('7', { each: true })
  orderIds!: string[];
}
