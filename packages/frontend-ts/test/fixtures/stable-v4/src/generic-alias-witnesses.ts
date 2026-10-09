import { type Layer } from "effect";
import type { HttpRouter } from "effect/unstable/http";
import {
  ContentApiHandlers as AliasHandlers,
  ContentApiHandlersWith as AliasHandlersWith,
} from "../project/bound-generic-alias/.effx/generated/content-handlers.js";
import { ContentApiHandlers as QualifiedHandlers } from "../project/bound-generic-qualified/.effx/generated/content-handlers.js";
import { makeAliasedRawHandlers, makeAlphaGuards } from "./content-bound-alias.js";
import { makeQualifiedRawHandlers } from "./content-bound-qualified.js";

const aliasContext = { maxBodyBytes: 2048 };

/** Aliased interface constraint, aliased type-alias default and alpha-renamed guards, all legal. */
export const AliasBound = AliasHandlers(aliasContext);
export const AliasInjected = AliasHandlersWith({
  raw: makeAliasedRawHandlers(aliasContext),
  guards: makeAlphaGuards(aliasContext),
});

/** Qualified type-only constraint, F-bound and literal default. */
export const QualifiedBound = QualifiedHandlers({ maxBodyBytes: 4096 });

type Assert<Condition extends true> = Condition;
type AliasServices = HttpRouter.Request.Only<"Requires", Layer.Services<typeof AliasBound>>;
type QualifiedServices = HttpRouter.Request.Only<"Requires", Layer.Services<typeof QualifiedBound>>;

export type AliasNoUnknownRequirement = Assert<unknown extends AliasServices ? false : true>;
export type QualifiedNoUnknownRequirement = Assert<
  unknown extends QualifiedServices ? false : true
>;

// @ts-expect-error an aliased constraint still rejects a context outside it.
export const WrongAliasContext = AliasHandlers({ maxBodyBytes: "many" });
// @ts-expect-error the qualified constraint still rejects a context outside it.
export const WrongQualifiedContext = QualifiedHandlers({ maxBodyBytes: "many" });
