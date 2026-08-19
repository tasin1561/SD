import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ConsignmentRoute, ConsignmentStatus, LabellingSite } from '@skydrop/db';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class DeclareConsignmentLineDto {
  @ApiProperty()
  @IsUUID('7')
  variantId!: string;

  @ApiProperty({ minimum: 1, description: 'Units the seller expects to ship' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  expectedQty!: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCostInr?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  manufacturedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class DeclareConsignmentDto {
  @ApiProperty({
    enum: ConsignmentRoute,
    description:
      'DIRECT_IN — you ship straight to the Indian warehouse. ' +
      'VIA_BD — you ship to our Bangladesh warehouse and we move it to India.',
  })
  @IsEnum(ConsignmentRoute)
  route!: ConsignmentRoute;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expectedArrivalAt?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sellerReference?: string;

  @ApiProperty({ type: [DeclareConsignmentLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeclareConsignmentLineDto)
  lines!: DeclareConsignmentLineDto[];
}

export class ListConsignmentsQueryDto {
  @ApiPropertyOptional({ enum: ConsignmentStatus })
  @IsOptional()
  @IsEnum(ConsignmentStatus)
  status?: ConsignmentStatus;

  @ApiPropertyOptional({ enum: ConsignmentRoute })
  @IsOptional()
  @IsEnum(ConsignmentRoute)
  route?: ConsignmentRoute;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('7')
  sellerId?: string;

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

export class SetLabellingSiteDto {
  @ApiProperty({
    enum: LabellingSite,
    description:
      'Where barcode labels are printed for this consignment. ONE station only, ' +
      'and locked once the first label has been printed.',
  })
  @IsEnum(LabellingSite)
  site!: LabellingSite;
}

export class DispatchLineDto {
  @ApiProperty({ description: 'The BD intake line these units were counted on' })
  @IsUUID('7')
  lineId!: string;

  @ApiProperty({ minimum: 1, description: 'Units leaving Bangladesh on this shipment' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

export class DispatchToIndiaDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Send it on WITHOUT counting in Bangladesh. The carton is forwarded on the ' +
      "seller's declared quantities and India becomes the first and only count. " +
      'Omit `lines` when using this — the declaration is what travels.',
  })
  @IsOptional()
  @IsBoolean()
  withoutCounting?: boolean;

  @ApiPropertyOptional({
    type: [DispatchLineDto],
    description:
      'What is physically leaving. A consignment may be dispatched in several ' +
      'shipments — each becomes its own India leg with its own arrival count. ' +
      'Required unless `withoutCounting` is set, in which case the whole ' +
      'declaration travels and there is nothing to choose from.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispatchLineDto)
  lines?: DispatchLineDto[];

  @ApiPropertyOptional({ description: 'Expected arrival in India' })
  @IsOptional()
  @IsDateString()
  etaAt?: string;

  @ApiPropertyOptional({ maxLength: 120, description: "The forwarder's own reference" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

export class CancelConsignmentDto {
  @ApiProperty({
    minLength: 10,
    maxLength: 500,
    description: 'Why the goods are going back to the seller. Recorded permanently.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
