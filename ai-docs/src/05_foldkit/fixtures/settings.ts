import { Context, Effect, Layer, Schema } from "effect";

// ---------------------------------------------------------------------------
// Wire schemas for the settings endpoint.
// ---------------------------------------------------------------------------

export const SettingsPatch = Schema.Struct({ theme: Schema.Literals(["light", "dark"]) });

export const SettingsResponse = Schema.Struct({ theme: Schema.Literals(["light", "dark"]) });

// A mutation that retries safely needs a stable key and a precondition.
export const WriteHeaders = Schema.Struct({
  "idempotency-key": Schema.String,
  "if-match": Schema.String,
});

// ---------------------------------------------------------------------------
// Messages. The UI program (Foldkit `update`) owns these shapes; effx only
// records which exported schemas a command maps into. `requestId` lets
// `update` ignore a stale answer.
// ---------------------------------------------------------------------------

export const SettingsSaved = Schema.TaggedStruct("SettingsSaved", {
  requestId: Schema.Int,
  settings: SettingsResponse,
});

export const SettingsSaveFailed = Schema.TaggedStruct("SettingsSaveFailed", {
  requestId: Schema.Int,
  reason: Schema.String,
});

// ---------------------------------------------------------------------------
// Command identity: an application function, never evaluated by the compiler.
// The app owns key creation and retry policy; effx only forwards the request.
// ---------------------------------------------------------------------------

export function settingsCommandIdentity(request: {
  readonly headers: typeof WriteHeaders.Type;
  readonly payload: typeof SettingsPatch.Type;
}) {
  return {
    key: request.headers["idempotency-key"],
    input: request,
    precondition: request.headers["if-match"],
  };
}

// ---------------------------------------------------------------------------
// A domain service the handler uses.
// ---------------------------------------------------------------------------

export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    readonly write: (
      patch: typeof SettingsPatch.Type,
    ) => Effect.Effect<typeof SettingsResponse.Type>;
  }
>()("docs/foldkit/SettingsStore") {
  static readonly layer = Layer.succeed(
    SettingsStore,
    SettingsStore.of({ write: (patch) => Effect.succeed({ theme: patch.theme }) }),
  );
}
