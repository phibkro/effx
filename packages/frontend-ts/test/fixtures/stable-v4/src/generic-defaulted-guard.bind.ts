import { Binding } from "@effx/runtime";
import { ContentActionsGroup } from "./content-actions.effx.js";
import { makeGenericRawHandlers } from "./content-bound-generic.js";
import { makeDefaultedGuards } from "./content-bound-generic.js";

export const DefaultedGuardBinding = Binding.group(ContentActionsGroup, {
  handlers: makeGenericRawHandlers,
  guards: makeDefaultedGuards,
});
