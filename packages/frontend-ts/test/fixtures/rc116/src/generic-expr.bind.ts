import { Binding } from "@effx/runtime";
import { ContentActionsGroup } from "./content-actions.effx.js";
import { contentGuard } from "./content-bound-http.js";
import { makeExpressionRawHandlers } from "./content-bound-expr.js";

export const ExpressionBinding = Binding.group(ContentActionsGroup, {
  handlers: makeExpressionRawHandlers,
  guardFor: contentGuard,
});
