/** @effect-diagnostics unstableApiUsage:off -- this fixture declares native HttpApi middleware and response headers. */
import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/http-api";
import type { HttpAccessAnnotationSpec } from "@effx/runtime";

export const ProfileCurrentPerson = { id: "profile.current-person" } as const;

export class ProfileAccessAnnotation extends Context.Service<
  ProfileAccessAnnotation,
  HttpAccessAnnotationSpec
>()("users/ProfileClientFoldkitAccess") {}

export const profileAccessAnnotations = (spec: HttpAccessAnnotationSpec) =>
  Context.make(ProfileAccessAnnotation, spec);

export class CredentialMissing extends Schema.TaggedError<CredentialMissing>()(
  "CredentialMissing",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/** The tuple preserves the concrete 401 type in HttpApiClient's error channel. */
export const ProfileProblemResponses = (_identifier: string, codes: ReadonlyArray<string>) => {
  if (codes.length !== 1 || codes[0] !== "credential.missing") {
    throw new TypeError("ProfileProblemResponses accepts only credential.missing");
  }

  return [CredentialMissing] as const;
};

export class ProfileCredentialSecurity extends HttpApiMiddleware.Service<ProfileCredentialSecurity>()(
  "users/ProfileClientFoldkitSecurity",
  {
    security: { sessionCookie: HttpApiSecurity.apiKey({ key: "cookie", in: "header" }) },
    error: CredentialMissing,
  },
) {}

export const ProfileReadInput = Schema.Struct({});

export const ProfileReadQuery = Schema.Struct({ locale: Schema.Literals(["en", "fr"]) });

export const ProfileReadHeaders = Schema.Struct({
  "x-trace-id": Schema.optionalKey(Schema.String),
});

export const ProfileUpdateInput = Schema.Struct({ firstName: Schema.String });

export const ProfileWriteHeaders = Schema.Struct({
  "if-match": Schema.String,
  "idempotency-key": Schema.String,
  "x-trace-id": Schema.optionalKey(Schema.String),
});

export const ProfileResponse = Schema.Struct({ firstName: Schema.String });

export const ProfileResponseHeaders = Schema.Struct({ etag: Schema.String });

export const ProfileUpdated = Schema.TaggedStruct("ProfileUpdated", {
  requestId: Schema.Int,
  profile: ProfileResponse,
  etag: Schema.String,
});

export const ProfileUpdateFailed = Schema.TaggedStruct("ProfileUpdateFailed", {
  requestId: Schema.Int,
  failure: Schema.Struct({ _tag: Schema.String }),
});

/** The application supplies and persists the key; the compiler only forwards these fields. */
export function profileCommandIdentity(request: {
  readonly headers: typeof ProfileWriteHeaders.Type;
  readonly payload: typeof ProfileUpdateInput.Type;
}) {
  return {
    key: request.headers["idempotency-key"],
    input: request,
    precondition: request.headers["if-match"],
  };
}

export type ProfilePrincipal = { readonly personId: string };

export const profileWithEtag = (firstName: string) =>
  HttpApiSchema.withHeaders({
    body: { firstName },
    headers: { etag: '"v2"' },
  });
