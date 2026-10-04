/**
 * @title Foldkit.Command
 *
 * Opt an HTTP operation into a generated Foldkit `Command`. You name the success
 * and failure Message schemas; effx maps the typed client call into them.
 */
import { Command, Foldkit, Http, Requirements } from "@effx/runtime";
import { Effect } from "effect";
import {
  SettingsPatch,
  SettingsResponse,
  SettingsSaveFailed,
  SettingsSaved,
  SettingsStore,
  WriteHeaders,
} from "./fixtures/settings.ts";

export class SettingsOperations {
  @Command({ name: "Settings.Save", input: SettingsPatch, success: SettingsResponse })
  @Http.Patch("/api/settings")
  @Http.Contract({
    group: "settings",
    headers: WriteHeaders,
    payload: SettingsPatch,
    success: SettingsResponse,
  })
  // Both arguments are exported Message schemas. The annotation is a
  // contribution to the IR; it does not run a Command or touch Foldkit. The
  // generated `foldkit.ts` (only for opted-in operations) imports Foldkit and
  // your Message schemas.
  @Foldkit.Command({ success: SettingsSaved, failure: SettingsSaveFailed })
  @Requirements(SettingsStore)
  static save(input: typeof SettingsPatch.Type) {
    // A Foldkit command needs a local handler: an external (`.declare()`)
    // operation cannot carry `Foldkit.Command` (EFFX1107).
    return Effect.gen(function* () {
      const store = yield* SettingsStore;

      return yield* store.write(input);
    });
  }
}
