/** @effect-diagnostics unstableApiUsage:off -- fixture declares Effect HttpApi security and problem schemas. */
import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api";
import type { HttpAccessAnnotationSpec } from "@effx/runtime";

export const ProfileCurrentPerson = { id: "profile.current-person" } as const;

export class ProfileAccessAnnotation extends Context.Service<
  ProfileAccessAnnotation,
  HttpAccessAnnotationSpec
>()("users/ProfileAccessAnnotation") {}

/** Generated endpoints merge this real Context value; the compiler only stores its symbol. */
export const profileAccessAnnotations = (spec: HttpAccessAnnotationSpec) =>
  Context.make(ProfileAccessAnnotation, spec);

export class AccessDenied extends Schema.TaggedError<AccessDenied>()(
  "AccessDenied",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

export const ProfileProblemResponses = (_identifier: string, codes: ReadonlyArray<string>) =>
  codes.map((code) => {
    if (code === "authority.denied") return AccessDenied;
    throw new TypeError(`Unknown fixture problem code: ${code}`);
  });

/** A declared security marker supplies a Cookie scheme, but implements no authorization itself. */
export class ProfilePersonSecurity extends HttpApiMiddleware.Service<ProfilePersonSecurity>()(
  "users/ProfilePersonSecurity",
  {
    security: { sessionCookie: HttpApiSecurity.apiKey({ key: "cookie", in: "header" }) },
    error: AccessDenied,
  },
) {}

/** Nonsecurity middleware must never satisfy the protected-operation guard check. */
export class ProfileRequestMarker extends HttpApiMiddleware.Service<ProfileRequestMarker>()(
  "users/ProfileRequestMarker",
) {}

export const ProfileReadInput = Schema.Struct({});

export const ProfileUpdateInput = Schema.Struct({ firstName: Schema.String });

export const ProfileResponse = Schema.Struct({ firstName: Schema.String });

export const ProfileReadHeaders = Schema.Struct({
  "if-none-match": Schema.optionalKey(Schema.String),
});

export const ProfileWriteHeaders = Schema.Struct({
  "if-match": Schema.String,
  "idempotency-key": Schema.String,
});

export type ProfilePrincipal = { readonly personId: string };
