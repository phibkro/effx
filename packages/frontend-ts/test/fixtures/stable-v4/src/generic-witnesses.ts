import { Effect, type Layer } from "effect";
import type { HttpRouter } from "effect/http";
import {
  ContentApiHandlers,
  ContentApiHandlersWith,
} from "../project/bound-generic/.effx/generated/content-handlers.js";
import { ProfileApiHandlers } from "../project/bound-generic-defaulted/.effx/generated/profile-handlers.js";
import { makeGenericGuards, makeGenericRawHandlers } from "./content-bound-generic.js";

const genericContext: { readonly maxBodyBytes: number } = { maxBodyBytes: 4096 };

/** Constrained generic raw factory plus a guards factory with the same context tuple. */
export const GenericContentBound = ContentApiHandlers(genericContext);
export const GenericContentInjected = ContentApiHandlersWith({
  raw: makeGenericRawHandlers(genericContext),
  guards: makeGenericGuards(genericContext),
});

/** A defaulted optional Effect context: no arguments must keep `R = never`. */
export const DefaultedProfileBound = ProfileApiHandlers();

type Assert<Condition extends true> = Condition;
type GenericServices = HttpRouter.Request.Only<
  "Requires",
  Layer.Services<typeof GenericContentBound>
>;
type DefaultedServices = HttpRouter.Request.Only<
  "Requires",
  Layer.Services<typeof DefaultedProfileBound>
>;

export type GenericNoUnknownRequirement = Assert<unknown extends GenericServices ? false : true>;
export type DefaultedNoUnknownRequirement = Assert<
  unknown extends DefaultedServices ? false : true
>;

// @ts-expect-error a context value outside `C extends GenericContentContext` must be rejected.
export const WrongGenericContext = ContentApiHandlers({ maxBodyBytes: "many" });

export const defaultedWork: Effect.Effect<void, never, never> = Effect.void;
export const DefaultedWithWork = ProfileApiHandlers(defaultedWork);
