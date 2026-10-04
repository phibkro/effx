import { Effect, type Layer, Schema } from "effect";
import type { HttpRouter } from "effect/unstable/http";
import type { HttpApiGroup } from "effect/unstable/httpapi";
import { ProfileApi } from "../project/contract/.effx/generated/profile-contract.js";
import type {
  ProfileGuards,
  ProfileRawHandlers,
} from "../project/typecheck-handlers/.effx/generated/profile-handlers.js";
import {
  FixtureReadBackend,
  FixtureWriteBackend,
  ProfileBindings,
  guards,
  raw,
} from "./fixture-binding.js";

type Raw = ProfileRawHandlers<HttpApiGroup.Endpoints<typeof ProfileApi>, typeof guards>;

type BoundServices = HttpRouter.Request.Only<"Requires", Layer.Services<typeof ProfileBindings>>;
type Assert<Condition extends true> = Condition;

export type BoundServicesAreNarrow = Assert<unknown extends BoundServices ? false : true>;
export type ReadBackendIsRequired = Assert<FixtureReadBackend extends BoundServices ? true : false>;
export type WriteBackendIsRequired = Assert<
  FixtureWriteBackend extends BoundServices ? true : false
>;

// @ts-expect-error a raw implementation is required for every endpoint.
export const missingRaw: Raw = { readOwnProfile: raw.readOwnProfile };

// @ts-expect-error a qualified guard is required for every protected endpoint.
export const missingGuard: ProfileGuards<HttpApiGroup.Endpoints<typeof ProfileApi>> = {
  "profile.readOwnProfile": guards["profile.readOwnProfile"],
};

export class UndeclaredRawFailure extends Schema.TaggedError<UndeclaredRawFailure>()(
  "UndeclaredRawFailure",
  { message: Schema.String },
) {}

const unexpectedFailure = Effect.fail(
  new UndeclaredRawFailure({ message: "not in Profile problems" }),
);

// @ts-expect-error the raw callback cannot add an undeclared error to the endpoint contract.
export const undeclaredRawFailure: Raw["readOwnProfile"] = () => unexpectedFailure;
