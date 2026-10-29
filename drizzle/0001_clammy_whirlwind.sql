CREATE TYPE "public"."sync_status" AS ENUM('syncing', 'synced', 'not synced');--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "sync_status" "sync_status" DEFAULT 'not synced' NOT NULL;