import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { versionColumn } from "./shared";

/**
 * Ingredient Names: every ingredient name a recipe line has ever used,
 * de-duplicated case-insensitively. A recipe line shows this name verbatim.
 *
 * A name can also carry an Ingredient Illustration (ADR-0033) and Alternative
 * Names (ADR-0034), both set only by an administrator. A line shows the picture
 * of the row it points at; which row that is was decided when the name was
 * written, and an Alternative Name is how "aubergine" comes to be the Eggplant
 * row rather than a second ingredient.
 *
 * `normalizedName` and `normalizedAltNames` are the one grocery folding
 * (`normalizeGroceryName`), written in JavaScript so they agree with the
 * browser. The fold is also what the Pantry matches on (ADR-0032): two names
 * that fold alike are the same thing at home, though they stay separate rows
 * here. A null `normalizedName` is a row written before the folding existed,
 * which the startup backfill fills in.
 */
export const ingredients = pgTable(
  "ingredients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name"),
    /** Other names that should show this name's picture. Used only for matching. */
    altNames: text("alt_names")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    normalizedAltNames: text("normalized_alt_names")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** A versioned, immutable path (`/ingredient-images/<id>-<stamp>.webp`), or null. */
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    ...versionColumn,
  },
  (t) => [
    uniqueIndex("uqidx_ingredients_name_lower").on(sql`lower(${t.name})`),
    index("idx_ingredients_created_at").on(t.createdAt),
    index("idx_ingredients_normalized_name").on(t.normalizedName),
    index("idx_ingredients_normalized_alt_names").using("gin", t.normalizedAltNames),
  ]
);
