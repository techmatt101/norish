ALTER TABLE "ingredients" ADD COLUMN "alt_names" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "normalized_alt_names" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_ingredients_normalized_alt_names" ON "ingredients" USING gin ("normalized_alt_names");