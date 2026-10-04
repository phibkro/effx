/**
 * @title Typed problem responses
 *
 * `Http.Problems` names the closed set of problem codes an endpoint can return. A
 * registry function you own derives the response schemas from those codes.
 */
import { Http, Query, Requirements } from "@effx/runtime";
import { Effect } from "effect";
import {
  ReadSettingsInput,
  SettingsResponse,
  SettingsStore,
  settingsProblems,
} from "./fixtures/settings.ts";

const SharedProblems = ["request.malformed"] as const;

const SettingsProblems = ["settings.not-found"] as const;

export class SettingsReads {
  @Query({ name: "settings.read", input: ReadSettingsInput, success: SettingsResponse })
  @Http.Get("/api/settings")
  @Http.Contract({ group: "settings", success: SettingsResponse })
  @Http.Problems({
    // An exported derivation function. The generated endpoint calls
    // `settingsProblems("<endpointKey>Problem", [...codes])` for its `error`
    // union; effx never calls it while compiling.
    registry: settingsProblems,
    // The single source of the code list. Nonempty and unique. It may list
    // codes no handler raises (for example request-decoding failures).
    codes: [...SettingsProblems, ...SharedProblems] as const,
    // `map` links domain errors (by their `_tag`) to codes. An error with no
    // map entry and no HTTP status annotation is EFFX2205; a mapped code
    // missing from `codes` is EFFX2206.
    map: { SettingsNotFound: "settings.not-found" },
  })
  @Requirements(SettingsStore)
  static read(_input: typeof ReadSettingsInput.Type) {
    return Effect.gen(function* () {
      // The failure stays an ordinary typed error. The mapping is a contract
      // about it, not a runtime translation that effx generates for you.
      const store = yield* SettingsStore;

      return yield* store.read;
    });
  }
}
