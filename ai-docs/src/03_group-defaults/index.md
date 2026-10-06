## Group defaults

Operations in one HTTP group usually repeat the same middleware, problem
registry, OpenAPI annotator and access policy. Declare those once on the group.
Spec: `docs/specs/0013-group-defaults.md`; implementation:
`packages/compiler/src/group-defaults.ts`, `extensions/http-group.ts`.

```
 Http.group({ root, group, defaults })      @Http.Group({ root, group, defaults })
        ▲                                          ▲   (decorates the class)
        │ .in(group)                               │ static methods inherit
 Operation.query/command(...)               @Query/@Command(...) static method
```

**Defaults are source syntax.** Before interpretation the compiler expands them
into each operation's ordinary annotations. They are not a new IR node, are not
serialized (`defaults` never reaches the IR), and no application function is
called while compiling. A dense and a fully spelled-out declaration with the
same expanded fields have the same canonical IR, semantic hash and generated files.
Dropping an explicit success status is a separate transformation (see below).

### Options

| Option                                                                                    | Meaning                                                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `root`                                                                                    | string (local roots) or an exported concrete `HttpApi` value (required for external groups)       |
| `group`                                                                                   | group identifier                                                                                  |
| `title`, `description`, `displayName`                                                     | group OpenAPI metadata                                                                            |
| `defaults.middleware`                                                                     | security/middleware marker classes                                                                |
| `defaults.metadata.annotator`                                                             | exported function `(metadata) => Context` merged onto each endpoint                               |
| `defaults.problems.registry`                                                              | exported `ProblemRegistry`; fills an existing `Http.Problems` that omits `registry`               |
| `defaults.access.{annotator, exposure, acceptedCredentials, principalKinds, concealment}` | fills an existing `Http.Access`; never invents capabilities, requirements, scope or decision time |

Source: `packages/runtime/src/Annotation.ts` (`HttpGroupOptions`).

### Merge and inference rules

- Merging is **per field**. An explicit operation field wins over the same
  group field, even an empty array (`middleware: []`).
- `.in(group)` / the class decorator supplies `root` and `group` to the
  operation's `Http.Contract`. `Http.Contract` is still written on every HTTP
  operation (otherwise `EFFX2405`).
- Defaults fill an annotation that exists. They never create `Http.Problems`
  (it needs its own `codes`) or `Http.Access` (it needs its own capabilities).
- Operation id: when `metadata.operationId` is absent and the operation `name`
  is exactly `<group>.<safe key>`, that name is the operation id. An explicit
  id wins.
- `Http.Contract.success` defaults to the declared `success`.
  `query: true` on a GET `Query` means the declared `input`. The other request
  channels come from `input` too (next section). Incompatible use of
  `query: true` is a diagnostic, never a guessed route shape.
- A group never mixes local and external operations (`EFFX2403`).

### Success status: write only an override

Leave `status` out for an unannotated or 200 success schema. Native Effect uses
200 in both cases. Keep an explicit `status: 201` for a created response, and
keep `status: 200` when overriding a success schema annotated with another status.
Omission inherits that schema annotation; it does not force 200. Spec:
`docs/specs/0024-declaration-density.md` §3; implementation:
`packages/compiler/src/generate/http.ts` (`contractSuccess`).

Absent status and explicit 200 remain different `HttpContractData.status` values:
removing the field changes canonical IR and semantic hash, only at that field.
For schemas whose effective status is already 200, complete OpenAPI documents and
SDK operation projections stay equal; contract source differs only by the status
expression and its required imports. Bare explicit 200 uses S5's conditional
expression to avoid cloning a 200 schema. Header-bearing responses apply the
override to the `WithHeaders` envelope, not its body schema.

The rc.116 fixtures distinguish two witnesses. `profile.effx.ts` and
`directory-dense.effx.ts` retain explicit 200 to prove exact canonical IR, hash
and generated-byte identity with their verbose twins and tracked goldens.
`profile-consumer.effx.ts` and `directory-consumer.effx.ts` are the actual
post-0024 item-2 consumer spellings: unnecessary 200 fields are absent, while
Directory's override of its 201-annotated patch result stays explicit.
Content's action fixture likewise keeps its original explicit-status witness;
`content-consumer.effx.ts` is its omitted-status consumer twin.
`packages/frontend-ts/test/dense-status.test.ts` compares those independent
spellings without rewriting the identity witnesses or their goldens.
Both runtime runners use the shared `dense-status-reflection.ts`
fixture helper, which reports its installed Effect version and resolved HttpApi
module origin. The tests check rc.116 resolution rather than accepting a stable
Effect fallback; OpenAPI and operation indexes are compared without normalization.

### Request channels derived from `input`

Dense or not, an operation's `input` implies which `Http.Contract` channel it
fills. Before interpretation the compiler writes that channel into the contract
arguments (group or no group), so the result equals the spelled-out contract:
same IR, `paramsKeys`/`headersKeys`, hash and generated files. Spec:
`docs/specs/0024-declaration-density.md` §2; implementation:
`packages/compiler/src/request-channels.ts`.

| Step | The input …                                                               | Becomes                                                    |
| ---- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 0    | already is the Schema of an explicit channel                              | nothing derived (`input: X` with `headers: X` stays valid) |
| 1    | is wrapped by `Http.headers(schema)`                                      | `headers` (`EFFX2410` if `headers` is another Schema)      |
| 2    | has no path parameters                                                    | GET/DELETE `query`; POST/PUT/PATCH `payload`               |
| 3    | has exactly the route's path parameters as keys                           | `params`                                                   |
| 4    | has keys, none of them a path parameter                                   | as step 2 (the explicit `params` stay)                     |
| 5    | mixes path parameters and other keys                                      | `EFFX2410`: write `params` and the body channel            |
| 6    | has unknown keys (union, brand, `Void`) and the route has path parameters | POST/PUT/PATCH `payload`; GET/DELETE `EFFX2411`            |

- An explicit channel always wins: a derived channel never replaces one, and an
  ambiguity (5, 6) is a diagnostic only while nothing resolves it (`payload` or
  `query` written for step 5; `params` or `query` for step 6).
- A path parameter name ends before an action suffix: `/items/:id:cancel` has
  one parameter, `id`, when `id` is an input key.
- A GET/DELETE input without keys derives no `query`; a body is still a body.
  A Query over POST keeps its explicit `payload` (ADR 0010).
- `Http.headers` is the identity function at runtime. The compiler recognises
  the wrapper by the brand on the Schema's static type, never by its name or by
  header-looking keys. A marked Schema needs static keys; they are its required
  keys, exactly what `headers:` records.

### Diagnostics

| Code       | Condition                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `EFFX2404` | group reference is unresolved, not exported, not a group, repeated or multiple                                          |
| `EFFX2405` | explicit `root`/`group` conflicts with the group; bad `query: true`; missing `Http.Contract`                            |
| `EFFX2406` | two distinct raw group ids normalize to the same generated export name in one root                                      |
| `EFFX2410` | `input` mixes path parameters and other keys, or is a header schema next to a different `headers`                       |
| `EFFX2411` | GET/DELETE with path parameters and an `input` whose keys are not static, while neither `params` nor `query` is written |

An operation with both a class-level `@Http.Group` and `.in(...)` fails with
`EFFX2404`. The reference must resolve statically to one exported group in the
same project; no runtime import happens.

### Status

Implemented (`STATE.md`: Schools, SocialEvents and Profile rows consume it;
spec 0013 is the contract). Group export names derive PascalCase parts at
`-`, `_` and `.` (`social-events` produces `SocialEventsApi`).
