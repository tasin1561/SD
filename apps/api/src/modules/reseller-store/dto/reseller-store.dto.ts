import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ResellerStoreActionMode, ResellerWalletManager } from '@skydrop/db';
import { STORE_ROLE_KEYS, type StoreRoleKey } from '../../../common/auth/store-permissions';

/** E.164, the only phone shape stored anywhere (General rule 2). */
const E164 = /^\+[1-9]\d{7,14}$/;

export class InviteStoreUserDto {
  @ApiProperty({ example: 'owner@mystore.in' })
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Priya Sharma' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ enum: STORE_ROLE_KEYS, example: 'owner' })
  @IsIn(STORE_ROLE_KEYS)
  roleKey!: StoreRoleKey;
}

class ResellerStoreFieldsDto {
  @ApiProperty({ example: 'Kolkata Kurtas', description: 'Unique among this seller’s stores' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ description: 'The name customers will see; defaults to `name`' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  // REQUIRED since 2026-09-16 (owner). A store we cannot reach is a
  // store nobody can chase when its parcels go wrong — and both halves
  // matter: the email carries its invitation and every notice, the phone
  // is how anybody rings them about a live parcel.
  @ApiProperty({ example: 'hello@mystore.in' })
  @IsEmail({}, { message: 'contactEmail must be a valid address' })
  @MaxLength(254)
  contactEmail!: string;

  @ApiProperty({ example: '+919812345678', description: 'E.164' })
  @Matches(E164, { message: 'contactPhone must be E.164, e.g. +919812345678' })
  contactPhone!: string;

  @ApiPropertyOptional({ enum: ResellerWalletManager, default: ResellerWalletManager.SELLER })
  @IsOptional()
  @IsEnum(ResellerWalletManager)
  walletManagedBy?: ResellerWalletManager;

  @ApiPropertyOptional({ description: 'A note for yourselves; never shown to the store' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** The seller creates a store for themselves — it is ACTIVE at once. */
export class CreateResellerStoreDto extends ResellerStoreFieldsDto {
  // REQUIRED since 2026-09-16 (owner): without an invitation nobody can
  // sign in, so the store is not onboarded — it is a row that looks open
  // and can do nothing. The first user is its owner.
  @ApiProperty({ type: InviteStoreUserDto, description: 'Invite the store’s first user' })
  @ValidateNested()
  @Type(() => InviteStoreUserDto)
  invite!: InviteStoreUserDto;
}

/** Skydrop creates a store FOR a seller — it waits for the seller's approval. */
export class AdminCreateResellerStoreDto extends ResellerStoreFieldsDto {
  @ApiProperty({ description: 'The seller this store will resell for' })
  @IsUUID()
  sellerId!: string;
}

export class ApproveResellerStoreDto {
  // The other half of the same rule: an admin-created store has no team
  // until the seller agrees to it, so the invitation arrives HERE, and
  // it is required for the same reason (2026-09-16, owner).
  @ApiProperty({ type: InviteStoreUserDto, description: 'Invite the store’s first user' })
  @ValidateNested()
  @Type(() => InviteStoreUserDto)
  invite!: InviteStoreUserDto;
}

export class ResellerStoreReasonDto {
  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10, { message: 'reason must be at least 10 characters' })
  @MaxLength(500)
  reason!: string;
}

export class OptionalReasonDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SetWalletManagerDto {
  @ApiProperty({ enum: ResellerWalletManager })
  @IsEnum(ResellerWalletManager)
  walletManagedBy!: ResellerWalletManager;
}

/**
 * What the store may do about an order on its own (2026-09-16).
 *
 * Every capability is REQUIRED: a save states the whole policy, so there
 * is no question of what an absent field meant — the screen sends what it
 * showed. For `reattempt` and `sendBack`, DIRECT means the store may ask
 * without the seller; the Skydrop operator gate (CUR-10) stays either way.
 */
export class SetStoreActionPolicyDto {
  @ApiProperty({ enum: ResellerStoreActionMode, description: 'Phone the customer again' })
  @IsEnum(ResellerStoreActionMode)
  recall!: ResellerStoreActionMode;

  @ApiProperty({
    enum: ResellerStoreActionMode,
    description:
      'Change the order — the customer’s details, what is in it, and the money the customer pays',
  })
  @IsEnum(ResellerStoreActionMode)
  orderChange!: ResellerStoreActionMode;

  @ApiProperty({ enum: ResellerStoreActionMode, description: 'Call the order off' })
  @IsEnum(ResellerStoreActionMode)
  cancel!: ResellerStoreActionMode;

  @ApiProperty({ enum: ResellerStoreActionMode, description: 'Answer the call-cap review' })
  @IsEnum(ResellerStoreActionMode)
  callCapDecision!: ResellerStoreActionMode;

  @ApiProperty({ enum: ResellerStoreActionMode, description: 'Raise it with Skydrop' })
  @IsEnum(ResellerStoreActionMode)
  chaseSkydrop!: ResellerStoreActionMode;

  @ApiProperty({ enum: ResellerStoreActionMode, description: 'Ask the courier to try again' })
  @IsEnum(ResellerStoreActionMode)
  reattempt!: ResellerStoreActionMode;

  @ApiProperty({ enum: ResellerStoreActionMode, description: 'Send it back' })
  @IsEnum(ResellerStoreActionMode)
  sendBack!: ResellerStoreActionMode;
}

export class UpdateStoreProfileDto {
  @ApiPropertyOptional({
    description: 'Empty string clears it (customers then see the store name)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({ description: 'Empty string clears it' })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  contactEmail?: string;

  @ApiPropertyOptional({ description: 'E.164; empty string clears it' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;
}

const LOGO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

export class PresignStoreLogoDto {
  @ApiProperty({ enum: LOGO_MIME })
  @IsIn(LOGO_MIME)
  mimeType!: (typeof LOGO_MIME)[number];
}

export class RegisterStoreLogoDto {
  @ApiProperty({ description: 'storageKey returned by /logo/presign' })
  @IsString()
  @MaxLength(300)
  storageKey!: string;

  @ApiProperty({ enum: LOGO_MIME })
  @IsIn(LOGO_MIME)
  mimeType!: (typeof LOGO_MIME)[number];
}

export class ChangeStoreMemberRoleDto {
  @ApiProperty({ enum: STORE_ROLE_KEYS })
  @IsIn(STORE_ROLE_KEYS)
  roleKey!: StoreRoleKey;
}
