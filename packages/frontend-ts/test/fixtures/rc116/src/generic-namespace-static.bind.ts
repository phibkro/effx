import { Binding } from "@effx/runtime";
import { ContentActionsGroup } from "./content-actions.effx.js";
import { contentGuard } from "./content-bound-http.js";
import { makeNamespaceStaticRawHandlers } from "./content-bound-namespace-value.js";

export const NamespaceStaticBinding = Binding.group(ContentActionsGroup, {
  handlers: makeNamespaceStaticRawHandlers,
  guardFor: contentGuard,
});
