-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('active', 'invited', 'disabled');

-- CreateEnum
CREATE TYPE "ContentItemStatus" AS ENUM ('draft', 'ready', 'scheduled', 'published', 'archived');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('xiaohongshu', 'zhihu', 'wechat_official_account', 'x_twitter');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('original', 'note', 'article', 'answer', 'idea', 'wechat_article', 'tweet', 'thread');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('image', 'video', 'file');

-- CreateEnum
CREATE TYPE "PlatformAccessType" AS ENUM ('official_api', 'draft_api', 'browser_assist', 'manual');

-- CreateEnum
CREATE TYPE "PlatformAuthStatus" AS ENUM ('active', 'unauthorized', 'disabled', 'limited', 'deleted');

-- CreateEnum
CREATE TYPE "PublishTaskStatus" AS ENUM ('draft', 'scheduled', 'processing', 'waiting_manual', 'partial_success', 'success', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "PublishTargetStatus" AS ENUM ('pending', 'scheduled', 'processing', 'draft_created', 'manual_required', 'manual_in_progress', 'success', 'failed', 'skipped', 'canceled');

-- CreateEnum
CREATE TYPE "PublishErrorType" AS ENUM ('validation_error', 'unauthorized', 'rate_limited', 'provider_error', 'network_error', 'manual_required', 'unknown');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('manual', 'api');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('pending', 'processing', 'success', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_content" TEXT,
    "product_info" TEXT,
    "target_audience" TEXT,
    "marketing_goal" TEXT,
    "status" "ContentItemStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_versions" (
    "id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "content_type" "ContentType" NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "tags" JSONB,
    "topics" JSONB,
    "settings" JSONB,
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "edited_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_version_revisions" (
    "id" TEXT NOT NULL,
    "content_version_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_by" TEXT,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_version_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "asset_type" "AssetType" NOT NULL,
    "path" TEXT NOT NULL,
    "thumbnail_path" TEXT,
    "size" INTEGER NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_version_media" (
    "content_version_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_version_media_pkey" PRIMARY KEY ("content_version_id","media_asset_id")
);

-- CreateTable
CREATE TABLE "platform_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "display_name" TEXT NOT NULL,
    "username" TEXT,
    "provider_account_id" TEXT,
    "avatar_url" TEXT,
    "access_type" "PlatformAccessType" NOT NULL,
    "auth_status" "PlatformAuthStatus" NOT NULL DEFAULT 'active',
    "token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "platform_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_account_auth_logs" (
    "id" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_account_auth_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "status" "PublishTaskStatus" NOT NULL DEFAULT 'draft',
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "publish_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_targets" (
    "id" TEXT NOT NULL,
    "publish_task_id" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "content_version_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "status" "PublishTargetStatus" NOT NULL DEFAULT 'pending',
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_type" "PublishErrorType",
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publish_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_results" (
    "id" TEXT NOT NULL,
    "publish_target_id" TEXT NOT NULL,
    "provider_post_id" TEXT,
    "external_url" TEXT,
    "response_data" JSONB,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publish_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_errors" (
    "id" TEXT NOT NULL,
    "publish_target_id" TEXT NOT NULL,
    "error_type" "PublishErrorType" NOT NULL,
    "error_message" TEXT NOT NULL,
    "error_detail" JSONB,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publish_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_publish_instructions" (
    "id" TEXT NOT NULL,
    "publish_target_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "account_snapshot" JSONB NOT NULL,
    "content_snapshot" JSONB NOT NULL,
    "media_snapshot" JSONB,
    "instruction" JSONB NOT NULL,
    "checklist" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_publish_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generation_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "content_item_id" TEXT,
    "content_version_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" "AiJobStatus" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_style_templates" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "content_type" "ContentType" NOT NULL,
    "name" TEXT NOT NULL,
    "prompt_template" TEXT NOT NULL,
    "rules" JSONB,
    "examples" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_style_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_metrics" (
    "id" TEXT NOT NULL,
    "publish_result_id" TEXT NOT NULL,
    "source" "MetricSource" NOT NULL DEFAULT 'manual',
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "favorites" INTEGER,
    "shares" INTEGER,
    "raw_data" JSONB,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publish_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "organizations_name_idx" ON "organizations"("name");

-- CreateIndex
CREATE INDEX "organization_members_user_id_status_idx" ON "organization_members"("user_id", "status");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_role_idx" ON "organization_members"("organization_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "content_items_organization_id_created_at_idx" ON "content_items"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "content_items_organization_id_status_idx" ON "content_items"("organization_id", "status");

-- CreateIndex
CREATE INDEX "content_items_created_by_created_at_idx" ON "content_items"("created_by", "created_at");

-- CreateIndex
CREATE INDEX "content_items_deleted_at_idx" ON "content_items"("deleted_at");

-- CreateIndex
CREATE INDEX "content_versions_content_item_id_platform_idx" ON "content_versions"("content_item_id", "platform");

-- CreateIndex
CREATE INDEX "content_versions_content_item_id_platform_content_type_idx" ON "content_versions"("content_item_id", "platform", "content_type");

-- CreateIndex
CREATE INDEX "content_versions_edited_by_updated_at_idx" ON "content_versions"("edited_by", "updated_at");

-- CreateIndex
CREATE INDEX "content_versions_deleted_at_idx" ON "content_versions"("deleted_at");

-- CreateIndex
CREATE INDEX "content_version_revisions_content_version_id_created_at_idx" ON "content_version_revisions"("content_version_id", "created_at");

-- CreateIndex
CREATE INDEX "content_version_revisions_changed_by_created_at_idx" ON "content_version_revisions"("changed_by", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_organization_id_created_at_idx" ON "media_assets"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_uploaded_by_created_at_idx" ON "media_assets"("uploaded_by", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_organization_id_asset_type_idx" ON "media_assets"("organization_id", "asset_type");

-- CreateIndex
CREATE INDEX "media_assets_deleted_at_idx" ON "media_assets"("deleted_at");

-- CreateIndex
CREATE INDEX "content_version_media_media_asset_id_idx" ON "content_version_media"("media_asset_id");

-- CreateIndex
CREATE INDEX "content_version_media_content_version_id_sort_order_idx" ON "content_version_media"("content_version_id", "sort_order");

-- CreateIndex
CREATE INDEX "platform_accounts_organization_id_platform_idx" ON "platform_accounts"("organization_id", "platform");

-- CreateIndex
CREATE INDEX "platform_accounts_organization_id_auth_status_idx" ON "platform_accounts"("organization_id", "auth_status");

-- CreateIndex
CREATE INDEX "platform_accounts_platform_provider_account_id_idx" ON "platform_accounts"("platform", "provider_account_id");

-- CreateIndex
CREATE INDEX "platform_accounts_deleted_at_idx" ON "platform_accounts"("deleted_at");

-- CreateIndex
CREATE INDEX "platform_account_auth_logs_platform_account_id_created_at_idx" ON "platform_account_auth_logs"("platform_account_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_account_auth_logs_event_type_created_at_idx" ON "platform_account_auth_logs"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "publish_tasks_organization_id_scheduled_at_idx" ON "publish_tasks"("organization_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "publish_tasks_organization_id_status_idx" ON "publish_tasks"("organization_id", "status");

-- CreateIndex
CREATE INDEX "publish_tasks_content_item_id_idx" ON "publish_tasks"("content_item_id");

-- CreateIndex
CREATE INDEX "publish_tasks_created_by_created_at_idx" ON "publish_tasks"("created_by", "created_at");

-- CreateIndex
CREATE INDEX "publish_tasks_deleted_at_idx" ON "publish_tasks"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "publish_targets_idempotency_key_key" ON "publish_targets"("idempotency_key");

-- CreateIndex
CREATE INDEX "publish_targets_publish_task_id_idx" ON "publish_targets"("publish_task_id");

-- CreateIndex
CREATE INDEX "publish_targets_status_scheduled_at_idx" ON "publish_targets"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "publish_targets_platform_account_id_status_idx" ON "publish_targets"("platform_account_id", "status");

-- CreateIndex
CREATE INDEX "publish_targets_platform_status_idx" ON "publish_targets"("platform", "status");

-- CreateIndex
CREATE UNIQUE INDEX "publish_results_publish_target_id_key" ON "publish_results"("publish_target_id");

-- CreateIndex
CREATE INDEX "publish_results_provider_post_id_idx" ON "publish_results"("provider_post_id");

-- CreateIndex
CREATE INDEX "publish_results_published_at_idx" ON "publish_results"("published_at");

-- CreateIndex
CREATE INDEX "publish_errors_publish_target_id_created_at_idx" ON "publish_errors"("publish_target_id", "created_at");

-- CreateIndex
CREATE INDEX "publish_errors_error_type_created_at_idx" ON "publish_errors"("error_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "manual_publish_instructions_publish_target_id_key" ON "manual_publish_instructions"("publish_target_id");

-- CreateIndex
CREATE INDEX "manual_publish_instructions_platform_created_at_idx" ON "manual_publish_instructions"("platform", "created_at");

-- CreateIndex
CREATE INDEX "ai_generation_logs_organization_id_created_at_idx" ON "ai_generation_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_generation_logs_content_item_id_created_at_idx" ON "ai_generation_logs"("content_item_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_generation_logs_content_version_id_created_at_idx" ON "ai_generation_logs"("content_version_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_generation_logs_status_created_at_idx" ON "ai_generation_logs"("status", "created_at");

-- CreateIndex
CREATE INDEX "platform_style_templates_platform_content_type_active_idx" ON "platform_style_templates"("platform", "content_type", "active");

-- CreateIndex
CREATE INDEX "publish_metrics_publish_result_id_recorded_at_idx" ON "publish_metrics"("publish_result_id", "recorded_at");

-- CreateIndex
CREATE INDEX "publish_metrics_source_recorded_at_idx" ON "publish_metrics"("source", "recorded_at");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_version_revisions" ADD CONSTRAINT "content_version_revisions_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_version_revisions" ADD CONSTRAINT "content_version_revisions_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_version_media" ADD CONSTRAINT "content_version_media_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_version_media" ADD CONSTRAINT "content_version_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_account_auth_logs" ADD CONSTRAINT "platform_account_auth_logs_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_tasks" ADD CONSTRAINT "publish_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_tasks" ADD CONSTRAINT "publish_tasks_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_tasks" ADD CONSTRAINT "publish_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_targets" ADD CONSTRAINT "publish_targets_publish_task_id_fkey" FOREIGN KEY ("publish_task_id") REFERENCES "publish_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_targets" ADD CONSTRAINT "publish_targets_platform_account_id_fkey" FOREIGN KEY ("platform_account_id") REFERENCES "platform_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_targets" ADD CONSTRAINT "publish_targets_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_results" ADD CONSTRAINT "publish_results_publish_target_id_fkey" FOREIGN KEY ("publish_target_id") REFERENCES "publish_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_errors" ADD CONSTRAINT "publish_errors_publish_target_id_fkey" FOREIGN KEY ("publish_target_id") REFERENCES "publish_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_publish_instructions" ADD CONSTRAINT "manual_publish_instructions_publish_target_id_fkey" FOREIGN KEY ("publish_target_id") REFERENCES "publish_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_metrics" ADD CONSTRAINT "publish_metrics_publish_result_id_fkey" FOREIGN KEY ("publish_result_id") REFERENCES "publish_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;
