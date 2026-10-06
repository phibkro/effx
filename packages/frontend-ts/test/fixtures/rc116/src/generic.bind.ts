import { Binding } from "@effx/runtime";
import { ContentActionsGroup } from "./content-actions.effx.js";
import { makeGenericGuards, makeGenericRawHandlers } from "./content-bound-generic.js";

export const GenericBinding = Binding.group(ContentActionsGroup, {
  handlers: makeGenericRawHandlers,
  guards: makeGenericGuards,
});
