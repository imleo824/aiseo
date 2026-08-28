-- AISEO commercial foundation. This migration intentionally replaces the
-- pre-launch schema because no production customer data exists.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS private;

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "SiteConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'VERIFYING', 'CONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "PublishPolicy" AS ENUM ('MANUAL_REVIEW', 'AUTO_PUBLISH', 'PAUSED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GSC');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('GSC_SYNC', 'DATAFORSEO_KEYWORD_SCAN', 'CONTENT_GENERATION', 'WORDPRESS_PUBLISH', 'WORDPRESS_ROLLBACK', 'PAYMENT_VERIFY', 'AUTOMATION_RECONCILE', 'INDEXING_MONITOR');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('GSC', 'DATAFORSEO', 'KNOWLEDGE');

-- CreateEnum
CREATE TYPE "DataStatus" AS ENUM ('LIVE', 'PENDING', 'UNAVAILABLE', 'STALE');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('TEXT', 'ORIGINAL_RESEARCH', 'ALLOWLISTED_URL');

-- CreateEnum
CREATE TYPE "OpportunityType" AS ENUM ('KGR', 'CONTENT_GAP', 'EXISTING_PAGE');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'SELECTED', 'DISMISSED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('INTERVAL', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('AWAITING_TRANSFER', 'VERIFYING', 'CONFIRMED', 'CREDITED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('PURCHASE', 'CONSUMPTION', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "CreditHoldStatus" AS ENUM ('HELD', 'SETTLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('GENERATING', 'QUALITY_FAILED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHING', 'PUBLISHED', 'PUBLISH_FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PublishAttemptStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ', 'ARCHIVED');

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "platform_role" "PlatformRole" NOT NULL DEFAULT 'USER',
    "suspended_at" TIMESTAMP(3),
    "deletion_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "credit_balance_micros" BIGINT NOT NULL DEFAULT 0,
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "organization_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id","profile_id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "wordpress_credentials" BYTEA,
    "wordpress_credential_key_version" INTEGER,
    "wordpress_status" "SiteConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "wordpress_user" TEXT,
    "wordpress_verified_at" TIMESTAMP(3),
    "publish_policy" "PublishPolicy" NOT NULL DEFAULT 'MANUAL_REVIEW',
    "manual_publish_successes" INTEGER NOT NULL DEFAULT 0,
    "auto_publish_terms_accepted_at" TIMESTAMP(3),
    "auto_publish_enabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "encrypted_credentials" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "property_id" TEXT,
    "status" "SiteConnectionStatus" NOT NULL DEFAULT 'VERIFYING',
    "last_synced_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID,
    "type" "KnowledgeSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "source_url" TEXT,
    "normalized_url" TEXT,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "checksum" TEXT NOT NULL,
    "status" "DataStatus" NOT NULL DEFAULT 'LIVE',
    "fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_snapshots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID,
    "source" "DataSource" NOT NULL,
    "status" "DataStatus" NOT NULL,
    "formula_version" TEXT,
    "provider_task_id" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_from" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_scans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "snapshot_id" UUID,
    "seed_keyword" TEXT NOT NULL,
    "language_code" TEXT NOT NULL,
    "location_code" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "keyword_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "keyword_scan_id" UUID,
    "snapshot_id" UUID NOT NULL,
    "type" "OpportunityType" NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "keyword" TEXT NOT NULL,
    "search_volume" INTEGER NOT NULL,
    "keyword_difficulty" INTEGER NOT NULL,
    "allintitle_count" INTEGER NOT NULL,
    "kgr_numerator" BIGINT NOT NULL,
    "kgr_denominator" BIGINT NOT NULL,
    "roi_score_micros" BIGINT NOT NULL,
    "formula_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'PAUSED',
    "schedule_type" "ScheduleType" NOT NULL,
    "schedule_config" JSONB NOT NULL,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotency_key" TEXT,
    "queue_job_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_drafts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "seo_snapshot_id" UUID NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'GENERATING',
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "quality_report" JSONB NOT NULL,
    "data_provenance" JSONB NOT NULL,
    "knowledge_source_ids" UUID[],
    "published_url" TEXT,
    "remote_post_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_reviews" (
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_attempts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "job_run_id" UUID,
    "status" "PublishAttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt_number" INTEGER NOT NULL,
    "remote_post_id" TEXT,
    "remote_url" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publish_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexing_observations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "draft_id" UUID,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "indexed" BOOLEAN,
    "status" "DataStatus" NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "available_from" TIMESTAMP(3),
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexing_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_amount_micros" BIGINT NOT NULL,
    "credit_micros" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_prices" (
    "action" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credit_micros" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_prices_pkey" PRIMARY KEY ("action")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "package_id" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'TRC20',
    "token_contract" TEXT NOT NULL,
    "recipient_address" TEXT NOT NULL,
    "base_amount_micros" BIGINT NOT NULL,
    "expected_amount_micros" BIGINT NOT NULL,
    "credit_micros" BIGINT NOT NULL,
    "tx_hash" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'AWAITING_TRANSFER',
    "verification" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "credited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount_micros" BIGINT NOT NULL,
    "balance_after_micros" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payment_intent_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_holds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_run_id" UUID NOT NULL,
    "amount_micros" BIGINT NOT NULL,
    "status" "CreditHoldStatus" NOT NULL DEFAULT 'HELD',
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),

    CONSTRAINT "credit_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_run_id" UUID,
    "action" TEXT NOT NULL,
    "amount_micros" BIGINT NOT NULL,
    "result_type" TEXT,
    "result_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "profile_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB,
    "status_code" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "trace_id" TEXT,
    "ip_hash" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms_acceptances" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "profile_id" UUID NOT NULL,
    "document" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,

    CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "profile_id" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "worker_id" TEXT NOT NULL,
    "queues" TEXT[],
    "process_version" TEXT NOT NULL,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE INDEX "organization_members_profile_id_organization_id_idx" ON "organization_members"("profile_id", "organization_id");

-- CreateIndex
CREATE INDEX "sites_organization_id_created_at_idx" ON "sites"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sites_organization_id_domain_key" ON "sites"("organization_id", "domain");

-- CreateIndex
CREATE INDEX "integration_connections_organization_id_provider_status_idx" ON "integration_connections"("organization_id", "provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_site_id_provider_key" ON "integration_connections"("site_id", "provider");

-- CreateIndex
CREATE INDEX "knowledge_sources_organization_id_site_id_status_created_at_idx" ON "knowledge_sources"("organization_id", "site_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_sources_organization_id_checksum_key" ON "knowledge_sources"("organization_id", "checksum");

-- CreateIndex
CREATE INDEX "data_snapshots_organization_id_source_fetched_at_idx" ON "data_snapshots"("organization_id", "source", "fetched_at");

-- CreateIndex
CREATE INDEX "data_snapshots_site_id_source_fetched_at_idx" ON "data_snapshots"("site_id", "source", "fetched_at");

-- CreateIndex
CREATE INDEX "data_snapshots_provider_task_id_idx" ON "data_snapshots"("provider_task_id");

-- CreateIndex
CREATE INDEX "keyword_scans_organization_id_site_id_created_at_idx" ON "keyword_scans"("organization_id", "site_id", "created_at");

-- CreateIndex
CREATE INDEX "opportunities_organization_id_site_id_status_created_at_idx" ON "opportunities"("organization_id", "site_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "automation_tasks_status_next_run_at_idx" ON "automation_tasks"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "automation_tasks_organization_id_site_id_idx" ON "automation_tasks"("organization_id", "site_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_queue_job_id_key" ON "job_runs"("queue_job_id");

-- CreateIndex
CREATE INDEX "job_runs_organization_id_status_created_at_idx" ON "job_runs"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "job_runs_status_heartbeat_at_idx" ON "job_runs"("status", "heartbeat_at");

-- CreateIndex
CREATE INDEX "job_runs_status_available_at_idx" ON "job_runs"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_organization_id_type_idempotency_key_key" ON "job_runs"("organization_id", "type", "idempotency_key");

-- CreateIndex
CREATE INDEX "content_drafts_organization_id_site_id_status_created_at_idx" ON "content_drafts"("organization_id", "site_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "draft_reviews_draft_id_created_at_idx" ON "draft_reviews"("draft_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "publish_attempts_job_run_id_key" ON "publish_attempts"("job_run_id");

-- CreateIndex
CREATE INDEX "publish_attempts_organization_id_status_created_at_idx" ON "publish_attempts"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "publish_attempts_draft_id_attempt_number_key" ON "publish_attempts"("draft_id", "attempt_number");

-- CreateIndex
CREATE INDEX "indexing_observations_organization_id_site_id_observed_at_idx" ON "indexing_observations"("organization_id", "site_id", "observed_at");

-- CreateIndex
CREATE INDEX "indexing_observations_draft_id_observed_at_idx" ON "indexing_observations"("draft_id", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_tx_hash_key" ON "payment_intents"("tx_hash");

-- CreateIndex
CREATE INDEX "payment_intents_organization_id_status_created_at_idx" ON "payment_intents"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "payment_intents_status_expires_at_idx" ON "payment_intents"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entries_organization_id_created_at_idx" ON "ledger_entries"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_holds_job_run_id_key" ON "credit_holds"("job_run_id");

-- CreateIndex
CREATE INDEX "credit_holds_organization_id_status_idx" ON "credit_holds"("organization_id", "status");

-- CreateIndex
CREATE INDEX "usage_records_organization_id_created_at_idx" ON "usage_records"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_profile_id_organization_id_key_key" ON "idempotency_keys"("profile_id", "organization_id", "key");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "terms_acceptances_profile_id_organization_id_document_versi_key" ON "terms_acceptances"("profile_id", "organization_id", "document", "version");

-- CreateIndex
CREATE INDEX "notifications_organization_id_profile_id_status_created_at_idx" ON "notifications"("organization_id", "profile_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "worker_heartbeats_heartbeat_at_idx" ON "worker_heartbeats"("heartbeat_at");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_snapshots" ADD CONSTRAINT "data_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_snapshots" ADD CONSTRAINT "data_snapshots_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_scans" ADD CONSTRAINT "keyword_scans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_scans" ADD CONSTRAINT "keyword_scans_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_scans" ADD CONSTRAINT "keyword_scans_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "data_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_keyword_scan_id_fkey" FOREIGN KEY ("keyword_scan_id") REFERENCES "keyword_scans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "data_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_reviews" ADD CONSTRAINT "draft_reviews_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "content_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_reviews" ADD CONSTRAINT "draft_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "content_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_job_run_id_fkey" FOREIGN KEY ("job_run_id") REFERENCES "job_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indexing_observations" ADD CONSTRAINT "indexing_observations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indexing_observations" ADD CONSTRAINT "indexing_observations_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "content_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "payment_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_job_run_id_fkey" FOREIGN KEY ("job_run_id") REFERENCES "job_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase Auth owns identity and session lifecycle. Application profiles are
-- a strict extension of auth.users and never store password/session material.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_auth_user_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.integration_connections
  ADD CONSTRAINT integration_connections_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.indexing_observations
  ADD CONSTRAINT indexing_observations_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.content_drafts
  ADD CONSTRAINT content_drafts_seo_snapshot_id_fkey
  FOREIGN KEY (seo_snapshot_id) REFERENCES public.data_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE public.usage_records
  ADD CONSTRAINT usage_records_job_run_id_fkey
  FOREIGN KEY (job_run_id) REFERENCES public.job_runs(id) ON DELETE SET NULL;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_nonnegative_balance CHECK (credit_balance_micros >= 0);
ALTER TABLE public.sites
  ADD CONSTRAINT sites_manual_publish_successes_nonnegative CHECK (manual_publish_successes >= 0),
  ADD CONSTRAINT sites_auto_publish_gate CHECK (
    publish_policy <> 'AUTO_PUBLISH'
    OR (manual_publish_successes >= 3 AND auto_publish_terms_accepted_at IS NOT NULL AND auto_publish_enabled_at IS NOT NULL)
  );
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_metric_bounds CHECK (
    search_volume >= 0 AND keyword_difficulty BETWEEN 0 AND 100
    AND allintitle_count >= 0 AND kgr_denominator > 0 AND roi_score_micros >= 0
  );
ALTER TABLE public.payment_packages
  ADD CONSTRAINT payment_packages_positive_amounts CHECK (
    base_amount_micros > 0 AND credit_micros > 0
    AND base_amount_micros % 1000000 = 0
  );
ALTER TABLE public.action_prices
  ADD CONSTRAINT action_prices_positive_amount CHECK (credit_micros > 0);
ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_trc20_only CHECK (network = 'TRC20'),
  ADD CONSTRAINT payment_intents_positive_amounts CHECK (
    base_amount_micros > 0 AND expected_amount_micros >= base_amount_micros AND credit_micros > 0
  );
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_nonzero_amount CHECK (amount_micros <> 0),
  ADD CONSTRAINT ledger_entries_nonnegative_balance CHECK (balance_after_micros >= 0);
ALTER TABLE public.credit_holds
  ADD CONSTRAINT credit_holds_positive_amount CHECK (amount_micros > 0);
ALTER TABLE public.usage_records
  ADD CONSTRAINT usage_records_positive_amount CHECK (amount_micros > 0);

-- Different active intents cannot advertise the same exact six-decimal amount.
CREATE UNIQUE INDEX payment_intents_active_amount_unique
  ON public.payment_intents (expected_amount_micros)
  WHERE status IN ('AWAITING_TRANSFER', 'VERIFYING', 'CONFIRMED');

CREATE OR REPLACE FUNCTION private.handle_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, created_at, updated_at)
  VALUES (
    NEW.id,
    lower(NEW.email),
    nullif(NEW.raw_user_meta_data ->> 'display_name', ''),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET email = excluded.email,
        display_name = coalesce(excluded.display_name, public.profiles.display_name),
        updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.handle_auth_user() FROM PUBLIC;

CREATE TRIGGER auth_user_profile_sync
AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.handle_auth_user();

-- These roles must be used by DATABASE_APP_URL and DATABASE_WORKER_URL. They
-- intentionally cannot bypass RLS; deployment grants LOGIN credentials outside
-- version-controlled migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
    CREATE ROLE app_backend NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, private TO app_backend, app_worker;
GRANT USAGE ON SCHEMA supabase_migrations TO app_backend;
GRANT SELECT ON TABLE supabase_migrations.schema_migrations TO app_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_backend, app_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_backend, app_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

CREATE OR REPLACE FUNCTION private.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(current_setting('app.profile_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION private.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION private.is_worker()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
-- Production connects directly as app_worker. Membership support remains for
-- a future credential rotation that uses a member login role.
AS $$ SELECT current_user = 'app_worker' OR pg_has_role(session_user, 'app_worker', 'member') $$;

CREATE OR REPLACE FUNCTION private.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = private.current_profile_id()
      AND platform_role = 'PLATFORM_ADMIN'
      AND suspended_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_organization(candidate uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_worker()
    OR private.is_platform_admin()
    OR (
      (private.current_organization_id() IS NULL OR private.current_organization_id() = candidate)
      AND EXISTS (
        SELECT 1
        FROM public.organization_members membership
        JOIN public.organizations organization ON organization.id = membership.organization_id
        JOIN public.profiles profile ON profile.id = membership.profile_id
        WHERE membership.organization_id = candidate
          AND membership.profile_id = private.current_profile_id()
          AND organization.disabled_at IS NULL
          AND profile.suspended_at IS NULL
      )
    )
$$;

CREATE OR REPLACE FUNCTION private.can_mutate_organization(candidate uuid, minimum_role public."OrganizationRole")
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_worker()
    OR private.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members membership
      JOIN public.organizations organization ON organization.id = membership.organization_id
      JOIN public.profiles profile ON profile.id = membership.profile_id
      WHERE membership.organization_id = candidate
        AND membership.profile_id = private.current_profile_id()
        AND (private.current_organization_id() IS NULL OR private.current_organization_id() = candidate)
        AND organization.disabled_at IS NULL
        AND profile.suspended_at IS NULL
        AND (CASE membership.role
          WHEN 'OWNER' THEN 3 WHEN 'ADMIN' THEN 2 WHEN 'EDITOR' THEN 1 ELSE 0 END)
          >= (CASE minimum_role
          WHEN 'OWNER' THEN 3 WHEN 'ADMIN' THEN 2 WHEN 'EDITOR' THEN 1 ELSE 0 END)
    )
$$;

REVOKE ALL ON FUNCTION private.current_profile_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_organization_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_worker() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_platform_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_mutate_organization(uuid, public."OrganizationRole") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_profile_id() TO app_backend, app_worker;
GRANT EXECUTE ON FUNCTION private.current_organization_id() TO app_backend, app_worker;
GRANT EXECUTE ON FUNCTION private.is_worker() TO app_backend, app_worker;
GRANT EXECUTE ON FUNCTION private.is_platform_admin() TO app_backend, app_worker;
GRANT EXECUTE ON FUNCTION private.can_access_organization(uuid) TO app_backend, app_worker;
GRANT EXECUTE ON FUNCTION private.can_mutate_organization(uuid, public."OrganizationRole") TO app_backend, app_worker;

CREATE OR REPLACE FUNCTION private.bootstrap_organization(organization_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_profile uuid := private.current_profile_id();
  new_organization uuid;
BEGIN
  IF current_profile IS NULL OR length(trim(organization_name)) < 2 THEN
    RAISE EXCEPTION 'verified profile and organization name are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE profile_id = current_profile) THEN
    RAISE EXCEPTION 'profile already belongs to an organization' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.organizations (id, name, credit_balance_micros, created_at, updated_at)
  VALUES (gen_random_uuid(), trim(organization_name), 0, now(), now())
  RETURNING id INTO new_organization;
  INSERT INTO public.organization_members (organization_id, profile_id, role)
  VALUES (new_organization, current_profile, 'OWNER');
  INSERT INTO public.audit_events (organization_id, actor_id, action, target_type, target_id, metadata)
  VALUES (new_organization, current_profile, 'ORGANIZATION_BOOTSTRAPPED', 'organization', new_organization::text, '{}'::jsonb);
  RETURN new_organization;
END;
$$;
REVOKE ALL ON FUNCTION private.bootstrap_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.bootstrap_organization(text) TO app_backend;

CREATE OR REPLACE FUNCTION private.request_account_deletion()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE current_profile uuid := private.current_profile_id();
BEGIN
  IF current_profile IS NULL THEN RAISE EXCEPTION 'profile context is required' USING ERRCODE = '22023'; END IF;
  UPDATE public.organizations organization
  SET disabled_at = now(), updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM public.organization_members membership
    WHERE membership.organization_id = organization.id
      AND membership.profile_id = current_profile AND membership.role = 'OWNER'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.organization_members other_owner
    WHERE other_owner.organization_id = organization.id
      AND other_owner.profile_id <> current_profile AND other_owner.role = 'OWNER'
  );
  UPDATE public.automation_tasks task SET status = 'DISABLED', updated_at = now()
  WHERE EXISTS (SELECT 1 FROM public.organizations organization WHERE organization.id = task.organization_id AND organization.disabled_at IS NOT NULL);
  DELETE FROM public.organization_members membership
  WHERE membership.profile_id = current_profile
    AND EXISTS (
      SELECT 1 FROM public.organization_members other_owner
      WHERE other_owner.organization_id = membership.organization_id
        AND other_owner.profile_id <> current_profile AND other_owner.role = 'OWNER'
    );
  UPDATE public.profiles
  SET deletion_requested_at = now(), suspended_at = now(), updated_at = now()
  WHERE id = current_profile;
  INSERT INTO public.audit_events (actor_id, action, target_type, target_id, metadata)
  VALUES (current_profile, 'ACCOUNT_DELETION_REQUESTED', 'profile', current_profile::text, jsonb_build_object('purgeAfter', now() + interval '30 days'));
END;
$$;
REVOKE ALL ON FUNCTION private.request_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.request_account_deletion() TO app_backend;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_scope ON public.profiles
  USING (id = private.current_profile_id() OR private.is_platform_admin() OR private.is_worker())
  WITH CHECK (id = private.current_profile_id() OR private.is_platform_admin() OR private.is_worker());

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_select ON public.organizations FOR SELECT
  USING (private.can_access_organization(id));
CREATE POLICY organizations_update ON public.organizations FOR UPDATE
  USING (private.can_mutate_organization(id, 'ADMIN'))
  WITH CHECK (private.can_mutate_organization(id, 'ADMIN'));
CREATE POLICY organizations_delete ON public.organizations FOR DELETE
  USING (private.can_mutate_organization(id, 'OWNER'));

DO $rls$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'organization_members', 'sites', 'integration_connections', 'knowledge_sources',
    'data_snapshots', 'keyword_scans', 'opportunities', 'automation_tasks',
    'job_runs', 'content_drafts', 'publish_attempts', 'indexing_observations',
    'payment_intents', 'ledger_entries', 'credit_holds', 'usage_records',
    'audit_events', 'terms_acceptances', 'notifications'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('CREATE POLICY organization_select ON public.%I FOR SELECT USING (private.can_access_organization(organization_id))', relation_name);
    EXECUTE format('CREATE POLICY organization_insert ON public.%I FOR INSERT WITH CHECK (private.can_mutate_organization(organization_id, %L))', relation_name, 'EDITOR');
    EXECUTE format('CREATE POLICY organization_update ON public.%I FOR UPDATE USING (private.can_mutate_organization(organization_id, %L)) WITH CHECK (private.can_mutate_organization(organization_id, %L))', relation_name, 'EDITOR', 'EDITOR');
    EXECUTE format('CREATE POLICY organization_delete ON public.%I FOR DELETE USING (private.can_mutate_organization(organization_id, %L))', relation_name, 'ADMIN');
  END LOOP;
END
$rls$;

-- Membership administration is stricter than ordinary workspace writes.
DROP POLICY organization_insert ON public.organization_members;
DROP POLICY organization_update ON public.organization_members;
DROP POLICY organization_delete ON public.organization_members;
CREATE POLICY organization_members_insert ON public.organization_members FOR INSERT
  WITH CHECK (private.can_mutate_organization(organization_id, 'ADMIN'));
CREATE POLICY organization_members_update ON public.organization_members FOR UPDATE
  USING (private.can_mutate_organization(organization_id, 'ADMIN'))
  WITH CHECK (private.can_mutate_organization(organization_id, 'ADMIN'));
CREATE POLICY organization_members_delete ON public.organization_members FOR DELETE
  USING (private.can_mutate_organization(organization_id, 'ADMIN'));

-- Ledger rows can only be appended by the worker or a platform administrator.
DROP POLICY organization_insert ON public.ledger_entries;
DROP POLICY organization_update ON public.ledger_entries;
DROP POLICY organization_delete ON public.ledger_entries;
CREATE POLICY ledger_entries_insert ON public.ledger_entries FOR INSERT
  WITH CHECK (private.is_worker() OR private.is_platform_admin());

ALTER TABLE public.draft_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY draft_reviews_scope ON public.draft_reviews
  USING (EXISTS (
    SELECT 1 FROM public.content_drafts draft
    WHERE draft.id = draft_id AND private.can_access_organization(draft.organization_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.content_drafts draft
    WHERE draft.id = draft_id AND private.can_access_organization(draft.organization_id)
  ));

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_scope ON public.idempotency_keys
  USING (
    profile_id = private.current_profile_id()
    AND (organization_id IS NULL OR private.can_access_organization(organization_id))
  )
  WITH CHECK (
    profile_id = private.current_profile_id()
    AND (organization_id IS NULL OR private.can_access_organization(organization_id))
  );

ALTER TABLE public.payment_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_packages_read ON public.payment_packages FOR SELECT
  USING (private.current_profile_id() IS NOT NULL OR private.is_worker());
CREATE POLICY payment_packages_admin_write ON public.payment_packages
  USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());

ALTER TABLE public.action_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_prices FORCE ROW LEVEL SECURITY;
CREATE POLICY action_prices_read ON public.action_prices FOR SELECT
  USING (private.current_profile_id() IS NOT NULL OR private.is_worker());
CREATE POLICY action_prices_admin_write ON public.action_prices
  USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());

ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_heartbeats FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_heartbeats_worker ON public.worker_heartbeats
  USING (
    current_user = 'app_backend'
    OR pg_has_role(session_user, 'app_backend', 'member')
    OR private.is_worker()
    OR private.is_platform_admin()
  )
  WITH CHECK (private.is_worker() OR private.is_platform_admin());

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY system_settings_admin ON public.system_settings
  USING (private.is_platform_admin() OR private.is_worker())
  WITH CHECK (private.is_platform_admin() OR private.is_worker());

CREATE OR REPLACE FUNCTION private.prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION private.prevent_ledger_mutation() FROM PUBLIC;
CREATE TRIGGER ledger_entries_immutable
BEFORE UPDATE OR DELETE ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION private.prevent_ledger_mutation();
REVOKE UPDATE, DELETE ON public.ledger_entries FROM app_backend, app_worker;

CREATE OR REPLACE FUNCTION private.validate_ledger_append()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE current_balance bigint;
BEGIN
  SELECT credit_balance_micros INTO current_balance
  FROM public.organizations WHERE id = NEW.organization_id FOR SHARE;
  IF current_balance IS NULL OR current_balance <> NEW.balance_after_micros THEN
    RAISE EXCEPTION 'ledger balance does not match organization balance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_ledger_append() FROM PUBLIC;
CREATE TRIGGER ledger_entries_balance_check
BEFORE INSERT ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION private.validate_ledger_append();

CREATE OR REPLACE FUNCTION private.validate_payment_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'AWAITING_TRANSFER' AND NEW.status IN ('VERIFYING', 'EXPIRED', 'REJECTED'))
    OR (OLD.status = 'VERIFYING' AND NEW.status IN ('CONFIRMED', 'EXPIRED', 'REJECTED'))
    OR (OLD.status = 'CONFIRMED' AND NEW.status IN ('CREDITED', 'REJECTED'))
  ) THEN
    RAISE EXCEPTION 'invalid payment transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_payment_transition() FROM PUBLIC;
CREATE TRIGGER payment_intents_state_machine
BEFORE UPDATE OF status ON public.payment_intents
FOR EACH ROW EXECUTE FUNCTION private.validate_payment_transition();

CREATE OR REPLACE FUNCTION private.protect_platform_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.platform_role <> OLD.platform_role
    AND current_user NOT IN ('postgres', 'supabase_admin')
    AND NOT private.is_platform_admin() THEN
    RAISE EXCEPTION 'platform role requires audited bootstrap/admin action' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_platform_role() FROM PUBLIC;
CREATE TRIGGER profiles_platform_role_guard
BEFORE UPDATE OF platform_role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.protect_platform_role();

INSERT INTO public.payment_packages
  (id, name, base_amount_micros, credit_micros, active, sort_order, updated_at)
VALUES
  ('starter', 'Starter', 19000000, 1900000000, true, 10, now()),
  ('growth', 'Growth', 49000000, 5390000000, true, 20, now()),
  ('scale', 'Scale', 99000000, 11880000000, true, 30, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.action_prices
  (action, name, credit_micros, description, active, updated_at)
VALUES
  ('KEYWORD_SCAN', '关键词真实数据扫描', 5000000, 'DataForSEO 搜索量、KD、SERP 与 allintitle 数据', true, now()),
  ('CONTENT_GENERATION', '内容生成', 20000000, '基于真实快照与客户知识源生成并通过质量门禁', true, now())
ON CONFLICT (action) DO NOTHING;
