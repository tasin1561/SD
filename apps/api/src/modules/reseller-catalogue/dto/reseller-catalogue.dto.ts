import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ResellerStockMode } from '@skydrop/db';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_MESSAGE = 'Must be a rupee amount of zero or more, with at most two decimals';

/** A reseller price row (RS-3). The service applies the ordering rules. */
export class ResellerPriceDto {
  @Matches(MONEY, { message: `transferPriceInr: ${MONEY_MESSAGE}` })
  transferPriceInr!: string;

  @IsOptional()
  @Matches(MONEY, { message: `minRetailInr: ${MONEY_MESSAGE}` })
  minRetailInr?: string | null;

  @IsOptional()
  @Matches(MONEY, { message: `maxRetailInr: ${MONEY_MESSAGE}` })
  maxRetailInr?: string | null;

  @IsOptional()
  @Matches(MONEY, { message: `suggestedRetailInr: ${MONEY_MESSAGE}` })
  suggestedRetailInr?: string | null;
}

/** One store's whole set of terms for one variant — written as a PUT. */
export class SaveStoreTermsDto {
  @IsBoolean()
  enabled!: boolean;

  /** null or absent ⇒ no override; the seller's default price applies. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ResellerPriceDto)
  priceOverride?: ResellerPriceDto | null;

  @IsEnum(ResellerStockMode)
  stockMode!: ResellerStockMode;

  /** Required when SET_ASIDE; ignored (stored NULL) when SHARED. */
  @ValidateIf((o: SaveStoreTermsDto) => o.stockMode === ResellerStockMode.SET_ASIDE)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  setAsideQty?: number | null;

  @IsInt()
  @Min(0)
  @Max(90)
  hiddenPercent!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  overlayTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  overlayDescription?: string | null;
}

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export class PresignOverlayImageDto {
  @IsIn(IMAGE_MIMES)
  mimeType!: string;
}

export class RegisterOverlayImageDto {
  @IsString()
  @MaxLength(300)
  storageKey!: string;

  @IsIn(IMAGE_MIMES)
  mimeType!: string;
}
