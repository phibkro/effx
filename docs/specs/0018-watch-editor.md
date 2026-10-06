# Spec 0018 — Watch checks and editor diagnostics

Status: **frozen — operator-approved** — 2026-10-06. Changes require an explicit dated amendment.
Baseline: live local main `3d66eda158422282b6e2f44ec12910a362dcb9ae`.
Depends on approved 0016, frozen 0015 and 0002. The operator approved all four §9 defaults on 2026-10-06. Implementation remains subject to design review; this contract grants no publication or main-branch landing authority.

**Director provenance correction — 2026-10-06.** The authoritative conversation
date is 2026-10-06. Supplied messages incorrectly dated the current **"approve
defaults"** and **"A"** approvals 2026-10-05; the director corrects their approval
dates here to 2026-10-06. Original commits/history and verbatim approval quotes are
preserved. Observed machine-clock research/execution timestamps are unchanged and
do not establish an earlier approval date. Accepted policies are unchanged.

## 1. Goal, constraints and values

An author runs `effx dev`, edits a declaration, sees the same effx diagnostic as
`effx check`, repairs it, sees the error disappear, and stops the session cleanly.
An editor starts `effx lsp`, changes an unsaved document and receives those same
compiler diagnostics without saving or modifying the project on disk.

```text
saved project ────────────┐
                         ├─ same AOT frontend + compiler + registry ─ diagnostics
saved project + overlay ─┘                                          ├─ check
                                                                   ├─ dev
                                                                   └─ LSP
```

### Constraints

- One underlying compiler meaning: codes (including package-qualified codes),
  occurrence severity policies, message bytes, source positions, related diagnostics
  and blocking behavior match one-shot check for identical source/config snapshots.
  The editor is a projection, not a second annotation analyzer.
- Application modules are never executed. No TypeScript objects enter IR, protocol
  data or manifests. Diagnostics remain data; faults remain IO/invariant failures.
- Caller intent controls disk effects. `dev` defaults to check-only even when config
  selects an output directory or generators. LSP never calls the disk-emission path.
- Discovery and precedence retain 0015. Editor trust is an additional execution
  admission gate, not another project-discovery algorithm.
- Every session, watcher, callback registration, timer and analysis has a scoped
  Effect owner. Admission, pending work and publication are bounded (§5).
- Do not promise latency, incremental speedups or reduced memory without measurement.
  Rebuilding a program is acceptable; semantic divergence is not.

### Values

Explicit authority; a single source of truth; complete replacement/clearing rather
than sticky errors; latest accepted snapshot wins; boring bounded composition;
offline registry usefulness; predictable shutdown.

### Non-goals

Completion, hover, formatting, refactoring, code actions, auto-fixes, pull diagnostics,
semantic tokens, application/runtime execution, HTTP transports, editor extension
packaging, plugin installation, remote workspaces, multi-project workspace inference,
a generalized incremental engine, persistent caches or a telemetry system. This
server reports effx diagnostics, not a replacement for the editor's TypeScript
server or the project's generated-code typecheck.

## 2. Existing authority and implementation seams

References below are to the baseline, not promises about nonexistent watch code.

| Authority                    | Exact source and consequence                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repo rules and mission state | `AGENTS.md:8-35,54-58,60-87`; `STATE.md:3-15,32-34`. STATE's registry row records local landing evidence/conditions; live main supplied the baseline. No STATE edit is part of this draft.                                                                                                                                                 |
| Approved diagnostics         | `docs/specs/0016-diagnostic-registry.md:3-6,19-35,72-108,227-249,286-314`: preserve occurrence semantics, checked extension boundary, offline explain and stable full-code anchors.                                                                                                                                                        |
| Config authority             | `docs/specs/0015-config-and-extensions.md:7-39`; `packages/cli/src/config.ts:4-25`; `packages/cli/src/commands.ts:126-149,194-249`. Paths resolve at their supplying source; discovery is beside the CLI-selected tsconfig and does not recurse after a config project override.                                                           |
| CLI entry/root ownership     | `packages/cli/src/main.ts:29-57,85-91,141-160`; check/build are portable Effects; Bun platform and runtime are selected at the root. Do not run a new runtime inside compiler work.                                                                                                                                                        |
| Shared compiler              | `packages/compiler/src/pipeline.ts:33-40,339-380`: registration precedes collection; frontend definitions are supplied; compile generates files in memory after validation. Check is not simply collection. Retain the full diagnostic-producing pipeline; skipping a generator stage must not hide faults/diagnostics that check exposes. |
| Frontend boundary            | `packages/compiler/src/SourceFrontend.ts:18-39`; `packages/frontend-ts/src/TsSourceFrontend.ts:37-49,74-92`. Add session/overlay capability inside the frontend boundary, not an LSP-owned collector.                                                                                                                                      |
| TS program and host          | `packages/frontend-ts/src/project.ts:120-171,175-205,252-272`: each analysis currently parses config through `ts.sys`, creates a host/program, obtains a checker and retains module-resolution closures. No reusable watch session currently exists. Both host reads and config/include enumeration need consistent snapshot authority.    |
| Position origin              | `packages/frontend-ts/src/ts.ts:5-21,56-67`; `packages/diagnostics/src/model.ts:3-11,34-41`: TS API calls are the named foreign boundary; locations are one-based line/column points, not spans.                                                                                                                                           |
| Extension registry           | `packages/compiler/src/Extension.ts:137-157`; `packages/compiler/src/pipeline.ts:359-378`: extension entries/definition entries compose before analysis; invalid callbacks must keep EFFX0010 behavior, not leak raw plugin codes into the editor.                                                                                         |
| Explain/links                | `packages/cli/src/explain.ts:25-56,88-95`; `packages/diagnostics/src/render.ts:42-72`: reuse validated entries and full-code anchor encoding. Explain does not discover config implicitly.                                                                                                                                                 |
| Normal generated ownership   | `packages/cli/src/commands.ts:282-384`: build owns resolved output plus `.effx/{ir.json,manifest.json,surface.json}`; prior manifest limits obsolete-file deletion; real-path `.effx` guard applies. Watch must reuse this policy, not sweep output directories.                                                                           |

The TypeScript checker is required for effx's inference, but current collection does
not invoke a general `getPreEmitDiagnostics` pass (`project.ts:165-171,252-255`).
The generated-code typecheck is a separate gate (`AGENTS.md:56-58`). Adding generic
TS diagnostics only in LSP would violate the parity contract. This slice does not
add a new typechecking policy or a second TS toolchain.

## 3. Commands, selection and execution authority

### `effx dev`

Accept the existing project/config/output/emit/target/strict-access selection flags.
Perform an initial check, report a complete diagnostic batch and counts, then watch.
Compiler errors do not terminate the session: later edits can repair them. Do not
clear the terminal by default. Each completed cycle has a distinct monotonically
increasing cycle marker and a full replacement batch, including an explicit zero
count on repair. Diagnostics themselves retain the existing reporter formatting.

`--build` MUST be included as the sole opt-in to writing normal build artifacts.
It runs the same pipeline and normal writer on successful, current cycles only;
errors/faults preserve the last successful artifacts. Output, emit/target choices,
generator toggles, manifest ownership and obsolete-file restrictions remain normal
build behavior. No application/server subprocess is started. Neither config output
settings nor generator selection grants write intent; only `dev --build` does.

Startup invalid selection fails before any watch/write. A later malformed saved
JSON config or missing dependency reports a failed cycle, invalidates old success
status and continues watching for repair. A watcher failure is terminal and visible,
not a silent apparently healthy session. SIGINT/SIGTERM close the root scope; an
ordinary diagnostic error does not set a permanent failed-session state.

### `effx lsp`

Use stdio only, with one selected project per process. Existing explicit flags take
precedence. In the absence of an explicit project, one `workspaceFolders` entry
(or `rootUri`, then `rootPath`, then startup cwd when absent) supplies the base cwd
for the existing `tsconfig.json`/config selection rules. Multiple workspace folders
without an explicit project fail initialization with an actionable selection error;
no recursive nearest-tsconfig scan and no per-document project guessing. Advertise
no workspace-folder change support. Non-file URIs are outside this slice.

A config file is executable code, not passive editor settings. The server MUST require
launch-time `--trust-config` before evaluating a discovered config; explicit
`--config <path>` is also affirmative authority for that module and its imports.
If discovery finds a config without either authority, initialization fails naming
that file and the required opt-in; do not silently compile with built-ins instead.
Client messages cannot grant trust, install dependencies or choose executable
modules. Native editor workspace-trust decisions must be reflected in launcher
arguments, not guessed from a root URI. `dev` follows existing CLI authority: the
operator invoked the project compiler and 0015 discovery applies.

There is no sandbox claim: trusted config/plugin imports can execute arbitrary
code with the process's privileges. The zero-write contract concerns effx's own
compiler/host/transport behavior and tests using read-only trusted extensions;
separately prove untrusted configs never execute. Config that writes during import
is not made read-only by calling it from LSP. No config or plugin is evaluated from
an unsaved overlay or temporary file.

### Executable coverage — operator amendment A, 2026-10-06

`EffxConfig` and its existing Schema decoder MUST accept optional
`executableCoverage: { files?: readonly string[], directories?: readonly
{ path: string, recursive: boolean }[] }`. `defineConfig` retains its identity
behavior. `dev` and `lsp` MUST accept repeatable `--exec-file <path>` and
`--exec-dir <path>` launch inputs; a launch directory covers ordinary descendants
recursively. Launch paths resolve from startup cwd; config paths resolve beside
the selected config. Merge coverage by union while retaining logical aliases.
Project/config selection and supported executable config syntax MUST NOT change.
Editor messages MUST NOT grant trust or add executable coverage authority. Coverage
data MUST stay outside ProjectConfig, IR, semanticHash and generated artifacts.

Executable observation MUST use caller coverage plus known loaded physical files
and observed TS/config/resolution inputs. The caller MUST completely declare ALL
otherwise-unobservable logical routes and resolution-sensitive inputs. This includes
ordinary static bare-package symlinks omitted by known logical/TS coverage, package
exports, `#imports`, extensionless candidates and computed/external aliases. The
guarantee is conditional on complete caller data. Omitted routes can change without
detection; effx MUST NOT certify completeness or infer full provenance from a
canonical module-cache file. Declarations authorize observation, not a sandbox or
credential access. Known physical cache keys supplement, never replace, the route
declaration. One-shot check/build semantics remain unchanged.

Observe the selected logical config and launch declarations before the single
trusted import. After existing config decoding, add config coverage and known
physical executable files, then reconcile before initial publication. Refresh known
files after admitted analyses without config re-evaluation, cache-busting or another
resolver. Config-returned coverage is unavailable before import and establishes a
post-import baseline. Initial config import assumes stable inputs in that window
unless complete pre-import launch coverage can detect a change. Neither path
claims an atomic filesystem snapshot. A detected import-window change MUST yield
RestartRequired rather than a trusted initial publication.

Covered changes that can replace executable code MUST transition once to
RestartRequired, clear diagnostics and suspend analysis/generation until a fresh
authorized process. Unchanged complete coverage MUST permit repeated source/overlay
analyses without restart. The rejected unobservable-epoch restart-before-every-
generation policy MUST NOT be implemented. The director approved component design;
only the operator approved the four product defaults and this A amendment.

### Reload versus restart

| Input change                                                                                                     | Required outcome                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authored sources, imported helpers, schemas and declaration files                                                | Invalidate the project snapshot and analyze again, using open overlays before disk.                                                                                                                                                                        |
| Selected tsconfig, `extends` chain, include/exclude/files, references and referenced config files                | Reparse saved JSON, rebuild root membership/resolution and watch coverage; malformed changes suspend successful publication until repair.                                                                                                                  |
| Package metadata, lockfile or installed resolution inputs not belonging to executable config/plugin closure      | Invalidate resolution and inferred target/version; analyze again after edits settle. Source/declaration dependencies and failed-lookup directories remain watched.                                                                                         |
| Selected executable config added/deleted/edited; its imported executable helper/plugin or plugin package changed | Mark restart-required once, clear previously published diagnostics, suspend analysis/generation. Restart the process to evaluate the entire module graph exactly once under renewed launch authority. No import-query cache busting or partial hot reload. |
| Unsaved executable config/plugin document                                                                        | Never execute it; log that changes apply only after save and restart. Continue source diagnostics using the previously selected saved config until a saved executable input changes.                                                                       |
| `workspace/didChangeConfiguration`                                                                               | Validate settings; no mutable compilation/trust settings are supported in this slice. Ignore unrelated editor settings; report changes to effx selection as restart-required. No implicit config import.                                                   |

Executable replacement coverage includes imported config helpers and selected
extensions under the explicit conditional coverage rule above. If a COVERED edit
can replace executable code or its selection, require restart rather than hot reload.
RestartRequired is session status/log data, not a compiler diagnostic code. Silently
using stale covered executable inputs is a falsifier; omitted unobservable inputs
remain the caller completeness limitation, not an automatic provenance guarantee.

## 4. Project membership, watching and overlay semantics

Register watch coverage before the initial analysis, reconcile the inputs after
registration, and reconcile coverage after every accepted snapshot. Events are
invalidation hints, not an ordered file history. Atomic-save rename, duplicate
notifications and create/remove races must converge on actual current inputs.

Source/config coverage includes root membership directories, imported source and
declaration files, failed lookup parents, selected/extended/referenced tsconfigs,
metadata selecting TS/Effect and relevant lockfiles/resolution directories. Executable
coverage is the conditional union defined in §3. Do not recursively watch all
`node_modules` or the whole monorepo by default.

Explicit executable files MUST retain their logical routes and observe each symlink
component, raw destination, successive target expansion, target identity/content
and relevant parent membership. Missing routes retain their unresolved suffix and
nearest existing ancestor so intermediate/final creation becomes observable.
Directory fingerprints include sorted entry names, kinds and link destinations.
Explicit external directories authorize those trees, within finite documented
path/depth/byte limits. Ordinary descendants of recursive declarations are covered.
Do not traverse arbitrary child links into undeclared trees; use separately declared
routes or known dependency edges. Deduplicate physical traversal without discarding
logical aliases. Cycles, inaccessible inputs, limits and owned-output overlaps MUST
fail visibly, never silently truncate coverage. Existing output/cache/VCS exclusions
remain; no implicit scan of every installed package or the whole filesystem.

For executable exports/`#imports`/extensionless or missing candidates, callers MUST
declare otherwise-unobserved package.json/tsconfig/lockfiles and candidate-directory
or missing-parent inputs. An eventual loaded file does not cover changed selection
or a new higher-priority candidate. Use declared membership coverage; do not add
a second Bun resolver or a global hook. The ordinary package-link and computed
external-alias examples in the approved research §7 define the intended observation.

Watch dependency files or their
nearest existing parent needed to notice replacement, including symlinked workspace
dependencies outside the project. Deletion or rename reparses membership and clears
diagnostics for the old URI; a renamed included declaration is analyzed at its new
path. Creation of a previously missing dependency can repair diagnostics.

Ignore effx-owned outputs (resolved custom output too), `.effx` manifests/IR/surface,
compiler caches, tsconfig build outputs/build-info and VCS internals as invalidation
sources. Derive exclusions from resolved policy, not only the spelling
`.effx/generated`. Do not suppress authored dependencies merely because a directory
is commonly named `dist` or `cache`. Outputs needed by module resolution can be read;
our writes must not create a self-triggering loop. An explicitly selected source or
config that overlaps an owned output is a visible invalid selection, not silently
unwatched input. Changing output policy rebuilds coverage only after restart of an
executable config; saved tsconfig policy changes re-resolve normally.

Use canonical real project/config paths to key ownership and deduplicate watchers,
with a stable URI-to-path alias map for publication. Preserve the existing logical
project-root-relative identity/import semantics; canonicalization must not rewrite
StableIds, IR refs or hashes. Follow only dependency edges, not arbitrary recursive
symlink traversal. Reject two open URIs resolving to the same underlying file rather
than merging contradictory overlay versions. Normalize URI percent encoding through
a maintained URI/path facility. For nonexistent new paths, canonicalize the existing
parent; reconcile the identity after creation. Do not case-fold on case-sensitive
filesystems. Project selection and output ownership cannot escape through a symlink
alias. A symlink loop must fail visibly, not grow an unbounded watch tree.

`didOpen` supplies authoritative text for that document; `didChange` replaces or
applies edits in memory; disk events never overwrite an open buffer. Overlay reads,
file existence, root-file enumeration for included new documents and module
resolution see one coherent snapshot. Open dependencies affect diagnostics in other
files. Files excluded from declaration roots do not become operations just because
they are opened; they can still participate as imported helpers under existing
semantics. No temporary save, tsbuildinfo or disk-backed overlay cache is permitted.

On `didClose`, discard the overlay, invalidate dependent analyses, immediately send
an empty diagnostic array for that document and reanalyze disk for other open
consumers. The server MUST publish only for open documents; closed-file findings remain
in compiler results but are not pushed. On reopening, a disk-based result is replaced
by the newly supplied overlay. If a deleted file remains open, its supplied text
remains authoritative until close; deletion clears the old URI once no overlay owns
it. No diagnostics can be attached to a version whose text was not analyzed.

## 5. Synchronization, admission and ownership

A session has a config epoch and increasing project revision; each open document
has a client version and current immutable text. Apply content changes in protocol
arrival order, validating a strictly increasing version for that open instance;
version gaps are allowed. Older/equal changes and changes for unopened documents
are rejected as notifications with a stderr/log explanation and do not mutate state.
On reopen, a new open instance may start its own version sequence.

Snapshot analysis captures all relevant document versions plus project/config epoch.
A newer accepted edit invalidates older publication immediately. Interrupt
superseded analyses where possible; otherwise discard their results before any
publication or generation. Synchronous TS API calls cannot be preempted by simply
interrupting an Effect fiber (`ts.ts:11-21`). Do not claim they are cancellable.
Queued newer changes must be admitted before publishing an older completion; client
version tags alone do not substitute for the session's stale-result guard.

- One analysis runs per project; at most one pending dirty/reconcile token exists.
  Repeated filesystem events coalesce into that token, not per-event jobs/fibers.
- Apply incremental document edits before coalescing analysis. Never drop an edit
  whose range depends on the preceding edit. Keep only current text and the snapshot
  required by the active analysis, not an unbounded change history.
- The transport has bounded byte/message admission and backpressure, including its
  own decoder and writer queues. Bound outstanding requests; reject excess requests
  explicitly. At a notification/byte limit that cannot be safely backpressured, log
  and close the session rather than silently drop edits. Concrete finite limits
  and their errors must be documented and tested before implementation acceptance.
- Output uses one serialized writer. Coalesce diagnostics per URI to the latest
  unsent replacement; empty clears are replacements too. Respect writer drain;
  no unbounded detached send promises.
- Generation, when explicitly requested by `dev --build`, has one writer for the
  canonical project's output/manifest set. Reject a competing watch-build owner of
  that same set, including symlink aliases, before writes; acquire/release ownership
  in the session scope. One-shot build must participate in that same output
  ownership rule if watch-build is included; reject it while a watch-build owns
  the set, and reject watch-build while a one-shot writer owns it. Do not promise
  cross-process safety from an Effect semaphore. This is local output custody,
  not a distributed lease system; no background writer may bypass it.
- Once a build write batch starts, serialize it to completion/failure before starting
  the next; do not interrupt halfway merely because another edit arrived. A cycle
  superseded before write admission writes nothing. Newer edits schedule the next
  cycle; this is not a claim of filesystem transaction atomicity.

The process root uses BunRuntime/runMain. Its child session scope owns watcher
registrations, native stream consumers, analysis fiber, overlay state and transport
connection. `acquireRelease` releases registrations once; scoped fibers end with
the session. `FiberHandle` is an available at-most-one fiber owner, not a mutex;
when replacement requires cleanup first, await interruption before starting work.
No `forkDetach`, per-keystroke worker/process, runtime-per-callback, global timer or
orphan helper process. EOF, client process death (`initialize.processId` when non-null),
transport failure, shutdown and SIGINT/SIGTERM all close the owner. Observe client
liveness through an owned platform boundary, never a detached polling timer.

## 6. Minimum actual LSP support

Use LSP 3.17 JSON-RPC 2.0 over `Content-Length` stdio framing. Header encoding is
ASCII, body length is UTF-8 bytes, separator is CRLF CRLF; chunk boundaries and
multiple frames per read are not message boundaries. stdout contains only framed
protocol messages from process start, including failures; human logs/help/config
warnings and Effect logging go to stderr. Trusted extensions must not print to
stdout; violations cannot be repaired by interleaving a banner with protocol bytes.

| Client method                      | Actual supported behavior                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `initialize`                       | Exactly once; select/admit project and config, validate parameters, return honest capabilities. Requests before initialization get ServerNotInitialized (-32002); other notifications before initialize are dropped except exit.                 |
| `initialized`                      | Start initial analysis/watching only after the initialize response; no unsolicited diagnostics before handshake.                                                                                                                                 |
| `textDocument/didOpen`             | Admit a file URI/version/full text, update overlay, schedule project analysis.                                                                                                                                                                   |
| `textDocument/didChange`           | Advertise incremental synchronization (2); support both full-text replacement and sequential range edits as allowed by 3.17. Validate UTF-16 ranges against the prior text of each edit.                                                         |
| `textDocument/didClose`            | Clear, discard overlay and invalidate consumers as §4.                                                                                                                                                                                           |
| `textDocument/didSave`             | Advertise save without text; disk invalidation hint only, never save on behalf of the client or override an open overlay.                                                                                                                        |
| `workspace/didChangeConfiguration` | Handle as §3, without new executable settings authority.                                                                                                                                                                                         |
| `workspace/didChangeWatchedFiles`  | Accept valid file create/change/delete invalidation hints; deduplicate with server watches. Do not require client dynamic watch registration for correctness.                                                                                    |
| `$/cancelRequest`                  | Honor cancellation of an outstanding cancellable request, returning RequestCancelled (-32800) rather than abandoning its response. Push diagnostics are notifications, not cancellable requests; their analyses obey the project revision guard. |
| `$/setTrace`                       | Accept off/messages/verbose; any trace remains on stderr and cannot expose source text or credentials.                                                                                                                                           |
| `shutdown`                         | Stop admission, cancel analysis, close watches, clear overlays and finish resource cleanup; reply null, remain awaiting exit/EOF, send no further analysis publications.                                                                         |
| `exit`                             | Exit 0 after shutdown, 1 without it; close ownership even before initialize. EOF also closes without waiting for exit.                                                                                                                           |

Capabilities: `positionEncoding: "utf-16"`; `textDocumentSync` openClose true,
change Incremental, save `{ includeText: false }`. Do not advertise completion,
formatting, hover, code actions, pull diagnostic provider, workspace-folder change
support or executable commands. Server sends `textDocument/publishDiagnostics`
and may send `window/logMessage` after initialization; no server requests are
required for the default flow.

Diagnostic projection is pure: source `effx`, exact full code and occurrence message;
error→1, warning→2, info→3. Convert one-based compiler points to zero-based UTF-16
positions. Existing locations contain no end: use a zero-length range at the exact
point, not an invented token span. Validate bounds against the analyzed snapshot;
CRLF is one line break, astral symbols consume two UTF-16 units. Do not split a
surrogate pair when applying edits. Preserve located related occurrences as
`relatedInformation` when supported; include unlocated related messages in readable
message context rather than fabricate a source file. Project/unlocated findings
are logged with code/severity and explain guidance, not falsely attributed to the
currently active editor line. This is a transport difference, not a new compiler
severity or synthetic diagnostic.

Use publishDiagnostics `version` for open documents when the client supports it;
in all cases enforce the latest-version guard server-side. A successful analysis
sends a complete replacement, including `[]` when an open file is repaired. Fault,
restart-required, exclusion, close and project deletion clear stale findings and
report that analysis is unavailable; an empty array alone must not imply success.

For bundled codes and clients supporting codeDescription, link to the shipped
catalogue's existing full-code anchor, URI-encoding the code rather than deriving a
title slug. Never claim a bundled docs page explains a third-party code. Every code
retains `effx explain <code>` support; third-party guidance explicitly uses
`effx explain <code> --config <selected path>`. No new explanation command or remote
lookup is necessary. Capability downgrade omits optional links/related fields but
never the code, severity, point or occurrence message.

Unknown requests receive MethodNotFound (-32601); malformed known parameters receive
InvalidParams (-32602); malformed JSON receives ParseError (-32700) when a complete
frame allows a safe response. Invalid request envelopes get InvalidRequest (-32600).
Unknown notifications are ignored; malformed known notifications are logged, never
answered with invented IDs. Duplicate initialize and post-shutdown requests are
rejected per lifecycle state. Bad framing, unsupported charset, truncated EOF and
oversize messages close the transport with stderr explanation when safe resync is
not possible. No manual parser/resynchronization guesses. Compiler faults are
reported as analysis-unavailable logs; they do not escape as an unregistered code.

## 7. Researched tooling, provenance and tradeoffs

Research was read-only, against installed packages and primary upstream sources.
No dependency was added and no compatibility test was run in this design task.

- **Installed platform:** Effect and platform-bun 4.0.0 (MIT); Bun runtime 1.3.13;
  @types/bun 1.4.2, @effect/vitest 4.0.0, @effect/tsgo 0.48.0. Root manifest
  `package.json:33-62` has the sole drizzle patch, no Effect patch/override.
  `node_modules/effect/package.json:2-11` identifies Effect-TS provenance.
- **Native watch:** `node_modules/effect/src/FileSystem.ts:361,1000-1079`:
  `watch(path, { recursive? }) -> Stream<WatchEvent, PlatformError>` with
  Create/Update/Remove and path. BunFileSystem delegates to shared NodeFileSystem
  (`node_modules/@effect/platform-bun/src/BunFileSystem.ts:10-20`). Installed shared
  source is `node_modules/.bun/@effect+platform-node-shared@4.0.0+4b74214ac2ee4e93/node_modules/@effect/platform-node-shared/src/NodeFileSystem.ts:590-649`.
  It closes the watcher in acquireRelease, but uses Stream.callback with no bounded
  buffer, discards null filenames, reports callback-relative paths and forks a stat
  effect per rename with runFork. `effect/src/Stream.ts:670-703` documents default
  unbounded callback buffering. A downstream bounded queue does not bound this
  upstream queue or own those stat fibers. Do not assert otherwise.
- **Watch recommendation:** retain the Effect FileSystem-facing seam and use its
  WatchBackend hook (`FileSystem.ts:1082-1127`) for a thin owned adapter where the
  installed default cannot meet admission/lifetime requirements. Evaluate installed
  Chokidar **5.0.0**, Paul Miller, MIT (`node_modules/.bun/chokidar@5.0.0/node_modules/chokidar/package.json:2-6,35-45`;
  `index.d.ts:10-31,73-86`) for normalized add/change/unlink, atomic save handling,
  ignored paths and explicit symlink policy. Its callbacks mark bounded dirty state;
  its asynchronous close must be awaited in finalization. Declare it directly in
  the eventual CLI package instead of relying on a docs-only transitive install.
  This is a proposed named watcher exception owned by CLI maintainers, retired when
  native watch offers bounded callback admission and owned rename work. Chokidar's
  internals are not proven bounded here; acceptance must observe the complete
  pipeline, not just the effx queue. If it fails, a bounded WatchBackend adapter to
  Bun's maintained watch API is the alternative, not a new watcher engine.
- **Bun API alternative:** installed guidance at
  `node_modules/.bun/bun-types@1.4.2/node_modules/bun-types/docs/guides/read-file/watch.mdx:7-58`
  uses Node-compatible `fs.watch(path, { recursive? }, callback)` and watcher.close;
  promises watch is an async iterator. Installed Node declarations are
  `node_modules/.bun/@types+node@26.6.4/node_modules/@types/node/fs.d.ts:354-362,3672-3723`.
  These declarations are not proof Bun supports every newest Node option. Bun is
  MIT ([upstream license](https://github.com/oven-sh/bun/blob/main/LICENSE.md));
  node type declarations are DefinitelyTyped/MIT. Direct fs use stays in a named
  registered adapter, never portable compiler code. Bare Bun `--watch` restarts
  the CLI process and cannot own an editor overlay; it is not this contract.
- **Native RPC does not supply LSP transport:** installed
  `node_modules/effect/src/rpc/RpcSerialization.ts:213-265` explicitly says JSON-RPC
  has no additional framing; ndJsonRpc uses newline framing. Neither is LSP
  Content-Length framing, nor an automatic implementation of LSP lifecycle and
  cancellation. No maintained native LSP connection was found in the inspected
  installed protocol sources; do not build a home-grown parser to bridge the gap.
- **Transport recommendation:** Microsoft
  [vscode-languageserver-node JSON-RPC README](https://github.com/microsoft/vscode-languageserver-node/blob/main/jsonrpc/README.md)
  uses `vscode-jsonrpc/node`, StreamMessageReader/Writer and createMessageConnection
  on stdio; [manifest](https://github.com/microsoft/vscode-languageserver-node/blob/main/jsonrpc/package.json)
  reports 9.0.3, MIT, Microsoft provenance. This is the upstream source version
  observed, not a claim of an installed or npm-published version. Pin a compatible
  released dependency during implementation and run the packed Bun stdio journey.
  A thin Effect adapter owns connection/disposal, decodes method payloads with
  Schema, bridges cancellation and limits transport admission. Library queue/size
  defaults must be researched at the chosen pin; do not infer boundedness from
  a maxParallelism knob alone. Full `vscode-languageserver` is the maintained
  alternative if its lifecycle helpers reduce code without importing editor
  semantics into the compiler. Do not copy the README's stdout console.log.
  Retire the foreign transport exception if installed Effect gains compatible
  framed LSP transport/lifecycle support. No upstream source code is copied here.
- **TS prior art:** the installed `@typescript/typescript6` wrapper is **6.0.2**,
  but its `@typescript/old` alias resolves the analysis API to **TypeScript 6.0.3**
  (observed import/version); root gate uses TypeScript 7.0.2. Both compiler packages
  are Microsoft/Apache-2.0. `node_modules/@typescript/typescript6/lib/typescript.d.ts:1-2`
  forwards to the alias; its manifest `:33-35` explains why wrapper version is not
  analysis version. Actual declarations:
  `node_modules/.bun/typescript@6.0.3/node_modules/typescript/lib/typescript.d.ts:7359-7362,9779-9788,9910-9914,10075-10113,11429-11431`.
  CompilerHost source reads or LanguageServiceHost getScriptVersion/getScriptSnapshot
  are overlay seams; Watch exposes getProgram/close. Microsoft's
  [Using the Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
  documents watch/builder programs and versioned ScriptSnapshots. Reuse the
  technique, not its emitting example or a separate typechecker. First recommend
  the existing createProgram path with a coherent memory host; retaining oldProgram
  or a language service is optional optimization after parity tests. TS-created
  watcher/timer lifetimes need the same scope adapter if adopted; don't layer an
  independently watching TS engine over the session's watches.

Installed Effect guidance consulted: complete `node_modules/effect/AGENTS.md`;
`ai-docs/src/01_effect/05_resources/{10_acquire-release,20_layer-side-effects}.ts`,
`01_effect/06_running/10_run-main.ts`; Stream, FiberHandle and FileSystem sources.
FiberHandle's scope-owned at-most-one contract is at `effect/src/FiberHandle.ts:1-9`;
runMain signal ownership is described at the running example `:22-30`.

Primary protocol authority is [LSP 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/),
not a blog or a generic JSON-RPC spec. Its
[raw base specification](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.17/specification.md)
contains Header/Content Part, request/response errors and includes feature sections;
[initialize source](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.17/general/initialize.md)
defines first-request ordering, processId and initialization options. Consult its
Position/Range, text synchronization, publishDiagnostics, configuration/watched-file,
shutdown/exit and cancellation sections when implementing (§6). UTF-16 positions
and UTF-8 body bytes are deliberately different contracts.

## 8. Falsifiers and definition of done

These are implementation acceptance gates, not checks claimed by contract approval.
Tests must use real compiled/packed CLI subprocesses and a maintained LSP client
connection for the boundary journeys. Deterministic unit tests supplement them;
mock-only green tests do not satisfy a filesystem or protocol requirement.

1. **Real watch repair:** in an isolated installed fixture, run `effx dev --project
tsconfig.json`. Await initial completion, edit a real declaration into an existing
   registered compiler error, await that code/severity/point, repair it and await a
   full zero-error cycle. SIGINT ends the process and releases watches; a subsequent
   file edit produces no output/work. Snapshot all files before/after: default dev
   creates no artifacts/caches/manifest, even with generators configured.
2. **Explicit generation:** run `dev --build` with custom output and emit/target
   flags. Successful edits match one-shot build bytes and manifest ownership; an
   error writes nothing new. Removing a declaration removes only previously owned
   obsolete files, preserving an unrelated sentinel. Own-output writes cause no
   further cycles. A second watch-build using a symlink alias of the same output
   set is refused before writes; competing one-shot build is refused too. The
   owner can restart after clean shutdown.
3. **Coverage:** exercise atomic-save rename, source rename/delete/new include,
   imported helper/schema edits, missing-import creation, extends/reference/include
   changes, package target/version metadata changes, dependency symlink retargeting,
   custom-output exclusion and a symlink loop. Observe correct replacement/clearing,
   unchanged logical identity and finite watch membership. Executable config/helper/
   plugin edits yield restart-required, clear stale diagnostics and perform no
   partial reimport; restart evaluates exactly once. Broken saved JSON then repaired
   JSON recovers without restarting the source watch session.
4. **Actual unsaved LSP journey:** maintained client spawns packed `effx lsp`,
   initializes, opens a clean on-disk declaration, then sends unsaved incremental
   edits producing the same error as a one-shot check of equivalent text in a
   separate fixture. Repair the overlay and receive `[]` for the latest version.
   Open/edit an imported dependency and observe changed diagnostics in its consumer.
   Include CRLF, an astral character before the occurrence, full replacement and
   multiple sequential range edits. Original disk bytes and tree membership remain
   unchanged throughout; no temp file, cache or generated artifacts appear.
5. **Stale/version guard:** controlled test hooks hold an old analysis after it has
   a snapshot; the actual client sends a newer valid version and repairs it. Releasing
   old completion must not publish or generate stale results after the newer edit
   was admitted. Send equal/older changes and verify state is unchanged, then a higher
   version with a gap. These invalid version probes are explicit robustness tests,
   not a fiction that a conforming client's ordered stream reorders notifications.
   Test out-of-order response IDs for concurrent allowed protocol requests through
   the real connection; don't invent a response to didChange. Close during an active
   analysis: receive clear, discard overlay, never republish that closed instance.
6. **Lifecycle/errors:** actual framed requests cover pre-initialize, duplicate
   initialize, unsupported method, malformed params, unknown notification, canceled
   request, malformed complete JSON, split frames/coalesced frames, UTF-8 byte length,
   invalid charset/framing, limits, EOF, shutdown→exit, exit without shutdown and
   client-process death. stdout is parseable framing only; logs are stderr. Verify
   releases once on normal/error/interruption paths and no surviving watches,
   callbacks, fibers, timers or processes. Slow-reader/burst tests prove finite
   queues/admission, coalesced latest diagnostics and no worker proliferation.
7. **Authority and registry parity:** a config execution sentinel is never touched
   without LSP launch authority. Trusted fixture evaluates one config, zero
   application modules and no writes; unsaved config never executes. Compare check,
   dev and editor diagnostics for built-ins, strictAccess promotion, skew policies,
   package-qualified extension warnings, related occurrences, duplicate entries
   and forged plugin diagnostics/EFFX0010. Open a real bundled catalogue link,
   including encoded full-code anchors; explain returns the matching entry offline,
   and explicit-config third-party explain still works. Unlocated faults/status must
   not masquerade as successful empty compiler output.
8. **Compatibility:** use existing users, rc.116, persistence and external-extension
   fixtures and the repository's identity/golden procedures. For unchanged sources,
   IR JSON, semanticHash, surface and generated bytes match baseline one-shot output.
   No IR version bump or transport/config/status metadata enters IR. Do not compare
   different authored handlers and infer identical full hashes.
9. **Landing evidence:** implementation updates existing command/extension docs and
   release changesets, records dependency/exception pins and limits, removes temporary
   probes, and passes focused frontend/compiler/CLI tests plus the ordered
   `bun run gate` on the final committed implementation tree. Maintain consumer-level
   deterministic tests using Effect clock/controlled admission for coalescing, not
   arbitrary sleeps or snapshots of an invented incremental architecture.

Failure of any numbered observable behavior falsifies completion. Contract approval
does not assert implementation acceptance; all numbered gates must be exercised on
the eventual final implementation commit.

## 9. Accepted operator defaults

| Named preference        | Recommendation                                                                                                                        | Actual tradeoff                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Watch write intent      | Check-only default; include explicit `dev --build`, never automatic build from config or LSP.                                         | Authors can opt into live generated artifacts; the writer/ownership gates add scope but remove surprise disk effects.                                   |
| Editor executable trust | Discovered config requires launcher `--trust-config`; explicit `--config` also grants authority; config/plugin edits require restart. | One editor launch setting and restart after executable edits, rather than arbitrary code execution on opening a workspace or cache-busting hot imports. |
| Editor diagnostic reach | Publish only open documents; unlocated project diagnostics are logs with codes/explain guidance.                                      | Predictable close/clear behavior and smaller publication state; closed-file Problems view is deliberately not provided.                                 |
| Project reach           | One explicitly selected project per server; one workspace root may supply defaults; no automatic multi-root discovery.                | Some monorepos run more than one server process, but project/config/overlay ownership is unambiguous.                                                   |

Transport library, finite admission limits and host caching are engineering choices,
not arbitrary operator knobs. Correctness, framing, authority enforcement, parity
and resource ownership are not optional preferences.

### Approval amendment — 2026-10-06

The operator wrote, verbatim: **"approve defaults"**. This approval applies to all
four defaults in this spec, not to the earlier approval of 0016 or any credential,
publication, deployment or landing authority:

1. `effx dev` MUST remain check-only by default and MUST include explicit `--build`
   as the only opt-in to normal generated writes; LSP MUST never write artifacts (§3).
2. LSP MUST require launch-time `--trust-config` for discovered executable config
   or explicit `--config` authority; saved executable config/plugin changes MUST
   require restart, not hot import (§3).
3. LSP MUST publish diagnostics only for open documents; unlocated project findings
   MUST be logged with code/severity and explain guidance (§4 and §6).
4. LSP MUST own one selected project per server and MUST NOT automatically infer
   multiple projects from workspace roots or document paths (§3).

This amendment freezes the contract; it does not claim implementation acceptance.

### Operator coverage amendment A — 2026-10-06

The operator wrote, verbatim: **"A"**. This approves the explicit conditional
executable-coverage proposal in
[`../research/0018-watch-editor-design.md` §7](../research/0018-watch-editor-design.md#7-proposed-contract-amendment--explicit-executable-coverage),
clarified at commit `ab45c48`. It does not approve unconditional full provenance,
credentials, publication, deployment or main landing. Original four defaults remain
binding. The director—not the operator—approved isolated component implementation
design before this amendment. Normative §§3–4 now incorporate this approved rule.

#### Additional acceptance — part of §8

10. Through actual packed dev/LSP journeys, exercise an ordinary static package
    symlink and a computed external alias. Retarget each while its old canonical
    target remains unchanged. Complete caller declarations MUST cause one
    RestartRequired status, diagnostic clearing and no further writes/analyses until
    a new authorized process. Also exercise successive link chains, missing
    intermediate creation, explicit external trees, executable exports/`#imports`
    candidate/metadata changes and visible traversal/permission/overlap limits.
    Unchanged declared inputs MUST permit multiple source/error/repair cycles and
    unsaved overlay generations without restarting or re-evaluating config. Test
    launch-relative/config-relative path union, pre-import launch observation and
    detected import-window changes. State the initial-import stability assumption
    for post-import config declarations. Documentation and client messages MUST
    state caller completeness; canonical cache files alone do not prove it. An
    omitted unobservable route is an explicit limitation, not silently claimed
    detected coverage. No global hook, sandbox, syntax restriction or hidden import.

### Operator Linux platform amendment — 2026-10-06

The operator wrote, verbatim: **"Linux"**. This selects the qualified native LSP
backend proposed in design §10 at commit `13e815e`, not portable certification,
credentials, publication or main landing. The four original defaults and coverage
amendment A, including additional §8 item 10, remain binding.

`effx lsp` is qualified for declared Linux-x64/glibc targets with standard
maintained-client socket, FIFO, regular-file and PTY stdin. The external Bun root
MUST exclusively own fd0; cooperative trusted config MUST neither consume stdin
nor bypass native stderr/framed-output reporting. Arbitrary trusted code remains
outside sandbox containment. Unusual devices, procfs and unsupported stdin forms
MUST receive explicit classified limits/failure, not silent supported assumptions.
Other CLI commands and `effx dev` retain their existing runtime/platform behavior.

The trusted fixed/audited POSIX readiness C source (prototype 511 bytes) MUST be
compiled at build time against declared target headers/toolchain and loaded through public Bun
1.3.13 dlopen. No runtime experimental cc/compiler/header discovery, guessed ABI
or constants, shared descriptor-flag mutation, private handles, per-read helper
process, fake backend or stub is permitted. After actual readiness, raw reads
MUST use at most 65,536 bytes, under the explicit exclusive-reader premise.
Accepted kernel bytes cannot be retracted; Closed admits no new native calls.
The prototype byte count is provenance, not a normative source-length gate.
Actual source/artifact hashes MUST be derived; semantic shim changes require
actual native-capability and release verification. Audited prototype evidence
remains preserved; reviewed comments/helper changes are not blocked by a size pin.

Shipping MUST declare artifact-derived ELF target ABI, minimum glibc and needed
libraries with actual compatibility evidence. The local glibc 2.44 probe does not
establish a lower minimum or Ubuntu 24 compatibility. Build determinism, trusted
source provenance, symbol signatures/data bounds and manifest byte integrity MUST
be established. The packaged asset MUST contain no raw Nix-store path, stale Nix
RPATH or runtime build dependency. Unsupported OS/architecture/libc MUST fail
explicitly at startup before unsafe IO. Native C process authority and lack of
memory-safety containment MUST be documented.

The single common scripts/effx.ts root, portable main.ts/caller/build/pack cutover
is owned first by approved 0019. 0018 MAY implement independent Linux capability,
asset/build helper and tests, but MUST NOT duplicate the common root or broad
caller migration. Adoption/rebase/injection follows director integration order.
Own Node imports/types/globals remain forbidden in packages; main.ts remains the
only effect/cli binding. No obsolete executable shim survives the final cutover.

The complete §8 and amendment-A journeys remain required. Additional native
acceptance MUST exercise actual packed maintained Node-client socket plus FIFO,
file and PTY; unsupported startup; integrity/ABI failures; exclusive fd ownership;
library close and root shutdown; writer two-second bound; EOF/SIGINT/client death
and PID probe; no calls after Closed; and effx-owned stdout purity before/after
initialize, cooperative config logging/fault and usage/help/error paths. No global
console monkeypatch or sandbox is permitted. Artifact/provenance evidence MUST
use closed safe projections and never serialize runtime environment, raw args,
config/credential/private payloads or raw causes. Final complete committed-clone
verification and director review/order precede any feature acceptance or landing.
