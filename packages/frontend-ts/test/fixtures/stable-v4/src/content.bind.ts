import { Binding } from "@effx/runtime";
import { ContentActionsGroup } from "./content-actions.effx.js";
import { makeContentRawHandlers, contentGuard } from "./content-bound-http.js";

export const ContentBinding = Binding.group(ContentActionsGroup, {
  handlers: makeContentRawHandlers,
  guardFor: contentGuard,
});
