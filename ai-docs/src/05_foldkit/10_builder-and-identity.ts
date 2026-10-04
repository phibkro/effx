/**
 * @title Builder form with command identity
 *
 * `.foldkit.command(...)` is the builder twin of `@Foldkit.Command`. A Command with
 * `idempotency-key` and `if-match` headers may also name a `commandIdentity` function.
 */
import { Operation } from "@effx/runtime";
import { Effect } from "effect";
import {
  SettingsPatch,
  SettingsResponse,
  SettingsSaveFailed,
  SettingsSaved,
  SettingsStore,
  WriteHeaders,
  settingsCommandIdentity,
} from "./fixtures/settings.ts";

export const saveSettings = Operation.command({
  name: "Settings.Save",
  input: SettingsPatch,
  success: SettingsResponse,
})
  .http.patch("/api/settings")
  .http.contract({
    group: "settings",
    headers: WriteHeaders,
    payload: SettingsPatch,
    success: SettingsResponse,
    metadata: {
      // Local operations may state an id; it must still be `<group>.<key>`.
      operationId: "settings.save",
      // An exported application function. effx generates a typed
      // `commandIdentity(input)` helper that calls it; effx never mints keys,
      // stores identities or retries. Legal only for a Command whose headers
      // contain both `idempotency-key` and `if-match`.
      commandIdentity: settingsCommandIdentity,
    },
  })
  .foldkit.command({ success: SettingsSaved, failure: SettingsSaveFailed })
  .handler((input: typeof SettingsPatch.Type) =>
    Effect.gen(function* () {
      const store = yield* SettingsStore;

      return yield* store.write(input);
    }),
  );
