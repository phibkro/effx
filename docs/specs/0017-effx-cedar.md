# Spec 0017 — `effx cedar`: Cedar schema and policy projection, validated by real Cedar

Status: **approved 2026-10-04; implemented, DoD met locally and not yet landed** (decisions in §7, implementation notes in §8). Builds on
[spec 0006](0006-access-contract-extension.md), [spec 0015](0015-config-and-extensions.md) and
[spec 0021](0021-surface-manifest.md); realizes the "Cedar schema is generated from the IR; policy
validation becomes `EFFX41xx` diagnostics" half of
[ADR 0007](../decisions/0007-cedar-authorizes-effx-issues-leases.md). It does **not** lift the ADR's
deferral of runtime authorization and leases.

## 1. Outcome

```
IR (Capability, AuthorizedBy, Model, Extension{access-contract})
        │  pure projection, no source, no execution
        ▼
.effx/cedar/schema.cedarschema   entity types, capability groups, operation actions
.effx/cedar/policies.cedar       grant templates + requirement forbids
        │
        ▼  validated by the real Cedar validator (§4)
EFFX41xx diagnostics, exit 1 iff any error
```

`effx cedar` answers one question: **is the access contract the IR declares a well-formed Cedar
authorization model, and do the policies the application wrote against it validate?** It is a
static projection plus validation. Its output has no effect on `build`, the IR, or its hash.

Non-goals (ADR 0007, spec 0006): evaluating a request (`authorize`/`isAuthorized`), choosing a
principal, resolving a credential or a relationship fact, issuing a lease, running a policy
store, linking templates, or generating application grants. A Cedar `Allow` that this projection
could make possible is never consumed by effx code.

## 2. Output: field-by-field mapping

Inputs are IR facts only: `Capability{name, resource, focus?}`, `Focus{root, path}`, `Model{name}`,
`AuthorizedBy` edges, and `AccessContractData` of each `Extension{access-contract}` reached by its
`ExtensionOf` edge (`packages/ir/src/Node.ts`, `packages/compiler/src/extensions/access-contract.ts`).
The namespace is `Effx` by default and `--namespace` overrides it (§4). Output is sorted by id and carries the header
`// effx cedar projection of semanticHash <sha-256>` (the same link as `surface.json`).

### 2.1 Schema

| Cedar element                                                                                                            | Derived from                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| principal `entity` types                                                                                                 | the union of `principalKinds` (`Anonymous`, `Person`, `ServicePrincipal`, `CapabilityHolder`), emitted only if used; an operation with no `AccessContract` uses a generic `entity Principal` (EFFX4105)                           |
| resource `entity` types                                                                                                  | `Capability.resource` → `Model.name` (`User`); an `AccessContract` operation's `canonicalScopeResolver` → the resolver's **export name** (`ProfileCurrentPerson`)                                                                 |
| capability **action group**                                                                                              | one `action "capability/<name>"` per `Capability` node and per capability name in `capabilities`; no `appliesTo`; annotations `@capability`, `@focus` (focus path, joined with `.`) when `Capability.focus` is set                |
| operation **action**                                                                                                     | one `action "operation/<name>"` per operation that has a capability link; `appliesTo { principal, resource, context }`; `memberOf` (`in`) its capability groups per the table below                                               |
| `capabilities` `None`                                                                                                    | operation action with no group parent; no grant can match it (default deny is the projection's reading of "no capability", not a claim that the operation is open)                                                                |
| `capabilities` `One`                                                                                                     | `in ["capability/<c>"]`                                                                                                                                                                                                           |
| `capabilities` `Any`                                                                                                     | `in ["capability/<c1>", …]`; Cedar group membership is disjunctive, which is exactly `Any` (checked with `cedar authorize`, §6)                                                                                                   |
| `capabilities` `All`                                                                                                     | **not mappable** (§2.3); operation action has no group parent; EFFX4104                                                                                                                                                           |
| `principalKinds`                                                                                                         | `appliesTo.principal`                                                                                                                                                                                                             |
| `requirements[].id`                                                                                                      | a required attribute `"<id>": Bool` in the operation action's `context` record; the application's interpreter asserts the fact per request (spec 0006)                                                                            |
| `AuthorizedBy` (no contract)                                                                                             | operation action `in ["capability/<c>"]`, `resource` = the capability's Model type, principal = `Principal`                                                                                                                       |
| `exposure`, `acceptedCredentials`, `canonicalScopeResolver`, `concealment`, `decisionTime`, `snapshotDecisionForCommand` | **annotations only** on the operation action (`@exposure`, `@acceptedCredentials`, `@canonicalScopeResolver` as `module#export`, `@concealment`, `@decisionTime`, `@snapshotDecisionForCommand`); Cedar assigns them no semantics |
| `annotator`                                                                                                              | omitted; an application function with no Cedar meaning                                                                                                                                                                            |

When one operation has both a `Capability` link and an `AccessContract`, `appliesTo.resource` is the
union of the Model type and the resolver's scope type.

### 2.2 Policies

Two kinds, both static text, both with a stable `@id`:

1. **Grant template**, one per capability: the _shape_ of a grant, left unlinked.

   ```text
   @id("effx:grant:profile.read-self")
   permit (principal == ?principal, action in Effx::Action::"capability/profile.read-self", resource == ?resource);
   ```

   Linking it to a principal and a resource is application data and runtime work (out of scope).

2. **Requirement forbid**, one per (operation, requirement id): default deny plus `forbid` overriding
   `permit` makes "this fact must hold" exact, whatever grants exist.

   ```text
   @id("effx:require:Profile.Read:profile.owner")
   forbid (principal, action == Effx::Action::"operation/Profile.Read", resource)
   unless { context["profile.owner"] };
   ```

### 2.3 What cannot be mapped (stated, never silent)

| Contract field / value                             | Why Cedar cannot hold it                                                                                                                                                                                         | Projection behavior                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `requirements[].parameters`                        | Cedar `context` attributes need one declared type; parameters are arbitrary JSON                                                                                                                                 | id-only requirement; **EFFX4103** warning per requirement; parameters stay with the application's interpreter            |
| `capabilities: All`                                | one Cedar request has one action; group membership is disjunctive                                                                                                                                                | **EFFX4104** warning; the application must issue one request per capability                                              |
| `decisionTime` `SnapshotRead` vs `Transaction`     | Cedar has no time or transaction notion. The contract's central property (decide inside the committing transaction, ADR 0013, spec 0004 §3) is a handler obligation, and a projection cannot express or check it | annotation only; the schema neither implies nor permits a pre-handler decision. This is exactly why leases stay deferred |
| `acceptedCredentials`, `exposure`, `concealment`   | evidence, transport and response shaping belong to the HTTP adapter (spec 0006)                                                                                                                                  | annotation only                                                                                                          |
| scope entity identity, parents, relationship facts | live in application data, not in the IR (the resolver is an opaque `SymbolRef`)                                                                                                                                  | entity type only; no entity data emitted                                                                                 |
| `Anonymous` principal                              | Cedar has no unauthenticated principal                                                                                                                                                                           | entity type `Anonymous`; the application models it as a singleton entity                                                 |

Completeness is enforced by construction (§6, F1): a `Record<keyof AccessContractData,
"mapped" | "annotated" | "omitted">` table in the projection fails typecheck when a field is added
to `AccessContractData` without a decision.

### 2.4 Validated sketches

Both were checked with `cedar validate` 4.13.0 (§3) on 2026-10-04 (pass), and a mutated context
attribute (`profile.ownr`) was rejected with exit 3 and
``attribute `["profile.ownr"]` in context for Effx::Action::"operation/Profile.Read" not found``.

`examples/users` (`@Authorize` only, no `AccessContract`):

```text
namespace Effx {
  entity Principal;
  entity User;

  @capability("User.Read")
  action "capability/User.Read";
  @capability("User.ChangeEmail") @focus("email")
  action "capability/User.ChangeEmail";

  @operation("User.Get") @kind("Query")
  action "operation/User.Get" in ["capability/User.Read"]
    appliesTo { principal: [Principal], resource: [User], context: {} };
  @operation("User.ChangeEmail") @kind("Command")
  action "operation/User.ChangeEmail" in ["capability/User.ChangeEmail"]
    appliesTo { principal: [Principal], resource: [User], context: {} };
}
```

Profile-like fixture (`Profile.Read` `SnapshotRead`, `Profile.Update` `Transaction`):

```text
namespace Effx {
  entity Person;
  entity ProfileCurrentPerson;

  @capability("profile.read-self")
  action "capability/profile.read-self";

  @operation("Profile.Read") @kind("Query")
  @exposure("External") @acceptedCredentials("BetterAuthCookie,OAuthUserBearer")
  @canonicalScopeResolver("profile/access#ProfileCurrentPerson")
  @concealment("Reveal") @decisionTime("SnapshotRead")
  action "operation/Profile.Read" in ["capability/profile.read-self"]
    appliesTo { principal: [Person], resource: [ProfileCurrentPerson], context: { "profile.owner": Bool } };
}
```

## 3. Validation: pinned real Cedar

Cedar is Amazon's `cedar-policy/cedar` (`https://github.com/cedar-policy/cedar`). Every row below was
read from the primary source on 2026-10-04.

| Artifact                               | Version  | License    | Primary source                                                                                                                                                                                                    |
| -------------------------------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cedar-policy-cli` crate / `cedar` CLI | `4.13.0` | Apache-2.0 | `https://crates.io/api/v1/crates/cedar-policy-cli` (published 2026-09-15, rust ≥ 1.89); GitHub release `cedar-policy-cli-v4.13.0`; `cedar language-version` → **Cedar language 4.5**                              |
| `@cedar-policy/cedar-wasm` (npm)       | `4.13.0` | Apache-2.0 | `https://registry.npmjs.org/@cedar-policy/cedar-wasm/latest`: `gitHead 324d3c09…`, npm trusted-publisher with SLSA provenance, no runtime dependencies, 13 MB unpacked                                            |
| nixpkgs `cedar`                        | `4.13.0` | Apache-2.0 | `nix eval nixpkgs#cedar.version`; `src` is the `v4.13.0` tag; `nix build nixpkgs#cedar` provides `bin/cedar` (verified here; this repository has no flake, so nixpkgs is the operator's registry, not a repo pin) |

**Decision (recommended): validate in-process with `@cedar-policy/cedar-wasm` 4.13.0, pinned exactly.**
It is the same crate and version as the nixpkgs CLI and runs under Bun with no PATH or Nix
dependency. Verified here under Bun 1.4.2: `import … from "@cedar-policy/cedar-wasm/nodejs"` and
`validate({ schema, policies: { staticPolicies, templates, templateLinks } })` return the same
verdicts as the CLI. Two findings that shape the adapter:

- The package root (`esm` entry) **fails to load under Bun 1.4.2** (`esm/cedar_wasm.js:6`); use the `/nodejs` subpath.
- `validate` returns `{ type: "success" }` **even when `validationErrors` is non-empty**; the CLI exits 3. The adapter treats a non-empty `validationErrors` as failure, and a test pins it (F2c). Warnings (e.g. "policy is impossible") are in `validationWarnings`.

Rejected: shelling out to `cedar`. AGENTS.md binds the unstable `effect/process` only in
`scripts/docs-api.ts`, so a CLI call needs a new registered exception and a PATH dependency. The CLI
remains the **cross-check oracle** in acceptance (F2d), not a runtime dependency. Rejected: a
hand-written Cedar validator (the whole point is the real toolchain).

Adapter shape: `packages/cli/src/cedar-validate.ts` is the single boundary. It exposes only
`validate` and `checkParse*` of the wasm module, loaded with a dynamic `import()` so `check` and
`build` never load 13 MB of wasm. Only strict validation mode exists in 4.13.0 wasm
(`ValidationMode = "strict"`). Wasm absent or failing to load is a `CompilerFault` naming the exact
`bun add @cedar-policy/cedar-wasm@4.13.0` fix, not a diagnostic.

## 4. Command

```
effx cedar [--project <tsconfig>] [--config <file>] [--out-dir <dir>] [--namespace <Name>]
           [--policies <file.cedar>]... [--deny-warnings]
```

- A **separate command**. `build` and `check` never call it, never write `.effx/cedar/`, never load the Cedar module.
- `--namespace <Name>` (default `Effx`) names the Cedar namespace of the emitted schema and of every policy reference (`<Name>::Action::"…"`). It is a Cedar path of unreserved identifiers joined by `::`; anything else is `EFFX4101` and nothing is written.
- `--out-dir` defaults to `<tsconfig dir>/.effx/cedar` (the layout in `docs/research/2026-10-02-deep-research-report.md`). Files: `schema.cedarschema`, `policies.cedar`, plus nothing else.
- Project resolution, config discovery and `ProjectConfig` use the single resolution of spec 0015; the config's discovery list gains `cedar`. Pipeline errors fail first, as `check`. `--strict-access` is **not** offered (spec 0006: only `check`/`build` claim the access gate).
- Always validates the emitted pair. `--policies` (repeatable) additionally validates application-authored policy files against the emitted schema. This is the editing-time feedback ADR 0007 names.
- Output through the existing `report` formatter. Exit 1 iff any error diagnostic; with `--deny-warnings`, also on any warning.
- **Not an `effx.config.ts` toggle** (recommended). The 0015 `generators` toggles switch off files that `build` writes; `cedar` is not in `build`, so a toggle would have nothing to disable and would imply an opt-in path into `build`. The command line is the only switch. If the operator wants a persistent default for `--policies`, that is a later, separate config field, not a generator flag.

## 5. Diagnostics

`EFFX41xx` is the range ADR 0007 reserves for Cedar policy validation. I checked every ref in the
repository on 2026-10-04: the only `EFFX41xx` text anywhere is `EFFX4102 Invalid authorization
mapping` in `docs/research/2026-10-02-deep-research-report.md`, no code emits it, and the 0016
registry has not landed. Used codes: 28xx (0021), 30xx–34xx (0019, 0020, 0022, 0024), 90xx/91xx.

| Code     | Severity | Meaning                                                                                                                                                                                      |
| -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EFFX4101 | error    | a name cannot be projected: not a valid unreserved Cedar identifier, or two distinct sources collide (resolver export names from different modules; a resolver export equal to a Model name) |
| EFFX4102 | error    | the Cedar validator rejected an application policy (`--policies`): carries the policy id, Cedar's message and its `help`                                                                     |
| EFFX4103 | warning  | requirement has `parameters`; projected id-only, parameters are not enforced by the Cedar model                                                                                              |
| EFFX4104 | warning  | `capabilities: All` is not expressible as one Cedar request; the operation action has no capability group parent                                                                             |
| EFFX4105 | info     | operation has `AuthorizedBy` but no `AccessContract`; principal type is the generic `Principal`                                                                                              |
| EFFX4106 | warning  | the Cedar validator warned about an application policy (e.g. impossible policy)                                                                                                              |
| EFFX4107 | info     | nothing to project: the IR has no capability and no `AccessContract`; no files written                                                                                                       |

A validator failure on **effx-emitted** text is an invariant break in the projection and is a
`CompilerFault` (invariant 11: faults are for invariant breakage), never a diagnostic. This is what
keeps `EFFX4102` about the user's policies.

## 6. Files and gates

New only: `packages/compiler/src/cedar.ts` (pure `cedarOf(ir) → { schema, policies, diagnostics }`,
in `@effx/compiler`), `packages/cli/src/{cedar,cedar-validate}.ts`, tests, one `main.ts` subcommand,
the exact-pinned optional peer dependency `@cedar-policy/cedar-wasm@4.13.0` in `@effx/cli`
(`peerDependenciesMeta.optional`, also a root devDependency for tests). No edit to any generator,
extension interpreter, IR schema or `build`.

### Falsifiers

- **F1 mapping.** Golden `schema.cedarschema` and `policies.cedar` bytes for `examples/users` and a Profile-like fixture (the `Profile.Read`/`Profile.Update` IR builders already in `packages/compiler/test/access-contract.test.ts`). Negative fixtures for each of `None`/`Any`/`All`, `Internal` exposure, parameterized requirement, a multi-principal operation, an `ObjectCapability` `CapabilityHolder` Contact declaration, a Capability with `focus`, and an `Anonymous` principal. The typed `Record<keyof AccessContractData, …>` table makes an unhandled new field a typecheck error.
- **F2 real validator.**
  (a) Both golden pairs pass the real validator.
  (b) Mutating one emitted policy (misspelled action id; context attribute absent from the schema) is **rejected by the real validator**, with Cedar's own message asserted, not an effx re-check.
  (c) `--policies bad.cedar` yields `EFFX4102` and exit 1; a wasm `type:"success"` with non-empty `validationErrors` still fails.
  (d) Acceptance cross-check: the same files and mutations give exit 0 / exit 3 under `nix shell nixpkgs#cedar -c cedar validate`. Run once on the exact commit and recorded in `STATE.md`; if `cedar` is unavailable it is reported as not run, never as passed.
- **F3 `build` and IR unchanged.** (a) `examples/users` and rc.116 generated bytes, `ir.json`, `surface.json` and `semanticHash` are byte-identical before and after the feature lands (existing hash tests). (b) sha-256 of every file in `.effx/` except `cedar/` is identical before and after `effx cedar`. (c) `build` and `check` create no `.effx/cedar/`. (d) a probe of the static import graph from `packages/cli/src/main.ts` shows no static `cedar-wasm` specifier, so `build` cannot load it.
- **F4 determinism.** Output bytes are identical across runs, emit modes and output directories; the header hash equals the IR's.
- **F5 scope.** The adapter exports `validate`/`checkParse*` only; a test fails if any module under `packages/` imports a Cedar request-evaluation entry point (`isAuthorized`, `authorize`) or a lease type.
- **F6 diagnostics.** One negative fixture per code, each asserting code and exit status.

Gates on a clean committed worktree after implementation: focused tests, `bun run check`,
`bun run effect:diagnostics`, `bun install --frozen-lockfile` on the merged tree. No publish, no
deploy, no runtime authorization.

## 7. Decisions (operator-approved 2026-10-04)

Resolved from the proposal's open questions; each is binding for the implementation.

1. **Validator.** `@cedar-policy/cedar-wasm` pinned exactly to `4.13.0`, loaded from the `/nodejs` subpath with a dynamic `import()`. The adapter checks `validationErrors` itself and never trusts `type: "success"`. The nixpkgs `cedar` CLI is the acceptance oracle only.
2. **Dependency.** An **optional peer dependency** of `@effx/cli`. When it is missing, `effx cedar` fails with one clear `CompilerFault` naming `bun add @cedar-policy/cedar-wasm@4.13.0`. `build` and `check` never import it; the import-graph test (F3d) proves it.
3. **Namespace.** Default `Effx`; `--namespace <Name>` overrides it. The value is validated as a Cedar namespace: one or more unreserved Cedar identifiers joined by `::`. An invalid value is `EFFX4101`, before anything is written.
4. **`All`.** Stays unmapped with `EFFX4104`.
5. **Requirements.** `"<id>": Bool` context attributes plus `forbid … unless`.
6. **Resource type.** The resolver export name.
7. **ADR and STATE.** The implementation adds an ADR 0007 addendum ("schema/policy projection + validation shipped in 0017; runtime authorization and leases still deferred") and a `STATE.md` row, each as a separate commit.

## 8. Implementation notes (details the contract left open)

Each is observable in the tests named in §6; none changes a decision in §7.

1. **Stacked `@Authorize`.** An operation with two or more `AuthorizedBy` capabilities and no `AccessContract` is read as "all required": it projects like `capabilities: All` (no group parent, `EFFX4104`). Exactly one capability is `One`.
2. **Grants only where a grant can match.** A grant template is emitted only for a capability that is the group parent of at least one operation action. A capability that appears only in an `All` expression, or that no operation uses, still gets its group action but no template: Cedar warns that such a policy is impossible, and the emitted pair validates with no errors and no warnings.
3. **Emitted text is a fault, not a diagnostic.** Any validator error or warning on effx-emitted text is a `CompilerFault`, as §5 says.
4. **Order and escaping.** Output is sorted by code unit; names are written as Cedar string literals with `\\`, `\"`, `\n`, `\r`, `\t` and `\u{…}` escapes. Cedar reports validation issues from hash maps, so the adapter sorts them by policy id and message.
5. **Policy ids.** Ids come from the `@id` annotation, else `policy<n>` or `template<n>`; a repeated id is kept and the later one is suffixed `#<position>`. A requirement id that makes two emitted policy ids collide is `EFFX4101`.
6. **Flags.** `effx cedar` resolves the project without `--strict-access` and without the shared `--out-dir`; `--out-dir` is its own output directory. `--target` and `--emit` are accepted but do not affect the output (verified byte-identical across `--emit`).
7. **Probe mechanism.** F3d's runtime proof runs the real CLI under `bun --tsconfig-override` with the validator's import redirected to a failing stand-in. Bun 1.3.13's runtime `plugin` `onResolve` does not intercept that bare package, so it was rejected.
8. **Source fixtures.** The real-source cases compile `ai-docs/src/04_problems-and-access/02_access.ts` (the Profile-like `SnapshotRead` query and `Transaction` command) and a test-owned decorator fixture (`Any`, `None`, `All`, parameterized requirement), both through the real frontend.
