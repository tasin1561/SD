import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length } from 'class-validator';

export class CreateManifestDto {
  @ApiProperty({ description: "The courier this manifest is for, e.g. 'delhivery'" })
  @IsString()
  @Length(2, 40)
  readonly courierCode!: string;

  @ApiProperty({ description: 'The warehouse the van collects from' })
  @IsUUID('7')
  readonly originWarehouseId!: string;
}
