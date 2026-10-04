/**
 * @title Capability and concealment variants
 *
 * Capability expressions (`one`, `any`, `all`, `none`) and concealment policies
 * (`reveal`, `notFound`) are plain tagged values. This builder file uses them.
 */
import { Capability, Concealment, Operation } from "@effx/runtime";
import { Effect } from "effect";
import {
  type Authorize,
  NoScope,
  ReadSettingsInput,
  SessionSecurity,
  SettingsResponse,
  SharedWorkspace,
  settingsAccessAnnotations,
} from "./fixtures/settings.ts";

// `Capability.any` is satisfied by either capability. `Concealment.notFound`
// takes a nonempty list of stage names. effx stores them as data and does not
// interpret them; your annotator and interpreter decide what each stage means.
export const readSharedSettings = Operation.query({
  name: "settings.readShared",
  input: ReadSettingsInput,
  success: SettingsResponse,
})
  .http.get("/api/shared/settings")
  .http.contract({ group: "shared", middleware: [SessionSecurity] })
  .http.access({
    annotator: settingsAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie"],
    principalKinds: ["Person", "ServicePrincipal"],
    capabilities: Capability.any("settings.read", "settings.admin"),
    // Typed requirements carry JSON-only parameters for the app's interpreter.
    requirements: [{ id: "workspace.member", parameters: { role: "viewer" } }],
    canonicalScopeResolver: SharedWorkspace,
    concealment: Concealment.notFound("membership", "capability"),
    decisionTime: "SnapshotRead",
  })
  .handler((_input: typeof ReadSettingsInput.Type, authorize: Authorize) =>
    Effect.gen(function* () {
      yield* authorize();

      return { theme: "light" as const };
    }),
  );

// An internal endpoint with no credential: `Capability.none` and the sole
// `None` credential. An `Internal` root is excluded from the generated client
// and from the external operation index.
export const readHealth = Operation.query({
  name: "settings.health",
  input: ReadSettingsInput,
  success: SettingsResponse,
})
  .http.get("/internal/settings/health")
  .http.contract({ root: "internal", group: "ops" })
  .http.access({
    annotator: settingsAccessAnnotations,
    exposure: "Internal",
    acceptedCredentials: ["None"],
    principalKinds: ["Anonymous"],
    capabilities: Capability.none,
    requirements: [],
    canonicalScopeResolver: NoScope,
    concealment: Concealment.reveal,
    decisionTime: "SnapshotRead",
  })
  .handler(() => Effect.succeed({ theme: "light" as const }));

// `Capability.all` requires every listed capability.
export const resetSettings = Operation.command({
  name: "settings.reset",
  input: ReadSettingsInput,
  success: SettingsResponse,
})
  .http.post("/api/shared/settings/reset")
  .http.contract({ group: "shared", middleware: [SessionSecurity] })
  .http.access({
    annotator: settingsAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie"],
    principalKinds: ["Person"],
    capabilities: Capability.all("settings.write", "settings.admin"),
    requirements: [],
    canonicalScopeResolver: SharedWorkspace,
    concealment: Concealment.reveal,
    decisionTime: "Transaction",
  })
  .handler((_input: typeof ReadSettingsInput.Type, authorize: Authorize) =>
    Effect.gen(function* () {
      yield* authorize();

      return { theme: "light" as const };
    }),
  );
