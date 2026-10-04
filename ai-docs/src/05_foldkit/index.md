## Foldkit commands

`@Foldkit.Command({ success, failure })` (builder: `.foldkit.command({ success, failure })`)
opts one HTTP operation into a generated Foldkit `Command`. Spec:
`docs/specs/0007-client-and-foldkit.md`; extension:
`packages/compiler/src/extensions/foldkit.ts`, generator:
`packages/compiler/src/generate/foldkit.ts`.

```
 @Foldkit.Command({ success: Saved, failure: SaveFailed })
        │  contribution to the IR: Extension { extension: "foldkit", tag: "UiCommand" }
        ▼                          + ExtensionOf edge to the operation
 effx build (--emit=all)  ──►  foldkit.ts   (imports foldkit; only for opted-in operations)
```

Both arguments are **exported Message Schema values** (`FoldkitCommandOptions`
in `packages/runtime/src/Annotation.ts`). The frontend records references and
never imports or runs your app.

### What is generated

For each opted-in operation the generator emits a Foldkit `Command.define`
whose `execute` calls the generated typed client operation **once**, maps the
success and catches the typed expected failure into a Message. It never runs
at construction, never retries, never turns a defect or interruption into a
Message. The Foldkit runtime owns execution and cancellation.

You supply message adapters when you build the commands. The generated
`<Group>CommandsFor(client, adapters)` takes, per operation:

| Adapter   | Receives                 | Returns                       |
| --------- | ------------------------ | ----------------------------- |
| `success` | `{ requestId, result }`  | the annotated success Message |
| `failure` | `{ requestId, failure }` | either annotated Message      |

The Message field shape stays yours, so the app can map a typed problem (such
as an expired replay) to a success Message. The Model, `update`, `view`,
request-id freshness checks, validation, wording and routing stay hand-written.

### Constraints (diagnostics)

| Code       | Condition                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `EFFX2601` | duplicate `Foldkit.Command`, invalid UiCommand data, no or several HTTP exposures, or an internal HTTP root |
| `EFFX1107` | declared (external) operation carries `Foldkit.Command`                                                     |

Also from the generator source: `foldkit.ts` is produced only for emit mode
`all`, and only for local operations on an external root.

### Command identity

`Http.Contract.metadata.commandIdentity` names an exported application
function. It is legal for a `Command` whose `headers` schema has both
`idempotency-key` and `if-match`. The client generator emits a typed
`commandIdentity(input)` helper that calls it and returns
`{ key, input, precondition }`. effx mints no keys, keeps no hidden state and
never decides when a lost answer was already applied; that policy is the
application's (spec 0007, "Stable command identity").

### Status

Implemented for Gate 2A (`STATE.md`: "Client/Foldkit projection", DoD met
locally against a fixture with real Foldkit types). Application-level
acceptance is tracked separately in `STATE.md`.
`@effx/compiler` and `@effx/runtime` have no Foldkit dependency: only the
generated file imports Foldkit.
