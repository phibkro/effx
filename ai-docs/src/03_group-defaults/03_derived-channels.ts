/**
 * @title Request channels derived from `input`
 *
 * The operation `input` says which request channel it fills; `Http.Contract` only spells what the
 * input cannot imply. The compiler writes the derived channel into the contract before
 * interpretation, so the dense and the spelled-out declaration share IR, hash and generated files.
 */
import { Capability, Operation } from "@effx/runtime";
import {
  AnonymousScope,
  SearchSettingsInput,
  SettingsById,
  SettingsList,
  SettingsRename,
  SettingsResponse,
  VersionHeaders,
} from "./fixtures/settings.ts";
import { SettingsGroup } from "./01_group-builder.ts";

// GET without path parameters: the input is the `query`. No `query: true`, no `query:`.
export const searchSettings = Operation.query({
  name: "settings.search",
  input: SearchSettingsInput,
  success: SettingsList,
})
  .in(SettingsGroup)
  .http.get("/api/settings/search")
  .http.contract({ status: 200 })
  .http.problems({ codes: ["request.malformed"] })
  .http.access({
    capabilities: Capability.one("settings.search"),
    requirements: [],
    canonicalScopeResolver: AnonymousScope,
  })
  .declare();

// An input wrapped by `Http.headers(...)` is the `headers` channel (never a body). The compiler
// detects the wrapper by the static type of the schema, not by its name or its keys.
export const readVersion = Operation.query({
  name: "settings.readVersion",
  input: VersionHeaders,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.get("/api/settings/version")
  .http.contract({ status: 200 })
  .http.problems({ codes: ["request.malformed"] })
  .http.access({
    capabilities: Capability.one("settings.read-version"),
    requirements: [],
    canonicalScopeResolver: AnonymousScope,
  })
  .declare();

// Every input field is a path parameter: the input is the `params` (its keys must be the route's).
export const readById = Operation.query({
  name: "settings.readById",
  input: SettingsById,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.get("/api/settings/:settingsId")
  .http.contract({ status: 200 })
  .http.problems({ codes: ["settings.not-found"] })
  .http.access({
    capabilities: Capability.one("settings.read"),
    requirements: [],
    canonicalScopeResolver: AnonymousScope,
  })
  .declare();

// No input field is a path parameter: the `params` stay explicit (the input does not carry them) and
// the input is the body of a PATCH. An input mixing both kinds is `EFFX2410`: write the channels.
export const renameSettings = Operation.command({
  name: "settings.rename",
  input: SettingsRename,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.patch("/api/settings/:settingsId")
  .http.contract({ params: SettingsById, status: 200 })
  .http.problems({ codes: ["settings.not-found"] })
  .http.access({
    capabilities: Capability.one("settings.rename"),
    requirements: [],
    canonicalScopeResolver: AnonymousScope,
  })
  .declare();
