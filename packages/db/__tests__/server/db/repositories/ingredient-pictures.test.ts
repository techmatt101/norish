// @vitest-environment node
/**
 * Ingredient Illustrations and Alternative Names on Ingredient Names (ADR-0033).
 *
 * Which picture a line shows is resolved from its name in SQL at read time,
 * so these tests are about what a name reaches as pictures and Alternative
 * Names change — which a mock cannot prove.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AdminIngredientDto } from "@norish/shared/contracts";
import { db } from "@norish/db/drizzle";
import {
  createIngredientWithDetails,
  deleteIngredientIfUnused,
  findIngredientForAdmin,
  listIngredientIdsMissingImage,
  listIngredientNames,
  listIngredientsForAdmin,
  mergeIngredientInto,
  setIngredientImage,
  updateIngredientDetails,
} from "@norish/db/repositories/ingredient-pictures";
import {
  getOrCreateManyIngredients,
  ingredientKey,
  listIngredientNamesMissingNormalizedName,
  setIngredientNormalizedNames,
} from "@norish/db/repositories/ingredients";
import { createPantryIngredient } from "@norish/db/repositories/pantry";
import { mapRecipeToPublicRecipeView } from "@norish/db/repositories/recipe-share-helpers";
import { createRecipeWithRefs, getRecipeFull } from "@norish/db/repositories/recipes";
import { ingredients } from "@norish/db/schema";

import { createTestUser } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

const testBase = new RepositoryTestBase("test_ingredient_pictures");

beforeAll(async () => await testBase.setup());
afterAll(async () => await testBase.teardown());
beforeEach(async () => await testBase.beforeEachTest());

async function create(name: string, altNames: string[] = []): Promise<AdminIngredientDto> {
  const result = await createIngredientWithDetails({ name, altNames });

  if (result.status !== "ok") throw new Error(`create failed: ${result.status}`);

  return result.ingredient;
}

/** The Ingredient Name this name resolves to, minting it if Norish has none. */
async function idOf(name: string): Promise<string> {
  const resolved = await getOrCreateManyIngredients([name]);

  return resolved.get(ingredientKey(name))!.id;
}

async function pictureOf(name: string): Promise<string | null | undefined> {
  return (await findIngredientForAdmin(await idOf(name)))?.imageUrl;
}

/** How many Ingredient Names exist, which is what Alternative Names hold down. */
async function nameCount(): Promise<number> {
  return (await listIngredientNames()).length;
}

async function createRecipeUsing(names: string[]): Promise<string> {
  const user = await createTestUser();
  const recipeId = crypto.randomUUID();

  // An archive import carries names, never instance-local ids (ADR-0022).
  await createRecipeWithRefs(recipeId, user.id, {
    name: "Omelette",
    systemUsed: "metric",
    recipeIngredients: names.map((ingredientName, order) => ({
      ingredientId: null,
      ingredientName,
      amount: null,
      unit: null,
      order,
      systemUsed: "metric" as const,
    })),
    tags: [],
    cuisines: [],
    categories: [],
    steps: [],
    images: [],
    videos: [],
  });

  return recipeId;
}

describe("creating and listing", () => {
  it("stores de-duplicated alternative names and lists every name with its usage", async () => {
    const egg = await create("Egg", ["eggs", "Eggs!", "egg", "large eggs"]);

    expect(egg).toMatchObject({
      name: "Egg",
      altNames: ["eggs", "large eggs"],
      imageUrl: null,
      version: 1,
      recipeCount: 0,
    });

    await createRecipeUsing(["chives"]);

    const page = await listIngredientsForAdmin({});

    expect(page.items.map((row) => [row.name, row.recipeCount])).toEqual([
      ["chives", 1],
      ["Egg", 0],
    ]);
    expect(page.nextCursor).toBeNull();
    expect((await listIngredientsForAdmin({ search: "large" })).items).toEqual([egg]);
  });

  it("pages", async () => {
    const apple = await create("Apple");
    const banana = await create("Banana");

    const first = await listIngredientsForAdmin({ limit: 1 });

    expect(first.items.map((row) => row.id)).toEqual([apple.id]);
    expect(first.nextCursor).toBe(1);
    expect(
      (await listIngredientsForAdmin({ cursor: 1, limit: 1 })).items.map((row) => row.id)
    ).toEqual([banana.id]);
  });

  it("refuses a name or alternative name that belongs to another name, naming it", async () => {
    await create("Coriander", ["cilantro"]);

    expect(await createIngredientWithDetails({ name: "coriander", altNames: [] })).toEqual({
      status: "duplicate",
      name: "coriander",
      ownerName: "Coriander",
    });
    expect(
      await createIngredientWithDetails({ name: "Cilantro leaves", altNames: ["CILANTRO"] })
    ).toEqual({ status: "duplicate", name: "CILANTRO", ownerName: "Coriander" });
  });

  it("refuses a name that folds to nothing", async () => {
    expect(await createIngredientWithDetails({ name: "!!!", altNames: [] })).toEqual({
      status: "invalid-name",
      name: "!!!",
    });
  });

  it("lists every name for devices, so the editor suggests names without pictures too", async () => {
    const salt = (await getOrCreateManyIngredients(["salt"])).get("salt");
    const egg = await create("Egg", ["eggs"]);
    const leek = await create("Leek");

    await setIngredientImage(leek.id, "/ingredient-images/l.webp");

    expect(await listIngredientNames()).toEqual([
      { id: egg.id, name: "Egg", altNames: ["eggs"], imageUrl: null },
      { id: leek.id, name: "Leek", altNames: [], imageUrl: "/ingredient-images/l.webp" },
      { id: salt!.id, name: "salt", altNames: [], imageUrl: null },
    ]);
  });
});

describe("which ingredient a name is", () => {
  it("shows the picture drawn for it, and nothing borrowed from another name", async () => {
    const egg = await create("Egg");

    await setIngredientImage(egg.id, "/ingredient-images/egg.webp");

    expect(await pictureOf("Egg")).toBe("/ingredient-images/egg.webp");
    // The same name folded is the same ingredient, so it is the same picture.
    expect(await pictureOf("egg!")).toBe("/ingredient-images/egg.webp");
    // A different name is a different ingredient, and has no picture of its own.
    expect(await pictureOf("free-range egg")).toBeNull();
  });

  it("takes an alternative name to the ingredient that carries it, minting nothing", async () => {
    const aubergine = await create("Aubergine", ["eggplant"]);

    await setIngredientImage(aubergine.id, "/ingredient-images/au.webp");

    const before = await nameCount();

    // The whole point: "eggplant" is the Aubergine row, so no second
    // ingredient and no second picture to draw.
    expect(await idOf("eggplant")).toBe(aubergine.id);
    expect(await idOf("  EGGPLANT! ")).toBe(aubergine.id);
    expect(await pictureOf("eggplant")).toBe("/ingredient-images/au.webp");
    expect(await nameCount()).toBe(before);
  });

  it("stops taking a name once the alternative is removed", async () => {
    const aubergine = await create("Aubergine", ["eggplant"]);

    expect(await idOf("eggplant")).toBe(aubergine.id);

    await updateIngredientDetails({
      id: aubergine.id,
      version: aubergine.version,
      name: "Aubergine",
      altNames: [],
    });

    // A name minted earlier keeps its row; a new one is its own ingredient.
    expect(await idOf("eggplant")).not.toBe(aubergine.id);
  });

  it("refuses to take a name that is already an ingredient, and says whose it is", async () => {
    const large = await create("Large eggs");
    const egg = await create("Egg");

    const claim = await updateIngredientDetails({
      id: egg.id,
      version: egg.version,
      name: "Egg",
      altNames: ["large eggs"],
    });

    // Taking the name silently would strand Large eggs with its own recipes
    // and its own picture; merging is the way, and it is asked for.
    expect(claim).toMatchObject({ status: "is-an-ingredient", name: "large eggs" });
    expect(claim.status === "is-an-ingredient" && claim.owner.id).toBe(large.id);
  });

  it("refuses a new name that is already another ingredient's alternative", async () => {
    await create("Aubergine", ["eggplant"]);

    expect(await createIngredientWithDetails({ name: "Eggplant", altNames: [] })).toMatchObject({
      status: "duplicate",
      ownerName: "Aubergine",
    });
  });

  it("merges one ingredient into another, taking its recipes and its names", async () => {
    await createRecipeUsing(["eggplant"]);
    const eggplant = await findIngredientForAdmin(await idOf("eggplant"));
    const aubergine = await create("Aubergine", ["brinjal"]);

    await setIngredientImage(eggplant!.id, "/ingredient-images/e.webp");
    expect(eggplant!.recipeCount).toBe(1);

    const merged = await mergeIngredientInto(eggplant!.id, aubergine.id);

    expect(merged).toMatchObject({
      status: "ok",
      strandedImageUrl: "/ingredient-images/e.webp",
    });
    // The recipe came across, and the merged name still answers — to Aubergine.
    expect(merged.status === "ok" && merged.ingredient.recipeCount).toBe(1);
    expect(merged.status === "ok" && merged.ingredient.altNames.sort()).toEqual([
      "brinjal",
      "eggplant",
    ]);
    expect(await findIngredientForAdmin(eggplant!.id)).toBeNull();
    expect(await idOf("eggplant")).toBe(aubergine.id);
  });

  it("refuses to merge an ingredient into itself", async () => {
    const egg = await create("Egg");

    expect(await mergeIngredientInto(egg.id, egg.id)).toEqual({ status: "same" });
  });

  it("reaches recipe lines and the share view through their names", async () => {
    const egg = await create("Egg", ["eggs"]);

    await setIngredientImage(egg.id, "/ingredient-images/egg.webp");

    const full = await getRecipeFull(await createRecipeUsing(["eggs", "chives"]));

    expect(full?.recipeIngredients.map((line) => line.picture)).toEqual([
      { imageUrl: "/ingredient-images/egg.webp" },
      null,
    ]);

    const shared = mapRecipeToPublicRecipeView(full!, "share-token");

    expect(shared.recipeIngredients.map((line) => line.picture)).toEqual([
      { imageUrl: "/ingredient-images/egg.webp" },
      null,
    ]);
  });
});

describe("updates and deletes", () => {
  it("refuses a stale version and a missing name", async () => {
    const salt = await create("Salt");

    await updateIngredientDetails({ id: salt.id, version: 1, name: "Sea salt", altNames: [] });

    expect(
      await updateIngredientDetails({ id: salt.id, version: 1, name: "Salt", altNames: [] })
    ).toEqual({ status: "stale" });
    expect(
      await updateIngredientDetails({
        id: crypto.randomUUID(),
        version: 1,
        name: "Salt",
        altNames: [],
      })
    ).toEqual({ status: "not-found" });
  });

  it("allows a name to keep its own names and renames its folded form", async () => {
    const lime = await create("Lime", ["limes"]);
    const result = await updateIngredientDetails({
      id: lime.id,
      version: lime.version,
      name: "Key lime",
      altNames: ["limes", "key limes"],
    });

    expect(result).toMatchObject({
      status: "ok",
      ingredient: { name: "Key lime", altNames: ["limes", "key limes"], version: 2 },
    });

    const [row] = await db.select().from(ingredients).where(eq(ingredients.id, lime.id));

    expect(row).toMatchObject({
      normalizedName: "key lime",
      normalizedAltNames: ["limes", "key limes"],
    });
  });

  it("refuses to delete a name a recipe uses, and deletes an unused one", async () => {
    await createRecipeUsing(["butter"]);
    const butter = await idOf("butter");
    const spare = await create("Spare");

    await setIngredientImage(spare.id, "/ingredient-images/s.webp");

    expect(await deleteIngredientIfUnused(butter)).toEqual({
      status: "in-use",
      recipeCount: 1,
      pantryCount: 0,
    });
    expect(await findIngredientForAdmin(butter)).not.toBeNull();
    expect(await deleteIngredientIfUnused(spare.id)).toEqual({ status: "ok" });
    expect(await deleteIngredientIfUnused(spare.id)).toEqual({ status: "not-found" });
  });

  it("refuses to delete a name a household keeps in its Pantry", async () => {
    const user = await createTestUser();
    const staple = await create("Olive oil");

    await createPantryIngredient(crypto.randomUUID(), { userId: user.id, name: "Olive oil" });

    expect(await deleteIngredientIfUnused(staple.id)).toEqual({
      status: "in-use",
      recipeCount: 0,
      pantryCount: 1,
    });
    expect(await findIngredientForAdmin(staple.id)).not.toBeNull();
  });
});

describe("pictures", () => {
  it("hands back the replaced picture without a version bump", async () => {
    const leek = await create("Leek");

    expect(await setIngredientImage(leek.id, "/ingredient-images/1.webp")).toEqual({
      previousImageUrl: null,
    });
    expect(await setIngredientImage(leek.id, "/ingredient-images/2.webp")).toEqual({
      previousImageUrl: "/ingredient-images/1.webp",
    });
    expect(await findIngredientForAdmin(leek.id)).toMatchObject({
      imageUrl: "/ingredient-images/2.webp",
      // A picture never makes the editor's name draft stale.
      version: 1,
    });
    expect(await setIngredientImage(crypto.randomUUID(), null)).toBeUndefined();
  });

  it("lists names worth drawing: used or given alternatives, without a picture", async () => {
    const pictured = await create("Apple", ["apples"]);
    const alts = await create("Banana", ["bananas"]);

    await create("Unused");
    await createRecipeUsing(["cherry"]);
    await setIngredientImage(pictured.id, "/ingredient-images/a.webp");

    expect(await listIngredientIdsMissingImage()).toEqual([alts.id, await idOf("cherry")]);
  });
});

describe("the normalized-name backfill", () => {
  it("folds a name written before the folding existed, so its variants reach it", async () => {
    const creme = await create("Crème Fraîche");

    await setIngredientImage(creme.id, "/ingredient-images/c.webp");
    // Simulate a row written before the column existed.
    await db.update(ingredients).set({ normalizedName: null }).where(eq(ingredients.id, creme.id));

    // Its own name still reaches it, because that match needs no fold.
    expect(await idOf("Crème Fraîche")).toBe(creme.id);

    const pending = await listIngredientNamesMissingNormalizedName(10);

    expect(pending.map((row) => row.name)).toEqual(["Crème Fraîche"]);

    await setIngredientNormalizedNames([{ id: creme.id, normalizedName: "creme fraiche" }]);

    expect(await listIngredientNamesMissingNormalizedName(10)).toEqual([]);
    // Folded, the variants reach it too — and mint nothing of their own.
    expect(await idOf("creme fraiche!")).toBe(creme.id);
    expect(await pictureOf("  CREME  FRAICHE ")).toBe("/ingredient-images/c.webp");
  });
});
