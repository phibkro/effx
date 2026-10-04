/** @effect-diagnostics unstableApiUsage:off -- fixture declares native HttpApi roots, security markers and problem schemas. */
import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
  OpenApi,
} from "effect/http-api";
import { Http, type HttpAccessAnnotationSpec, type HttpOperationMetadata } from "@effx/runtime";

// ---------------------------------------------------------------------------
// Wire schemas
// ---------------------------------------------------------------------------

export const ReadSettingsInput = Schema.Struct({});

export const SettingsPatch = Schema.Struct({ theme: Schema.Literals(["light", "dark"]) });

export const SettingsResponse = Schema.Struct({ theme: Schema.Literals(["light", "dark"]) });

export const ConditionalReadHeaders = Schema.Struct({
  "if-none-match": Schema.optionalKey(Schema.String),
});

export const WriteHeaders = Schema.Struct({
  "idempotency-key": Schema.String,
  "if-match": Schema.String,
});

export const SearchSettingsInput = Schema.Struct({
  query: Schema.String,
  page: Schema.optionalKey(Schema.Finite),
});

export const SettingsList = Schema.Struct({ names: Schema.Array(Schema.String) });

/** `Http.headers` marks a Schema as a headers schema; it is the identity at runtime. */
export const VersionHeaders = Http.headers(
  Schema.Struct({
    "if-none-match": Schema.optionalKey(Schema.String),
    "x-client-version": Schema.String,
  }),
);

export const SettingsById = Schema.Struct({ settingsId: Schema.String });

export const SettingsRename = Schema.Struct({ name: Schema.String });

// ---------------------------------------------------------------------------
// Application-owned pieces that a group's defaults refer to by symbol.
// effx records these exports and imports them from generated code. It never
// calls them while compiling.
// ---------------------------------------------------------------------------

/** The concrete root the group belongs to (external bindings need a symbol, not a string). */
export const SettingsApi = HttpApi.make("settings-api");

export class SessionDenied extends Schema.TaggedError<SessionDenied>()(
  "SessionDenied",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/** A security marker: it declares the credential scheme and implements no authorization. */
export class SessionSecurity extends HttpApiMiddleware.Service<SessionSecurity>()(
  "docs/group-defaults/SessionSecurity",
  {
    security: { sessionCookie: HttpApiSecurity.apiKey({ key: "cookie", in: "header" }) },
    error: SessionDenied,
  },
) {}

interface StatusByCode {
  readonly [code: string]: number;
}

const statusByCode: StatusByCode = {
  "request.malformed": 400,
  "authority.denied": 403,
  "settings.not-found": 404,
  "precondition.failed": 412,
  "internal.error": 500,
};

/** A `ProblemRegistry`: from an identifier and the operation's codes, derive response schemas. */
export const settingsProblems = (
  identifier: string,
  codes: ReadonlyArray<string>,
): ReadonlyArray<Schema.Top> =>
  codes.map((code) =>
    Schema.Struct({
      code: Schema.Literal(code),
      title: Schema.String,
    }).pipe(
      Schema.annotate({ identifier: `${identifier}.${code}` }),
      HttpApiSchema.status(statusByCode[code] ?? 400),
    ),
  );

export class SettingsAccessAnnotation extends Context.Service<
  SettingsAccessAnnotation,
  HttpAccessAnnotationSpec
>()("docs/group-defaults/SettingsAccessAnnotation") {}

/** Receives the access spec effx forwards unchanged and returns an Effect `Context`. */
export const settingsAccessAnnotations = (spec: HttpAccessAnnotationSpec) =>
  Context.make(SettingsAccessAnnotation, spec);

/** Receives the operation metadata effx forwards; here it adds OpenAPI provenance. */
export const settingsOperationAnnotations = (metadata: HttpOperationMetadata) =>
  OpenApi.annotations({
    transform: (operation) => ({ ...operation, "x-operation-id": metadata.operationId }),
  });

/** Opaque application symbol the access interpreter maps to a scope resolver. */
export const CurrentAccount = { id: "settings.current-account" } as const;

/** Scope resolver symbol for the public operation that has no account. */
export const AnonymousScope = { id: "settings.anonymous" } as const;
