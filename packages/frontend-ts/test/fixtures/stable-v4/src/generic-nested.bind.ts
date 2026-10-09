import { Binding } from "@effx/runtime";
import { ContentActionsGroup } from "./content-actions.effx.js";
import { contentGuard } from "./content-bound-http.js";
import { makeNestedOnlyRawHandlers } from "./content-bound-nested.js";

export const NestedOnlyBinding = Binding.group(ContentActionsGroup, {
  handlers: makeNestedOnlyRawHandlers,
  guardFor: contentGuard,
});
