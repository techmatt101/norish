"use client";

import { useState } from "react";
import { FIELD_CLASS, FIELD_STYLE } from "@/components/groceries/grocery-field";
import { PlusIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Button, FieldError, Input, TextField } from "@heroui/react";
import { useTranslations } from "next-intl";

import { MAX_INGREDIENT_ALT_NAMES } from "@norish/shared/contracts/zod/ingredient-pictures";
import { normalizeGroceryName } from "@norish/shared/lib/normalized-name";

/** Ingredient names are one to eighty characters; the fields stop at the eightieth. */
export const INGREDIENT_NAME_MAX = 80;

interface AltNamesEditorProps {
  /** The ingredient's own name, which an alternative may not repeat. */
  name: string;
  altNames: string[];
  onChange: (altNames: string[]) => void;
}

/**
 * An Ingredient Name's Alternative Names: every other way a recipe or a
 * grocery list writes it — plurals, other spellings, other languages. A name
 * that folds to one already listed adds nothing and is refused where it is
 * typed. Nothing here writes anything; the ingredient is saved with its footer.
 */
export function AltNamesEditor({ name, altNames, onChange }: AltNamesEditorProps) {
  const t = useTranslations("settings.admin.ingredients");
  // The half-typed name goes with the panel: closing it unmounts this editor.
  const [draft, setDraft] = useState("");

  const draftFolded = normalizeGroceryName(draft);
  const draftDuplicate =
    draftFolded !== "" &&
    [name, ...altNames].some((existing) => normalizeGroceryName(existing) === draftFolded);
  const full = altNames.length >= MAX_INGREDIENT_ALT_NAMES;

  const add = () => {
    if (draftFolded === "" || draftDuplicate || full) return;
    onChange([...altNames, draft.trim()]);
    setDraft("");
  };

  return (
    <div data-testid="ingredients-alt-names">
      <p className="text-muted mb-2 text-sm font-medium">{t("altNamesLabel")}</p>

      {altNames.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {altNames.map((altName, index) => (
            <li
              key={`${altName}-${index}`}
              className="bg-surface-secondary flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-sm"
              data-testid="ingredients-alt-name"
            >
              <span>{altName}</span>
              <Button
                isIconOnly
                aria-label={t("removeAltName", { name: altName })}
                className="size-6 min-w-6"
                size="sm"
                variant="ghost"
                onPress={() => onChange(altNames.filter((_, i) => i !== index))}
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-2">
        <TextField
          aria-label={t("addAltName")}
          className="min-w-0 flex-1"
          isDisabled={full}
          isInvalid={draftDuplicate}
          value={draft}
          onChange={setDraft}
        >
          <Input
            className={FIELD_CLASS}
            data-testid="ingredients-alt-name-input"
            maxLength={INGREDIENT_NAME_MAX}
            placeholder={t("altNamePlaceholder")}
            style={FIELD_STYLE}
            variant="secondary"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          {draftDuplicate && <FieldError>{t("altNameAlreadyListed")}</FieldError>}
        </TextField>
        <Button
          isIconOnly
          aria-label={t("addAltName")}
          className="mt-1 shrink-0"
          data-testid="ingredients-add-alt-name"
          isDisabled={draftFolded === "" || draftDuplicate || full}
          size="sm"
          variant="tertiary"
          onPress={add}
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-muted mt-2 text-xs">{t("altNamesHint")}</p>
    </div>
  );
}
