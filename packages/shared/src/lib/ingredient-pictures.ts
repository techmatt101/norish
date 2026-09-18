import type { UnitsMap } from "@norish/config/zod/server-config";
import type { IngredientSummaryDto } from "@norish/shared/contracts/dto/ingredient-pictures";
import { parseIngredientWithDefaults } from "@norish/shared/lib/helpers";
import { nameWords, normalizeGroceryName } from "@norish/shared/lib/normalized-name";

/** The parts of an Ingredient Name a reader needs to recognise a name. */
export type IngredientLookupEntry = Pick<
  IngredientSummaryDto,
  "id" | "name" | "altNames" | "imageUrl"
>;

/** Every name Norish knows, folded, to the Ingredient Name it belongs to. */
export type IngredientLookup = ReadonlyMap<string, IngredientLookupEntry>;

/** Every name an Ingredient Name answers to: its own name first, then its Alternative Names. */
function ingredientNamesOf(entry: Pick<IngredientLookupEntry, "name" | "altNames">): string[] {
  return [entry.name, ...entry.altNames];
}

/**
 * Index every known name by folded form, the way the server resolves a name it
 * is given (ADR-0034): a name's own folded form wins over another name's
 * Alternative Name. Should two entries still claim one form, the first wins.
 *
 * Pictures are not consulted here. A name resolves to an ingredient, and the
 * picture is simply that ingredient's own — there is no separate matching of
 * names to pictures.
 */
export function buildIngredientLookup(entries: readonly IngredientLookupEntry[]): IngredientLookup {
  const lookup = new Map<string, IngredientLookupEntry>();

  for (const entry of entries) {
    const key = normalizeGroceryName(entry.name);

    if (key && !lookup.has(key)) lookup.set(key, entry);
  }

  for (const entry of entries) {
    for (const alt of entry.altNames) {
      const key = normalizeGroceryName(alt);

      if (key && !lookup.has(key)) lookup.set(key, entry);
    }
  }

  return lookup;
}

/**
 * The Ingredient Name a name is, by exact equality of the one grocery folding
 * and nothing looser (ADR-0034): "Eggs" and "eggs!" are "eggs", "free-range
 * eggs" is not. Its picture, if it has one, is `entry.imageUrl`.
 */
export function findIngredientForName(
  lookup: IngredientLookup,
  name: string | null | undefined
): IngredientLookupEntry | null {
  const key = normalizeGroceryName(name);

  return key ? (lookup.get(key) ?? null) : null;
}

/** Where the ingredient name sits inside a free-text ingredient line. */
export interface IngredientLineNamePart {
  name: string;
  start: number;
  end: number;
}

/**
 * The name part of an ingredient line as the editor stores it — what is left
 * once the amount and unit are parsed away ("2 cups flour" → "flour") — and
 * where it sits in the text. Null for a heading, an empty line, or a line whose
 * parsed name cannot be found verbatim in what was typed; a suggestion must
 * never rewrite text it cannot point at.
 */
export function ingredientLineNamePart(
  text: string,
  units: UnitsMap = {}
): IngredientLineNamePart | null {
  const trimmed = text.trim();

  if (!trimmed || trimmed.startsWith("#") || text.includes("\n")) return null;

  const parsed = parseIngredientWithDefaults(trimmed, units);
  const name = (parsed?.[0]?.description as string | undefined)?.trim() || trimmed;
  let start = text.lastIndexOf(name);

  if (start < 0) start = text.toLowerCase().lastIndexOf(name.toLowerCase());
  if (start < 0) return null;

  return { name, start, end: start + name.length };
}

/** A known ingredient name offered while an ingredient line is being typed. */
export interface IngredientNameSuggestion {
  key: string;
  ingredientId: string;
  /**
   * The Ingredient Name itself, which is what gets inserted: typing an
   * Alternative Name would resolve to this ingredient anyway, so the line may
   * as well say what it will mean.
   */
  name: string;
  /** The Alternative Name that matched, shown as context. Absent when the name itself matched. */
  matchedName?: string;
  imageUrl: string | null;
}

const MIN_QUERY_LENGTH = 2;

function matchRank(normalizedName: string, query: string, queryWords: string[]): number | null {
  if (normalizedName.startsWith(query)) return 0;

  const words = normalizedName.split(" ");

  if (queryWords.every((word) => words.some((candidate) => candidate.startsWith(word)))) return 1;

  if (normalizedName.includes(query)) return 2;

  return null;
}

/**
 * Known ingredient names worth offering for a partly typed ingredient name, best first:
 * names that start with it, then names whose words start with its words, then
 * names that merely contain it. Each entry is offered once, under its best
 * matching name. The entry the name already matches exactly is left out — the
 * line is linked to it already — but longer names still are, so "egg" can
 * still become "eggplant".
 */
export function suggestIngredientNames(
  typedName: string,
  entries: readonly IngredientLookupEntry[],
  limit = 6
): IngredientNameSuggestion[] {
  const query = normalizeGroceryName(typedName);

  if (query.length < MIN_QUERY_LENGTH) return [];

  const queryWords = nameWords(query);
  const ranked: Array<{ suggestion: IngredientNameSuggestion; rank: number }> = [];

  for (const entry of entries) {
    const names = ingredientNamesOf(entry).map((name) => ({
      name,
      normalized: normalizeGroceryName(name),
    }));

    if (names.some(({ normalized }) => normalized === query)) continue;

    let best: { name: string; rank: number } | null = null;

    for (const { name, normalized } of names) {
      const rank = matchRank(normalized, query, queryWords);

      if (rank !== null && (best === null || rank < best.rank)) best = { name, rank };
    }

    if (best) {
      ranked.push({
        rank: best.rank,
        suggestion: {
          key: `${entry.id}:${best.name}`,
          ingredientId: entry.id,
          name: entry.name,
          matchedName: best.name === entry.name ? undefined : best.name,
          imageUrl: entry.imageUrl,
        },
      });
    }
  }

  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.suggestion.name.length - b.suggestion.name.length ||
        a.suggestion.name.localeCompare(b.suggestion.name)
    )
    .slice(0, limit)
    .map(({ suggestion }) => suggestion);
}

/** The line with its name part replaced by a picked name, amount and unit untouched. */
export function replaceIngredientLineName(
  text: string,
  part: Pick<IngredientLineNamePart, "start" | "end">,
  name: string
): string {
  return `${text.slice(0, part.start)}${name}${text.slice(part.end)}`;
}
