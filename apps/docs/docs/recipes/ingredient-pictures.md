---
sidebar_position: 9
title: Ingredient pictures
description: Small pictures beside ingredient lines, grocery items and step ingredients, which your administrator gives each ingredient and can have drawn by AI.
---

# Ingredient pictures

A column of ingredient names is slow to scan when you recognise things by sight.
Norish can show a small picture of each ingredient beside its line, so the
coriander or the eggs can be spotted at a glance.

![A recipe's ingredient list with a picture beside each ingredient](/img/screenshots/ingredient-pictures-recipe.png)

Pictures appear:

- beside each line of a recipe's **ingredient list**, which includes cooking
  mode's ingredients view and the page someone opens from a share link;
- inside a step's **ingredient chips**;
- beside a row in the **recipe editor**, as soon as the name you typed matches;
- beside items on the **grocery list**, including ones you typed by hand, and
  while you are offline;
- beside the names in your [Pantry](../groceries/pantry.md), and beside the
  lines held back under "In your pantry" when you add a recipe.

## How a line gets its picture

Every ingredient your recipes use is kept on the server once, and your
administrator can give it a picture and any number of **other names**.

A line shows the picture of the ingredient it points at — that and nothing else.
The interesting part is how a name becomes an ingredient, which happens as the
recipe is saved or imported: the name you wrote is looked up by itself, then by
its other names. Matching ignores capitals, accents, punctuation and extra
spaces, and nothing else: `Eggs!` is `eggs`, but `free-range eggs` is its own
ingredient until someone adds it as another name. The amount and unit are never
part of the name, so `3 eggs` and `200 g eggs` are both eggs.

This is what keeps one food from becoming two. If `aubergine` is listed as
another name for `Eggplant`, a recipe you import saying aubergine points at
Eggplant, shows the Eggplant picture, and counts towards Eggplant — instead of
starting a second ingredient that needs its own picture drawn.

Because the line points at the ingredient, it also shows **that ingredient's
name**. A recipe imported as "aubergine" reads "Eggplant". This is the same
thing that already happens with capitals, where a recipe saying "olive oil"
reads "Olive Oil" if that is how your server first recorded it.

Grocery items are different: you type them as free text, so they have no
ingredient of their own. A grocery row finds its picture by its name, under the
same matching — capitals, accents, punctuation and extra spaces ignored, and
other names counted too.

A few things follow:

- Other names apply to recipes saved or imported **from then on**. Recipes that
  already point at the older ingredient stay where they are; an administrator
  can merge the two, which moves them across.
- Removing a picture takes it away everywhere at once. Removing another name
  stops future recipes resolving through it, and changes nothing already saved.
- Imported recipes, including [Recipe Archives](./recipe-archive.md), resolve
  their names against the ingredients your server already has.

## Suggestions in the editor

While you type an ingredient line, the editor suggests ingredient names your
recipes already use, starting with, or containing, what you have typed so far.
Every name is offered, whether or not it has a picture. Suggestions only look at
the name part of the line, after the amount and unit.

![The editor suggesting an ingredient while typing a line](/img/screenshots/ingredient-pictures-editor.png)

- Click a suggestion, or use the arrow keys and press **Enter** or **Tab**, to
  replace just the name. The amount and unit you typed stay as they are. If you
  matched an ingredient by one of its other names, the suggestion says so and
  inserts the ingredient's own name, which is what the line would mean anyway.
- Press **Enter** without choosing a suggestion to move to the next line, as
  always.
- Suggestions are optional. Any other name is saved exactly as you typed it, and
  pasting a whole ingredient list works as before.

## Hiding the pictures

If you would rather not see them on a device, hide **Ingredient pictures**
under Settings => User => [Hidden Items](./hidden-items.md). Like every Hidden
Item, this changes only your own view on that device.

## Managing ingredients

Administrators manage ingredients under Settings => Admin => **Ingredients**.
Choose **Manage ingredients** to see every ingredient name your recipes use,
with how many recipes use each. Search by name or other name to find one.

![The Ingredients panel](/img/screenshots/ingredients-admin-panel.png)

Edit an ingredient to change:

- **Name**, which is the text recipes show. Renaming changes it in every recipe
  that uses it, and the editor tells you how many that is first.
- **Other names**, every other way a recipe or shopping list writes it: plurals
  (`egg`), other spellings (`yoghurt`, `yogurt`), other languages (`aubergine`),
  or a common longer form (`large eggs`). Recipes saved from then on resolve
  through them, so the food stays one ingredient with one picture.

  A name can only belong to one ingredient. If the name you add is already an
  ingredient in its own right, Norish says so, tells you how many recipes use
  it, and offers to **merge** it in — which moves those recipes and any pantry
  entries across, keeps its names as other names, and removes its row and
  picture. Merging is never automatic: it is destructive, so it is always your
  choice.
- **Picture**, uploaded, pasted from the clipboard, or drawn by the image model.
  Pictures are cropped to a square.

![Editing an ingredient: its name, other names and picture](/img/screenshots/ingredients-admin-editor.png)

**Add ingredient** creates a name no recipe uses yet, so it can have a picture
ready ahead of time. An ingredient can only be deleted when no recipe uses it and
no household keeps it in a pantry; otherwise Norish tells you what still does.

### Drawing pictures with AI

When [Image Generation](../configuration/ai-provider.md#image-generation) is
configured, **Generate** has the image model draw the ingredient from its name.
A drawing takes a moment and appears in the panel when it is ready. Generating
again replaces the picture.

**Generate missing pictures** draws every ingredient without a picture that a
recipe uses or that has other names. It tells you how many pictures that is
before it starts, because each one is a separate request to your image provider.
Ingredients already being drawn are not drawn twice.

Every picture is drawn from the **Ingredient Illustration Prompt**, which sets
the style they share. You can edit it under Settings => Admin => AI &
Processing => Prompts. Changing it affects pictures drawn afterwards, not the
ones you already have.
