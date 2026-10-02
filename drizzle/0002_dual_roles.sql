DROP INDEX "reviews_author_subject_user_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_landlord" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_renter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_author_subject_user_kind_unique" ON "reviews" USING btree ("author_id","subject_user_id","kind") WHERE "reviews"."subject_user_id" is not null;--> statement-breakpoint
CREATE INDEX "users_is_landlord_idx" ON "users" USING btree ("is_landlord") WHERE "users"."is_landlord";--> statement-breakpoint
CREATE INDEX "users_is_renter_idx" ON "users" USING btree ("is_renter") WHERE "users"."is_renter";--> statement-breakpoint
-- Existing accounts keep the single role they signed up with.
UPDATE "users" SET "is_landlord" = ("role" = 'landlord'), "is_renter" = ("role" = 'renter');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_has_a_role" CHECK ("users"."is_landlord" or "users"."is_renter");