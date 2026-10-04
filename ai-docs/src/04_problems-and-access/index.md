## Problems and access

Two annotations describe the failure and authority surface of an HTTP
operation. Both are **declarations stored in the IR**. effx does not
authorize a request, resolve a credential or translate a domain error to a
response body at runtime; the application supplies those (specs
`docs/specs/0005-http-contract-extension.md`,
`docs/specs/0006-access-contract-extension.md`).

### `Http.Problems`

`@Http.Problems(opts)` / `.http.problems(opts)`; type `HttpProblemsOptions`
in `packages/runtime/src/Annotation.ts`.

| Field        | Meaning                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `codes`      | nonempty, unique problem codes; the **single source** of the endpoint's code list                      |
| `registry`   | exported `(identifier, codes) => ReadonlyArray<Schema.Top>`; optional when a group default supplies it |
| `identifier` | optional schema name; default `Registry("<endpointKey>Problem", codes)`                                |
| `map`        | optional `{ DomainErrorTag: code }`; every value must appear in `codes`                                |

The generated endpoint calls your registry for its `error` union. The registry
owns status, body shape and headers; effx keeps no code table. The handler
stays an ordinary Effect, and its domain-error to problem conversion is
application code.

| Code       | Condition                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `EFFX2205` | an operation error has no `map` entry and no HTTP status annotation, or a `map` key is not an operation error |
| `EFFX2206` | a `map` value is not in `codes`                                                                               |
| `EFFX2402` | duplicate `Http.Problems`, non-unique `codes`, unsafe `identifier`, or no HTTP exposure                       |

### `Http.Access`

`@Http.Access(opts)` / `.http.access(opts)`; type `HttpAccessOptions`.

| Field                        | Shape                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `annotator`                  | exported `(spec) => Context`; merged onto the endpoint after middleware (group default allowed)   |
| `exposure`                   | `"External"` or `"Internal"`                                                                      |
| `acceptedCredentials`        | nonempty names (`None`, `BetterAuthCookie`, ... application-owned strings)                        |
| `principalKinds`             | nonempty names (`Anonymous`, `Person`, ...)                                                       |
| `capabilities`               | `Capability.one(c)`, `.any(a, ...)`, `.all(a, ...)` or `.none`                                    |
| `requirements`               | `{ id, parameters? }[]` with JSON-only parameters                                                 |
| `canonicalScopeResolver`     | exported symbol; the annotator maps it to the app's resolver id                                   |
| `concealment`                | `Concealment.reveal` or `Concealment.notFound(stage, ...)`                                        |
| `decisionTime`               | optional: `"SnapshotRead"` for a `Query`, `"Transaction"` for a `Command`; an explicit value wins |
| `snapshotDecisionForCommand` | optional `true`; compiler-only claim for a capability-only Command (ADR 0013)                     |

**Decision time defaults from the operation kind** (spec 0024 §4). Leave it out and
the pre-pass writes `SnapshotRead` for a `Query` and `Transaction` for a `Command`
before interpretation, so the IR, hash and generated files equal the spelled-out
declaration. Builder, decorator and group-level access behave alike; a group's
`defaults.access` has no `decisionTime` (it is per operation by nature). Write the
value only to override the default, e.g. a read that decides inside a transaction.
`EFFX2501` and `EFFX2502` check the resolved value, so a default never trips them.

`Capability.make(name, { resource, focus? })` is a different thing: it builds a
**model** capability for `@Authorize` / `.authorize(...)`. The access
constructors above build the capability **expression** stored in `Http.Access`.
Literal tagged objects such as `{ _tag: "One", capability: "x" }` also lower to
the same arguments.

### The guard boundary

For each protected operation the generated code requires an application guard
and passes your handler a **lazy nullary thunk** as its second argument:

```
 handler(input, authorize)   authorize: () => Effect<Principal, Problem, R>
                              │
                              └─ nothing runs until the handler calls it, inside
                                 its own read snapshot or committing transaction
```

A missing or non-Effect `authorize` fails TypeScript on the generated file. A
typed binding does not prove the handler calls it at the right time; that
needs a real end-to-end run.

### Analyses

| Code       | Condition                                                                                             | Severity                              |
| ---------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `EFFX2501` | a `Command` declares `SnapshotRead` without an accepted `snapshotDecisionForCommand` claim            | error                                 |
| `EFFX2502` | a `Query` declares `Transaction`                                                                      | warning                               |
| `EFFX2503` | a credential other than sole `None` is accepted but `Http.Contract.middleware` has no security marker | error                                 |
| `EFFX2504` | an HTTP operation has no `Http.Access`                                                                | warning; error with `--strict-access` |
| `EFFX2500` | duplicate `Http.Access`                                                                               | error                                 |
| `EFFX2506` | `snapshotDecisionForCommand: true` is declared outside the one allowed shape (see below)              | error                                 |
| `EFFX2414` | `decisionTime` omitted on a declaration with no single `Query` or `Command` to default it from        | error                                 |

A **security marker** is an `HttpApiMiddleware.Service` class that carries
Effect's `security` option. Any other middleware does not satisfy `EFFX2503`.

`snapshotDecisionForCommand: true` (ADR 0013) lifts `EFFX2501` for a `Command` only when it also declares
`SnapshotRead`, empty `requirements`, `acceptedCredentials: ["ObjectCapability"]` and
`principalKinds: ["CapabilityHolder"]`. Any other use, including on a `Query` or beside `Transaction`, is
`EFFX2506`. The claim is compiler-only: the annotator never receives it, and `false` is the same as absent.
It asserts a declared shape, not that the resolver only routes or that your guard compares the token
correctly; the application middleware and guard own that.

Read-only queries over POST: `@Http.Contract({ payloadIsQuery: true, payload })`
on a `Query` with `@Http.Post` (ADR 0010); it is rejected unless the operation
is a Query, the method is POST and a payload exists.

### Status

Both are implemented (`STATE.md`: "HTTP contract extension", "AccessContract
and Query POST" rows). Authority evaluation (Cedar, leases, ADR 0007) is
deferred and is not part of effx today.
