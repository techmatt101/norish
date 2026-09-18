# An Alternative Name resolves to the Ingredient Name that carries it

One deployment accumulates the same food under several names — "aubergine" and "eggplant", "coriander" and "cilantro" — each minted as its own `ingredients` row by whichever recipe was imported first. Each then counts separately in the administrator's list, is drawn separately, and is billed separately (ADR-0033). The names differ; the food does not.

This is a matching problem, and it is settled where a name becomes an ingredient rather than where one is read. **An Ingredient Name carries Alternative Names, and a name written from now on resolves to the row that answers to it — by its own name, by its folded form under `normalizeGroceryName`, or by one of that row's Alternative Names.** A recipe that says "aubergine" points at the Eggplant row because it *is* Eggplant.

Resolution ranks: a row's own name beats a fold, and a fold beats another row's Alternative Name. Where two rows still answer alike the lower `lower(name)` wins, so the same name never lands on a different ingredient from one import to the next.

## Considered Options

- **Matching at read time**, so a line shows the picture of a name carrying its folded form as an Alternative Name. Rejected in ADR-0033, and rejected again here for a stronger reason: it leaves both rows in place, so the duplicate the feature exists to close stays open, with two recipe counts and two chances to be drawn. The alternative papers over the split instead of closing it.
- **Merging silently** when an administrator adds an Alternative Name that is already an ingredient. It destroys a row, its picture and its identity as a side effect of typing in a text field. Rejected in favour of refusing and offering the merge as its own action.
- **Fuzzy or word-subset matching**, so "extra virgin olive oil" finds "olive oil". It merges ingredients that are not the same whenever the longer name is a different thing ("coconut milk" is not milk), and here a wrong match no longer shows a wrong picture — it puts a recipe's line on the wrong ingredient and changes what that line says. Rejected the more firmly for it, as ADR-0032 rejects it for the Pantry; the remedy for a missed match is an Alternative Name.
- **Rewriting the rows that already exist** when an Alternative Name is added. That is a merge, and a merge is destructive; it is the administrator's to ask for.
- **AI proposing Alternative Names**, per import or per enrichment. Deferred. Every enrichment kind today writes only to the recipe it ran on, while an Alternative Name writes to a vocabulary the whole instance shares and decides what another household's recipe says. Deduplication is also a question about the whole list rather than about one recipe, so it belongs in a batch an administrator asks for, not in a per-import call that is billed every time. ADR-0012 has the governance shape if this is ever taken up: a curated vocabulary that AI may extend only under an explicitly permissive setting.
- **Per-locale alternatives** beyond what an administrator types. Rejected; the vocabulary is per deployment, and a household cooking in two languages types both names once.

## Consequences

- A recipe line shows the Ingredient Name it resolved to, not the words the import used: a recipe that said "aubergine" reads "Eggplant" once an administrator has made that an Alternative Name. This is the same collapse that already happens for case — a recipe saying "olive oil" reads "Olive Oil" when that row was minted first — widened to names an administrator has declared equal. Keeping the original wording would mean giving `recipe_ingredients` text of its own, which is the duplication the `ingredients` table exists to remove.
- Alternative Names take effect on names written **afterwards**. Rows that already exist are not moved, because moving them is a merge; the administrator is shown the clash and asks for it.
- Adding an Alternative Name that is already an Ingredient Name in its own right is refused, naming that ingredient and how many recipes use it, and offering to merge it in. Adding a *name* that is already another ingredient's Alternative Name is refused outright: both directions would otherwise mint the duplicate the feature exists to prevent.
- Merging repoints the merged ingredient's recipe lines and Pantry Ingredients, keeps its name and its alternatives as Alternative Names of the survivor so nothing that resolved to it stops resolving, deletes its row and sweeps its picture. A member holding both in their Pantry keeps one.
- Because a name may resolve to a row called something else, every caller of the bulk resolve looks its result up by the fold of the name it asked for, never by the row's name.
- The editor suggests from the cached list and inserts the **ingredient's own name**, saying which Alternative Name matched. Typing an alternative would resolve there anyway, so the line may as well say what it will mean.
- The grocery row's lookup indexes alternatives too, so a hand-typed "aubergine" shows the Eggplant picture without a row of its own.
- A name written before its fold was stored is reached only by its exact name until the startup backfill folds it (ADR-0033).
- Matching anything looser than the grocery folding reopens this ADR.
