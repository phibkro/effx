import { type Layer } from "effect";
import type { HttpRouter } from "effect/http";
import { ContentApiHandlers as ExpressionHandlers } from "../project/bound-generic-expr/.effx/generated/content-handlers.js";
import { ContentApiHandlers as DefaultedGuardHandlers } from "../project/bound-generic-defaulted-guard/.effx/generated/content-handlers.js";

/** typeof-value, qualified namespace and imported-alias clauses, all legal. */
export const ExpressionBound = ExpressionHandlers();
/** The same value tuple as its raw factory, with an extra legal defaulted guard type parameter. */
export const DefaultedGuardBound = DefaultedGuardHandlers({ maxBodyBytes: 512 });

type Assert<Condition extends true> = Condition;
type ExpressionServices = HttpRouter.Request.Only<
  "Requires",
  Layer.Services<typeof ExpressionBound>
>;
type GuardServices = HttpRouter.Request.Only<
  "Requires",
  Layer.Services<typeof DefaultedGuardBound>
>;

export type ExpressionNoUnknownRequirement = Assert<
  unknown extends ExpressionServices ? false : true
>;
export type DefaultedGuardNoUnknownRequirement = Assert<
  unknown extends GuardServices ? false : true
>;

// @ts-expect-error a value outside `typeof defaults` is still rejected.
export const WrongDefaults = ExpressionHandlers({ maxBodyBytes: "many" });
