import { describe, expect, it } from "vitest";

import {
  buildIngredientLookup,
  findIngredientForName,
  ingredientLineNamePart,
  replaceIngredientLineName,
  suggestIngredientNames,
} from "@norish/shared/lib/ingredient-pictures";

const flour = { id: "f", name: "Flour", altNames: ["plain flour"], imageUrl: "/f.webp" };
const coriander = { id: "c", name: "Coriander", altNames: ["cilantro"], imageUrl: null };
const egg = { id: "e", name: "Egg", altNames: ["eggs", "large eggs"], imageUrl: "/e.webp" };
const eggplant = { id: "p", name: "Aubergine", altNames: ["eggplant"], imageUrl: null };
const catalog = [flour, coriander, egg, eggplant];

describe("findIngredientForName", () => {
  const lookup = buildIngredientLookup(catalog);

  it("matches names and their alternative names by the grocery folding", () => {
    expect(findIngredientForName(lookup, "flour")).toBe(flour);
    expect(findIngredientForName(lookup, "  EGGS! ")).toBe(egg);
    expect(findIngredientForName(lookup, "Plain flour")).toBe(flour);
  });

  it("matches a name with no picture: a picture is not what makes a name known", () => {
    expect(findIngredientForName(lookup, "coriander")).toBe(coriander);
    expect(findIngredientForName(lookup, "Cilantro")).toBe(coriander);
    expect(findIngredientForName(lookup, "eggplant")).toBe(eggplant);
  });

  it("never matches a longer or looser name", () => {
    expect(findIngredientForName(lookup, "free-range eggs")).toBeNull();
    expect(findIngredientForName(lookup, "flou")).toBeNull();
    expect(findIngredientForName(lookup, "")).toBeNull();
    expect(findIngredientForName(lookup, null)).toBeNull();
  });

  it("prefers a name's own form over another name's alternative name", () => {
    const largeEggs = { id: "l", name: "Large eggs", altNames: [], imageUrl: "/l.webp" };

    expect(findIngredientForName(buildIngredientLookup([egg, largeEggs]), "large eggs")).toBe(
      largeEggs
    );
  });

  it("keeps the first entry when two claim the same alternative name", () => {
    const other = { id: "x", name: "Eggs again", altNames: ["eggs"], imageUrl: "/x.webp" };
    const stale = buildIngredientLookup([egg, other]);

    expect(findIngredientForName(stale, "eggs")).toBe(egg);
  });
});

describe("suggestIngredientNames", () => {
  it("offers prefix matches before word and substring matches", () => {
    const pepper = { id: "r", name: "Red pepper", altNames: ["pepper, red"], imageUrl: null };
    const names = suggestIngredientNames("pe", [
      ...catalog,
      pepper,
      { ...egg, id: "q", name: "Crêpe", altNames: [] },
    ]).map((s) => s.name);

    // Offered under the ingredient's own name, whichever of its names matched.
    expect(names).toEqual(["Red pepper", "Crêpe"]);
  });

  it("offers each entry once, under its best matching name", () => {
    const suggestions = suggestIngredientNames("flo", catalog);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      ingredientId: "f",
      name: "Flour",
      matchedName: undefined,
      imageUrl: "/f.webp",
    });
  });

  it("offers the ingredient itself when an alternative name matched, saying which", () => {
    // Typing "cilantro" would resolve to Coriander anyway, so the line is
    // offered the name it will mean.
    expect(suggestIngredientNames("cila", catalog)[0]).toMatchObject({
      name: "Coriander",
      matchedName: "cilantro",
    });
  });

  it("leaves out the entry a name already matches, but not longer names", () => {
    expect(suggestIngredientNames("egg", catalog).map((s) => s.name)).toEqual(["Aubergine"]);
    expect(suggestIngredientNames("eggs", catalog)).toEqual([]);
  });

  it("offers nothing for a single character", () => {
    expect(suggestIngredientNames("e", catalog)).toEqual([]);
  });

  it("respects the limit", () => {
    expect(suggestIngredientNames("e", catalog, 1)).toHaveLength(0);
    expect(suggestIngredientNames("an", catalog, 1)).toHaveLength(1);
  });
});

describe("ingredientLineNamePart", () => {
  it("finds the name after the amount and unit", () => {
    const text = "2 cups flo";
    const part = ingredientLineNamePart(text, {});

    expect(part).toEqual({ name: "flo", start: 7, end: 10 });
  });

  it("treats a bare name as the whole line", () => {
    expect(ingredientLineNamePart("cilan", {})).toEqual({ name: "cilan", start: 0, end: 5 });
  });

  it("ignores headings, empty lines and pasted lists", () => {
    expect(ingredientLineNamePart("# Sauce", {})).toBeNull();
    expect(ingredientLineNamePart("   ", {})).toBeNull();
    expect(ingredientLineNamePart("2 eggs\n1 cup flour", {})).toBeNull();
  });
});

describe("replaceIngredientLineName", () => {
  it("rewrites only the name part", () => {
    const text = "2 cups flo";
    const part = ingredientLineNamePart(text, {})!;

    expect(replaceIngredientLineName(text, part, "Flour")).toBe("2 cups Flour");
  });
});
