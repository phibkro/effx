/**
 * @title Declaring access with Http.Access
 *
 * `Http.Access` records who may call an endpoint as data. The application owns
 * evaluation; effx only requires a typed, lazy guard at the handler boundary.
 */
import { Capability, Command, Concealment, Http, Query } from "@effx/runtime";
import { Effect } from "effect";
import {
  type Authorize,
  CurrentAccount,
  ReadSettingsInput,
  SessionSecurity,
  SettingsPatch,
  SettingsResponse,
  SettingsStore,
  WriteHeaders,
  settingsAccessAnnotations,
} from "./fixtures/settings.ts";

export class SettingsAccessOperations {
  @Query({ name: "settings.read", input: ReadSettingsInput, success: SettingsResponse })
  @Http.Get("/api/settings")
  // A protected operation needs a security marker in `middleware`
  // (EFFX2503 otherwise). A marker is not any middleware: it must carry
  // Effect's HttpApiMiddleware security stamp.
  @Http.Contract({ group: "settings", success: SettingsResponse, middleware: [SessionSecurity] })
  @Http.Access({
    // An exported function `(spec) => Context`. The generated endpoint calls it
    // with the values below and merges the Context onto the endpoint.
    annotator: settingsAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    // Names are application strings. Constructors build the tagged values.
    capabilities: Capability.one("settings.read"),
    requirements: [{ id: "settings.owner" }],
    // An exported symbol the app maps to its own resolver id.
    canonicalScopeResolver: CurrentAccount,
    concealment: Concealment.reveal,
    // A read decides in a read snapshot.
    decisionTime: "SnapshotRead",
  })
  static read(_input: typeof ReadSettingsInput.Type, authorize: Authorize) {
    return Effect.gen(function* () {
      // `authorize` is lazy: nothing ran before this line. Call it where your
      // own snapshot (read) or transaction (write) needs the decision.
      yield* authorize();
      const store = yield* SettingsStore;

      return yield* store.read;
    });
  }

  @Command({ name: "settings.update", input: SettingsPatch, success: SettingsResponse })
  @Http.Patch("/api/settings")
  @Http.Contract({
    group: "settings",
    headers: WriteHeaders,
    payload: SettingsPatch,
    success: SettingsResponse,
    middleware: [SessionSecurity],
  })
  @Http.Access({
    annotator: settingsAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: Capability.one("settings.update"),
    requirements: [{ id: "settings.owner" }],
    canonicalScopeResolver: CurrentAccount,
    concealment: Concealment.reveal,
    // A write decides inside the committing transaction. `SnapshotRead` on a
    // Command is EFFX2501.
    decisionTime: "Transaction",
  })
  static update(input: typeof SettingsPatch.Type, authorize: Authorize) {
    return Effect.gen(function* () {
      yield* authorize();
      const store = yield* SettingsStore;

      return yield* store.write(input);
    });
  }
}
