/** @effect-diagnostics unstableApiUsage:off -- fixture declares native HttpApi security markers and problem schemas. */
import { Context, Effect, Layer, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/http-api";
import type { HttpAccessAnnotationSpec } from "@effx/runtime";

// ---------------------------------------------------------------------------
// Wire schemas
// ---------------------------------------------------------------------------

export const ReadSettingsInput = Schema.Struct({});

export const SettingsPatch = Schema.Struct({ theme: Schema.Literals(["light", "dark"]) });

export const SettingsResponse = Schema.Struct({ theme: Schema.Literals(["light", "dark"]) });

export const WriteHeaders = Schema.Struct({
  "idempotency-key": Schema.String,
  "if-match": Schema.String,
});

// ---------------------------------------------------------------------------
// Domain errors. `@Http.Problems({ map })` keys are these classes' `_tag`s.
// ---------------------------------------------------------------------------

export class SettingsNotFound extends Schema.TaggedError<SettingsNotFound>()(
  "SettingsNotFound",
  {},
) {}

export class AccessDenied extends Schema.TaggedError<AccessDenied>()(
  "AccessDenied",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

// ---------------------------------------------------------------------------
// Application-owned access pieces. effx records them as symbols.
// ---------------------------------------------------------------------------

export interface Principal {
  readonly personId: string;
}

/** The thunk a protected handler receives; calling it runs the app's own guard. */
export type Authorize = () => Effect.Effect<Principal, AccessDenied>;

/** A security marker declares the credential scheme. It does not authorize anything itself. */
export class SessionSecurity extends HttpApiMiddleware.Service<SessionSecurity>()(
  "docs/problems-and-access/SessionSecurity",
  {
    security: { sessionCookie: HttpApiSecurity.apiKey({ key: "cookie", in: "header" }) },
    error: AccessDenied,
  },
) {}

/** Opaque handles for the scope resolvers the app interpreter registers. */
export const CurrentAccount = { id: "settings.current-account" } as const;

export const SharedWorkspace = { id: "settings.shared-workspace" } as const;

export const NoScope = { id: "settings.none" } as const;

export class SettingsAccessAnnotation extends Context.Service<
  SettingsAccessAnnotation,
  HttpAccessAnnotationSpec
>()("docs/problems-and-access/SettingsAccessAnnotation") {}

/** Receives the access spec exactly as written in the declaration. The app interprets it. */
export const settingsAccessAnnotations = (spec: HttpAccessAnnotationSpec) =>
  Context.make(SettingsAccessAnnotation, spec);

// ---------------------------------------------------------------------------
// Problem registry: (identifier, codes) -> response schemas, one per code.
// effx has no status or body table of its own; the application owns the wire format.
// ---------------------------------------------------------------------------

interface StatusByCode {
  readonly [code: string]: number;
}

const statusByCode: StatusByCode = {
  "request.malformed": 400,
  "authority.denied": 403,
  "settings.not-found": 404,
  "precondition.failed": 412,
};

export const settingsProblems = (
  identifier: string,
  codes: ReadonlyArray<string>,
): ReadonlyArray<Schema.Top> =>
  codes.map((code) =>
    Schema.Struct({ code: Schema.Literal(code), title: Schema.String }).pipe(
      Schema.annotate({ identifier: `${identifier}.${code}` }),
      HttpApiSchema.status(statusByCode[code] ?? 400),
    ),
  );

// ---------------------------------------------------------------------------
// A domain service the handlers use.
// ---------------------------------------------------------------------------

export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    readonly read: Effect.Effect<typeof SettingsResponse.Type, SettingsNotFound>;
    readonly write: (
      patch: typeof SettingsPatch.Type,
    ) => Effect.Effect<typeof SettingsResponse.Type>;
  }
>()("docs/problems-and-access/SettingsStore") {
  static readonly layer = Layer.succeed(
    SettingsStore,
    SettingsStore.of({
      read: Effect.succeed({ theme: "light" }),
      write: (patch) => Effect.succeed({ theme: patch.theme }),
    }),
  );
}
