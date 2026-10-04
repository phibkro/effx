import { Context, Schema } from "effect";
import {
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
  OpenApi,
} from "effect/unstable/httpapi";

/** Fixture-only schemas; the real Profile package remains outside this project. */
export const ProfileReadInput = Schema.Struct({});

export const ProfileMergePatch = Schema.Struct({
  firstName: Schema.optionalKey(Schema.String),
  lastName: Schema.optionalKey(Schema.String),
});

export const UserProfileResponse = Schema.Struct({
  firstName: Schema.String,
  lastName: Schema.String,
}).annotate({ identifier: "UserProfileResponse" });

export const ConditionalReadHeaders = Schema.Struct({
  "if-none-match": Schema.optionalKey(Schema.String),
});

export const IdempotencyIfMatchHeaders = Schema.Struct({
  "idempotency-key": Schema.String,
  "if-match": Schema.String,
});

export const ProfileReadResponseHeaders = Schema.Struct({
  etag: Schema.String,
  "cache-control": Schema.Literal("private, no-store"),
  vary: Schema.Literal("Origin"),
});

export const ProfileWriteResponseHeaders = Schema.Struct({
  etag: Schema.String,
  "cache-control": Schema.Literal("no-store"),
  vary: Schema.Literal("Origin"),
});

export class AccessDenied extends Schema.TaggedError<AccessDenied>()(
  "AccessDenied",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/** Security marker only; the app-owned guard decides whether to grant authority. */
export class PersonSecurity extends HttpApiMiddleware.Service<PersonSecurity>()(
  "fixture/rc116/PersonSecurity",
  {
    security: { sessionCookie: HttpApiSecurity.apiKey({ key: "cookie", in: "header" }) },
    error: AccessDenied,
  },
) {}

export interface ProfilePrincipal {
  readonly personId: string;
}

export const ProfileCurrentPerson = { id: "profile.current-person" } as const;

export class ProfileAccessAnnotation extends Context.Service<ProfileAccessAnnotation, unknown>()(
  "fixture/rc116/ProfileAccessAnnotation",
) {}

export const profileAccessAnnotations = (spec: unknown) =>
  Context.make(ProfileAccessAnnotation, spec);

/** Fixture lineage derives from the exact metadata forwarded to the app annotator. */
export const fixtureOperationAnnotations = (metadata: {
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: ReadonlyArray<string>;
}) =>
  OpenApi.annotations({
    transform: (operation) => ({
      ...operation,
      "x-test": {
        operationId: metadata.operationId,
        summary: metadata.summary,
        description: metadata.description,
        tags: metadata.tags,
      },
    }),
  });

/** One code list per operation is passed in by the declaration; this fake registry copies no list. */
export const ProfileProblemResponses = (identifier: string, codes: ReadonlyArray<string>) => [
  Schema.Union(
    codes.map((code) =>
      Schema.Struct({
        _tag: Schema.Literal("ProfileProblem"),
        code: Schema.Literal(code),
        message: Schema.String,
      }).pipe(HttpApiSchema.status(problemStatus(code))),
    ),
  ).annotate({ identifier }),
];

/** A test-only status classification, independent of the operation's authoritative code list. */
const problemStatus = (code: string): number => {
  if (code === "internal.error") return 500;
  if (code === "profile.unavailable" || code === "idempotency.unavailable") return 503;
  if (code === "profile.not-found") return 404;
  if (code === "authority.denied" || code === "origin.denied") return 403;
  if (code === "request.too-large") return 413;
  if (code === "media-type.unsupported") return 415;
  if (code === "precondition.failed") return 412;
  if (code === "precondition.required") return 428;
  if (code.startsWith("idempotency.") || code === "transaction.conflict") return 409;
  if (code.startsWith("validation.")) return 422;
  return 400;
};
