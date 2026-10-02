DROP INDEX "users_role_idx";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" DROP NOT NULL;--> statement-breakpoint
-- Transitional (drop with the "role" column in a later migration): while a
-- deployment running the previous code may still be live, keep "role" and the
-- new flags in sync both ways. Old code inserts only "role"; new code sets only
-- the flags.
CREATE OR REPLACE FUNCTION "users_sync_legacy_role"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" IS NOT NULL AND NOT (NEW."is_landlord" OR NEW."is_renter") THEN
    NEW."is_landlord" := NEW."role" = 'landlord';
    NEW."is_renter" := NEW."role" = 'renter';
  END IF;
  IF NEW."role" IS NULL
    OR (NEW."role" = 'landlord' AND NOT NEW."is_landlord")
    OR (NEW."role" = 'renter' AND NOT NEW."is_renter") THEN
    NEW."role" := CASE WHEN NEW."is_landlord" THEN 'landlord'::"user_role" ELSE 'renter'::"user_role" END;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "users_sync_legacy_role" ON "users";--> statement-breakpoint
CREATE TRIGGER "users_sync_legacy_role" BEFORE INSERT OR UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION "users_sync_legacy_role"();
