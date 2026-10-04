# Spec 0003 — CLI and vertical slice (`@effx/cli`, `examples/users`)

Status: **frozen** 2026-10-03. Changes require editing this file explicitly.
Depends on: spec 0001 (pipeline, diagnostics, generators), spec 0002 (`TsSourceFrontend`, module specifiers), ADR 0003 (manifest holds locations), ADR 0008 (generated code is ordinary Effect).
Source: `docs/research/2026-10-02-deep-research-report.md` §"Minimal vertical slice", §"CLI and inspector", §"MVP exit criteria".

## Goal

A developer runs `effx build` on a real project and gets a canonical `ir.json`, a manifest, and
generated `http.ts`/`rpc.ts`/`cli.ts`/`client.ts` that a Bun process serves and a generated client
calls — proving "declare once → four projections" end to end, with less hand-written code than
the four projections would cost.

Non-goals: watch mode (`effx dev`), Cedar/leases (`effx auth check`), SQL persistence (the
example's `Users` layer is in-memory), Foldkit adapter, `handlers.ts`/`auth.ts` outputs.

## Journey

```
examples/users/src/{user,schemas,services,operations}.ts
        │ bun ../../packages/cli/src/main.ts build        (effx build)
        ▼
examples/users/.effx/{ir.json, manifest.json, generated/{http,rpc,cli,client}.ts}
        │                                   │
        │ src/server-main.ts                │ src/client-main.ts / src/cli-main.ts
        ▼                                   ▼
BunHttpServer: HttpApi at /, RPC at /rpc ◀── generated client calls User.Get + User.ChangeEmail
```

## `@effx/cli`

### Composition root

`packages/cli/src/main.ts` is the only file that imports `@effect/platform-bun`:
`BunServices.layer` + `TsSourceFrontend.layer` + `BunRuntime.runMain`. Everything else in the
package is portable over `FileSystem`, `Path`, `Crypto`, `SourceFrontend` and the `Console`
reference. `effect/cli` is unstable: one `@effect-diagnostics unstableApiUsage:off` directive at
the package composition root, documented there (AGENTS.md "unstable APIs stay behind adapters").

### Commands

| Command                             | Behaviour                                                                                                                                                             | Exit                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `effx check [--project <tsconfig>]` | collect → interpret → analyze; print diagnostics (format below); print `N error(s), M warning(s), K info`                                                             | 1 if any `error`, else 0 |
| `effx build [--project]`            | `check`, then write `.effx/ir.json` (canonical text, trailing newline), `.effx/manifest.json`, `.effx/generated/*.ts`. On errors nothing is written and the exit is 1 | as `check`               |
| `effx inspect <name> [--project]`   | tree for one operation (format below). Unknown name → `error: no operation named <name>` on stdout, exit 1                                                            | 0 / 1                    |
| `effx graph [name] [--project]`     | mermaid `flowchart LR` of the whole IR, or of `name` plus everything reachable from it (edge direction). Unknown name → exit 1                                        | 0 / 1                    |

`--project` defaults to `tsconfig.json` resolved against the working directory. `.effx/` is
`<dirname(tsconfig)>/.effx`, which is also the frontend's default `outDir`, so generated module
specifiers stay valid.

Name resolution (`inspect`, `graph`): a full `StableId` is used verbatim; otherwise
`operation:<name>` wins, then the unique node whose `StableId.nameOf(id) == name`.

### Diagnostic output

Grouped by `location.file` (relative to the working directory when inside it), locationless
diagnostics last under `(no location)`. Each line:

```
EFFX2201 error    handler can fail with …  src/operations.ts:31:3
```

`code severity<pad 8> message  file:line:col` — the file suffix is omitted when there is no
location. Groups are sorted by file name; within a group by `(line, col, code)`.

### `inspect` format (research report §"CLI and inspector", exact)

```
Operation User.ChangeEmail

Kind
  Command

Contract
  ChangeEmailInput → User.Self

Errors
  EmailTaken
  UserNotFound

Requirements
  Users

Authority
  User.ChangeEmail
  resource: User
  focus: User.email

Exposed
  PATCH /users/:id/email
  RPC User.ChangeEmail
  CLI users change-email
```

Schema display name = last `/` segment of `StableId.nameOf(symbolId)` (`src/user/User.Self` →
`User.Self`). Empty sections print `  (none)`. `Errors`/`Requirements` are suffixed with
` (inferred)` on the heading when `inferred: true`. Exposures are listed in StableId order.

### `graph` format

```mermaid
flowchart LR
  operation_User_Get["operation:User.Get"]
  …
  operation_User_Get -->|ExposedAs http| exposure_http_User_Get
```

Mermaid node id = StableId with every non-`[A-Za-z0-9_]` character replaced by `_`; label = the
StableId; edge label = `kind` plus ` qualifier` when present. Nodes and edges in normalized order.
For `graph <name>`, include directed forward reachability **and one hop of incoming edges to the named node**, with their existing source nodes; do not recursively traverse predecessors. This includes the operation's `InputOf`, `SuccessOf`, and `ErrorOf` sources without pulling in unrelated operations.

### Manifest (`.effx/manifest.json`, pretty JSON, Schema-defined)

```ts
Manifest = {
  format: "effx-manifest", version: 1,
  compiler: { effx: string, effect: string, typescript: string },   // package versions; typescript = frontend ts.version
  semanticHash: string,                                              // sha-256 of ir.json content
  generated: string[],                                               // paths relative to .effx/, sorted
  diagnostics: Diagnostic[],                                         // all, in stage order
  locations: Record<StableId, { file, line, col }>,                  // operation/model ids → declaration start; file relative to dirname(tsconfig)
}
```

To populate `locations`, `Declaration` (spec 0001) gains `location?: Location` which the TS
frontend fills with the start of the decorated method / class / builder declarator. This is the
only location the IR pipeline carries and it never enters the IR (ADR 0002/0003).

### Laws / tests (`packages/cli/test/cli.test.ts`, CLI run as a child process against `packages/frontend-ts/test/fixtures/users`)

| Law                    | Test                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| check passes           | `check --project <fixture>` exits 0, prints `EFFX0001 info` and `0 error(s)`                                   |
| check fails            | `check` with `src/broken.ts` entry (via a temp tsconfig) exits 1 and prints `EFFX2201 error`                   |
| build is deterministic | two `build`s → `ir.json` byte-identical; manifest lists the four generated files; files exist                  |
| inspect                | `inspect User.Get` prints `Kind`/`  Query`/`GET /users/:id`/`RPC User.Get`/`CLI users get`                     |
| graph                  | `graph` starts with `flowchart LR` and contains an `ExposedAs` edge; `graph User.Get` omits `User.ChangeEmail` |

## `examples/users`

| File                  | Content                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/schemas.ts`      | `UserId`, `Email`, `GetUserInput`, `ChangeEmailInput`, `UserPublic`, `UserSelf`, errors `UserNotFound`, `EmailTaken`                                                |
| `src/user.ts`         | `@PersistentModel({ table: "users", views: { Public, Self }, focus: { email: ["email"] } }) class User` with `static Public/Self`                                   |
| `src/services.ts`     | `Users` `Context.Service` (`find`, `setEmail`) + `Users.layer` (in-memory `Ref<HashMap>` seeded with two users)                                                     |
| `src/capabilities.ts` | `Read`, `ChangeEmail` via `Capability.make` / `Focus.key(User, "email")`                                                                                            |
| `src/operations.ts`   | `UserOperations.get` (`@Query` + `Http.Get` + `Rpc` + `Cli` + `Authorize`), `changeEmail` (`@Command` + `Http.Patch` + … + `@Errors` + `@Requirements`)             |
| `src/server.ts`       | portable `AppRoutes` layer: `HttpApiBuilder.layer(Api)` + `RpcServer.layerHttp({ group: Operations, path: "/rpc", protocol: "http" })`, provided with `Users.layer` |
| `src/server-main.ts`  | composition root: `HttpRouter.serve(AppRoutes)` + `BunHttpServer.layer({ port })` + `BunRuntime.runMain`                                                            |
| `src/client-main.ts`  | composition root: generated `client.ts` calls `User.Get` then `User.ChangeEmail` against `EFFX_URL` (default `http://localhost:3000`), `Effect.log`s results        |
| `src/cli-main.ts`     | composition root: generated `cli.ts` `root` run with `Users.layer` + `BunServices.layer`                                                                            |

Scripts: `effx:build`, `serve`, `client`, `cli`. Generated files live in `.effx/generated/`
(gitignored); `bun run effx:build` must precede typecheck and tests.

### Generated CLI contract (revision of spec 0001's `cli` generator)

A leaf command's handler runs the operation and prints its success encoded with the
operation's success schema as one JSON line (`Schema.fromJsonString(Success)` + `Console.log`).
A CLI that discards results is not a projection of the operation.

### e2e test (`examples/users/test/e2e.test.ts`)

1. run `effx build` as a child process (exit 0, `.effx/generated/client.ts` exists);
2. start `AppRoutes` in-process on `BunHttpServer.layerTest` (ephemeral port, test `HttpClient`);
3. through the generated `client.ts`: `User.Get` returns the seeded public view; `User.ChangeEmail`
   returns the self view with the new email; a second `User.Get`… is public-only, so the change is
   verified by `User.ChangeEmail` again returning the persisted value, and by `Users.find` directly;
4. the RPC path: `RpcClient.make(Operations)` over `RpcClient.layerProtocolHttp({ url: "/rpc" })`
   calls `User.Get` and gets the same result; `EmailTaken` is observed as a typed failure.

## Release-gate evidence (recorded in STATE.md)

Lines of hand-written `operations.ts` + `schemas.ts` + `user.ts` versus generated
`http.ts` + `rpc.ts` + `cli.ts` + `client.ts`, counted with `wc -l`, with the claim
"declare once → less code than four hand-written projections".

## Definition of done

- `bun --bun node_modules/.bin/tsc --noEmit -p tsconfig.json`, `bun run lint`, `bun run fmt:check`, `bun --bun vitest run` green (after `effx:build`).
- All laws above are tests; the e2e test exercises HTTP and RPC against a live Bun server.
