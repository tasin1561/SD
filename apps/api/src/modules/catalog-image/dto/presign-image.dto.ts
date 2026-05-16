import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { ALLOWED_IMAGE_MIME } from '../image-key';

export class PresignImageDto {
  @ApiProperty({
    enum: ALLOWED_IMAGE_MIME,
    description: 'MIME type of the image to upload (jpeg/png/webp only)',
  })
  @IsString()
  @IsIn(ALLOWED_IMAGE_MIME as readonly string[])
  mimeType!: string;
}
