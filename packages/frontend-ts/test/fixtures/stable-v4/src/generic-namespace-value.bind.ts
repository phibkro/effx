import { Binding } from "@effx/runtime";
import { ContentActionsGroup } from "./content-actions.effx.js";
import { contentGuard } from "./content-bound-http.js";
import { makeNamespaceValueRawHandlers } from "./content-bound-namespace-value.js";

export const NamespaceValueBinding = Binding.group(ContentActionsGroup, {
  handlers: makeNamespaceValueRawHandlers,
  guardFor: contentGuard,
});
