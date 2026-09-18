import { z } from "zod";

/** Bounds shared by an Ingredient Name and its Alternative Names on every administrator write. */
export const IngredientDetailsNameSchema = z.string().trim().min(1).max(80);

/** The most Alternative Names one Ingredient Name may carry. */
export const MAX_INGREDIENT_ALT_NAMES = 50;

/** What an administrator submits for an Ingredient Name: the name and its Alternative Names. */
export const IngredientDetailsCreateSchema = z.object({
  name: IngredientDetailsNameSchema,
  altNames: z.array(IngredientDetailsNameSchema).max(MAX_INGREDIENT_ALT_NAMES).default([]),
});

export const IngredientDetailsUpdateSchema = IngredientDetailsCreateSchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
});

export const AdminIngredientListInputSchema = z.object({
  search: z.string().trim().max(80).optional(),
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

/** An Ingredient Name as a reader matching or suggesting names needs it (ADR-0033). */
export const IngredientSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  altNames: z.array(z.string()),
  imageUrl: z.string().nullable(),
});

/** An Ingredient Name as the administration list shows it. */
export const AdminIngredientSchema = IngredientSummarySchema.extend({
  version: z.number(),
  /** How many recipes use the name; a used name cannot be deleted. */
  recipeCount: z.number(),
});
