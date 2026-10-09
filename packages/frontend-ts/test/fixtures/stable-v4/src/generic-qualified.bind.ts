import { Binding } from "@effx/runtime";
import { ContentActionsGroup } from "./content-actions.effx.js";
import { makeQualifiedRawHandlers } from "./content-bound-qualified.js";
import { contentGuard } from "./content-bound-http.js";

export const QualifiedBinding = Binding.group(ContentActionsGroup, {
  handlers: makeQualifiedRawHandlers,
  guardFor: contentGuard,
});
