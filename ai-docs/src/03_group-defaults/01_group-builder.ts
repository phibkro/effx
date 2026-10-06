/**
 * @title Group defaults with Http.group
 *
 * State middleware, problem registry, metadata annotator and access policy once on the
 * group. Operations joined with `.in(group)` inherit them field by field.
 */
import { Capability, Concealment, Http, Operation } from "@effx/runtime";
import {
  ConditionalReadHeaders,
  CurrentAccount,
  ReadSettingsInput,
  SessionSecurity,
  SettingsApi,
  SettingsPatch,
  SettingsResponse,
  WriteHeaders,
  settingsAccessAnnotations,
  settingsOperationAnnotations,
  settingsProblems,
} from "./fixtures/settings.ts";

// Export the group: operations reference it by symbol and the frontend resolves
// it statically to exactly one exported declaration (EFFX2404 otherwise).
export const SettingsGroup = Http.group({
  root: SettingsApi,
  group: "settings",
  title: "Settings",
  description: "Per-account settings.",
  displayName: "Settings",
  // Defaults are source syntax. They are merged into each operation's own
  // annotations before interpretation and are never serialized in the IR.
  defaults: {
    middleware: [SessionSecurity],
    metadata: { annotator: settingsOperationAnnotations },
    problems: { registry: settingsProblems },
    access: {
      annotator: settingsAccessAnnotations,
      exposure: "External",
      acceptedCredentials: ["BetterAuthCookie"],
      principalKinds: ["Person"],
      concealment: Concealment.reveal,
    },
  },
});

// What stays per operation: route, request channels, problem codes,
// capabilities, requirements, scope resolver and decision time. Defaults never
// invent those.
export const readSettings = Operation.query({
  // A name of the exact shape `<group>.<key>` doubles as the operation id, so
  // no `metadata.operationId` is needed (spec 0013).
  name: "settings.read",
  input: ReadSettingsInput,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.get("/api/settings")
  // `root`, `group` and `success` come from the group and the operation.
  .http.contract({ headers: ConditionalReadHeaders })
  // The registry comes from the group default; the codes stay explicit.
  .http.problems({ codes: ["authority.denied", "settings.not-found"] })
  .http.access({
    capabilities: Capability.one("settings.read"),
    requirements: [],
    canonicalScopeResolver: CurrentAccount,
  })
  .declare();

export const updateSettings = Operation.command({
  name: "settings.update",
  input: SettingsPatch,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.patch("/api/settings")
  // `payload` is omitted: the declared `input` is the body of a PATCH, POST or PUT Command unless
  // it is the params or headers schema (request channels are derived from `input`, see below).
  .http.contract({ headers: WriteHeaders })
  .http.problems({ codes: ["authority.denied", "precondition.failed"] })
  .http.access({
    capabilities: Capability.one("settings.update"),
    requirements: [],
    canonicalScopeResolver: CurrentAccount,
    // `decisionTime` is omitted: a Command decides inside its own transaction and a Query in a
    // read snapshot. Write it only to override the default (spec 0024 §4).
  })
  .declare();
