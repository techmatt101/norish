import { asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import z from "zod";

import type { UnitsMap } from "@norish/config/zod/server-config";
import type { IngredientDto } from "@norish/shared/contracts/dto/ingredient";
import type { MeasurementSystem } from "@norish/shared/contracts/dto/recipe";
import type {
  RecipeIngredientInsertDto,
  RecipeIngredientsDto,
} from "@norish/shared/contracts/dto/recipe-ingredient";
import defaultUnits from "@norish/config/units.default.json";
import {
  ServerConfigKeys,
  UnitsConfigSchema,
  UnitsMapSchema,
} from "@norish/config/zod/server-config";
import { db } from "@norish/db/drizzle";
import { dbLogger } from "@norish/db/logger";
import { getConfig } from "@norish/db/repositories/server-config";
import { ingredients, recipeIngredients } from "@norish/db/schema";
import { IngredientSelectBaseSchema } from "@norish/shared/contracts/zod";
import {
  RecipeIngredientInputSchema,
  RecipeIngredientSelectWithNameSchema,
  RecipeIngredientsInsertBaseSchema,
} from "@norish/shared/contracts/zod/recipe-ingredients";
import { stripHtmlTags } from "@norish/shared/lib/helpers";
import { normalizeGroceryName } from "@norish/shared/lib/normalized-name";
import { normalizeUnit } from "@norish/shared/lib/unit-localization";

const IngredientArraySchema = z.array(IngredientSelectBaseSchema);

export async function getUnitsForNormalization(): Promise<UnitsMap> {
  const value = await getConfig<unknown>(ServerConfigKeys.UNITS);

  const wrapped = UnitsConfigSchema.safeParse(value);

  if (wrapped.success) {
    return wrapped.data.units;
  }

  const legacyWrapped =
    typeof value === "object" && value !== null && "units" in value && "isOverwritten" in value
      ? UnitsMapSchema.safeParse((value as { units: unknown }).units)
      : null;

  if (legacyWrapped?.success) {
    return legacyWrapped.data;
  }

  const legacy = UnitsMapSchema.safeParse(value);

  if (legacy.success) {
    return legacy.data;
  }

  return defaultUnits as UnitsMap;
}

/**
 * The columns a new Ingredient Name row is written with: the name and its
 * folded form, which is what every other name is matched against (ADR-0034)
 * and what the Pantry compares (ADR-0032). Used by every path that mints
 * Ingredient Names, so a name is folded the moment it exists.
 */
function ingredientNameRowValues(names: readonly string[]) {
  return names.map((name) => ({ name, normalizedName: normalizeGroceryName(name) }));
}

/** The one key a name is looked up by, here and in the browser. */
function nameKey(name: string): string {
  return normalizeGroceryName(name);
}

/** How well a row answers to a name; the lowest rank wins. */
function matchRank(row: IngredientDto, lower: string, fold: string): number | null {
  if (row.name.toLowerCase() === lower) return 0;
  if (row.normalizedName !== null && row.normalizedName === fold) return 1;
  if (row.normalizedAltNames.includes(fold)) return 2;

  return null;
}

/**
 * The Ingredient Name each of these names *is*, keyed by the name's fold.
 *
 * A name is the row that carries it: as its own name, as the same name folded,
 * or as one of its Alternative Names (ADR-0034). That last case is the whole
 * point of Alternative Names — "aubergine" is the Eggplant row, so a recipe
 * that says aubergine does not mint a second ingredient with a second picture.
 *
 * Names with no row are simply absent, which is what lets the caller mint only
 * those.
 */
async function findIngredientsForNames(
  runner: { select: typeof db.select },
  names: readonly string[]
): Promise<Map<string, IngredientDto>> {
  const lowers = [...new Set(names.map((name) => name.toLowerCase()))];
  const folds = [...new Set(names.map(nameKey).filter(Boolean))];

  if (folds.length === 0) return new Map();

  const rows = await runner
    .select()
    .from(ingredients)
    .where(
      or(
        inArray(sql`lower(${ingredients.name})`, lowers),
        inArray(ingredients.normalizedName, folds),
        sql`${ingredients.normalizedAltNames} && ${sql.param(folds)}::text[]`
      )
    );

  const parsed = IngredientArraySchema.safeParse(rows);

  if (!parsed.success) throw new Error("Failed to parse ingredients");

  const best = new Map<string, { row: IngredientDto; rank: number }>();

  for (const name of names) {
    const fold = nameKey(name);

    if (!fold) continue;

    const lower = name.toLowerCase();

    for (const row of parsed.data) {
      const rank = matchRank(row, lower, fold);

      if (rank === null) continue;

      const held = best.get(fold);

      // A stable winner where two rows answer alike, so the same name never
      // lands on a different ingredient from one import to the next.
      if (
        !held ||
        rank < held.rank ||
        (rank === held.rank && row.name.toLowerCase() < held.row.name.toLowerCase())
      ) {
        best.set(fold, { row, rank });
      }
    }
  }

  return new Map([...best].map(([fold, { row }]) => [fold, row]));
}

/**
 * The Ingredient Name each name is, minting the ones Norish has never seen.
 * Keyed by the name's fold, because the row a name resolves to may be named
 * something else entirely.
 */
async function resolveOrCreateIngredients(
  runner: { select: typeof db.select; insert: typeof db.insert },
  names: readonly string[]
): Promise<Map<string, IngredientDto>> {
  const resolved = await findIngredientsForNames(runner, names);
  const missing = new Map<string, string>();

  for (const name of names) {
    const fold = nameKey(name);

    if (fold && !resolved.has(fold) && !missing.has(fold)) missing.set(fold, name);
  }

  if (missing.size === 0) return resolved;

  const minted = [...missing.values()];

  await runner.insert(ingredients).values(ingredientNameRowValues(minted)).onConflictDoNothing();

  for (const [fold, row] of await findIngredientsForNames(runner, minted)) {
    resolved.set(fold, row);
  }

  return resolved;
}

function ensureNonEmptyName(name?: string): string {
  if (name === undefined || name === null) throw new Error("Ingredient name cannot be empty");

  const cleaned = stripHtmlTags(name);

  if (cleaned.length === 0) throw new Error("Ingredient name cannot be empty");

  return cleaned;
}

export async function findIngredientById(id: string): Promise<IngredientDto | null> {
  const rows = await db.select().from(ingredients).where(eq(ingredients.id, id)).limit(1);
  const parsed = IngredientSelectBaseSchema.safeParse(rows[0]);

  return parsed.success ? parsed.data : null;
}

/** The Ingredient Name this name is, minting it where Norish has never seen it. */
export async function getOrCreateIngredientByName(name: string): Promise<IngredientDto> {
  const cleaned = ensureNonEmptyName(name);
  const found = (await resolveOrCreateIngredients(db, [cleaned])).get(nameKey(cleaned));

  if (!found) throw new Error("Failed to create or fetch ingredient");

  return found;
}

/**
 * The Ingredient Name each of these names is, keyed by the fold of the name as
 * asked for. Callers look rows up by `ingredientKey(theirName)` rather than by
 * the row's name, because the two differ whenever an Alternative Name matched.
 */
export async function getOrCreateManyIngredientsTx(
  tx: any,
  names: string[]
): Promise<Map<string, IngredientDto>> {
  const cleaned = names.map(stripHtmlTags).filter((n) => n.length > 0);

  if (cleaned.length === 0) return new Map();

  return await resolveOrCreateIngredients(tx, cleaned);
}

export async function getOrCreateManyIngredients(
  names: string[]
): Promise<Map<string, IngredientDto>> {
  const cleaned = names.map(stripHtmlTags).filter((n) => n.length > 0);

  if (cleaned.length === 0) return new Map();

  return await db.transaction(async (tx) => resolveOrCreateIngredients(tx, cleaned));
}

/** The key a caller looks a resolved Ingredient Name up by. */
export function ingredientKey(name: string): string {
  return nameKey(name);
}

export async function attachIngredientsToRecipeByInputTx(
  tx: any,
  payloadIngredients: RecipeIngredientInsertDto[]
): Promise<RecipeIngredientsDto[]> {
  if (!payloadIngredients?.length) return [];

  const parsedInput = z.array(RecipeIngredientInputSchema).safeParse(payloadIngredients);

  if (!parsedInput.success) {
    dbLogger.error({ err: parsedInput.error }, "Invalid RecipeIngredientsDto");
    throw new Error("Invalid RecipeIngredientsDto");
  }
  const items = parsedInput.data;

  // Get units config for normalization
  const units = await getUnitsForNormalization();

  // Separate items with ingredientId (already exist) from those needing creation (ingredientName)
  const itemsWithId = items.filter((ri) => ri.ingredientId);
  const itemsNeedingCreation = items.filter((ri) => !ri.ingredientId && ri.ingredientName);

  // Create/fetch ingredients for items that only have ingredientName
  const names = Array.from(
    new Set(itemsNeedingCreation.map((ri) => ri.ingredientName?.trim() ?? "").filter(Boolean))
  );
  const createdIngredients =
    names.length > 0 ? await getOrCreateManyIngredientsTx(tx, names) : new Map();

  // Build rows for items that already have ingredientId
  const rowsWithExistingIds = itemsWithId.map((ri) => ({
    recipeId: ri.recipeId,
    ingredientId: ri.ingredientId!,
    amount: ri.amount != null ? Number(ri.amount) : null,
    unit: normalizeUnit(ri.unit ?? "", units),
    order: ri.order,
    systemUsed: (ri.systemUsed as MeasurementSystem) || "metric",
  }));

  // Build rows for items that needed ingredient creation
  const rowsWithNewIngredients = itemsNeedingCreation
    .map((ri) => {
      // By the name asked for, not by the row's name: an Alternative Name
      // resolves to a row called something else.
      const ing = createdIngredients.get(ingredientKey(ri.ingredientName?.trim() ?? ""));

      if (!ing) return null;

      return {
        recipeId: ri.recipeId,
        ingredientId: ing.id,
        amount: ri.amount != null ? Number(ri.amount) : null,
        unit: normalizeUnit(ri.unit ?? "", units), // ← Normalize unit to canonical ID
        order: ri.order,
        systemUsed: (ri.systemUsed as MeasurementSystem) || "metric",
      };
    })
    .filter(Boolean);

  // Combine both sets of rows
  const rows = [...rowsWithExistingIds, ...rowsWithNewIngredients];

  if (!rows.length) return [];

  const rowsSchema = z.array(RecipeIngredientsInsertBaseSchema);
  const validatedRows = rowsSchema.safeParse(rows);

  if (!validatedRows.success) {
    dbLogger.error({ err: validatedRows.error }, "Invalid recipeIngredients insert payload");
    throw new Error("Invalid recipeIngredients insert payload");
  }

  const inserted = await tx
    .insert(recipeIngredients)
    .values(validatedRows.data)
    .onConflictDoNothing()
    .returning();

  if (!inserted.length) return [];

  // Fetch all ingredient names for the inserted items
  const allIngredientIds = inserted.map((ri: any) => ri.ingredientId);
  const allIngredients = await tx
    .select()
    .from(ingredients)
    .where(inArray(ingredients.id, allIngredientIds));

  const insertedWithNames = inserted.map((ri: any) => ({
    ...ri,
    amount: ri.amount != null ? Number(ri.amount) : null,
    ingredientName: allIngredients.find((i: any) => i.id === ri.ingredientId)?.name ?? "",
    order: ri.order,
  }));

  const parsedInserted = z.array(RecipeIngredientSelectWithNameSchema).safeParse(insertedWithNames);

  if (!parsedInserted.success) {
    dbLogger.error({ err: parsedInserted.error }, "Failed to parse inserted ingredients");
    throw new Error("Failed to parse inserted ingredients");
  }

  return parsedInserted.data;
}

/**
 * Ingredient Names written before names were folded, which the Pantry can
 * never match. The startup backfill works through them.
 */
export async function listIngredientNamesMissingNormalizedName(
  limit: number
): Promise<Array<{ id: string; name: string }>> {
  return await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(isNull(ingredients.normalizedName))
    .orderBy(asc(ingredients.id))
    .limit(limit);
}

/**
 * Store the folded form of each Ingredient Name. Rows that already carry one
 * are left alone, so two servers backfilling at once cannot undo each other.
 */
export async function setIngredientNormalizedNames(
  rows: ReadonlyArray<{ id: string; normalizedName: string }>
): Promise<void> {
  if (rows.length === 0) return;

  const ids = sql.join(
    rows.map((row) => sql`${row.id}`),
    sql`, `
  );
  const folded = sql.join(
    rows.map((row) => sql`${row.normalizedName}`),
    sql`, `
  );

  await db.execute(sql`
    UPDATE ${ingredients}
    SET normalized_name = folded.normalized_name
    FROM unnest(ARRAY[${ids}]::uuid[], ARRAY[${folded}]::text[]) AS folded(id, normalized_name)
    WHERE ${ingredients.id} = folded.id
      AND ${ingredients.normalizedName} IS NULL
  `);
}
