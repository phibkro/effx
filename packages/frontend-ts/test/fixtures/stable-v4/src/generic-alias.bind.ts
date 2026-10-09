import { Binding } from "@effx/runtime";
import { ContentActionsGroup } from "./content-actions.effx.js";
import { makeAliasedRawHandlers, makeAlphaGuards } from "./content-bound-alias.js";

export const AliasBinding = Binding.group(ContentActionsGroup, {
  handlers: makeAliasedRawHandlers,
  guards: makeAlphaGuards,
});
