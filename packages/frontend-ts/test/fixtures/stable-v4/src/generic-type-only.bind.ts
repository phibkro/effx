import { Binding } from "@effx/runtime";
import { ContentActionsGroup } from "./content-actions.effx.js";
import { contentGuard } from "./content-bound-http.js";
import { makeTypeOnlyRawHandlers } from "./content-bound-type-only.js";

export const TypeOnlyBinding = Binding.group(ContentActionsGroup, {
  handlers: makeTypeOnlyRawHandlers,
  guardFor: contentGuard,
});
