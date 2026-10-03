CREATE TYPE "public"."report_reason" AS ENUM('wrong_person', 'wrong_name', 'false_or_abusive', 'personal_data', 'identity_claimed', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('review', 'profile', 'property', 'account');--> statement-breakpoint
CREATE TYPE "public"."review_kind" AS ENUM('landlord', 'renter', 'property');--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"unit" text,
	"postal_code" smallint NOT NULL,
	"description" text,
	"address_sort" text NOT NULL,
	"address_search" text NOT NULL,
	"landlord_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_postal_code_range" CHECK ("properties"."postal_code" between 100 and 999)
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_kind" "report_target" NOT NULL,
	"target_id" uuid,
	"reason" "report_reason" NOT NULL,
	"details" text NOT NULL,
	"contact_email" text,
	"reporter_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "review_kind" NOT NULL,
	"author_id" uuid NOT NULL,
	"subject_user_id" uuid,
	"property_id" uuid,
	"rating" smallint NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_subject_matches_kind" CHECK (("reviews"."kind" = 'property' and "reviews"."property_id" is not null and "reviews"."subject_user_id" is null)
        or ("reviews"."kind" <> 'property' and "reviews"."subject_user_id" is not null and "reviews"."property_id" is null)),
	CONSTRAINT "reviews_not_self" CHECK ("reviews"."subject_user_id" is null or "reviews"."subject_user_id" <> "reviews"."author_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kennitala" char(10) NOT NULL,
	"is_company" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"name_sort" text NOT NULL,
	"name_search" text NOT NULL,
	"email" text,
	"password_hash" text,
	"joined_at" timestamp with time zone,
	"is_landlord" boolean DEFAULT false NOT NULL,
	"is_renter" boolean DEFAULT false NOT NULL,
	"city" text,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_kennitala_digits" CHECK ("users"."kennitala" ~ '^[0-9]{10}$'),
	CONSTRAINT "users_has_a_role" CHECK ("users"."is_landlord" or "users"."is_renter"),
	CONSTRAINT "users_account_complete" CHECK (("users"."email" is null) = ("users"."password_hash" is null) and ("users"."email" is null) = ("users"."joined_at" is null)),
	CONSTRAINT "users_profile_text_needs_account" CHECK ("users"."email" is not null or ("users"."city" is null and "users"."bio" is null))
);
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_landlord_id_users_id_fk" FOREIGN KEY ("landlord_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_attempts_key_created_at_idx" ON "auth_attempts" USING btree ("key","created_at");--> statement-breakpoint
CREATE INDEX "properties_landlord_id_idx" ON "properties" USING btree ("landlord_id");--> statement-breakpoint
CREATE INDEX "properties_created_by_id_idx" ON "properties" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "properties_postal_code_idx" ON "properties" USING btree ("postal_code");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_address_unique" ON "properties" USING btree ("address_search","postal_code");--> statement-breakpoint
CREATE INDEX "reports_unresolved_idx" ON "reports" USING btree ("created_at") WHERE "reports"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_author_subject_user_kind_unique" ON "reviews" USING btree ("author_id","subject_user_id","kind") WHERE "reviews"."subject_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_author_property_unique" ON "reviews" USING btree ("author_id","property_id") WHERE "reviews"."property_id" is not null;--> statement-breakpoint
CREATE INDEX "reviews_subject_user_idx" ON "reviews" USING btree ("subject_user_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_property_idx" ON "reviews" USING btree ("property_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_author_idx" ON "reviews" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_created_at_idx" ON "reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_kennitala_unique" ON "users" USING btree ("kennitala");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_is_landlord_idx" ON "users" USING btree ("is_landlord") WHERE "users"."is_landlord";--> statement-breakpoint
CREATE INDEX "users_is_renter_idx" ON "users" USING btree ("is_renter") WHERE "users"."is_renter";--> statement-breakpoint
CREATE INDEX "users_name_sort_idx" ON "users" USING btree ("name_sort");