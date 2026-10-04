# Effect rc.116 distribution compatibility

Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.

Source: effx `pack-dist` commit `340a7c8e0cb332613283846df634f82c176b2a9f`; mono-web baseline `f433ea906c9f9af5134c7316d54c78d8c859038f`. The source of the API differences is the installed `effect/package.json` export map and the modules under each installed `node_modules/effect/src`. No mono-web source was changed.

## Packed artifacts

`bun run pack` builds `@effx/runtime` and `@effx/cli`, then writes `dist-artifacts/manifest.json` with the source commit and SHA-256 for each ignored tarball. This pack command refuses a dirty source tree. It uses Bun's `pm pack` rather than a hand-written tar writer. The manifest at the source commit named above contains:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `effx-runtime-0.1.0-340a7c8e0cb332613283846df634f82c176b2a9f.tgz` | 4,908 | `b4305d4d754ea53e88c17181bbb16b8accb3c930499022e9a543a8f07a2cb815` |
| `effx-cli-0.1.0-340a7c8e0cb332613283846df634f82c176b2a9f.tgz` | 227,566 | `b8c150288b38f36daadd673b5a76e60a4c366bd731929ddbb5065eb782fa6233` |

The CLI bundle `packages/cli/dist/effx.js` is **1,130,427 bytes** before compression. Bun bundles Effect 4.0.0, `@effect/platform-bun`, and the effx compiler/frontend/IR into that process. The only non-built-in external import is `@typescript/typescript6@6.0.2`, which is a package dependency of the CLI tarball. It provides TypeScript's `lib.*.d.ts` files and aliases `@typescript/old` (installed TypeScript 6.0.3); bundling only compiler JavaScript would lose the compiler's disk-backed standard libraries. This is a build-process dependency, not a second Effect in the consuming application. The runtime tarball has only `dist/` and LICENSE, exports ESM/declarations, and has **no runtime Effect import** or `effect` dependency. Its peer range is `>=4.0.0-rc.116 <5` (`packages/runtime/src/{Annotation,authority,builder,decorators}.ts`, both installed `Schema.ts` and `Context.ts`). The source workspace manifest also has a `source` condition. The packed manifest omits that condition because the tarball does not contain `src/`.

## Isolated consumer proof

A new `temporary workspace` project installed only `effect@4.0.0-rc.116` as its Effect dependency, the two tarballs above, and `typescript@7.0.2` for the target typecheck. Bun also installed the CLI's TypeScript 6 package/alias. No effx workspace path was present in its package manifest. The fixture uses `@effx/runtime` decorators for an Effect-backed `User.Get` GET operation.

| Command in the temporary project | Exit | Observation |
| --- | ---: | --- |
| `bun add effect@4.0.0-rc.116` | 0 | One application Effect version. |
| `bun add <runtime tarball> <CLI tarball>` | 0 | Local `node_modules/.bin/effx` resolves to the packed CLI. |
| `bun add -d typescript@7.0.2` | 0 | Target TypeScript installed. |
| `bunx effx --version` | 0 | `0.1.0`. |
| `bunx tsc --noEmit -p tsconfig.runtime.json` | 0 | The packed runtime declarations typecheck against rc.116. |
| `bunx effx build --project tsconfig.json` | 0 | Emits `http.ts`, `client.ts`, `cli.ts`, `rpc.ts`. Warnings: TypeScript 6.0.3 vs target 7.0.2, no inferred errors, and no `Http.Access` on this small fixture. No errors. |
| `bunx tsc --noEmit -p tsconfig.json` | **2** | Generated HTTP/client imports fail under rc.116. The package proof passes; generated target compatibility does not. |

This last failure is **not** a passing generated-code gate. There are seven diagnostics. Four `TS2307` sites concern `effect/http` and `effect/http-api`. One `TS5097` concerns the generated `client.ts` import of `./http.ts`. Two `TS7031` implicit-any errors affect handler `{ params, payload }` after the missing HTTP types. The target mono-web `tsconfig.json` does not enable `allowImportingTsExtensions` (`mono-web/tsconfig.json:1-29`). A separate typecheck with that option enabled still failed at the four package imports and two downstream implicit-any sites. Do not fix these by hand-editing generated files.

## Import map for the generator engineer

| Current effx 4.0.0 source/generated import | Target rc.116 import or finding | Evidence |
| --- | --- | --- |
| `effect/http` | `effect/unstable/http` | both installed `effect/package.json` export maps; generated `http.ts:6`, `client.ts:6` |
| `effect/http-api` | `effect/unstable/httpapi` (**no hyphen** in `httpapi`) | rc.116 `src/unstable/httpapi/index.ts`; generated `http.ts:7`, `client.ts:7` |
| `effect/rpc` | `effect/unstable/rpc` | both installed export maps; effx `packages/compiler/src/generate/rpc.ts` |
| `effect/cli` | `effect/unstable/cli` | both installed export maps; effx `packages/compiler/src/generate/cli.ts` |
| `effect/sql` | `effect/unstable/sql` | both installed export maps; Profile SQL extension remains parked |
| root `Arbitrary` from `effect` | `effect/unstable/arbitrary` | rc.116 `src/index.ts` lacks root Arbitrary; `src/unstable/arbitrary/index.ts` exports it. CLI bundles its own stable Effect. |
| root `Graph`, `Trie` from `effect` | **present unchanged** | rc.116 `src/index.ts`, `Graph.ts` and `Trie.ts`; do not list them as missing APIs. |
| generated relative `./http.ts` | target TypeScript requires `.js` or explicit `allowImportingTsExtensions` | generated `client.ts:9`; mono-web `tsconfig.json:1-29` |

The import map is necessary but not sufficient for Gate 3. Target `HttpApiBuilder.handleRaw`, patched `HttpApiEndpoint.ClientRequest`, response headers, access guards and problem unions still require generated-code typechecks and the real Profile journey (spec 0009). This task does not change generators.
