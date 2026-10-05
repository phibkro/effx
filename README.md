# effx

effx is an ahead-of-time compiler for Effect v4 applications: it collects decorator or builder declarations into a schema-defined intermediate representation (IR), analyzes their graph, and emits ordinary Effect code. It treats source annotations as compile-time contracts—not runtime behavior—and supports compiler extensions for application-specific semantics. This repository includes the source-syntax runtime, a TypeScript frontend, the compiler and CLI, and a worked users example.

## Source syntax

The decorator form below is the 15-line `User.Get` operation from [`examples/users/src/operations.ts`](examples/users/src/operations.ts), with its imports omitted:

```ts
export class UserOperations {
  @Query({ name: "User.Get", input: GetUserInput, success: User.Public })
  @Http.Get("/users/:id")
  @Rpc("User.Get")
  @Cli("users get")
  @Authorize(Read)
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    });
  }
}
```

The builder declaration below keeps the same operation name, schemas, transports, authorization, and handler as the decorator example. Its chain follows the [users builder fixture](packages/frontend-ts/test/fixtures/users/src/operations.builder.ts); the checked-in users example currently contains the decorator form.

```ts
export const getUser = Operation.query({
  name: "User.Get",
  input: GetUserInput,
  success: User.Public,
})
  .http.get("/users/:id")
  .rpc("User.Get")
  .cli("users get")
  .authorize(Read)
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    }),
  );
```

Both source forms are collected into the same annotations and semantic IR. The decorators and builder are declaration syntax; they do not implement the generated HTTP, RPC, or CLI behavior.

## Quick start

Run from a clean checkout of this workspace:

```sh
bun install
bun run --cwd examples/users effx:build
bun run --cwd examples/users serve
```

In another terminal, run the example client:

```sh
bun run --cwd examples/users client
```

The users example build emits two expected `EFFX2504` warnings because its HTTP endpoints intentionally have no `@Http.Access` declarations; see [spec 0006](docs/specs/0006-access-contract-extension.md).

## CLI commands

Run commands from the repository root. `check` analyzes without writing; `build` writes the selected projections.

| Command   | Invocation                      | Purpose                                                                   |
| --------- | ------------------------------- | ------------------------------------------------------------------------- |
| `check`   | `bun run effx check`            | Analyze the project and report diagnostics.                               |
| `build`   | `bun run effx build`            | Compile and emit generated projections.                                   |
| `inspect` | `bun run effx inspect User.Get` | Show an operation's contract and exposures.                               |
| `graph`   | `bun run effx graph`            | Print the IR as a Mermaid graph; an optional node name narrows the graph. |
| `explain` | `bun run effx explain EFFX2504` | Explain a diagnostic code offline with examples and repair guidance.      |

Core lookup needs no project or config. For a package-qualified extension code, opt in with
`effx explain 'EFFX[@owner/package]/0001' --config effx.config.ts`. Explain never compiles
the project or writes output. The docs catalogue and installed AI guides derive from the same registry
([spec 0016](docs/specs/0016-diagnostic-registry.md)).

### Watch checks and editor diagnostics

```sh
bun run effx dev --project examples/users/tsconfig.json
bun run effx dev --project examples/users/tsconfig.json --build
bun run effx lsp --project examples/users/tsconfig.json
```

`dev` checks saved sources and dependencies until you stop it. Only `--build` enables normal build writes; output config does not.
`lsp` uses stdio for one project and checks unsaved source buffers without compiler writes.
If a saved executable config exists, launch LSP with explicit `--config <path>` or `--trust-config`.
Editor messages cannot grant trust. Trusted config imports run with process privileges; LSP is not a sandbox.

Both commands accept repeatable `--exec-file` and `--exec-dir` inputs.
The caller must declare **all** otherwise-unobservable executable routes, including static bare-package symlinks, exports, `#imports`, and external aliases.
Omitted routes can change without detection. Covered executable changes require a fresh process, not hot reload.
See [dev and executable coverage](apps/docs/content/docs/cli/dev.mdx) and [LSP](apps/docs/content/docs/cli/lsp.mdx) for limits and shutdown.
Source: [spec 0018, amendment A](docs/specs/0018-watch-editor.md), `packages/cli/src/config.ts`, `documents.ts`, `project-session.ts`, and `watch-files.ts`.

## Packages

| Package                                     | Status  | Role                                                                                               |
| ------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| [`@effx/diagnostics`](packages/diagnostics) | Public  | Effect-only diagnostic entry schemas, typed factories, registry validation and Markdown rendering. |
| [`@effx/ir`](packages/ir)                   | Public  | Effect Schema IR, stable IDs, normalization, canonical JSON and graph indexing.                    |
| [`@effx/compiler`](packages/compiler)       | Public  | Diagnostics, extension contracts, analyses, generators, and the compiler pipeline.                 |
| [`@effx/frontend-ts`](packages/frontend-ts) | Private | TypeScript 6 compiler-API frontend; bundled into the CLI distribution.                             |
| [`@effx/runtime`](packages/runtime)         | Public  | Standards-compatible decorators and builder API used only as source syntax.                        |
| [`@effx/cli`](packages/cli)                 | Public  | `effx` command-line compiler and `@effx/cli/config` extension configuration.                       |
| `examples/users`                            | Private | A worked application example.                                                                      |

Project specifications and decisions live in [`docs/`](docs/). The planned documentation site source is [`apps/docs`](apps/docs).

## Supported versions

**Effect ≥ 4.0.0 < 5; TypeScript analysis via TS 6.0 (TS 7 JS API pending 7.1, see [ADR 0009](docs/decisions/0009-ts6-frontend-is-a-registered-exception.md)); Bun ≥ 1.3.** Effect `4.0.0-rc.116` is accepted as a temporary compatibility target for the vektorprogrammet migration; the supported Effect release line starts at `4.0.0`.
