/**
 * @title Group defaults with @Http.Group
 *
 * Decorate the class once. Its static HTTP operations are associated with the group
 * and inherit the same defaults as builder operations joined with `.in(group)`.
 */
import { Capability, Command, Concealment, Http, Query } from "@effx/runtime";
import { Effect } from "effect";
import {
  ConditionalReadHeaders,
  CurrentAccount,
  ReadSettingsInput,
  SessionSecurity,
  SettingsPatch,
  SettingsResponse,
  WriteHeaders,
  settingsAccessAnnotations,
  settingsProblems,
} from "./fixtures/settings.ts";

// A local (non-declared) group may use a plain string root. `@Http.Group`
// takes the same options and defaults as `Http.group(...)`.
@Http.Group({
  root: "settings-local",
  group: "settings",
  title: "Settings",
  defaults: {
    middleware: [SessionSecurity],
    problems: { registry: settingsProblems },
    access: {
      annotator: settingsAccessAnnotations,
      exposure: "External",
      acceptedCredentials: ["BetterAuthCookie"],
      principalKinds: ["Person"],
      concealment: Concealment.reveal,
    },
  },
})
export class SettingsOperations {
  @Query({ name: "settings.read", input: ReadSettingsInput, success: SettingsResponse })
  @Http.Get("/api/settings")
  @Http.Contract({ headers: ConditionalReadHeaders })
  @Http.Problems({ codes: ["authority.denied"] })
  @Http.Access({
    capabilities: Capability.one("settings.read"),
    requirements: [],
    canonicalScopeResolver: CurrentAccount,
  })
  // A protected local operation takes a lazy `authorize` thunk as its second
  // argument. Call it at the point your own snapshot or transaction needs it.
  static read(_input: typeof ReadSettingsInput.Type, authorize: () => Effect.Effect<void>) {
    return Effect.gen(function* () {
      yield* authorize();

      return { theme: "light" as const };
    });
  }

  @Command({ name: "settings.update", input: SettingsPatch, success: SettingsResponse })
  @Http.Patch("/api/settings")
  @Http.Contract({ headers: WriteHeaders })
  @Http.Problems({ codes: ["authority.denied"] })
  @Http.Access({
    capabilities: Capability.one("settings.update"),
    requirements: [],
    canonicalScopeResolver: CurrentAccount,
  })
  static update(input: typeof SettingsPatch.Type, authorize: () => Effect.Effect<void>) {
    return Effect.gen(function* () {
      yield* authorize();

      return { theme: input.theme };
    });
  }
}
