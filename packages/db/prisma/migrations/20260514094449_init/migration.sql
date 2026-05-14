-- CreateEnum
CREATE TYPE "staff_role" AS ENUM ('super_admin', 'seller_approval_admin', 'call_agent', 'warehouse_staff', 'manual_placement_admin', 'finance');

-- CreateEnum
CREATE TYPE "seller_status" AS ENUM ('pending', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "currency" AS ENUM ('inr', 'bdt');

-- CreateEnum
CREATE TYPE "seller_note_category" AS ENUM ('general', 'rejection_reason', 'onboarding', 'compliance', 'complaint', 'payment');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('staff', 'seller', 'system', 'api');

-- CreateEnum
CREATE TYPE "address_owner_type" AS ENUM ('seller', 'warehouse', 'order', 'return_hub');

-- CreateEnum
CREATE TYPE "address_type" AS ENUM ('bd_origin', 'bd_office', 'in_return', 'in_warehouse', 'recipient');

-- CreateEnum
CREATE TYPE "warehouse_status" AS ENUM ('active', 'inactive', 'maintenance');

-- CreateEnum
CREATE TYPE "bin_type" AS ENUM ('storage', 'picking', 'receiving', 'packing', 'rto_hold', 'damaged', 'quarantine');

-- CreateEnum
CREATE TYPE "service_area" AS ENUM ('metro', 'tier1', 'tier2', 'rest', 'special_ne', 'special_jk');

-- CreateEnum
CREATE TYPE "pin_code_source" AS ENUM ('api_cache', 'manual_import', 'user_entered');

-- CreateEnum
CREATE TYPE "package_type" AS ENUM ('box', 'polybag', 'envelope', 'tube', 'custom');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('active', 'archived', 'draft');

-- CreateEnum
CREATE TYPE "variant_status" AS ENUM ('active', 'archived', 'out_of_stock');

-- CreateEnum
CREATE TYPE "batch_status" AS ENUM ('active', 'depleted', 'expired', 'recalled');

-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('receiving', 'put_away', 'pick', 'pack_confirm', 'dispatch', 'return_receive', 'return_restock', 'adjustment_increase', 'adjustment_decrease', 'transfer_out', 'transfer_in', 'cycle_count_adjust', 'expiry_write_off');

-- CreateEnum
CREATE TYPE "stock_movement_reason_code" AS ENUM ('damaged_on_arrival', 'damaged_in_warehouse', 'lost', 'found_extra', 'customer_refused', 'address_invalid', 'expired', 'recalled', 'counting_error', 'other');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('active', 'fulfilled', 'released');

-- CreateEnum
CREATE TYPE "reservation_release_reason" AS ENUM ('order_cancelled', 'call_cancelled', 'order_rejected_by_courier', 'expired', 'manual_release', 'stock_reallocated', 'other');

-- CreateEnum
CREATE TYPE "adjustment_type" AS ENUM ('increase', 'decrease', 'transfer', 'cycle_count');

-- CreateEnum
CREATE TYPE "adjustment_status" AS ENUM ('pending', 'approved', 'rejected', 'executed');

-- CreateEnum
CREATE TYPE "cycle_count_type" AS ENUM ('full', 'zone', 'sample', 'sku_targeted', 'abc_classification');

-- CreateEnum
CREATE TYPE "cycle_count_status" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "goods_receipt_status" AS ENUM ('pending', 'arriving', 'completed', 'discrepancy', 'cancelled');

-- CreateEnum
CREATE TYPE "customer_risk_level" AS ENUM ('none', 'low', 'medium', 'high', 'blocked');

-- CreateEnum
CREATE TYPE "order_source" AS ENUM ('manual', 'bulk_upload', 'api', 'admin');

-- CreateEnum
CREATE TYPE "payment_mode" AS ENUM ('cod', 'prepaid');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('draft', 'pending_confirmation', 'call_no_response', 'call_rescheduled', 'confirmed', 'cancelled', 'rejected', 'pending_pick', 'picked', 'packed', 'pack_failed', 'pending_dispatch', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'rto_initiated', 'rto_in_transit', 'rto_received', 'rto_restocked', 'rto_damaged', 'lost_in_transit', 'pending_manual_placement');

-- CreateEnum
CREATE TYPE "order_cancellation_reason" AS ENUM ('customer_requested', 'customer_unreachable', 'fake_order', 'wrong_address', 'out_of_stock', 'high_risk_customer', 'seller_requested', 'duplicate_order', 'no_courier_available', 'other');

-- CreateEnum
CREATE TYPE "order_event_type" AS ENUM ('created', 'status_changed', 'note_added', 'call_logged', 'stock_reserved', 'stock_released', 'picked', 'packed', 'courier_assigned', 'courier_rejected', 'manual_placement', 'awb_generated', 'dispatched', 'tracking_update', 'delivery_attempted', 'delivered', 'rto_initiated', 'rto_received', 'rto_restocked', 'adjustment', 'charge_added', 'charge_removed');

-- CreateEnum
CREATE TYPE "bulk_upload_status" AS ENUM ('pending', 'processing', 'completed', 'completed_with_errors', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "call_queue_status" AS ENUM ('waiting', 'assigned', 'in_progress', 'scheduled', 'closed');

-- CreateEnum
CREATE TYPE "assignment_method" AS ENUM ('auto_round_robin', 'manual', 'reassigned', 'agent_picked');

-- CreateEnum
CREATE TYPE "queue_closure_reason" AS ENUM ('order_confirmed', 'order_cancelled', 'order_rejected', 'max_attempts_exceeded', 'order_deleted', 'admin_closed');

-- CreateEnum
CREATE TYPE "call_outcome" AS ENUM ('confirmed', 'cancelled_by_customer', 'rescheduled', 'address_correction', 'item_correction', 'no_answer', 'busy', 'call_rejected', 'voicemail', 'wrong_number', 'phone_disconnected', 'language_barrier', 'technical_issue', 'fake_order', 'other');

-- CreateEnum
CREATE TYPE "shipment_status" AS ENUM ('created', 'awb_pending', 'awb_generated', 'failed_at_creation', 'handed_to_courier', 'in_transit', 'at_hub', 'out_for_delivery', 'delivery_attempted', 'delivered', 'rto_initiated', 'rto_in_transit', 'rto_delivered', 'lost', 'damaged', 'cancelled');

-- CreateEnum
CREATE TYPE "label_paper_size" AS ENUM ('a4', 'a6', 'thermal_4x6');

-- CreateEnum
CREATE TYPE "label_generation_reason" AS ENUM ('initial', 'reprint_damaged', 'awb_reissued', 'format_changed', 'manual_request');

-- CreateEnum
CREATE TYPE "tracking_event_type" AS ENUM ('awb_generated', 'courier_pickup_scheduled', 'courier_pickup_done', 'arrived_at_hub', 'departed_hub', 'in_transit_update', 'arrived_at_destination_hub', 'out_for_delivery', 'delivery_attempted', 'delivered', 'delivery_failed', 'address_issue', 'customer_requested_reschedule', 'customer_refused', 'rto_initiated', 'rto_in_transit', 'rto_delivered', 'lost', 'damaged', 'status_sync', 'manual_update');

-- CreateEnum
CREATE TYPE "tracking_event_source" AS ENUM ('courier_webhook', 'courier_poll', 'manual_entry', 'system', 'customer_report');

-- CreateEnum
CREATE TYPE "webhook_status" AS ENUM ('received', 'processed', 'ignored', 'failed', 'abandoned');

-- CreateEnum
CREATE TYPE "delivery_attempt_outcome" AS ENUM ('success', 'failed', 'rescheduled', 'refused', 'cancelled');

-- CreateEnum
CREATE TYPE "delivery_failure_reason" AS ENUM ('customer_unavailable', 'customer_phone_unreachable', 'address_not_found', 'address_incomplete', 'address_out_of_delivery_area', 'customer_refused', 'payment_refused', 'bad_weather', 'customer_not_available_at_time', 'damaged_package', 'other');

-- CreateEnum
CREATE TYPE "courier_integration_type" AS ENUM ('api_full', 'api_tracking_only', 'manual');

-- CreateEnum
CREATE TYPE "credential_environment" AS ENUM ('sandbox', 'production');

-- CreateEnum
CREATE TYPE "surcharge_type" AS ENUM ('cod_fee', 'fuel_surcharge', 'remote_area_fee', 'rto_fee', 'weight_dispute_fee', 'reshipment_fee', 'address_correction_fee', 'other');

-- CreateEnum
CREATE TYPE "surcharge_computation_method" AS ENUM ('flat', 'percentage', 'tiered');

-- CreateEnum
CREATE TYPE "surcharge_base_field" AS ENUM ('shipping_charge', 'cod_amount', 'declared_value', 'chargeable_weight');

-- CreateEnum
CREATE TYPE "fx_rate_source" AS ENUM ('exchangerate_host', 'open_exchange_rates', 'manual', 'fallback');

-- CreateEnum
CREATE TYPE "charge_type" AS ENUM ('base_shipping', 'cod_fee', 'fuel_surcharge', 'remote_area_fee', 'rto_fee', 'weight_dispute_fee', 'reshipment_fee', 'gst', 'adjustment', 'refund', 'other');

-- CreateEnum
CREATE TYPE "order_charge_status" AS ENUM ('estimated', 'confirmed', 'final', 'disputed', 'adjusted');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('email', 'sms', 'in_app', 'whatsapp');

-- CreateEnum
CREATE TYPE "notification_recipient_type" AS ENUM ('customer', 'seller', 'staff', 'admin');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('queued', 'sending', 'sent', 'delivered', 'read', 'bounced', 'failed', 'throttled', 'cancelled');

-- CreateEnum
CREATE TYPE "webhook_delivery_status" AS ENUM ('scheduled', 'in_flight', 'delivered', 'failed', 'abandoned', 'endpoint_disabled');

-- CreateEnum
CREATE TYPE "setting_value_type" AS ENUM ('string', 'int', 'decimal', 'boolean', 'json', 'date');

-- CreateEnum
CREATE TYPE "seller_notification_category" AS ENUM ('order_updates', 'shipment_updates', 'stock_alerts', 'call_center_outcomes', 'billing', 'system_announcements', 'marketing');

-- CreateEnum
CREATE TYPE "notification_frequency" AS ENUM ('immediate', 'hourly_digest', 'daily_digest', 'weekly_digest', 'disabled');

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "email_display" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "staff_role" NOT NULL,
    "email_verified_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sellers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "email_display" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_person_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "status" "seller_status" NOT NULL DEFAULT 'pending',
    "approved_at" TIMESTAMPTZ,
    "approved_by_id" UUID,
    "bank_name" TEXT,
    "bank_account_name" TEXT,
    "bank_account_number" TEXT,
    "bank_routing_number" TEXT,
    "bank_swift_code" TEXT,
    "display_currency" "currency" NOT NULL DEFAULT 'inr',
    "display_language" TEXT NOT NULL DEFAULT 'en',
    "country_code" CHAR(2) NOT NULL DEFAULT 'BD',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_invitations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "seller_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "seller_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "staff_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "seller_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_api_keys" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "seller_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "staff_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "seller_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "staff_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "seller_email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_notes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "category" "seller_note_category" NOT NULL DEFAULT 'general',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "seller_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "staff_user_id" UUID,
    "seller_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_type" "address_owner_type" NOT NULL,
    "owner_id" UUID NOT NULL,
    "label" TEXT,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "state_province" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "type" "address_type" NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "warehouse_status" NOT NULL DEFAULT 'active',
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_zones" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "warehouse_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pick_order" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "warehouse_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_bins" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "warehouse_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "aisle" TEXT,
    "shelf" TEXT,
    "type" "bin_type" NOT NULL,
    "max_weight_kg" DECIMAL(10,2),
    "max_volume_cm3" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "warehouse_bins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pin_codes" (
    "pin_code" VARCHAR(10) NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "city" TEXT,
    "district" TEXT,
    "state_province" TEXT,
    "region" TEXT,
    "zone" TEXT,
    "service_area" "service_area",
    "serviceability" JSONB,
    "source" "pin_code_source" NOT NULL DEFAULT 'user_entered',
    "last_verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pin_codes_pkey" PRIMARY KEY ("pin_code")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "parent_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "default_package_type" "package_type",
    "requires_fragile" BOOLEAN NOT NULL DEFAULT false,
    "requires_cold_chain" BOOLEAN NOT NULL DEFAULT false,
    "default_hs_code" TEXT,
    "default_gst_rate" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "external_ref" TEXT,
    "external_sku" TEXT,
    "default_weight_grams" INTEGER,
    "default_length_cm" DECIMAL(6,2),
    "default_width_cm" DECIMAL(6,2),
    "default_height_cm" DECIMAL(6,2),
    "default_declared_value_inr" DECIMAL(12,2),
    "default_hs_code" TEXT,
    "status" "product_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "product_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "sku_code" TEXT NOT NULL,
    "attributes" JSONB,
    "variant_label" TEXT,
    "weight_grams" INTEGER,
    "length_cm" DECIMAL(6,2),
    "width_cm" DECIMAL(6,2),
    "height_cm" DECIMAL(6,2),
    "declared_value_inr" DECIMAL(12,2),
    "hs_code" TEXT,
    "gst_rate" DECIMAL(5,2),
    "barcode" TEXT,
    "external_sku" TEXT,
    "status" "variant_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "variant_id" UUID NOT NULL,
    "spaces_key" TEXT NOT NULL,
    "spaces_bucket" TEXT NOT NULL DEFAULT 'skydrop-storage',
    "url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "width_px" INTEGER,
    "height_px" INTEGER,
    "alt_text" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by_seller_id" UUID,
    "uploaded_by_staff_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_courier_rules" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "category_id" UUID NOT NULL,
    "courier_code" TEXT NOT NULL,
    "is_allowed" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "category_courier_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "batch_code" TEXT NOT NULL,
    "seller_batch_ref" TEXT,
    "manufactured_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "unit_cost_inr" DECIMAL(12,2),
    "unit_cost_bdt" DECIMAL(12,2),
    "status" "batch_status" NOT NULL DEFAULT 'active',
    "initial_qty" INTEGER NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL,
    "received_by_id" UUID,
    "receiving_note_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "bin_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "qty_on_hand" INTEGER NOT NULL DEFAULT 0,
    "qty_reserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seller_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "bin_id" UUID,
    "batch_id" UUID,
    "type" "stock_movement_type" NOT NULL,
    "qty_change" INTEGER NOT NULL,
    "qty_before" INTEGER NOT NULL,
    "qty_after" INTEGER NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "reason_code" "stock_movement_reason_code",
    "order_id" UUID,
    "order_item_id" UUID,
    "shipment_id" UUID,
    "adjustment_id" UUID,
    "transfer_group_id" UUID,
    "from_bin_id" UUID,
    "to_bin_id" UUID,
    "metadata" JSONB,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id","created_at")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "bin_id" UUID,
    "batch_id" UUID,
    "qty_reserved" INTEGER NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ,
    "released_at" TIMESTAMPTZ,
    "fulfilled_at" TIMESTAMPTZ,
    "release_reason" "reservation_release_reason",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "type" "adjustment_type" NOT NULL,
    "reason_code" "stock_movement_reason_code" NOT NULL,
    "description" TEXT,
    "initiated_by_id" UUID NOT NULL,
    "initiated_at" TIMESTAMPTZ NOT NULL,
    "status" "adjustment_status" NOT NULL DEFAULT 'pending',
    "approver_threshold_inr" DECIMAL(12,2),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "rejected_reason" TEXT,
    "photo_spaces_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "total_value_impact_inr" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_counts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "warehouse_id" UUID NOT NULL,
    "zone_id" UUID,
    "count_type" "cycle_count_type" NOT NULL,
    "count_date" DATE NOT NULL,
    "initiated_by_id" UUID NOT NULL,
    "status" "cycle_count_status" NOT NULL DEFAULT 'scheduled',
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "total_bins_counted" INTEGER NOT NULL DEFAULT 0,
    "total_skus_counted" INTEGER NOT NULL DEFAULT 0,
    "discrepancy_count" INTEGER NOT NULL DEFAULT 0,
    "total_discrepancy_value_inr" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "cycle_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_count_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "cycle_count_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "bin_id" UUID NOT NULL,
    "batch_id" UUID,
    "system_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER NOT NULL,
    "counted_by_id" UUID,
    "counted_at" TIMESTAMPTZ,
    "notes" TEXT,
    "adjustment_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cycle_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "expected_arrival_at" TIMESTAMPTZ,
    "seller_reference" TEXT,
    "expected_skus" JSONB,
    "received_at" TIMESTAMPTZ,
    "received_by_id" UUID,
    "status" "goods_receipt_status" NOT NULL DEFAULT 'pending',
    "has_discrepancies" BOOLEAN NOT NULL DEFAULT false,
    "discrepancy_notes" TEXT,
    "photo_spaces_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "receipt_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "expected_qty" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "damaged_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_cost_inr" DECIMAL(12,2),
    "manufactured_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "putaway_bin_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "phone_e164" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "alt_phone_e164" TEXT,
    "total_orders_count" INTEGER NOT NULL DEFAULT 0,
    "successful_orders_count" INTEGER NOT NULL DEFAULT 0,
    "rto_count" INTEGER NOT NULL DEFAULT 0,
    "refused_count" INTEGER NOT NULL DEFAULT 0,
    "fake_orders_count" INTEGER NOT NULL DEFAULT 0,
    "risk_level" "customer_risk_level" NOT NULL DEFAULT 'none',
    "risk_notes" TEXT,
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "first_order_at" TIMESTAMPTZ,
    "last_order_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_number" TEXT NOT NULL,
    "seller_id" UUID NOT NULL,
    "customer_id" UUID,
    "seller_order_ref" TEXT,
    "source" "order_source" NOT NULL DEFAULT 'manual',
    "bulk_upload_id" UUID,
    "recipient_name" TEXT NOT NULL,
    "recipient_phone_e164" TEXT NOT NULL,
    "recipient_alt_phone_e164" TEXT,
    "recipient_email" TEXT,
    "recipient_address_line1" TEXT NOT NULL,
    "recipient_address_line2" TEXT,
    "recipient_landmark" TEXT,
    "recipient_city" TEXT NOT NULL,
    "recipient_state_province" TEXT NOT NULL,
    "recipient_postal_code" TEXT NOT NULL,
    "recipient_country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "payment_mode" "payment_mode" NOT NULL,
    "cod_amount_inr" DECIMAL(12,2),
    "declared_value_inr" DECIMAL(12,2) NOT NULL,
    "total_weight_grams" INTEGER,
    "package_type" "package_type",
    "status" "order_status" NOT NULL DEFAULT 'draft',
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "is_high_risk" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMPTZ,
    "confirmed_by_id" UUID,
    "cancellation_reason" "order_cancellation_reason",
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by_id" UUID,
    "internal_notes" TEXT,
    "seller_notes" TEXT,
    "call_notes" TEXT,
    "sla_deadline" TIMESTAMPTZ,
    "expected_delivery_at" TIMESTAMPTZ,
    "placed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "sku_code" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "variant_label" TEXT,
    "image_url" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_weight_grams" INTEGER,
    "unit_declared_value_inr" DECIMAL(12,2),
    "unit_price_inr" DECIMAL(12,2),
    "qty_reserved" INTEGER NOT NULL DEFAULT 0,
    "qty_picked" INTEGER NOT NULL DEFAULT 0,
    "qty_packed" INTEGER NOT NULL DEFAULT 0,
    "qty_shipped" INTEGER NOT NULL DEFAULT 0,
    "qty_delivered" INTEGER NOT NULL DEFAULT 0,
    "qty_returned" INTEGER NOT NULL DEFAULT 0,
    "hs_code" TEXT,
    "picked_batch_id" UUID,
    "picked_bin_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "type" "order_event_type" NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status",
    "description" TEXT,
    "data" JSONB,
    "actor_type" "actor_type",
    "actor_id" UUID,
    "is_visible_to_seller" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_order_uploads" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "spaces_key" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "status" "bulk_upload_status" NOT NULL DEFAULT 'pending',
    "error_report_key" TEXT,
    "orders_created" INTEGER NOT NULL DEFAULT 0,
    "rows_failed" INTEGER NOT NULL DEFAULT 0,
    "rows_skipped" INTEGER NOT NULL DEFAULT 0,
    "job_id" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "uploaded_by_seller_id" UUID,
    "uploaded_by_staff_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "bulk_order_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_recipient_address_cache" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "customer_id" UUID NOT NULL,
    "address_hash" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "state_province" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "seen_count" INTEGER NOT NULL DEFAULT 1,
    "rto_count_at_address" INTEGER NOT NULL DEFAULT 0,
    "successful_count_at_address" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_recipient_address_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_queue_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "assigned_agent_id" UUID,
    "assigned_at" TIMESTAMPTZ,
    "assignment_method" "assignment_method" NOT NULL DEFAULT 'auto_round_robin',
    "previous_agent_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" "call_queue_status" NOT NULL DEFAULT 'waiting',
    "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "closed_at" TIMESTAMPTZ,
    "closure_reason" "queue_closure_reason",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "call_queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "queue_entry_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "duration_seconds" INTEGER,
    "phone_e164" TEXT NOT NULL,
    "outcome" "call_outcome" NOT NULL,
    "outcome_notes" TEXT,
    "customer_said_name" TEXT,
    "customer_said_address" TEXT,
    "customer_verified_items" BOOLEAN,
    "rescheduled_for" TIMESTAMPTZ,
    "rescheduled_reason" TEXT,
    "flagged_as_suspicious" BOOLEAN NOT NULL DEFAULT false,
    "suspicion_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_call_settings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" UUID NOT NULL,
    "max_active_calls" INTEGER NOT NULL DEFAULT 20,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "working_hours_start" TEXT NOT NULL DEFAULT '09:00',
    "working_hours_end" TEXT NOT NULL DEFAULT '18:00',
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "languages" TEXT[] DEFAULT ARRAY['en', 'hi']::TEXT[],
    "can_handle_high_risk" BOOLEAN NOT NULL DEFAULT false,
    "can_handle_high_value" BOOLEAN NOT NULL DEFAULT false,
    "total_calls_today" INTEGER NOT NULL DEFAULT 0,
    "confirmed_today_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "agent_call_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "shipment_number" TEXT NOT NULL,
    "courier_code" TEXT NOT NULL,
    "awb_number" TEXT,
    "courier_shipment_id" TEXT,
    "service_type" TEXT,
    "origin_warehouse_id" UUID NOT NULL,
    "dest_recipient_name" TEXT NOT NULL,
    "dest_recipient_phone_e164" TEXT NOT NULL,
    "dest_address_line1" TEXT NOT NULL,
    "dest_address_line2" TEXT,
    "dest_landmark" TEXT,
    "dest_city" TEXT NOT NULL,
    "dest_state_province" TEXT NOT NULL,
    "dest_postal_code" TEXT NOT NULL,
    "dest_country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "total_weight_grams" INTEGER NOT NULL,
    "declared_weight_grams" INTEGER,
    "actual_weight_grams" INTEGER,
    "length_cm" DECIMAL(6,2),
    "width_cm" DECIMAL(6,2),
    "height_cm" DECIMAL(6,2),
    "volumetric_weight_grams" INTEGER,
    "chargeable_weight_grams" INTEGER,
    "package_type" "package_type",
    "declared_value_inr" DECIMAL(12,2) NOT NULL,
    "cod_amount_inr" DECIMAL(12,2),
    "status" "shipment_status" NOT NULL DEFAULT 'created',
    "awb_generated_at" TIMESTAMPTZ,
    "picked_up_by_courier_at" TIMESTAMPTZ,
    "first_scan_at" TIMESTAMPTZ,
    "out_for_delivery_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "rto_initiated_at" TIMESTAMPTZ,
    "rto_received_at" TIMESTAMPTZ,
    "expected_delivery_at" TIMESTAMPTZ,
    "is_manual_courier" BOOLEAN NOT NULL DEFAULT false,
    "supersedes_shipment_id" UUID,
    "pod_photo_spaces_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pod_signature_spaces_key" TEXT,
    "pod_recipient_name" TEXT,
    "has_issue" BOOLEAN NOT NULL DEFAULT false,
    "estimated_cost_inr" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_shipments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "is_full_order" BOOLEAN NOT NULL DEFAULT true,
    "shipment_sequence" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "shipment_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sku_code" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "variant_label" TEXT,
    "unit_weight_grams" INTEGER,
    "unit_declared_value_inr" DECIMAL(12,2),
    "hs_code" TEXT,
    "unit_price_inr" DECIMAL(12,2),
    "picked_batch_id" UUID,
    "picked_bin_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awb_labels" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "shipment_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "spaces_key" TEXT NOT NULL,
    "spaces_bucket" TEXT NOT NULL DEFAULT 'skydrop-storage',
    "url" TEXT,
    "file_size_bytes" INTEGER,
    "mime_type" TEXT NOT NULL DEFAULT 'application/pdf',
    "paper_size" "label_paper_size" NOT NULL DEFAULT 'a4',
    "format" TEXT,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by_staff_id" UUID,
    "generated_reason" "label_generation_reason" NOT NULL DEFAULT 'initial',
    "printed_count" INTEGER NOT NULL DEFAULT 0,
    "last_printed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "awb_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shipment_id" UUID NOT NULL,
    "event_type" "tracking_event_type" NOT NULL,
    "status" "shipment_status" NOT NULL,
    "description" TEXT,
    "location_name" TEXT,
    "location_city" TEXT,
    "location_pincode" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "source" "tracking_event_source" NOT NULL,
    "courier_code" TEXT,
    "raw_courier_status" TEXT,
    "webhook_id" UUID,
    "actor_type" "actor_type",
    "actor_id" UUID,
    "metadata" JSONB,
    "is_visible_to_customer" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id","created_at")
);

-- CreateTable
CREATE TABLE "courier_webhooks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "courier_code" TEXT NOT NULL,
    "shipment_id" UUID,
    "awb_number" TEXT,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remote_ip" INET,
    "user_agent" TEXT,
    "signature" TEXT,
    "signature_valid" BOOLEAN,
    "http_method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "raw_body" TEXT NOT NULL,
    "parsed_body" JSONB,
    "status" "webhook_status" NOT NULL DEFAULT 'received',
    "processed_at" TIMESTAMPTZ,
    "tracking_event_id" UUID,
    "error_message" TEXT,
    "error_stack" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "courier_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "shipment_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "attempted_at" TIMESTAMPTZ NOT NULL,
    "outcome" "delivery_attempt_outcome" NOT NULL,
    "failure_reason" "delivery_failure_reason",
    "failure_notes" TEXT,
    "contacted_customer" BOOLEAN NOT NULL DEFAULT false,
    "customer_response" TEXT,
    "next_attempt_scheduled_at" TIMESTAMPTZ,
    "attempt_latitude" DECIMAL(10,7),
    "attempt_longitude" DECIMAL(10,7),
    "agent_name" TEXT,
    "agent_phone" TEXT,
    "source" "tracking_event_source" NOT NULL,
    "webhook_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "couriers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "logo_spaces_key" TEXT,
    "integration_type" "courier_integration_type" NOT NULL,
    "api_base_url" TEXT,
    "webhook_secret" TEXT,
    "supports_cod" BOOLEAN NOT NULL DEFAULT false,
    "supports_prepaid" BOOLEAN NOT NULL DEFAULT true,
    "supports_rto" BOOLEAN NOT NULL DEFAULT false,
    "supports_weight_dispute" BOOLEAN NOT NULL DEFAULT false,
    "max_weight_grams" INTEGER,
    "max_declared_value_inr" DECIMAL(12,2),
    "max_cod_amount_inr" DECIMAL(12,2),
    "default_service_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "volumetric_divisor" INTEGER NOT NULL DEFAULT 5000,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority_for_routing" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_credentials" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "courier_id" UUID NOT NULL,
    "environment" "credential_environment" NOT NULL,
    "encrypted_payload" TEXT NOT NULL,
    "encryption_key_version" INTEGER NOT NULL,
    "field_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "last_tested_at" TIMESTAMPTZ,
    "last_test_result" TEXT,
    "created_by_staff_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "courier_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_cards" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMPTZ NOT NULL,
    "effective_to" TIMESTAMPTZ,
    "currency" "currency" NOT NULL DEFAULT 'inr',
    "created_by_staff_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_card_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "rate_card_id" UUID NOT NULL,
    "courier_id" UUID NOT NULL,
    "service_type" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "weight_slab_from_grams" INTEGER NOT NULL,
    "weight_slab_to_grams" INTEGER NOT NULL,
    "base_charge_inr" DECIMAL(12,2) NOT NULL,
    "per_kg_charge_inr" DECIMAL(10,2),
    "cost_to_skydrop_inr" DECIMAL(12,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rate_card_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_pricing" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "rate_card_id" UUID NOT NULL,
    "courier_id" UUID,
    "discount_percent" DECIMAL(5,2),
    "cod_fee_percent" DECIMAL(5,2),
    "effective_from" TIMESTAMPTZ NOT NULL,
    "effective_to" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "approved_by_staff_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "seller_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_matrix_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "courier_id" UUID NOT NULL,
    "origin_area" "service_area" NOT NULL,
    "dest_area" "service_area" NOT NULL,
    "zone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "zone_matrix_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surcharge_rules" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "rate_card_id" UUID NOT NULL,
    "type" "surcharge_type" NOT NULL,
    "name" TEXT NOT NULL,
    "computation_method" "surcharge_computation_method" NOT NULL,
    "flat_amount_inr" DECIMAL(12,2),
    "percentage" DECIMAL(5,2),
    "min_amount_inr" DECIMAL(12,2),
    "max_amount_inr" DECIMAL(12,2),
    "base_field" "surcharge_base_field",
    "applies_only_if_payment_mode" "payment_mode",
    "applies_only_for_service_areas" "service_area"[] DEFAULT ARRAY[]::"service_area"[],
    "is_visible_to_seller" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "surcharge_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "from_currency" "currency" NOT NULL,
    "to_currency" "currency" NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "source" "fx_rate_source" NOT NULL,
    "source_url" TEXT,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_manual_override" BOOLEAN NOT NULL DEFAULT false,
    "override_by_staff_id" UUID,
    "override_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_charges" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "shipment_id" UUID,
    "type" "charge_type" NOT NULL,
    "amount_inr" DECIMAL(12,2) NOT NULL,
    "is_taxable" BOOLEAN NOT NULL DEFAULT false,
    "tax_rate" DECIMAL(5,2),
    "tax_amount_inr" DECIMAL(12,2),
    "total_amount_inr" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_visible_to_seller" BOOLEAN NOT NULL DEFAULT true,
    "rate_card_id" UUID,
    "surcharge_rule_id" UUID,
    "computation_context" JSONB,
    "status" "order_charge_status" NOT NULL DEFAULT 'estimated',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "order_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "channel" "notification_channel" NOT NULL,
    "recipient_type" "notification_recipient_type" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "body_template" TEXT NOT NULL,
    "html_body_template" TEXT,
    "variables" JSONB,
    "preferred_provider" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "max_per_recipient_per_hour" INTEGER,
    "max_per_recipient_per_day" INTEGER,
    "last_edited_by_staff_id" UUID,
    "last_edited_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "template_id" UUID,
    "template_code" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "recipient_type" "notification_recipient_type" NOT NULL,
    "recipient_id" UUID,
    "to_email" TEXT,
    "to_phone_e164" TEXT,
    "to_in_app_user_id" UUID,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "html_body" TEXT,
    "variables" JSONB,
    "order_id" UUID,
    "shipment_id" UUID,
    "call_attempt_id" UUID,
    "trigger_event" TEXT,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "status" "notification_status" NOT NULL DEFAULT 'queued',
    "sent_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "cost_micros" INTEGER,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "parent_notification_id" UUID,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_webhook_endpoints" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret_key" TEXT NOT NULL,
    "previous_secret_key" TEXT,
    "previous_secret_key_valid_until" TIMESTAMPTZ,
    "subscribed_events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "name" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_success_at" TIMESTAMPTZ,
    "last_failure_at" TIMESTAMPTZ,
    "consecutive_failure_count" INTEGER NOT NULL DEFAULT 0,
    "auto_disabled_at" TIMESTAMPTZ,
    "auto_disabled_reason" TEXT,
    "last_tested_at" TIMESTAMPTZ,
    "last_test_status" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "seller_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "endpoint_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_version" TEXT NOT NULL DEFAULT 'v1',
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "http_method" TEXT NOT NULL DEFAULT 'POST',
    "request_url" TEXT NOT NULL,
    "request_headers" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_headers" JSONB,
    "response_body" TEXT,
    "response_time_ms" INTEGER,
    "status" "webhook_delivery_status" NOT NULL DEFAULT 'scheduled',
    "error_code" TEXT,
    "error_message" TEXT,
    "scheduled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "next_retry_at" TIMESTAMPTZ,
    "parent_delivery_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "outbound_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value_type" "setting_value_type" NOT NULL,
    "value_string" TEXT,
    "value_int" INTEGER,
    "value_decimal" DECIMAL(20,6),
    "value_boolean" BOOLEAN,
    "value_json" JSONB,
    "value_date" TIMESTAMPTZ,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "help_text" TEXT,
    "validation_schema" JSONB,
    "is_editable_by_admin" BOOLEAN NOT NULL DEFAULT true,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "requires_restart" BOOLEAN NOT NULL DEFAULT false,
    "last_edited_by_staff_id" UUID,
    "last_edited_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_notification_preferences" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "category" "seller_notification_category" NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "webhook_enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "notification_frequency" NOT NULL DEFAULT 'immediate',
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "seller_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE INDEX "staff_users_role_idx" ON "staff_users"("role");

-- CreateIndex
CREATE INDEX "staff_users_deleted_at_idx" ON "staff_users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_email_key" ON "sellers"("email");

-- CreateIndex
CREATE INDEX "sellers_status_idx" ON "sellers"("status");

-- CreateIndex
CREATE INDEX "sellers_deleted_at_idx" ON "sellers"("deleted_at");

-- CreateIndex
CREATE INDEX "sellers_approved_by_id_idx" ON "sellers"("approved_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_invitations_token_key" ON "seller_invitations"("token");

-- CreateIndex
CREATE INDEX "seller_invitations_email_idx" ON "seller_invitations"("email");

-- CreateIndex
CREATE INDEX "seller_invitations_expires_at_idx" ON "seller_invitations"("expires_at");

-- CreateIndex
CREATE INDEX "seller_invitations_invited_by_id_idx" ON "seller_invitations"("invited_by_id");

-- CreateIndex
CREATE INDEX "seller_invitations_seller_id_idx" ON "seller_invitations"("seller_id");

-- CreateIndex
CREATE INDEX "staff_refresh_tokens_staff_user_id_idx" ON "staff_refresh_tokens"("staff_user_id");

-- CreateIndex
CREATE INDEX "staff_refresh_tokens_token_hash_idx" ON "staff_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "staff_refresh_tokens_expires_at_idx" ON "staff_refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "seller_refresh_tokens_seller_id_idx" ON "seller_refresh_tokens"("seller_id");

-- CreateIndex
CREATE INDEX "seller_refresh_tokens_token_hash_idx" ON "seller_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "seller_refresh_tokens_expires_at_idx" ON "seller_refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "seller_api_keys_key_hash_key" ON "seller_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "seller_api_keys_seller_id_idx" ON "seller_api_keys"("seller_id");

-- CreateIndex
CREATE INDEX "seller_api_keys_revoked_at_idx" ON "seller_api_keys"("revoked_at");

-- CreateIndex
CREATE INDEX "staff_password_reset_tokens_staff_user_id_idx" ON "staff_password_reset_tokens"("staff_user_id");

-- CreateIndex
CREATE INDEX "staff_password_reset_tokens_token_hash_idx" ON "staff_password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "staff_password_reset_tokens_expires_at_idx" ON "staff_password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "seller_password_reset_tokens_seller_id_idx" ON "seller_password_reset_tokens"("seller_id");

-- CreateIndex
CREATE INDEX "seller_password_reset_tokens_token_hash_idx" ON "seller_password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "seller_password_reset_tokens_expires_at_idx" ON "seller_password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "staff_email_verification_tokens_staff_user_id_idx" ON "staff_email_verification_tokens"("staff_user_id");

-- CreateIndex
CREATE INDEX "staff_email_verification_tokens_token_hash_idx" ON "staff_email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "staff_email_verification_tokens_expires_at_idx" ON "staff_email_verification_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "seller_email_verification_tokens_seller_id_idx" ON "seller_email_verification_tokens"("seller_id");

-- CreateIndex
CREATE INDEX "seller_email_verification_tokens_token_hash_idx" ON "seller_email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "seller_email_verification_tokens_expires_at_idx" ON "seller_email_verification_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "seller_notes_seller_id_idx" ON "seller_notes"("seller_id");

-- CreateIndex
CREATE INDEX "seller_notes_author_id_idx" ON "seller_notes"("author_id");

-- CreateIndex
CREATE INDEX "seller_notes_category_idx" ON "seller_notes"("category");

-- CreateIndex
CREATE INDEX "seller_notes_deleted_at_idx" ON "seller_notes"("deleted_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_actor_id_idx" ON "audit_logs"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_staff_user_id_idx" ON "audit_logs"("staff_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_seller_id_idx" ON "audit_logs"("seller_id");

-- CreateIndex
CREATE INDEX "addresses_owner_type_owner_id_idx" ON "addresses"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "addresses_country_code_postal_code_idx" ON "addresses"("country_code", "postal_code");

-- CreateIndex
CREATE INDEX "addresses_deleted_at_idx" ON "addresses"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE INDEX "warehouses_status_idx" ON "warehouses"("status");

-- CreateIndex
CREATE INDEX "warehouse_zones_warehouse_id_idx" ON "warehouse_zones"("warehouse_id");

-- CreateIndex
CREATE INDEX "warehouse_zones_deleted_at_idx" ON "warehouse_zones"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_zones_warehouse_id_code_key" ON "warehouse_zones"("warehouse_id", "code");

-- CreateIndex
CREATE INDEX "warehouse_bins_warehouse_id_idx" ON "warehouse_bins"("warehouse_id");

-- CreateIndex
CREATE INDEX "warehouse_bins_zone_id_idx" ON "warehouse_bins"("zone_id");

-- CreateIndex
CREATE INDEX "warehouse_bins_aisle_idx" ON "warehouse_bins"("aisle");

-- CreateIndex
CREATE INDEX "warehouse_bins_type_idx" ON "warehouse_bins"("type");

-- CreateIndex
CREATE INDEX "warehouse_bins_deleted_at_idx" ON "warehouse_bins"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_bins_warehouse_id_code_key" ON "warehouse_bins"("warehouse_id", "code");

-- CreateIndex
CREATE INDEX "pin_codes_country_code_idx" ON "pin_codes"("country_code");

-- CreateIndex
CREATE INDEX "pin_codes_city_idx" ON "pin_codes"("city");

-- CreateIndex
CREATE INDEX "pin_codes_state_province_idx" ON "pin_codes"("state_province");

-- CreateIndex
CREATE INDEX "pin_codes_zone_idx" ON "pin_codes"("zone");

-- CreateIndex
CREATE INDEX "pin_codes_last_verified_at_idx" ON "pin_codes"("last_verified_at");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "categories_depth_idx" ON "categories"("depth");

-- CreateIndex
CREATE INDEX "categories_deleted_at_idx" ON "categories"("deleted_at");

-- CreateIndex
CREATE INDEX "products_seller_id_idx" ON "products"("seller_id");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_deleted_at_idx" ON "products"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_seller_id_external_ref_key" ON "products"("seller_id", "external_ref");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_variants_seller_id_idx" ON "product_variants"("seller_id");

-- CreateIndex
CREATE INDEX "product_variants_barcode_idx" ON "product_variants"("barcode");

-- CreateIndex
CREATE INDEX "product_variants_status_idx" ON "product_variants"("status");

-- CreateIndex
CREATE INDEX "product_variants_deleted_at_idx" ON "product_variants"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_seller_id_sku_code_key" ON "product_variants"("seller_id", "sku_code");

-- CreateIndex
CREATE INDEX "product_images_variant_id_idx" ON "product_images"("variant_id");

-- CreateIndex
CREATE INDEX "product_images_is_primary_idx" ON "product_images"("is_primary");

-- CreateIndex
CREATE INDEX "product_images_display_order_idx" ON "product_images"("display_order");

-- CreateIndex
CREATE INDEX "product_images_deleted_at_idx" ON "product_images"("deleted_at");

-- CreateIndex
CREATE INDEX "category_courier_rules_courier_code_idx" ON "category_courier_rules"("courier_code");

-- CreateIndex
CREATE UNIQUE INDEX "category_courier_rules_category_id_courier_code_key" ON "category_courier_rules"("category_id", "courier_code");

-- CreateIndex
CREATE INDEX "stock_batches_seller_id_variant_id_idx" ON "stock_batches"("seller_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_batches_variant_id_idx" ON "stock_batches"("variant_id");

-- CreateIndex
CREATE INDEX "stock_batches_warehouse_id_idx" ON "stock_batches"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_batches_expires_at_idx" ON "stock_batches"("expires_at");

-- CreateIndex
CREATE INDEX "stock_batches_status_idx" ON "stock_batches"("status");

-- CreateIndex
CREATE INDEX "stock_batches_deleted_at_idx" ON "stock_batches"("deleted_at");

-- CreateIndex
CREATE INDEX "stock_batches_received_by_id_idx" ON "stock_batches"("received_by_id");

-- CreateIndex
CREATE INDEX "stock_batches_receiving_note_id_idx" ON "stock_batches"("receiving_note_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_seller_id_batch_code_key" ON "stock_batches"("seller_id", "batch_code");

-- CreateIndex
CREATE INDEX "stock_levels_seller_id_variant_id_idx" ON "stock_levels"("seller_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_levels_warehouse_id_bin_id_idx" ON "stock_levels"("warehouse_id", "bin_id");

-- CreateIndex
CREATE INDEX "stock_levels_variant_id_idx" ON "stock_levels"("variant_id");

-- CreateIndex
CREATE INDEX "stock_levels_batch_id_idx" ON "stock_levels"("batch_id");

-- CreateIndex
CREATE INDEX "stock_levels_qty_on_hand_idx" ON "stock_levels"("qty_on_hand");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_seller_id_variant_id_warehouse_id_bin_id_batch_key" ON "stock_levels"("seller_id", "variant_id", "warehouse_id", "bin_id", "batch_id");

-- CreateIndex
CREATE INDEX "stock_movements_seller_id_variant_id_created_at_idx" ON "stock_movements"("seller_id", "variant_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_warehouse_id_bin_id_created_at_idx" ON "stock_movements"("warehouse_id", "bin_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_batch_id_idx" ON "stock_movements"("batch_id");

-- CreateIndex
CREATE INDEX "stock_movements_order_id_idx" ON "stock_movements"("order_id");

-- CreateIndex
CREATE INDEX "stock_movements_shipment_id_idx" ON "stock_movements"("shipment_id");

-- CreateIndex
CREATE INDEX "stock_movements_type_created_at_idx" ON "stock_movements"("type", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- CreateIndex
CREATE INDEX "stock_movements_adjustment_id_idx" ON "stock_movements"("adjustment_id");

-- CreateIndex
CREATE INDEX "stock_movements_order_item_id_idx" ON "stock_movements"("order_item_id");

-- CreateIndex
CREATE INDEX "stock_reservations_seller_id_variant_id_status_idx" ON "stock_reservations"("seller_id", "variant_id", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_order_id_idx" ON "stock_reservations"("order_id");

-- CreateIndex
CREATE INDEX "stock_reservations_order_item_id_idx" ON "stock_reservations"("order_item_id");

-- CreateIndex
CREATE INDEX "stock_reservations_status_expires_at_idx" ON "stock_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "stock_reservations_bin_id_batch_id_idx" ON "stock_reservations"("bin_id", "batch_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_seller_id_idx" ON "stock_adjustments"("seller_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_warehouse_id_idx" ON "stock_adjustments"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_status_idx" ON "stock_adjustments"("status");

-- CreateIndex
CREATE INDEX "stock_adjustments_type_idx" ON "stock_adjustments"("type");

-- CreateIndex
CREATE INDEX "stock_adjustments_initiated_at_idx" ON "stock_adjustments"("initiated_at");

-- CreateIndex
CREATE INDEX "stock_adjustments_initiated_by_id_idx" ON "stock_adjustments"("initiated_by_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_approved_by_id_idx" ON "stock_adjustments"("approved_by_id");

-- CreateIndex
CREATE INDEX "cycle_counts_warehouse_id_idx" ON "cycle_counts"("warehouse_id");

-- CreateIndex
CREATE INDEX "cycle_counts_zone_id_idx" ON "cycle_counts"("zone_id");

-- CreateIndex
CREATE INDEX "cycle_counts_count_type_idx" ON "cycle_counts"("count_type");

-- CreateIndex
CREATE INDEX "cycle_counts_status_idx" ON "cycle_counts"("status");

-- CreateIndex
CREATE INDEX "cycle_counts_count_date_idx" ON "cycle_counts"("count_date");

-- CreateIndex
CREATE INDEX "cycle_counts_initiated_by_id_idx" ON "cycle_counts"("initiated_by_id");

-- CreateIndex
CREATE INDEX "cycle_count_items_cycle_count_id_idx" ON "cycle_count_items"("cycle_count_id");

-- CreateIndex
CREATE INDEX "cycle_count_items_variant_id_idx" ON "cycle_count_items"("variant_id");

-- CreateIndex
CREATE INDEX "cycle_count_items_bin_id_idx" ON "cycle_count_items"("bin_id");

-- CreateIndex
CREATE INDEX "cycle_count_items_batch_id_idx" ON "cycle_count_items"("batch_id");

-- CreateIndex
CREATE INDEX "cycle_count_items_adjustment_id_idx" ON "cycle_count_items"("adjustment_id");

-- CreateIndex
CREATE INDEX "cycle_count_items_counted_by_id_idx" ON "cycle_count_items"("counted_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_receipt_number_key" ON "goods_receipts"("receipt_number");

-- CreateIndex
CREATE INDEX "goods_receipts_seller_id_idx" ON "goods_receipts"("seller_id");

-- CreateIndex
CREATE INDEX "goods_receipts_warehouse_id_idx" ON "goods_receipts"("warehouse_id");

-- CreateIndex
CREATE INDEX "goods_receipts_status_idx" ON "goods_receipts"("status");

-- CreateIndex
CREATE INDEX "goods_receipts_expected_arrival_at_idx" ON "goods_receipts"("expected_arrival_at");

-- CreateIndex
CREATE INDEX "goods_receipts_received_by_id_idx" ON "goods_receipts"("received_by_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_receipt_id_idx" ON "goods_receipt_lines"("receipt_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_variant_id_idx" ON "goods_receipt_lines"("variant_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_batch_id_idx" ON "goods_receipt_lines"("batch_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_putaway_bin_id_idx" ON "goods_receipt_lines"("putaway_bin_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_e164_key" ON "customers"("phone_e164");

-- CreateIndex
CREATE INDEX "customers_risk_level_idx" ON "customers"("risk_level");

-- CreateIndex
CREATE INDEX "customers_last_order_at_idx" ON "customers"("last_order_at");

-- CreateIndex
CREATE INDEX "customers_deleted_at_idx" ON "customers"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_seller_id_status_idx" ON "orders"("seller_id", "status");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "orders_recipient_phone_e164_idx" ON "orders"("recipient_phone_e164");

-- CreateIndex
CREATE INDEX "orders_recipient_postal_code_idx" ON "orders"("recipient_postal_code");

-- CreateIndex
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at");

-- CreateIndex
CREATE INDEX "orders_placed_at_idx" ON "orders"("placed_at");

-- CreateIndex
CREATE INDEX "orders_confirmed_at_idx" ON "orders"("confirmed_at");

-- CreateIndex
CREATE INDEX "orders_deleted_at_idx" ON "orders"("deleted_at");

-- CreateIndex
CREATE INDEX "orders_bulk_upload_id_idx" ON "orders"("bulk_upload_id");

-- CreateIndex
CREATE INDEX "orders_confirmed_by_id_idx" ON "orders"("confirmed_by_id");

-- CreateIndex
CREATE INDEX "orders_cancelled_by_id_idx" ON "orders"("cancelled_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_seller_id_seller_order_ref_key" ON "orders"("seller_id", "seller_order_ref");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- CreateIndex
CREATE INDEX "order_items_picked_batch_id_idx" ON "order_items"("picked_batch_id");

-- CreateIndex
CREATE INDEX "order_items_picked_bin_id_idx" ON "order_items"("picked_bin_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_events_type_idx" ON "order_events"("type");

-- CreateIndex
CREATE INDEX "order_events_to_status_idx" ON "order_events"("to_status");

-- CreateIndex
CREATE INDEX "bulk_order_uploads_seller_id_idx" ON "bulk_order_uploads"("seller_id");

-- CreateIndex
CREATE INDEX "bulk_order_uploads_status_idx" ON "bulk_order_uploads"("status");

-- CreateIndex
CREATE INDEX "bulk_order_uploads_created_at_idx" ON "bulk_order_uploads"("created_at");

-- CreateIndex
CREATE INDEX "bulk_order_uploads_uploaded_by_seller_id_idx" ON "bulk_order_uploads"("uploaded_by_seller_id");

-- CreateIndex
CREATE INDEX "bulk_order_uploads_uploaded_by_staff_id_idx" ON "bulk_order_uploads"("uploaded_by_staff_id");

-- CreateIndex
CREATE INDEX "order_recipient_address_cache_customer_id_idx" ON "order_recipient_address_cache"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_recipient_address_cache_customer_id_address_hash_key" ON "order_recipient_address_cache"("customer_id", "address_hash");

-- CreateIndex
CREATE UNIQUE INDEX "call_queue_entries_order_id_key" ON "call_queue_entries"("order_id");

-- CreateIndex
CREATE INDEX "call_queue_entries_assigned_agent_id_status_idx" ON "call_queue_entries"("assigned_agent_id", "status");

-- CreateIndex
CREATE INDEX "call_queue_entries_status_available_at_priority_idx" ON "call_queue_entries"("status", "available_at", "priority");

-- CreateIndex
CREATE INDEX "call_queue_entries_order_id_idx" ON "call_queue_entries"("order_id");

-- CreateIndex
CREATE INDEX "call_queue_entries_closure_reason_idx" ON "call_queue_entries"("closure_reason");

-- CreateIndex
CREATE INDEX "call_attempts_queue_entry_id_idx" ON "call_attempts"("queue_entry_id");

-- CreateIndex
CREATE INDEX "call_attempts_order_id_idx" ON "call_attempts"("order_id");

-- CreateIndex
CREATE INDEX "call_attempts_agent_id_started_at_idx" ON "call_attempts"("agent_id", "started_at");

-- CreateIndex
CREATE INDEX "call_attempts_outcome_idx" ON "call_attempts"("outcome");

-- CreateIndex
CREATE INDEX "call_attempts_started_at_idx" ON "call_attempts"("started_at");

-- CreateIndex
CREATE INDEX "call_attempts_flagged_as_suspicious_idx" ON "call_attempts"("flagged_as_suspicious");

-- CreateIndex
CREATE UNIQUE INDEX "agent_call_settings_agent_id_key" ON "agent_call_settings"("agent_id");

-- CreateIndex
CREATE INDEX "agent_call_settings_is_available_idx" ON "agent_call_settings"("is_available");

-- CreateIndex
CREATE INDEX "agent_call_settings_agent_id_idx" ON "agent_call_settings"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_shipment_number_key" ON "shipments"("shipment_number");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_awb_number_key" ON "shipments"("awb_number");

-- CreateIndex
CREATE INDEX "shipments_courier_code_status_idx" ON "shipments"("courier_code", "status");

-- CreateIndex
CREATE INDEX "shipments_status_created_at_idx" ON "shipments"("status", "created_at");

-- CreateIndex
CREATE INDEX "shipments_dest_postal_code_idx" ON "shipments"("dest_postal_code");

-- CreateIndex
CREATE INDEX "shipments_dest_recipient_phone_e164_idx" ON "shipments"("dest_recipient_phone_e164");

-- CreateIndex
CREATE INDEX "shipments_delivered_at_idx" ON "shipments"("delivered_at");

-- CreateIndex
CREATE INDEX "shipments_rto_initiated_at_idx" ON "shipments"("rto_initiated_at");

-- CreateIndex
CREATE INDEX "shipments_supersedes_shipment_id_idx" ON "shipments"("supersedes_shipment_id");

-- CreateIndex
CREATE INDEX "shipments_origin_warehouse_id_idx" ON "shipments"("origin_warehouse_id");

-- CreateIndex
CREATE INDEX "shipments_deleted_at_idx" ON "shipments"("deleted_at");

-- CreateIndex
CREATE INDEX "order_shipments_order_id_idx" ON "order_shipments"("order_id");

-- CreateIndex
CREATE INDEX "order_shipments_shipment_id_idx" ON "order_shipments"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_shipments_order_id_shipment_id_key" ON "order_shipments"("order_id", "shipment_id");

-- CreateIndex
CREATE INDEX "shipment_items_shipment_id_idx" ON "shipment_items"("shipment_id");

-- CreateIndex
CREATE INDEX "shipment_items_order_item_id_idx" ON "shipment_items"("order_item_id");

-- CreateIndex
CREATE INDEX "shipment_items_picked_batch_id_idx" ON "shipment_items"("picked_batch_id");

-- CreateIndex
CREATE INDEX "shipment_items_picked_bin_id_idx" ON "shipment_items"("picked_bin_id");

-- CreateIndex
CREATE INDEX "awb_labels_shipment_id_is_current_idx" ON "awb_labels"("shipment_id", "is_current");

-- CreateIndex
CREATE INDEX "awb_labels_generated_at_idx" ON "awb_labels"("generated_at");

-- CreateIndex
CREATE INDEX "awb_labels_generated_by_staff_id_idx" ON "awb_labels"("generated_by_staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "awb_labels_shipment_id_version_key" ON "awb_labels"("shipment_id", "version");

-- CreateIndex
CREATE INDEX "tracking_events_shipment_id_created_at_idx" ON "tracking_events"("shipment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tracking_events_event_type_idx" ON "tracking_events"("event_type");

-- CreateIndex
CREATE INDEX "tracking_events_source_idx" ON "tracking_events"("source");

-- CreateIndex
CREATE INDEX "tracking_events_webhook_id_idx" ON "tracking_events"("webhook_id");

-- CreateIndex
-- Declared explicitly so Prisma's migration history owns it (matches the
-- pattern used for stock_movements_created_at_idx). Without this, TimescaleDB's
-- create_hypertable() below auto-creates an identically-named index outside
-- Prisma's tracking, which trips drift detection on every subsequent migration.
CREATE INDEX "tracking_events_created_at_idx" ON "tracking_events"("created_at");

-- CreateIndex
CREATE INDEX "courier_webhooks_courier_code_idx" ON "courier_webhooks"("courier_code");

-- CreateIndex
CREATE INDEX "courier_webhooks_shipment_id_idx" ON "courier_webhooks"("shipment_id");

-- CreateIndex
CREATE INDEX "courier_webhooks_awb_number_idx" ON "courier_webhooks"("awb_number");

-- CreateIndex
CREATE INDEX "courier_webhooks_received_at_idx" ON "courier_webhooks"("received_at");

-- CreateIndex
CREATE INDEX "courier_webhooks_status_idx" ON "courier_webhooks"("status");

-- CreateIndex
CREATE INDEX "courier_webhooks_next_retry_at_status_idx" ON "courier_webhooks"("next_retry_at", "status");

-- CreateIndex
CREATE INDEX "delivery_attempts_shipment_id_idx" ON "delivery_attempts"("shipment_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_outcome_idx" ON "delivery_attempts"("outcome");

-- CreateIndex
CREATE INDEX "delivery_attempts_failure_reason_idx" ON "delivery_attempts"("failure_reason");

-- CreateIndex
CREATE INDEX "delivery_attempts_attempted_at_idx" ON "delivery_attempts"("attempted_at");

-- CreateIndex
CREATE INDEX "delivery_attempts_webhook_id_idx" ON "delivery_attempts"("webhook_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_attempts_shipment_id_attempt_number_key" ON "delivery_attempts"("shipment_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "couriers_code_key" ON "couriers"("code");

-- CreateIndex
CREATE INDEX "couriers_is_active_idx" ON "couriers"("is_active");

-- CreateIndex
CREATE INDEX "couriers_priority_for_routing_idx" ON "couriers"("priority_for_routing");

-- CreateIndex
CREATE INDEX "couriers_deleted_at_idx" ON "couriers"("deleted_at");

-- CreateIndex
CREATE INDEX "courier_credentials_courier_id_idx" ON "courier_credentials"("courier_id");

-- CreateIndex
CREATE INDEX "courier_credentials_environment_idx" ON "courier_credentials"("environment");

-- CreateIndex
CREATE INDEX "courier_credentials_is_active_idx" ON "courier_credentials"("is_active");

-- CreateIndex
CREATE INDEX "courier_credentials_deleted_at_idx" ON "courier_credentials"("deleted_at");

-- CreateIndex
CREATE INDEX "courier_credentials_created_by_staff_id_idx" ON "courier_credentials"("created_by_staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "courier_credentials_courier_id_environment_is_active_key" ON "courier_credentials"("courier_id", "environment", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "rate_cards_code_key" ON "rate_cards"("code");

-- CreateIndex
CREATE INDEX "rate_cards_is_default_idx" ON "rate_cards"("is_default");

-- CreateIndex
CREATE INDEX "rate_cards_is_active_idx" ON "rate_cards"("is_active");

-- CreateIndex
CREATE INDEX "rate_cards_effective_from_effective_to_idx" ON "rate_cards"("effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "rate_cards_deleted_at_idx" ON "rate_cards"("deleted_at");

-- CreateIndex
CREATE INDEX "rate_cards_created_by_staff_id_idx" ON "rate_cards"("created_by_staff_id");

-- CreateIndex
CREATE INDEX "rate_card_items_rate_card_id_courier_id_idx" ON "rate_card_items"("rate_card_id", "courier_id");

-- CreateIndex
CREATE INDEX "rate_card_items_zone_idx" ON "rate_card_items"("zone");

-- CreateIndex
CREATE INDEX "rate_card_items_weight_slab_from_grams_weight_slab_to_grams_idx" ON "rate_card_items"("weight_slab_from_grams", "weight_slab_to_grams");

-- CreateIndex
CREATE INDEX "rate_card_items_is_active_idx" ON "rate_card_items"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "rate_card_items_rate_card_id_courier_id_service_type_zone_w_key" ON "rate_card_items"("rate_card_id", "courier_id", "service_type", "zone", "weight_slab_from_grams");

-- CreateIndex
CREATE INDEX "seller_pricing_seller_id_is_active_idx" ON "seller_pricing"("seller_id", "is_active");

-- CreateIndex
CREATE INDEX "seller_pricing_rate_card_id_idx" ON "seller_pricing"("rate_card_id");

-- CreateIndex
CREATE INDEX "seller_pricing_effective_from_effective_to_idx" ON "seller_pricing"("effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "seller_pricing_deleted_at_idx" ON "seller_pricing"("deleted_at");

-- CreateIndex
CREATE INDEX "seller_pricing_courier_id_idx" ON "seller_pricing"("courier_id");

-- CreateIndex
CREATE INDEX "seller_pricing_approved_by_staff_id_idx" ON "seller_pricing"("approved_by_staff_id");

-- CreateIndex
CREATE INDEX "zone_matrix_entries_courier_id_idx" ON "zone_matrix_entries"("courier_id");

-- CreateIndex
CREATE INDEX "zone_matrix_entries_zone_idx" ON "zone_matrix_entries"("zone");

-- CreateIndex
CREATE UNIQUE INDEX "zone_matrix_entries_courier_id_origin_area_dest_area_key" ON "zone_matrix_entries"("courier_id", "origin_area", "dest_area");

-- CreateIndex
CREATE INDEX "surcharge_rules_rate_card_id_idx" ON "surcharge_rules"("rate_card_id");

-- CreateIndex
CREATE INDEX "surcharge_rules_type_idx" ON "surcharge_rules"("type");

-- CreateIndex
CREATE INDEX "surcharge_rules_is_active_idx" ON "surcharge_rules"("is_active");

-- CreateIndex
CREATE INDEX "surcharge_rules_deleted_at_idx" ON "surcharge_rules"("deleted_at");

-- CreateIndex
CREATE INDEX "fx_rates_override_by_staff_id_idx" ON "fx_rates"("override_by_staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_from_currency_to_currency_key" ON "fx_rates"("from_currency", "to_currency");

-- CreateIndex
CREATE INDEX "order_charges_order_id_idx" ON "order_charges"("order_id");

-- CreateIndex
CREATE INDEX "order_charges_shipment_id_idx" ON "order_charges"("shipment_id");

-- CreateIndex
CREATE INDEX "order_charges_type_idx" ON "order_charges"("type");

-- CreateIndex
CREATE INDEX "order_charges_status_idx" ON "order_charges"("status");

-- CreateIndex
CREATE INDEX "order_charges_rate_card_id_idx" ON "order_charges"("rate_card_id");

-- CreateIndex
CREATE INDEX "order_charges_surcharge_rule_id_idx" ON "order_charges"("surcharge_rule_id");

-- CreateIndex
CREATE INDEX "order_charges_deleted_at_idx" ON "order_charges"("deleted_at");

-- CreateIndex
CREATE INDEX "notification_templates_code_idx" ON "notification_templates"("code");

-- CreateIndex
CREATE INDEX "notification_templates_channel_idx" ON "notification_templates"("channel");

-- CreateIndex
CREATE INDEX "notification_templates_recipient_type_idx" ON "notification_templates"("recipient_type");

-- CreateIndex
CREATE INDEX "notification_templates_is_active_idx" ON "notification_templates"("is_active");

-- CreateIndex
CREATE INDEX "notification_templates_deleted_at_idx" ON "notification_templates"("deleted_at");

-- CreateIndex
CREATE INDEX "notification_templates_last_edited_by_staff_id_idx" ON "notification_templates"("last_edited_by_staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_code_language_key" ON "notification_templates"("code", "language");

-- CreateIndex
CREATE INDEX "notification_logs_recipient_type_recipient_id_idx" ON "notification_logs"("recipient_type", "recipient_id");

-- CreateIndex
CREATE INDEX "notification_logs_order_id_idx" ON "notification_logs"("order_id");

-- CreateIndex
CREATE INDEX "notification_logs_shipment_id_idx" ON "notification_logs"("shipment_id");

-- CreateIndex
CREATE INDEX "notification_logs_status_idx" ON "notification_logs"("status");

-- CreateIndex
CREATE INDEX "notification_logs_provider_message_id_idx" ON "notification_logs"("provider_message_id");

-- CreateIndex
CREATE INDEX "notification_logs_template_code_created_at_idx" ON "notification_logs"("template_code", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_created_at_idx" ON "notification_logs"("created_at");

-- CreateIndex
CREATE INDEX "notification_logs_template_id_idx" ON "notification_logs"("template_id");

-- CreateIndex
CREATE INDEX "notification_logs_call_attempt_id_idx" ON "notification_logs"("call_attempt_id");

-- CreateIndex
CREATE INDEX "notification_logs_parent_notification_id_idx" ON "notification_logs"("parent_notification_id");

-- CreateIndex
CREATE INDEX "seller_webhook_endpoints_seller_id_is_active_idx" ON "seller_webhook_endpoints"("seller_id", "is_active");

-- CreateIndex
CREATE INDEX "seller_webhook_endpoints_is_active_idx" ON "seller_webhook_endpoints"("is_active");

-- CreateIndex
CREATE INDEX "seller_webhook_endpoints_deleted_at_idx" ON "seller_webhook_endpoints"("deleted_at");

-- CreateIndex
CREATE INDEX "outbound_webhook_deliveries_endpoint_id_status_idx" ON "outbound_webhook_deliveries"("endpoint_id", "status");

-- CreateIndex
CREATE INDEX "outbound_webhook_deliveries_status_next_retry_at_idx" ON "outbound_webhook_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "outbound_webhook_deliveries_event_type_event_id_idx" ON "outbound_webhook_deliveries"("event_type", "event_id");

-- CreateIndex
CREATE INDEX "outbound_webhook_deliveries_scheduled_at_idx" ON "outbound_webhook_deliveries"("scheduled_at");

-- CreateIndex
CREATE INDEX "outbound_webhook_deliveries_sent_at_idx" ON "outbound_webhook_deliveries"("sent_at");

-- CreateIndex
CREATE INDEX "outbound_webhook_deliveries_parent_delivery_id_idx" ON "outbound_webhook_deliveries"("parent_delivery_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_webhook_deliveries_endpoint_id_event_type_event_id_key" ON "outbound_webhook_deliveries"("endpoint_id", "event_type", "event_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE INDEX "system_settings_category_idx" ON "system_settings"("category");

-- CreateIndex
CREATE INDEX "system_settings_last_edited_by_staff_id_idx" ON "system_settings"("last_edited_by_staff_id");

-- CreateIndex
CREATE INDEX "seller_notification_preferences_seller_id_idx" ON "seller_notification_preferences"("seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_notification_preferences_seller_id_category_key" ON "seller_notification_preferences"("seller_id", "category");

-- AddForeignKey
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_invitations" ADD CONSTRAINT "seller_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_invitations" ADD CONSTRAINT "seller_invitations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_refresh_tokens" ADD CONSTRAINT "staff_refresh_tokens_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_refresh_tokens" ADD CONSTRAINT "seller_refresh_tokens_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_api_keys" ADD CONSTRAINT "seller_api_keys_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_password_reset_tokens" ADD CONSTRAINT "staff_password_reset_tokens_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_password_reset_tokens" ADD CONSTRAINT "seller_password_reset_tokens_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_email_verification_tokens" ADD CONSTRAINT "staff_email_verification_tokens_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_email_verification_tokens" ADD CONSTRAINT "seller_email_verification_tokens_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_notes" ADD CONSTRAINT "seller_notes_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_notes" ADD CONSTRAINT "seller_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_zones" ADD CONSTRAINT "warehouse_zones_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_bins" ADD CONSTRAINT "warehouse_bins_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_bins" ADD CONSTRAINT "warehouse_bins_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "warehouse_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_uploaded_by_seller_id_fkey" FOREIGN KEY ("uploaded_by_seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_uploaded_by_staff_id_fkey" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_courier_rules" ADD CONSTRAINT "category_courier_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_receiving_note_id_fkey" FOREIGN KEY ("receiving_note_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "warehouse_bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "warehouse_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_bin_id_fkey" FOREIGN KEY ("from_bin_id") REFERENCES "warehouse_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_bin_id_fkey" FOREIGN KEY ("to_bin_id") REFERENCES "warehouse_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "warehouse_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "warehouse_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_cycle_count_id_fkey" FOREIGN KEY ("cycle_count_id") REFERENCES "cycle_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "warehouse_bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_counted_by_id_fkey" FOREIGN KEY ("counted_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_putaway_bin_id_fkey" FOREIGN KEY ("putaway_bin_id") REFERENCES "warehouse_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_bulk_upload_id_fkey" FOREIGN KEY ("bulk_upload_id") REFERENCES "bulk_order_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_picked_batch_id_fkey" FOREIGN KEY ("picked_batch_id") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_picked_bin_id_fkey" FOREIGN KEY ("picked_bin_id") REFERENCES "warehouse_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_order_uploads" ADD CONSTRAINT "bulk_order_uploads_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_order_uploads" ADD CONSTRAINT "bulk_order_uploads_uploaded_by_seller_id_fkey" FOREIGN KEY ("uploaded_by_seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_order_uploads" ADD CONSTRAINT "bulk_order_uploads_uploaded_by_staff_id_fkey" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_recipient_address_cache" ADD CONSTRAINT "order_recipient_address_cache_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_queue_entries" ADD CONSTRAINT "call_queue_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_queue_entries" ADD CONSTRAINT "call_queue_entries_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "call_queue_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_call_settings" ADD CONSTRAINT "agent_call_settings_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_courier_code_fkey" FOREIGN KEY ("courier_code") REFERENCES "couriers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_warehouse_id_fkey" FOREIGN KEY ("origin_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_supersedes_shipment_id_fkey" FOREIGN KEY ("supersedes_shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_picked_batch_id_fkey" FOREIGN KEY ("picked_batch_id") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_picked_bin_id_fkey" FOREIGN KEY ("picked_bin_id") REFERENCES "warehouse_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awb_labels" ADD CONSTRAINT "awb_labels_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awb_labels" ADD CONSTRAINT "awb_labels_generated_by_staff_id_fkey" FOREIGN KEY ("generated_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "courier_webhooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_webhooks" ADD CONSTRAINT "courier_webhooks_courier_code_fkey" FOREIGN KEY ("courier_code") REFERENCES "couriers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_webhooks" ADD CONSTRAINT "courier_webhooks_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "courier_webhooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_credentials" ADD CONSTRAINT "courier_credentials_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_credentials" ADD CONSTRAINT "courier_credentials_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_card_items" ADD CONSTRAINT "rate_card_items_rate_card_id_fkey" FOREIGN KEY ("rate_card_id") REFERENCES "rate_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_card_items" ADD CONSTRAINT "rate_card_items_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_pricing" ADD CONSTRAINT "seller_pricing_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_pricing" ADD CONSTRAINT "seller_pricing_rate_card_id_fkey" FOREIGN KEY ("rate_card_id") REFERENCES "rate_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_pricing" ADD CONSTRAINT "seller_pricing_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_pricing" ADD CONSTRAINT "seller_pricing_approved_by_staff_id_fkey" FOREIGN KEY ("approved_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_matrix_entries" ADD CONSTRAINT "zone_matrix_entries_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surcharge_rules" ADD CONSTRAINT "surcharge_rules_rate_card_id_fkey" FOREIGN KEY ("rate_card_id") REFERENCES "rate_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_override_by_staff_id_fkey" FOREIGN KEY ("override_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_charges" ADD CONSTRAINT "order_charges_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_charges" ADD CONSTRAINT "order_charges_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_charges" ADD CONSTRAINT "order_charges_rate_card_id_fkey" FOREIGN KEY ("rate_card_id") REFERENCES "rate_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_charges" ADD CONSTRAINT "order_charges_surcharge_rule_id_fkey" FOREIGN KEY ("surcharge_rule_id") REFERENCES "surcharge_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_last_edited_by_staff_id_fkey" FOREIGN KEY ("last_edited_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_call_attempt_id_fkey" FOREIGN KEY ("call_attempt_id") REFERENCES "call_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_parent_notification_id_fkey" FOREIGN KEY ("parent_notification_id") REFERENCES "notification_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_webhook_endpoints" ADD CONSTRAINT "seller_webhook_endpoints_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_webhook_deliveries" ADD CONSTRAINT "outbound_webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "seller_webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_webhook_deliveries" ADD CONSTRAINT "outbound_webhook_deliveries_parent_delivery_id_fkey" FOREIGN KEY ("parent_delivery_id") REFERENCES "outbound_webhook_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_last_edited_by_staff_id_fkey" FOREIGN KEY ("last_edited_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_notification_preferences" ADD CONSTRAINT "seller_notification_preferences_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- TimescaleDB setup (appended manually to the initial migration).
-- The extension is pre-created in docker/init/01-extensions.sql, but
-- the IF NOT EXISTS guard keeps this migration self-contained for any
-- environment that hasn't run that bootstrap.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Convert tracking_events to a hypertable partitioned by created_at,
-- with 1-month chunks.
SELECT create_hypertable(
  'tracking_events',
  'created_at',
  chunk_time_interval => INTERVAL '1 month',
  if_not_exists => TRUE
);

ALTER TABLE tracking_events SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'created_at DESC',
  timescaledb.compress_segmentby = 'shipment_id'
);

SELECT add_compression_policy(
  'tracking_events',
  INTERVAL '7 days',
  if_not_exists => TRUE
);

-- Convert stock_movements to a hypertable partitioned by created_at,
-- with 1-month chunks.
SELECT create_hypertable(
  'stock_movements',
  'created_at',
  chunk_time_interval => INTERVAL '1 month',
  if_not_exists => TRUE
);

ALTER TABLE stock_movements SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'created_at DESC',
  timescaledb.compress_segmentby = 'seller_id, variant_id'
);

SELECT add_compression_policy(
  'stock_movements',
  INTERVAL '30 days',
  if_not_exists => TRUE
);
