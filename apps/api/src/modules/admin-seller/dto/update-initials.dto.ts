import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class UpdateSellerInitialsDto {
  @ApiProperty({
    description:
      'The seller\'s operations short code, e.g. "MSt". 2-4 letters or digits. Must be unique across sellers — it is written on totes and read down manifests, so a code shared by two companies fails exactly where it is trusted.',
    example: 'MSt',
  })
  @Matches(/^[A-Za-z0-9]{2,4}$/, {
    message: 'Initials must be 2-4 letters or digits.',
  })
  initials!: string;
}
