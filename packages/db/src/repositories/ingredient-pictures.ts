/**
 * Ingredient Illustrations (ADR-0033) and Alternative Names (ADR-0034), which
 * live on the Ingredient Names themselves.
 *
 * Only an administrator writes here. An Ingredient Illustration belongs to the
 * Ingredient Name it was drawn for and to nothing else — a line shows its own
 * ingredient's picture, never one borrowed by matching names at read time.
 * Alternative Names do their work earlier, where a name is turned into an
 * ingredient, so "aubergine" and "Eggplant" are one row with one picture.
 *
 * Every read and write of these columns is issued from this module, so no
 * router, worker, or startup job composes its own query.
 */

import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type {
  AdminIngredientDto,
  AdminIngredientListInput,
  IngredientDetailsCreateDto,
  IngredientDetailsUpdateDto,
  IngredientSummaryDto,
} from "@norish/shared/contracts";
import { db } from "@norish/db/drizzle";
import { ingredients, pantryIngredients, recipeIngredients } from "@norish/db/schema";
import {
  AdminIngredientListInputSchema,
  IngredientDetailsCreateSchema,
  IngredientDetailsUpdateSchema,
} from "@norish/shared/contracts/zod";
import { stripHtmlTags } from "@norish/shared/lib/helpers";
import { normalizeGroceryName } from "@norish/shared/lib/normalized-name";

/** Why a submitted set of names cannot stand as written. */
type ClashResult =
  | { kind: "duplicate"; name: string; ownerName: string }
  | { kind: "is-an-ingredient"; name: string; owner: AdminIngredientDto };

/** The outcome of an administrator's write to one Ingredient Name. */
export type IngredientDetailsWriteResult =
  | { status: "ok"; ingredient: AdminIngredientDto }
  /** The name, or an Alternative Name, already belongs to another Ingredient Name. */
  | { status: "duplicate"; name: string; ownerName: string }
  /**
   * An Alternative Name is an Ingredient Name in its own right. Merging that
   * ingredient into this one is the way to take the name over, and it is the
   * administrator's to ask for.
   */
  | { status: "is-an-ingredient"; name: string; owner: AdminIngredientDto }
  /** A name is nothing once folded (e.g. only punctuation). */
  | { status: "invalid-name"; name: string }
  | { status: "not-found" }
  /** The row changed since the administrator loaded it. */
  | { status: "stale" };

export type IngredientDeleteResult =
  | { status: "ok" }
  /**
   * Recipes use the name, or a household has it in its Pantry; deleting it
   * would delete their rows with it.
   */
  | { status: "in-use"; recipeCount: number; pantryCount: number }
  | { status: "not-found" };

interface CleanDetails {
  name: string;
  normalizedName: string;
  altNames: string[];
  normalizedAltNames: string[];
}

function cleanName(name: string): string {
  return stripHtmlTags(name).trim();
}

/**
 * The name and Alternative Names an administrator submitted, cleaned and
 * de-duplicated by folded form. An Alternative Name that folds to the name, or
 * to an earlier alternative, is dropped: it matches nothing the others do not.
 */
function cleanDetails(input: {
  name: string;
  altNames?: readonly string[];
}): CleanDetails | { invalid: string } {
  const name = cleanName(input.name);
  const normalizedName = normalizeGroceryName(name);

  if (!normalizedName) return { invalid: input.name };

  const seen = new Set([normalizedName]);
  const altNames: string[] = [];
  const normalizedAltNames: string[] = [];

  for (const raw of input.altNames ?? []) {
    const alt = cleanName(raw);
    const normalized = normalizeGroceryName(alt);

    if (!normalized) return { invalid: raw };
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    altNames.push(alt);
    normalizedAltNames.push(normalized);
  }

  return { name, normalizedName, altNames, normalizedAltNames };
}

/**
 * The columns an administrator's row is read with. Built on call, not at
 * module load, so a test that mocks the schema can still import a module that
 * imports this one.
 */
function adminColumns() {
  return {
    id: ingredients.id,
    name: ingredients.name,
    altNames: ingredients.altNames,
    imageUrl: ingredients.imageUrl,
    version: ingredients.version,
    // Qualified by hand: drizzle drops table names from columns in a single-table select.
    recipeCount: sql<number>`(
      SELECT count(DISTINCT ri.recipe_id)::int FROM recipe_ingredients ri
      WHERE ri.ingredient_id = "ingredients"."id"
    )`,
  };
}

function byName() {
  return [asc(sql`lower(${ingredients.name})`), asc(ingredients.id)];
}

/** One page of every Ingredient Name, for administration. */
export async function listIngredientsForAdmin(
  input: AdminIngredientListInput = {}
): Promise<{ items: AdminIngredientDto[]; nextCursor: number | null }> {
  const { search, cursor = 0, limit } = AdminIngredientListInputSchema.parse(input);
  const conditions = [];

  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    conditions.push(
      or(
        ilike(ingredients.name, pattern),
        sql`array_to_string(${ingredients.altNames}, ' ') ILIKE ${pattern}`
      )
    );
  }

  const rows = await db
    .select(adminColumns())
    .from(ingredients)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...byName())
    .limit(limit + 1)
    .offset(cursor);

  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? cursor + limit : null,
  };
}

export async function findIngredientForAdmin(id: string): Promise<AdminIngredientDto | null> {
  const [row] = await db.select(adminColumns()).from(ingredients).where(eq(ingredients.id, id));

  return row ?? null;
}

/**
 * Every Ingredient Name, as a device needs it: to show the picture a name
 * matches, and to suggest names in the recipe editor. Suggestions cover every
 * name recipes use, not only the ones an administrator has reached yet, so the
 * editor offers the same names whether or not a picture exists.
 */
export async function listIngredientNames(): Promise<IngredientSummaryDto[]> {
  return await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      altNames: ingredients.altNames,
      imageUrl: ingredients.imageUrl,
    })
    .from(ingredients)
    .orderBy(...byName());
}

/**
 * The first clash between the submitted names and another Ingredient Name:
 * the same name (case-insensitively), an Alternative Name that is another
 * Ingredient Name in its own right, or an Alternative Name another name
 * already carries.
 */
async function findClash(
  details: CleanDetails,
  exceptId: string | null
): Promise<ClashResult | null> {
  const others = exceptId ? ne(ingredients.id, exceptId) : undefined;

  const [sameName] = await db
    .select({ name: ingredients.name })
    .from(ingredients)
    .where(and(eq(sql`lower(${ingredients.name})`, details.name.toLowerCase()), others))
    .limit(1);

  if (sameName) return { kind: "duplicate", name: details.name, ownerName: sameName.name };

  // The name is already an Alternative Name of another ingredient. Allowing it
  // would mint the duplicate that Alternative Name exists to prevent, and the
  // two would then compete for every recipe that says it.
  const [ownedAsAlt] = await db
    .select({ name: ingredients.name })
    .from(ingredients)
    .where(
      and(
        sql`${ingredients.normalizedAltNames} @> ARRAY[${details.normalizedName}]::text[]`,
        others
      )
    )
    .limit(1);

  if (ownedAsAlt) {
    return { kind: "duplicate", name: details.name, ownerName: ownedAsAlt.name };
  }

  if (details.normalizedAltNames.length === 0) return null;

  // An Alternative Name that is already an ingredient of its own. Claiming it
  // silently would leave that ingredient stranded with its own recipes and its
  // own picture — the very duplicate Alternative Names exist to prevent — so
  // the administrator is told, and offered the merge.
  const [ownsIt] = await db
    .select({ ...adminColumns(), normalizedName: ingredients.normalizedName })
    .from(ingredients)
    .where(and(inArray(ingredients.normalizedName, details.normalizedAltNames), others))
    .orderBy(...byName())
    .limit(1);

  if (ownsIt) {
    const { normalizedName, ...owner } = ownsIt;
    const index = details.normalizedAltNames.indexOf(normalizedName ?? "");

    return {
      kind: "is-an-ingredient",
      name: details.altNames[index] ?? owner.name,
      owner,
    };
  }

  const [altClash] = await db
    .select({ name: ingredients.name, normalizedAltNames: ingredients.normalizedAltNames })
    .from(ingredients)
    .where(
      and(
        sql`${ingredients.normalizedAltNames} && ${sql.param(details.normalizedAltNames)}::text[]`,
        others
      )
    )
    .limit(1);

  if (!altClash) return null;

  const index = details.normalizedAltNames.findIndex((alt) =>
    altClash.normalizedAltNames.includes(alt)
  );

  return {
    kind: "duplicate",
    name: details.altNames[index] ?? details.altNames[0] ?? "",
    ownerName: altClash.name,
  };
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  while (current && typeof current === "object") {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

async function okOrMissing(id: string): Promise<IngredientDetailsWriteResult> {
  const ingredient = await findIngredientForAdmin(id);

  return ingredient ? { status: "ok", ingredient } : { status: "not-found" };
}

/** Add an Ingredient Name no recipe uses yet, so it can be given a picture ahead of time. */
export async function createIngredientWithDetails(
  input: IngredientDetailsCreateDto
): Promise<IngredientDetailsWriteResult> {
  const details = cleanDetails(IngredientDetailsCreateSchema.parse(input));

  if ("invalid" in details) return { status: "invalid-name", name: details.invalid };

  const clash = await findClash(details, null);

  if (clash) return clashResult(clash);

  try {
    const [row] = await db.insert(ingredients).values(details).returning({ id: ingredients.id });

    if (!row) throw new Error("Failed to create ingredient");

    return await okOrMissing(row.id);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    return clashResult((await findClash(details, null)) ?? blankClash(details));
  }
}

function blankClash(details: CleanDetails): ClashResult {
  return { kind: "duplicate", name: details.name, ownerName: details.name };
}

/** A clash as the caller hears it: a plain duplicate, or one a merge would settle. */
function clashResult(clash: ClashResult): IngredientDetailsWriteResult {
  return clash.kind === "is-an-ingredient"
    ? { status: "is-an-ingredient", name: clash.name, owner: clash.owner }
    : { status: "duplicate", name: clash.name, ownerName: clash.ownerName };
}

/**
 * Rename an Ingredient Name and replace its Alternative Names. A rename
 * changes the text of every recipe line that uses the name.
 */
export async function updateIngredientDetails(
  input: IngredientDetailsUpdateDto
): Promise<IngredientDetailsWriteResult> {
  const parsed = IngredientDetailsUpdateSchema.parse(input);
  const details = cleanDetails(parsed);

  if ("invalid" in details) return { status: "invalid-name", name: details.invalid };

  const clash = await findClash(details, parsed.id);

  if (clash) return clashResult(clash);

  try {
    const [row] = await db
      .update(ingredients)
      .set({ ...details, version: sql`${ingredients.version} + 1` })
      .where(and(eq(ingredients.id, parsed.id), eq(ingredients.version, parsed.version)))
      .returning({ id: ingredients.id });

    if (!row) {
      const [exists] = await db
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(eq(ingredients.id, parsed.id));

      return { status: exists ? "stale" : "not-found" };
    }

    return await okOrMissing(row.id);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    return clashResult((await findClash(details, parsed.id)) ?? blankClash(details));
  }
}

/**
 * Delete an Ingredient Name that nothing points at. A name a recipe line uses,
 * or a name a household keeps in its Pantry, is refused: the foreign key would
 * take those rows with it, and neither is an administrator's to discard.
 */
export async function deleteIngredientIfUnused(id: string): Promise<IngredientDeleteResult> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(eq(ingredients.id, id))
      .for("update");

    if (!row) return { status: "not-found" };

    const countRecipes = async () => {
      const [usage] = await tx
        .select({ count: sql<number>`count(DISTINCT ${recipeIngredients.recipeId})::int` })
        .from(recipeIngredients)
        .where(eq(recipeIngredients.ingredientId, id));

      return usage?.count ?? 0;
    };

    const countPantries = async () => {
      const [usage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(pantryIngredients)
        .where(eq(pantryIngredients.ingredientId, id));

      return usage?.count ?? 0;
    };

    const inUse = async () => ({
      status: "in-use" as const,
      recipeCount: await countRecipes(),
      pantryCount: await countPantries(),
    });

    const before = await inUse();

    if (before.recipeCount > 0 || before.pantryCount > 0) return before;

    const [deleted] = await tx
      .delete(ingredients)
      .where(
        and(
          eq(ingredients.id, id),
          sql`NOT EXISTS (SELECT 1 FROM ${recipeIngredients} WHERE ${recipeIngredients.ingredientId} = ${id})`,
          sql`NOT EXISTS (SELECT 1 FROM ${pantryIngredients} WHERE ${pantryIngredients.ingredientId} = ${id})`
        )
      )
      .returning({ id: ingredients.id });

    // Something claimed the name between the count and the delete: say what
    // does now rather than inventing a number.
    return deleted ? { status: "ok" } : await inUse();
  });
}

/**
 * Set or clear an Ingredient Name's picture.
 *
 * The version is left alone: it guards the names an administrator edits as a
 * draft, while a picture is written whole the moment it is chosen. Bumping it
 * would make the editor that just uploaded a picture refuse its own next save.
 *
 * @returns the picture it replaced (null when it had none), or undefined when
 *   the name no longer exists — a generation finishing after a delete
 */
export async function setIngredientImage(
  id: string,
  imageUrl: string | null
): Promise<{ previousImageUrl: string | null } | undefined> {
  return await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ imageUrl: ingredients.imageUrl })
      .from(ingredients)
      .where(eq(ingredients.id, id))
      .for("update");

    if (!before) return undefined;

    await tx.update(ingredients).set({ imageUrl }).where(eq(ingredients.id, id));

    return { previousImageUrl: before.imageUrl };
  });
}

/**
 * The Ingredient Names worth drawing in a "generate missing pictures" run:
 * those without a picture that a recipe uses or an administrator gave
 * Alternative Names. Names nothing uses any more are not billed for.
 */
function missingImage() {
  return and(
    isNull(ingredients.imageUrl),
    or(
      sql`cardinality(${ingredients.altNames}) > 0`,
      sql`EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.ingredient_id = "ingredients"."id")`
    )
  );
}

export async function listIngredientIdsMissingImage(): Promise<string[]> {
  const rows = await db
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(missingImage())
    .orderBy(...byName());

  return rows.map((row) => row.id);
}

/** How many names are worth drawing, for the count an administrator is shown first. */
export async function countIngredientsMissingImage(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ingredients)
    .where(missingImage());

  return row?.count ?? 0;
}

/** The outcome of merging one Ingredient Name into another. */
export type IngredientMergeResult =
  | { status: "ok"; ingredient: AdminIngredientDto }
  | { status: "not-found" }
  /** A name cannot be merged into itself. */
  | { status: "same" };

/**
 * Fold one Ingredient Name into another: its recipe lines and Pantry
 * Ingredients are repointed at the target, its names are kept as Alternative
 * Names so nothing that used to resolve to it stops resolving, and the row
 * itself is deleted.
 *
 * This is the deliberate half of Alternative Names. Adding an Alternative Name
 * that is already an ingredient is refused (`is-an-ingredient`) precisely so
 * that this — which destroys a row and, with it, any picture drawn for it —
 * is something an administrator asks for rather than a side effect of typing.
 *
 * @returns the surviving Ingredient Name, and the picture the merged row leaves
 *   behind for the caller to sweep.
 */
export async function mergeIngredientInto(
  sourceId: string,
  targetId: string
): Promise<IngredientMergeResult & { strandedImageUrl?: string | null }> {
  if (sourceId === targetId) return { status: "same" };

  const stranded = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: ingredients.id,
        name: ingredients.name,
        normalizedName: ingredients.normalizedName,
        altNames: ingredients.altNames,
        normalizedAltNames: ingredients.normalizedAltNames,
        imageUrl: ingredients.imageUrl,
      })
      .from(ingredients)
      .where(inArray(ingredients.id, [sourceId, targetId]))
      .for("update");

    const source = rows.find((row) => row.id === sourceId);
    const target = rows.find((row) => row.id === targetId);

    if (!source || !target) return undefined;

    await tx
      .update(recipeIngredients)
      .set({ ingredientId: targetId })
      .where(eq(recipeIngredients.ingredientId, sourceId));

    // A member who holds both keeps one: the unique row per member is the
    // Pantry's rule, and merging must not break it.
    await tx.execute(sql`
      DELETE FROM ${pantryIngredients} source
      WHERE source.ingredient_id = ${sourceId}
        AND EXISTS (
          SELECT 1 FROM ${pantryIngredients} held
          WHERE held.user_id = source.user_id AND held.ingredient_id = ${targetId}
        )
    `);
    await tx
      .update(pantryIngredients)
      .set({ ingredientId: targetId })
      .where(eq(pantryIngredients.ingredientId, sourceId));

    // The merged name, and everything it answered to, keep answering — to the
    // survivor now.
    const seen = new Set([target.normalizedName ?? "", ...target.normalizedAltNames]);
    const altNames = [...target.altNames];
    const normalizedAltNames = [...target.normalizedAltNames];

    for (const [name, normalized] of [
      [source.name, source.normalizedName ?? normalizeGroceryName(source.name)] as const,
      ...source.altNames.map(
        (alt, index) =>
          [alt, source.normalizedAltNames[index] ?? normalizeGroceryName(alt)] as const
      ),
    ]) {
      if (!normalized || seen.has(normalized)) continue;

      seen.add(normalized);
      altNames.push(name);
      normalizedAltNames.push(normalized);
    }

    await tx.delete(ingredients).where(eq(ingredients.id, sourceId));
    await tx
      .update(ingredients)
      .set({ altNames, normalizedAltNames, version: sql`${ingredients.version} + 1` })
      .where(eq(ingredients.id, targetId));

    return { imageUrl: source.imageUrl };
  });

  if (!stranded) return { status: "not-found" };

  const ingredient = await findIngredientForAdmin(targetId);

  return ingredient
    ? { status: "ok", ingredient, strandedImageUrl: stranded.imageUrl }
    : { status: "not-found" };
}
