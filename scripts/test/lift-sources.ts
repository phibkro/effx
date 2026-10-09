/*
 * The authored application bytes of the native lift-check suites and the installed packed journey: a small
 * stable-Effect `HttpApiGroup` with an application root. Plain text only, no imports, so the vitest suites
 * and the packed smoke share one source. No stub stands in for any stage: the frontend, compiler,
 * generator, witness child and binding typecheck all run on these bytes.
 */

export const support = `import { Schema } from "effect";
export const ProfileResponse = Schema.Struct({ id: Schema.String, name: Schema.String }).annotate({ identifier: "ProfileResponse" });
export const ProfileQuery = Schema.Struct({ expand: Schema.optionalKey(Schema.String) }).annotate({ identifier: "ProfileQuery" });
export const ProfilePatch = Schema.Struct({ name: Schema.String }).annotate({ identifier: "ProfilePatch" });
`;

export const api = `import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { ProfilePatch, ProfileQuery, ProfileResponse } from "./support.ts";

export const ReadOwnProfile = HttpApiEndpoint.get("readOwnProfile", "/profile", { query: ProfileQuery, success: ProfileResponse, error: Schema.Never });
export const UpdateOwnProfile = HttpApiEndpoint.patch("updateOwnProfile", "/profile", { payload: ProfilePatch, success: ProfileResponse, error: Schema.Never });
export class ProfileGroup extends HttpApiGroup.make("profile").add(ReadOwnProfile, UpdateOwnProfile) {}
export class Root extends HttpApi.make("mini-api").add(ProfileGroup) {}
`;

/** Application-owned opaque-Context projector (spec 0019 §5.4): the summary annotation, when merged. */
export const projection = `import { Option } from "effect";

export const SummaryKey = "effect/http-api/OpenApi/Summary";

export const summaryOf = (subject: {
  readonly annotations: { readonly mapUnsafe: ReadonlyMap<string, unknown> };
}) => Option.fromUndefinedOr(subject.annotations.mapUnsafe.get(SummaryKey));
`;
