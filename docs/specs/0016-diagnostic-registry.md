# Spec 0016 — Diagnostic registry, `effx explain`, generated catalogue

Status: **frozen — operator-approved** 2026-10-05. Changes require an explicit dated amendment.
Baseline: local main `a879a38c109d4fa968745ab152e8c093a457f2dd`.
Builds on specs 0001, 0003, 0015 and 0020; includes the shipped 0017, 0021 and 0022 diagnostics.
This document is the approved implementation contract. The operator approved all nine defaults in §8.

## 1. Goal

A user copies a diagnostic code from `effx check`, runs `effx explain <code>` offline,
and gets its stable meaning and a concrete repair. The same entry appears in the docs
site and installed AI guidance. An extension author can register explanations without
negotiating a numeric allocation with every other extension author.

`registry entry → emission / explain / site catalogue / LLMS.md` is one explicit
source-to-derivation graph. Diagnostics remain data; user mistakes do not become
`CompilerFault` (AGENTS.md:21-22; spec 0001:138-155).

### Constraints

- Existing numbers, meanings, severity policies, message bytes, ordering and locations
  remain stable. Several existing codes cover multiple related conditions: document
  those conditions, do not silently split, narrow or recycle their numbers.
- No registry, prose, policy or source location enters ApplicationIR. No IR version,
  normalization, canonical JSON, semanticHash or generated application bytes change.
- Reuse Schema and the existing compiler/CLI/config/docs seams. No remote lookup,
  central allocation service, separate website or new plugin-discovery mechanism.
- Unknown, duplicate and undocumented codes cannot pass the repository test rung.
  Typed entry references strengthen this guarantee, but do not claim TypeScript
  can prevent forged JavaScript diagnostics from an external module.

### Values

Single source of truth; offline usefulness; stable machine identifiers; deterministic
projections; an honest distinction between construction guarantees and checked boundaries.

### Non-goals

Localization; LSP integration; automatic code fixes; rewriting diagnostic wording;
new validation rules; telemetry; compiling a project to explain a code; watching;
fetching plugin documentation; publishing arbitrary third-party explanations on the
core site; a public registry server; automatic renumbering; changing failure taxonomy.

## 2. Registry contract

The compiler exposes the public Schema-defined `DiagnosticEntry` and entry-reference
emitter API. Its implementation belongs in a small Effect-only leaf package
`@effx/diagnostics`, also importable by runtime annotation definitions. Runtime cannot
import the compiler: EFFX1301 is created there before compiler interpretation. The leaf
owns the entry Schema/factory; owner modules supply data, and the compiler composes the
complete catalogue. This avoids a runtime→compiler cycle and does not put compiler
behavior into decorators. Runtime definition diagnostics use the same entry reference
but retain their existing code/message projection until interpreted. One data entry per full code contains:

| Field          | Contract                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| code           | Full immutable identifier; grammar and ownership below                                                                                                    |
| owner          | Core subsystem or canonical extension package identity                                                                                                    |
| title          | Nonempty short human-readable title                                                                                                                       |
| severity       | Default error, warning or info                                                                                                                            |
| severityPolicy | Fixed, or an explicitly named existing promotion policy                                                                                                   |
| explanation    | Nonempty Markdown describing the condition and its variants                                                                                               |
| examples       | At least one nonempty before/after example and explanation of the fix; informational entries may show the triggering configuration and recommended action |

No duplicated `code` field and object key: if entries are keyed by code, materialize
the field from that key. A validated registry snapshot is data, serializable without
functions. Core data belongs to one compiler registry module; first-party optional
package data lives with its owner and is explicitly included in the shipped catalogue
composition. The CLI must bundle those data modules without pulling optional runtimes,
validators, application modules or generating code.

Each entry's typed diagnostic factory takes structured message parameters plus an
optional location/related list. The entry module owns the parameter Schema and message
renderer beside its data; renderers are not fields of the serialized entry Schema.
Emission sites reference the entry/factory and pass facts, never a literal code,
copied title, severity or free-form message template. Multiple existing message forms
are tagged parameter variants under one entry, not multiple entries with the same code.
External validator text is a named parameter, not an unchecked replacement for the
registry-owned prefix. Preserve all existing message forms exactly at cutover.

The emitter derives severity from the entry and named policy inputs. Preserve both
EFFX0001 policies (same-major skew is info, different-major skew warning) and EFFX1106
phase policies (frontend resolution warning versus core contract errors); entry variants
name these policies explicitly. In particular,
EFFX2504 is warning by default and error under strictAccess; neither arbitrary severity
overrides nor a second entry is allowed (access-contract.ts:137-140). Explanations show
both modes. Locations remain per occurrence; they are not registry data.

### Guarantee and enforcement rung

- Entry references make unregistered codes unrepresentable in ordinary typed emitter
  calls; code, title and default severity are derived, not independently supplied.
- Registry composition rejects duplicate full codes, even identical duplicate entries;
  no last-writer-wins map, spread overwrite or load-order resolution. Core repository
  tests inspect the source declarations as well as composed entries so overwrites
  cannot erase evidence of a duplicate before validation.
- All production emission paths (frontend, expand, interpret, analyze, surface, Cedar,
  persistence, CLI) must use this API. A syntax-aware repository conformance test
  rejects direct Diagnostic construction outside the emitter and location-preserving
  adapters, and rejects raw-string helper calls. Decode-only wire fixtures are exempt,
  not production emission. Tests compare old message variants against new factories.
- Untrusted extension registry data is Schema-decoded and collision-checked before
  frontend analysis. Diagnostics returned by extension callbacks are checked against
  that composed registry, recursively including related diagnostics, before they are
  reported or written. An undeclared code or mismatched severity policy is extension
  contract data: report a registered core registry-contract error and stop generation.
  A malformed/duplicate registry similarly reports that core error, naming both owners;
  it does not crash as a CompilerFault or invent an unregistered diagnostic about itself.
- Reserve new core EFFX0010 for this registry-contract error.
  Its own entry is available in the immutable bootstrap core registry.

Thus the **minimum promised global guarantee is the test rung**, plus checked plugin
boundaries. TypeScript casts, raw JavaScript and duplicate dynamic composition rule out
an absolute by-construction claim. Do not retain the old string-code helper overloads
or compatibility aliases after migrating every caller and shipped authoring example.

## 3. Codes and ownership

All existing EFFX#### codes are immutable reservations. Numeric EFFX0000–EFFX9999
belongs to the effx distribution, including first-party optional extensions. Unassigned
numbers are reserved, not permission for a third-party to pick a random unused number.

| Existing family        | Owner / scope                                                                 |
| ---------------------- | ----------------------------------------------------------------------------- |
| 00xx                   | Frontend version/toolchain notices and registry bootstrap                     |
| 10xx, 11xx             | Kernel graph and annotation interpretation/lowering                           |
| 13xx                   | Annotation definition/lowering boundaries                                     |
| 22xx, 23xx             | Handler error and requirement contracts                                       |
| 24xx                   | HTTP contracts, grouping and endpoint inventory, including frontend emissions |
| 25xx                   | Access contracts                                                              |
| 26xx                   | Legacy Foldkit and frontend lowering validation (EFFX2601)                    |
| 27xx                   | Project target/output compatibility (EFFX2701)                                |
| 28xx                   | Surface/deployment wiring checks                                              |
| 2901, 2902             | Legacy shipped example.deprecated extension reservations                      |
| 9001, 9002, 9101, 9102 | Legacy shipped AI-doc authoring example reservations                          |
| 34xx                   | First-party persistence ports                                                 |
| 41xx                   | Cedar projection and validation                                               |

Families express semantic ownership, not the filesystem where a diagnostic is emitted.
Keep every other existing reservation found during migration; this table does not
reassign an observed code. New numbers require an entry and review by the family owner.
Retired codes keep explanatory entries and are never reused for a different condition.

New third-party codes use `EFFX[<package>]/<local>`, for example
`EFFX[@acme/effx-rate-limit]/0001`. Package is an explicitly declared canonical npm
package name (scoped or unscoped, lowercase); local is exactly four decimal digits.
An extension package can contain several extensions; it owns one package-wide local
number space. Independent packages cannot collide in the full identifier. Two loaded
copies claiming the same full identifier are rejected, even if text agrees; no version
suffix in the identifier and no load-order-dependent precedence. Package ownership is
a declared identity, not cryptographic authentication: a malicious config can lie, but
cannot silently win a collision. No registry authority/network access is implied.

The six existing example/AI-doc numeric codes remain as narrow grandfathered reservations;
the shipped example migrates to entry references without renumbering. This is a specific
ownership reservation, not a legacy raw-string API or arbitrary third-party numeric range.

Add diagnostic entry registration to the public Extension authoring contract and its
`extension()/implement` composition path. `effx.config.ts` still selects extensions as
spec 0015 specifies; its selected Extension objects carry their registry entries. An
extension with no diagnostics declares none. Authors publish explanations with their
compiler module; code and prose cannot require importing the application. Library
`compile(config, extensions)` applies the same checks as the CLI; config cannot become
the only enforcement path. Sharing a core factory is allowed; shadowing its entry is not.

## 4. `effx explain <code>`

Exactly one full, case-sensitive code; no numeric shorthand or fuzzy match. No network,
pager, project compilation, manifest dependency or output files. Successful output is
plain deterministic Markdown to stdout, ending in one newline:

1. `# <code> — <title>`;
2. owner, default severity and any named promotion policy;
3. explanation (including all existing variants);
4. example, corrected example and repair guidance.

Known built-in/first-party codes work from an empty directory without a tsconfig.
By default explain uses only the bundled registry and **does not discover/evaluate
`effx.config.ts`**, even for an unknown code. For an installed third-party code the user
opts in with `--config <path>`: evaluate that one selected config and its imports,
read/validate its extension entries, and do not create a TS Program or analyze source.
An explicitly selected config is validated even when the requested code is built-in;
no hidden fallback around an invalid config. Project/output/generation flags are not
inputs to explanation and must be rejected rather than silently applied. Reuse config
module loading, but separate registry resolution from project compilation.

| Result                                                 | stdout               | stderr                                                                                 | Exit |
| ------------------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------- | ---- |
| Known code                                             | Complete explanation | Empty                                                                                  | 0    |
| Well-formed unknown code                               | Empty                | `Unknown diagnostic code: <code>`; for namespaced codes also suggest `--config <path>` | 1    |
| Missing/extra code, malformed code, unsupported option | Empty                | Usage and specific error                                                               | 2    |
| Invalid explicit config or registry conflict           | Empty                | Registered registry-contract/config error with owner/path context                      | 1    |
| IO/invariant breakage                                  | Empty                | Existing typed fault reporting                                                         | 1    |

Unknown explain queries are lookup outcomes, not fabricated compiler diagnostics.
`--help` and `--version` keep normal CLI behavior. Shell users must quote namespaced
codes where their shell treats brackets as glob syntax.

## 5. Generated catalogue and AI documentation

Use one pure Markdown renderer over the validated, sorted entry-data snapshot. It
renders one stable anchor per full code, a code/title/severity index and complete entry
sections. Escape MDX/Markdown metacharacters in labels; examples are fenced text, never
executed by docs sync. Sort by full code with code-unit ordering, independent of extension
load order; no timestamps, absolute paths or environment-dependent prose.

- Implement the existing `renderDiagnostics` hook in `scripts/docs-sync.ts:13-16`.
  Generate `apps/docs/content/docs/diagnostics/registry.md`; replace the marked
  placeholder in the authored diagnostics landing page with a link to that generated
  page, not a second list of codes. Include appropriate Fumadocs metadata/navigation
  and gitignore coverage. Sync owns generated catalogue bytes and stale output cleanup.
- Extend `scripts/ai-docs.ts` to append the same rendered catalogue body to LLMS.md.
  Its existing `--check` recomputes from registry data and fails on prose/code drift;
  no manually authored catalogue under ai-docs/src. Keep a typechecked example there
  showing entry-based extension authoring and explain usage. The existing package-copy
  step ships the catalogue in package AGENTS.md; include the authoring example as usual.
- `bun run docs:build` continues to regenerate the catalogue before Fumadocs MDX/static
  export. Add focused tests connecting its output to the shared renderer; do not claim
  `ai-docs:check` checks an ignored site artifact unless explicitly wired to do so.
- The public site/LLMS catalogue includes the complete effx distribution (including
  optional persistence and shipped legacy authoring examples), not just currently enabled
  project extensions. Bundled explain uses that same explicitly assembled snapshot.
  User plugins remain explainable via explicit config; the docs scripts never execute
  arbitrary discovered user configs. Plugin authors may use the public renderer for
  their own catalogue without another hand-maintained representation.

## 6. Compatibility and cutover

Existing diagnostics retain code, message, severity policy, location/related structure,
ordering and blocking behavior. Registry descriptions classify broad existing meanings,
not retrofit one condition per number. EFFX1102 remains an umbrella for malformed
annotation arguments; EFFX2403 includes its existing external HTTP/binding/key cases.
EFFX2415 remains finite HTTP root endpoint inventory validation; EFFX3401 remains a
port with a local handler. No error becomes a fault to simplify registration.

Widen the Diagnostic code Schema to the numeric-or-namespaced grammar. Existing numeric
manifest payloads continue to decode, and the Diagnostic wire fields and manifest
version remain unchanged; this is an additive grammar change, not an IR migration.
Manifest consumers with their own EFFX#### regex must accept the new extension grammar.
No explanatory prose, renderer function, registry contents or registry hash is added
to the manifest, IR or generated application. Entry documentation changes affect only
explain/catalogue/LLMS/package guidance bytes. Existing fixtures' IR JSON, semanticHash,
surface.json and generated application files must remain byte-identical; manifest
compiler-version fields are not asserted identical across a release.

The helper API and Extension registration contract change for compiler extension authors;
release it as the appropriate pre-1.0 package API change with a migration example and
changeset. No deprecation shim. Migrate internal emitters, direct info objects, related
construction, optional first-party packages, config examples and tests in one cutover.

## 7. Falsifiers / definition of done (implementation acceptance, not draft checks)

1. Add `packages/compiler/test/diagnostic-registry.test.ts` and a syntax-aware production
   emission conformance test. `bun --bun vitest run packages/compiler/test/diagnostic-registry.test.ts`
   must fail for duplicate declarations (including duplicate spread inputs), missing
   explanation/fix, invalid ownership, undeclared related codes and unauthorized severity.
   A type fixture rejects a raw string code. Injecting raw production construction fails
   the conformance test. Verify every existing inventoried code has exactly one entry.
2. Parameterized factory snapshots preserve each existing message variant, especially
   EFFX1102/EFFX2403/EFFX4101 and EFFX2504 in both strict modes. Preserve location enrichment
   and warning-vs-error generation behavior in frontend/kernel/persistence tests.
3. Add `packages/cli/test/explain.test.ts` using the built/packed executable. From an empty
   temporary cwd, `effx explain EFFX1102`, EFFX2415 and EFFX3401 return complete output/0,
   no stderr/files and no TS Program/config evaluation. Unknown EFFX9999 returns 1 with
   exact lookup text; malformed EFFX12, missing/extra arguments and unsupported flags
   return 2. Inspect no application import/config trap was executed by default.
4. Explicit-config fixture registers `EFFX[@fixture/effx-example]/0001`; explain returns
   its entry without source analysis; check/build report the same code and message and
   manifest round-trips it. Two copies collide before frontend analysis and write nothing.
   A forged core-code claim, undeclared callback diagnostic and undeclared related code
   yield the registered core contract diagnostic and never escape as raw output/fault.
   Test the direct library compile path as well as CLI config resolution.
5. `bun run ai-docs` then `bun run ai-docs:check` succeeds; changing one registry title,
   severity explanation or example without regeneration makes check fail. Generated
   catalogue tests compare all entry codes and shared rendered bodies for site and LLMS.
   `bun run docs:build` resolves catalogue navigation/anchors and exports the full page.
   Packed package AGENTS.md contains the same entries and authoring example.
6. Run focused existing frontend, compiler, CLI and persistence suites, then the existing
   ordered `bun run gate` on the eventual implementation commit. Compare current users,
   rc.116, persistence and extension fixture IR/hash/surface/generated bytes before/after
   registry migration using the repository's generation/golden procedures, not a narrowed
   synthetic IR. Documentation-only entry edits must not change those artifacts.
7. Update compiler/CLI/extension authoring documentation and release changesets; remove
   string helpers and the diagnostic placeholder. No duplicate hand-maintained catalogue.

## 8. Accepted operator decisions

| Question                                    | Recommended default                                                                                                 | Tradeoff                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Third-party numbering?                      | Package-qualified codes; numeric space distribution-owned, grandfather the six shipped authoring/example codes only | Longer identifiers and additive wire grammar, but no central allocator or accidental cross-package collision        |
| Does explain execute discovered config?     | Never by default; explicit --config only                                                                            | One extra flag for plugins, but offline core lookup is safe and works outside a project                             |
| One severity per code despite strictAccess? | Default plus named existing promotion policy                                                                        | More explicit schema, preserves existing strictAccess behavior without a lying catalogue                            |
| Move message templates into entries?        | Yes, typed parameter variants beside Schema data                                                                    | Larger mechanical migration, but emission cannot drift from the entry and legacy umbrella codes keep their meaning  |
| Guarantee level?                            | Typed references plus test rung and checked plugin boundary                                                         | No impossible TypeScript-security claim; external JavaScript requires runtime validation                            |
| Public catalogue scope?                     | Whole bundled distribution, no discovered user plugins                                                              | Includes optional codes, but docs are deterministic and never execute operator config                               |
| Registry-contract code?                     | Reserve EFFX0010 error                                                                                              | Adds one diagnostic only for new contract violations; avoids faults or self-referential unknown codes               |
| Shared entry API placement?                 | Effect-only @effx/diagnostics leaf; compiler re-exposes API                                                         | Adds a small package, but lets runtime definition diagnostics reference entries without a compiler dependency cycle |
| Explain machine-readable output?            | Plain Markdown only in this slice                                                                                   | Smaller stable CLI contract; JSON can be separately approved if a concrete consumer appears                         |

### Approval amendment — 2026-10-05

The operator wrote, verbatim: **"Approve the defaults"**. This approves all nine §8 decisions:

1. Use package-qualified third-party codes. Reserve numeric codes for the distribution and the six existing example codes (§3).
2. Load extension config only through explicit `--config`; never discover it for explain (§4).
3. Preserve default severity and each named existing promotion policy (§2).
4. Place typed message variants beside Schema entry data; emission sites pass facts (§2).
5. Guarantee typed references plus the test rung and checked plugin boundaries (§2).
6. Include the whole bundled distribution in the catalogue, not discovered user plugins (§5).
7. Reserve EFFX0010 as the registry-contract error (§2).
8. Place the shared API in the Effect-only `@effx/diagnostics` leaf; re-expose it through compiler (§2).
9. Emit plain Markdown only from explain (§4).

These decisions are binding in the cited contract sections. This amendment records approval, not implementation acceptance.

### Implementation sequencing amendment — 2026-10-05

The operator authorized two phases to avoid the concurrent `compiler/inventory-bootstrap` work.
Phase 1 adds the leaf, all existing entries/message variants, EFFX0010, explain, shared catalogue rendering and registry tests.
Phase 1 does not migrate emission sites or enable the syntax-aware emission restriction.
Phase 2 starts only after the operator reports that inventory-bootstrap landed on local main.
Then rebase, migrate every emission site/example, remove string helpers and enable the syntax-aware restriction.
Identity snapshots compare each phase against its base. Preserve diagnostics and generated artifacts; list every intended difference.
No phase authorizes pushing or fast-forwarding main.

## 9. Read-only investigation (baseline a879a38, 2026-10-05)

### Vocabulary and all producer locations

There are **62 distinct package production codes**, plus **six distinct shipped
extension/AI-doc example codes**: **68 existing identifiers** to preserve. This is a
vocabulary count, not the number of diagnostics a project emits. Loops may emit the
same code many times; helper call sites and construction sites are different counts.
Tests, snapshots, assertion text and mentions in specs are not producers.
The table covers 26 emitting package files, one package code-selection file and three
shipped example/AI-doc producer files. Diagnostic.ts:35-50 supplies generic constructors.
The per-file counts below separate shared-helper calls from local construction sites.

| Package producer                                                                  | Local creation sites / helper invocation branches                                   |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| runtime define                                                                    | 1 mapping expression                                                                |
| frontend collect / leaf / lower / project / signature                             | 5 / 1 / 4 / 5 / 1 (project counts both severity arms separately)                    |
| compiler annotation / args                                                        | 6 / 1                                                                               |
| compiler Cedar                                                                    | 3 dynamic object constructors, called from 8 emission branches                      |
| decision-time / group-defaults / http-api-inventory / pipeline / request-channels | 1 / 1 helper with 9 call branches / 2 / 2 / 1 helper with 2 classified code choices |
| surface-check                                                                     | 5                                                                                   |
| access-contract / client / core / Foldkit                                         | 7 / 1 / 15 / 6                                                                      |
| http-contract                                                                     | 1 EFFX2402 helper with 16 call branches; 5 direct EFFX2403 calls                    |
| http-group / not-an-operation / problem-contract                                  | 5 / 1 / 8                                                                           |
| CLI surface / Cedar                                                               | 2 / 2                                                                               |
| persistence ports                                                                 | 7 (compiler.ts selects a duplicate code; not an additional emitter)                 |
| deprecated example / implement AI example / handwritten AI example                | 3 / 2 / 2                                                                           |

Cited lines for each count and code appear in the producer table below.
Duplicate-code options select a code for annotation.ts, rather than construct another diagnostic.

Package code set: EFFX0001; 1001–1003; 1101–1107; 1301–1304 and 1306;
2201–2206; 2302–2304; 2401–2406, 2410–2411, 2414–2415; 2500–2506;
2601; 2701; 2801–2807; 3401–3404; 4101–4107 (all prefixed EFFX).
Example codes: EFFX2901/2902, EFFX9001/9002, EFFX9101/9102.

| Producer file and cited lines                                                             | Codes / creation pattern                                                                                                     |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| packages/runtime/src/define/define.ts:150-155,216-224                                     | EFFX1301 code/message definition data per invalid plan leaf; severity applied later                                          |
| packages/frontend-ts/src/collect.ts:240-243,274-281,591-598,620-627                       | EFFX1104,1303,2404; error helper with node position                                                                          |
| packages/frontend-ts/src/leaf.ts:36-72                                                    | EFFX1306; error helper with use-site position                                                                                |
| packages/frontend-ts/src/lower.ts:39-57,397-403,638-645                                   | EFFX1102,2404 helper emissions; EFFX2601,2415 errors with node position                                                      |
| packages/frontend-ts/src/project.ts:113-124,222-255                                       | EFFX0001 direct info/warning skew; EFFX2701 errors; EFFX1106 resolution warning                                              |
| packages/frontend-ts/src/signature.ts:186-205                                             | EFFX1105 error with source position                                                                                          |
| packages/compiler/src/annotation.ts:162-185,367-435,512-560                               | EFFX1102,2402,1302,1304; dynamic duplicate code and forwarded DefinitionDiagnostic; before/notOperation callback diagnostics |
| packages/compiler/src/args.ts:25-36                                                       | EFFX1102 shared decode-error helper                                                                                          |
| packages/compiler/src/cedar.ts:117-129,170-175,245-305,336-364                            | Dynamic failure/caution/info object factories; EFFX4101,4103,4104,4105,4107                                                  |
| packages/compiler/src/decision-time.ts:24-47                                              | EFFX2414 error with declaration location                                                                                     |
| packages/compiler/src/group-defaults.ts:62-64,77-197                                      | EFFX2404,2405 through dynamic-code invalid helper, declaration location                                                      |
| packages/compiler/src/http-api-inventory.ts:54-74                                         | EFFX2415 error branches                                                                                                      |
| packages/compiler/src/pipeline.ts:91-97,191-201                                           | EFFX1101 unknown annotation and EFFX2701 unsupported-module errors                                                           |
| packages/compiler/src/request-channels.ts:118-123,158-179,206-220                         | EFFX2410,2411 selected into Decision.code, one dynamic invalid helper                                                        |
| packages/compiler/src/surface-check.ts:61-71,91-96,115-143                                | EFFX2801,2802,2803 errors; 2806 warning; 2807 direct info                                                                    |
| packages/compiler/src/extensions/access-contract.ts:110-138,154-190,222-228               | EFFX2500–2504,2506; error/warning helpers and strictAccess conditional severity; duplicate code configuration                |
| packages/compiler/src/extensions/client.ts:54-64                                          | EFFX2505 error                                                                                                               |
| packages/compiler/src/extensions/core.ts:129-161,198-203,282-328,416-475,519-548          | EFFX1001–1003,1106–1107,2201–2204,2302–2304,2401; error helpers, 2204 warning                                                |
| packages/compiler/src/extensions/foldkit.ts:14-15,33-103                                  | EFFX2601 error branches and duplicate code configuration                                                                     |
| packages/compiler/src/extensions/http-contract.ts:120-121,139-350                         | EFFX2402 fixed-code helper and EFFX2403 direct error calls                                                                   |
| packages/compiler/src/extensions/http-group.ts:20-29,51-79,110-143                        | EFFX2402,2406 errors                                                                                                         |
| packages/compiler/src/extensions/not-an-operation.ts:8-16                                 | EFFX1103 shared error helper                                                                                                 |
| packages/compiler/src/extensions/problem-contract.ts:96-144,160-191                       | EFFX2205,2206,2402 errors                                                                                                    |
| packages/persistence/src/compiler.ts:8-20; packages/persistence/src/ports.ts:28-30,45-123 | Duplicate code EFFX3403 setting; EFFX3401–3403 error and 3404 warning emissions                                              |
| packages/cli/src/surface.ts:24-36,57-68                                                   | EFFX2804 error, EFFX2805 warning                                                                                             |
| packages/cli/src/cedar.ts:113-118                                                         | EFFX4102/4106 error/warning wrapping external policy validator findings                                                      |
| examples/extension-openapi-tags/deprecated-extension.ts:12-15,31-63                       | Constants EFFX2901 warning and 2902 error; same unregistered string helper API                                               |
| ai-docs/src/06_custom-extensions/05_implement-annotation.ts:29-41                         | EFFX9101 error, 9102 warning                                                                                                 |
| ai-docs/src/06_custom-extensions/10_hand-written-extension.ts:38-40,78-80                 | EFFX9002 error, 9001 warning                                                                                                 |

### Severity, messages, locations and manifest

The current Diagnostic Schema checks only numeric syntax, not registration or uniqueness
(packages/compiler/src/Diagnostic.ts:11-14,25-33). Its TypeScript interface accepts string
codes (:16-22). error/warning select severity and accept arbitrary code/message/location
(:35-50). Direct info objects and Cedar's local constructors bypass those helpers.
Messages are mostly inline templates, often prefixed by operation/declaration name.
EFFX0001 varies info/warning by version skew, EFFX1106 warning/error by phase, EFFX2504
warning/error by strictAccess. EFFX2402 and EFFX2403 are existing umbrella identifiers;
EFFX2601 is used by Foldkit and frontend lowering, so assigning it a new target-only
meaning would be a compatibility error.

Frontend positionOf reads the source filename and **1-based** line/column
(packages/frontend-ts/src/ts.ts:67-74). Interpreter contributions lacking a location
inherit their declaration location, preserving related data
(packages/compiler/src/pipeline.ts:31-48,103-115). That is not a general analysis/prepass
location-enrichment pass; many IR analyses and Cedar findings have no Location. Cedar
policy filenames/IDs/help appear in message text, not a fabricated source span.

Manifest holds diagnostics and a separate stable-ID location map
(packages/cli/src/manifest.ts:15-30). Build stores result.diagnostics unchanged
(packages/cli/src/commands.ts:350-357); locationsOf relativizes declaration/model locations
(:358-365; manifest.ts:52-74), and spreads are separately relativized (:368-373).
It does **not** generally relativize diagnostic locations. CLI display formatting uses
a relative callback separately (commands.ts:252-264; report.ts:19-23,45-62).

Cedar rejecting generated Cedar is existing invariant breakage/CompilerFault
(packages/cli/src/cedar.ts:85-96); application policy findings become EFFX4102/4106.
No change to that distinction is proposed. scripts/identity-snapshot.ts:92-108 consumes
code/severity/message/location, not another emission source.

### Existing registry and extension path

No executable per-code registry exists. Partial catalogues are prose: spec 0001:182-199,
spec 0022:38 and the diagnostics overview. The site explicitly says there is no central
registry (apps/docs/content/docs/diagnostics/index.mdx:70-94); docs-sync.ts:13-16 contains
an unimplemented generation hook, not a catalogue implementation.

Extension presently has interpreters/analyses/expand/generators and annotation definitions,
not diagnostic registration (packages/compiler/src/Extension.ts:136-155). Config selects
Extension objects by array append or builtin-list callback
(packages/cli/src/config.ts:10-13; spec 0015:7-25). The shipped example simply declares
EFFX2901/2902 constants and calls public error/warning; nothing reserves or collision-checks
them. AI docs suggest non-colliding EFFX9xxx examples without a source-reserved allocation
(ai-docs/src/06_custom-extensions/index.md:110-139). implement's duplicate.code and
callback diagnostics are additional stringly extensibility seams
(packages/compiler/src/annotation.ts:162-185,423-425,530-532).

### Existing docs derivation

scripts/docs-sync.ts:28-31,129-180 currently generates only decisions/specs collections,
recreating ignored directories and deriving front matter/meta. Its diagnostics hook
(:13-16) already names the exact proposed catalogue path. Diagnostics meta currently
lists only index (apps/docs/content/docs/diagnostics/meta.json:2-3); ignored generated
directories do not yet include that catalogue (apps/docs/.gitignore:27-31).

Fumadocs reads content/docs and derives site-specific LLMS content
(apps/docs/lib/source.ts:9-33). Static page params come from source.generateParams
(apps/docs/app/docs/[[...slug]]/page.tsx:44-45,62-63); Next exports statically
(apps/docs/next.config.mjs:24-28). The generated catalogue therefore enters both the site
and its LLMS representation through the existing content graph, without a new route.

The separate repository scripts/ai-docs.ts:158-185,235-270 renders index.md and TS examples,
writes LLMS.md and copies guide/examples into publishable packages. --check compares
recomputed LLMS.md and returns before package copies (:254-265). docs:check checks fences,
not registry completeness. docs:build performs sync/API generation/Next build; check
includes ai-docs:check but gate additionally builds docs (package.json:23-30).
Thus app LLMS and repository LLMS require explicit derivation edges to the registry;
they are not currently one pipeline.

### Prior art and reused ideas

- **TypeScript:** [v5.9.3 diagnosticMessages.json](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/diagnosticMessages.json)
  owns message text, code and category. Its [generator](https://github.com/microsoft/TypeScript/blob/v5.9.3/scripts/processDiagnosticMessages.mjs)
  emits diagnosticInformationMap.generated.ts/diagnosticMessages.generated.json and
  rejects duplicate codes; [Hereby wiring](https://github.com/microsoft/TypeScript/blob/v5.9.3/Herebyfile.mjs)
  derives build artifacts. The closer TypeScript-Go toolchain comparison is its
  [generator at 2c251880](https://github.com/microsoft/typescript-go/blob/2c251880/internal/diagnostics/generate.go),
  which combines base/extra messages and generates sorted definitions/localizations.
  Reuse the data-root/generation principle, not upstream numbers or localization machinery.
- **Rust:** [rustc --explain](https://doc.rust-lang.org/stable/rustc/command-line-arguments.html#--explain-provide-a-detailed-explanation-of-an-error-message)
  gives a longer explanation by code; the [official error index](https://doc.rust-lang.org/stable/error_codes/error-index.html)
  provides index and per-code pages. Reuse the lookup and repair-example journey,
  not a second separately authored website or Rust's E#### namespace.
- **Effect:** installed effect is runtime/library v4.0.0 and @effect/tsgo is separate
  language tooling v0.48.0 (their package.json:2-6). Its README documents named rules,
  structured diagnostics mode and configurable severities
  (node_modules/@effect/tsgo/README.md:3,30-36,50-83,327-339).
  [Official v4 devtools](https://effect.website/docs/v4/getting-started/devtools) and
  [tooling source](https://github.com/Effect-TS/tsgo) establish that distinction.
  These are not runtime Effect errors or an EFFX catalogue. Reuse Schema for our data
  contract; do not conflate rule names or configurable severities with effx identifiers.
  effx's AI generator already adapts Effect's MIT AI-doc generation approach, with
  provenance recorded in scripts/ai-docs.ts:6-10.

No tests, builds, docs generation or implementation commands were run for this
investigation. Only the requested draft commit's normal lightweight hooks are expected.

## 10. Phase 1 implementation evidence — 2026-10-05

The registry/help/catalogue phase is implemented without migrating existing emitters.
The distribution has 69 entries: 68 legacy identifiers and EFFX0010.
Core and HTTP factories cover their existing typed message variants.

- Focused registry/renderer/CLI suites: eight files, 303 tests passed.
- After a pre-command global-option correction, the focused explain suite passed all 37 tests.
- Typecheck passed after correcting assertion generics and generating the persistence example prerequisite.
- Strict Effect diagnostics checked 261 files: zero errors, warnings or messages.
- Leaf and CLI builds passed. The built CLI explains EFFX2415 offline with exit 0; EFFX9999 reports `Unknown diagnostic code: EFFX9999` with exit 1.
- AI generation/check and docs sync passed. The fence check covered 193 files and 783 fences. A full site build and full repository gate remain phase 2 acceptance checks.

Identity snapshots used the existing `scripts/identity-snapshot.ts` against frozen base 4f95f81.
Both snapshots contain 172 cases, no faults, 172 IR/hash results and 68 generated-file results.
Only the literal checkout-directory prefix was normalized to `<worktree>` in string values.
The complete normalized snapshots are byte-identical, with SHA-256
`27b2aa12f097173b18caa4eb51fad7687166e1dcacb6b4108baada1b11e24acd`.
This comparison includes Collected data and every diagnostic code/message/severity/location, not just hashes.
Intended changes to existing compiler diagnostics, IR, semantic hashes and generated application bytes: **none**.
The new EFFX0010 paths handle registry-contract errors; explanatory/docs bytes are new outputs.

The operator reported that inventory-bootstrap landed at 7290ea5 and authorized phase 2 after this phase is committed and reported.
Phase 2 rebases onto that commit and updates EFFX2415 to the generation-only, whole-root contract in spec 0010:262-305.
No push or fast-forward of main is authorized.

## 11. Phase 2 implementation evidence — 2026-10-05

The complete emission migration targets inventory-bootstrap main `7290ea5`.
The implementation commit is `c08b45e884e6daf809461bf6b8dabb8a0be0a5d1`.
All compiler, frontend, runtime, persistence and shipped extension emitters use registered entries and typed factories.
The compiler checks callback diagnostics recursively, preserves valid occurrences, and reports registry violations as EFFX0010 data.
The syntax-aware conformance gate checks construction and emission syntax, not code mentions in comments, assertions or documentation.
Its runtime-definition projection allowance applies only to the named adapter; negative controls reject equivalent construction elsewhere.

### Checks on the clean acceptance clone

- The complete ordered `bun run gate` passed with exit 0 at implementation commit `c08b45e884e6daf809461bf6b8dabb8a0be0a5d1`, after restoring the clone's baseline ref.
- Typecheck, lint, formatting, docs fences and `ai-docs:check` passed.
- Vitest passed 86 files and 998 tests. The Oxlint RuleTester suite passed.
- Strict Effect diagnostics checked 255 files: zero errors, warnings or messages.
- The rc.116 generation/golden checks and target typecheck passed.
- The docs build exported 426 pages, including the generated catalogue of 69 entries.
- Six exact-commit packages built and packed. Their filenames and checksums appear in `dist-artifacts/manifest.json` in the acceptance clone.
- The release plan passed after restoring local `main` in the single-branch clone. The initial gate reached this final rung but failed because that ref was absent.
- A registry-title mutation made `ai-docs:check` exit 1 without regeneration. The isolated mutation was then removed.

### Real executable and manifest journeys

The committed CLI acceptance suite covers the built executable and the named extension fixture.
Its check/build journey reports `EFFX[@fixture/effx-example]/0001` and round-trips the same occurrence through the manifest codec.
A separate fixture installed all six packages from the exact-commit tarballs, with local overrides for their unpublished dependencies.
The packed CLI explained EFFX1102, EFFX2415 and EFFX3401 offline with exit 0.
A throwing default config was not evaluated; EFFX1102 and EFFX3401 produced no stderr.
Unknown EFFX9999 returned exit 1. Malformed, missing, extra and unsupported-flag invocations returned exit 2.
Explicit config explained the package-qualified fixture entry despite a missing project, without compilation or generated writes.
The disposable package fixture was removed after these checks.

### Compatibility evidence

Both complete identity snapshots contain 172 cases, zero faults and 68 generated-file results.
One type-witness case imports ignored generated modules. Both compilers generated equivalent prerequisites before that case was compared.
Only the checkout-directory prefix was normalized to `<worktree>` in string values.
The complete normalized snapshots are byte-identical, with SHA-256
`dd2e181eebad37491b96c15e315c700b9cffd177bff171087a89bb57999bfe4c`.
This includes Collected data, diagnostic code/message/severity/location, canonical IR, semantic hashes and generated application files.
Separate real builds of the persistence and configured extension examples produced identical IR, hash, diagnostics, surface and generated bytes.

No push, merge or fast-forward of main is authorized.
