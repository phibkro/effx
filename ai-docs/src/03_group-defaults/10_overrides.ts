/**
 * @title Overriding group defaults per operation
 *
 * An explicit operation field wins over the group default, including an empty
 * `middleware` array. Defaults merge per field, never object by object.
 */
import { Capability, Concealment, Operation } from "@effx/runtime";
import {
  AnonymousScope,
  ReadSettingsInput,
  SettingsResponse,
  settingsProblems,
} from "./fixtures/settings.ts";
import { SettingsGroup } from "./01_group-builder.ts";

// A declaration in a group declared elsewhere in the project. The group
// reference resolves to the single exported declaration `SettingsGroup`.
// A group never mixes local and external operations (EFFX2403), so this one is
// declared too. It is intentionally public: it overrides the inherited
// credential policy, so it must also override the inherited security middleware.
export const publicDefaults = Operation.query({
  // `<group>.<key>` again: the operation id is derived from the name.
  name: "settings.publicDefaults",
  input: ReadSettingsInput,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.get("/api/settings/defaults")
  // `middleware: []` is an explicit field and wins over `[SessionSecurity]`.
  .http.contract({ middleware: [] })
  .http.problems({
    // An operation may also name its own registry; then the group default is
    // not used for this field.
    registry: settingsProblems,
    codes: ["request.malformed"],
  })
  .http.access({
    // Only the fields present here replace the group's access defaults.
    // Everything else (annotator, exposure) is still inherited.
    acceptedCredentials: ["None"],
    principalKinds: ["Anonymous"],
    capabilities: Capability.none,
    concealment: Concealment.reveal,
    requirements: [],
    canonicalScopeResolver: AnonymousScope,
    decisionTime: "SnapshotRead",
  })
  .declare();
