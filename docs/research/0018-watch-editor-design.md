# 0018 — Watch/editor implementation design for review

Status: **operator defaults and amendment A approved; full implementation active**, 2026-10-06.
Frozen contract: [`../specs/0018-watch-editor.md`](../specs/0018-watch-editor.md),
commit `9ac1bff`; preserved draft parent `d37f77e`; baseline main `3d66eda`.
The operator approved the four product policies with **"approve defaults"** on 2026-10-06.
The director approved the session, overlay, native polling and transport plan
in principle, subject to real boundary tests and exception records. The operator
separately approved amendment A on 2026-10-06. No landing authority is granted.

**Director provenance correction — 2026-10-06.** The current **"approve defaults"**
and **"A"** approvals belong to the authoritative conversation date 2026-10-06,
not the 2026-10-05 dates supplied in those messages. Original commits/history and
verbatim quotes remain preserved. Research and execution dates below remain
observed machine-clock facts; they do not imply earlier approval. This correction
changes no accepted policy or implementation authority.

The approved component dependencies were installed with ordinary `bun install`.
`vscode-jsonrpc` resolves to 9.0.3. Published and installed source establish API
behavior, not implementation acceptance. No heavy checks or main changes occurred.

## Review summary

1. Reuse one selected-project session, the existing AOT frontend/compiler/registry,
   and a snapshot-aware TS host. No independent editor analyzer or temp saves.
2. Use a small native sequential filesystem observation loop, not the installed
   push-watch producer followed by a supposedly corrective downstream queue.
3. Use published Microsoft `vscode-jsonrpc` **9.0.3** framing/decoder/connection
   primitives behind **one** bounded Effect-facing stdio module. No copied parser.
4. Extract normal build emission to consume the admitted compiler result. Both
   one-shot build and `dev --build` share canonical output/manifest custody.
5. **An executable-import provenance gap remains (§5).** Cache enumeration is not
   a complete logical import ledger; a global Bun plugin does not fix it. Do not
   approve this document as proof that arbitrary computed executable imports are
   fully covered. The director rejected restart before every generation. Section 7
   proposes explicit caller coverage; it is not a frozen-contract amendment yet.

## 1. Session, overlay and publication authority

Proposed portable session logic lives in `packages/cli/src/watch.ts` and
`packages/cli/src/lsp.ts`; foreign stdio lives only in
`packages/cli/src/lsp-transport.ts`. These files do not exist yet.

- Reuse `resolveProject` precedence/discovery (`packages/cli/src/commands.ts:194-249`).
  LSP performs its admitted-project trust check **before** `loadConfig` invokes
  import (`commands.ts:126-149`). Explicit `--config` or launch `--trust-config`
  grants executable authority; editor messages cannot grant it.
- One scope owns project/config epoch, increasing project revision, current text
  and client version per open instance, dependency coverage and the active analysis.
- Frontend changes remain inside `SourceFrontend` / TS host seams
  (`packages/compiler/src/SourceFrontend.ts:18-39`;
  `packages/frontend-ts/src/project.ts:120-171,175-205,252-272`). An immutable overlay
  provides file reads, existence and included-new-document membership before disk;
  config parsing and source reads use the same snapshot authority.
- Existing `compile` remains the semantic path, including validated extension
  registry and in-memory generation (`packages/compiler/src/pipeline.ts:339-380`).
  TS objects and session metadata never enter IR. Located diagnostics remain the
  existing one-based points (`packages/frontend-ts/src/ts.ts:56-67`;
  `packages/diagnostics/src/model.ts:8-11`). LSP converts these to zero-based UTF-16
  zero-length ranges without inventing spans.
- Apply incremental edits in arrival order **before** analysis coalescing. One active
  analysis plus one dirty/reconcile token; no per-edit fiber. Capture epoch/revision
  and document versions. Superseding input invalidates publication immediately;
  interrupt where supported, otherwise discard old results. Synchronous TS work
  (`packages/frontend-ts/src/ts.ts:11-21`) is not preemptible.
- Close/fault/restart clears are complete replacement publications. Only open URIs
  receive diagnostics. Logs for unlocated findings preserve codes/severity/explain
  guidance, rather than assigning a made-up active-document location.

## 2. Native filesystem observation

### Operations, interval and owner

One project-specific scoped fiber performs a **sequential** pass and then
`Effect.sleep("250 millis")`. The interval is relative to pass completion, not a
250 ms latency promise. Effect's Clock owns the delay; no `setInterval`, native
watch callback, detached work or generic poll/watch library.

Installed authority (paths relative to the worktree):

| Operation | Installed source |
| --- | --- |
| `FileSystem.readDirectory(path, { recursive: false }) -> Effect<Array<string>, PlatformError>` | `node_modules/effect/src/FileSystem.ts:237-242` |
| `readFile(path) -> Effect<Uint8Array, PlatformError>` | `FileSystem.ts:246-248` |
| `readFileString`, `readLink`, `realPath` | `FileSystem.ts:252-267` |
| `stat(path)` / `exists(path)` | `FileSystem.ts:304-306`; service implementation supplies existence from stat |
| SHA-256 through native Crypto | Established reuse: `packages/ir/src/canonical.ts:43-48`, `crypto.digest("SHA-256", bytes)` |
| Scoped background owner / native clock delay | `node_modules/effect/ai-docs/src/01_effect/05_resources/20_layer-side-effects.ts:11-22`; `01_effect/06_running/10_run-main.ts:10-30` |
| Native polling composition prior art | `node_modules/effect/ai-docs/src/03_stream/10_creating-streams.ts:22-30`, `Stream.fromEffectSchedule` / `Schedule.spaced` |

### Coverage and fingerprints

Instrument the existing TS6 `ParseConfigHost` / `CompilerHost` reads and resolution
host probes, rather than replace TS's include/exclude or module-resolution semantics.
Public host signatures are in
`node_modules/.bun/typescript@6.0.3/node_modules/typescript/lib/typescript.d.ts:5986-6002,7359-7388,9267,9340`.
The analysis wrapper `@typescript/typescript6` is 6.0.2, but its installed alias
actually resolves to TS **6.0.3** (observed import/version); the gate's TS7 is separate.

Record selected/extended/referenced configs; source/declaration read paths; package
metadata actually consulted; include/root membership enumeration directories;
`fileExists` / `directoryExists` failure probes and their nearest existing parents;
relevant lockfiles; logical links and resolved physical dependencies. Re-run the
same TS root enumeration when membership/config inputs change. Do not use an
internal `failedLookupLocations` cast: public `ResolvedModuleWithFailedLookupLocations`
only exposes `resolvedModule` (`typescript.d.ts:7346-7348`), so failures must be
recorded at the host callbacks.

Fingerprint each covered input by tagged existence/kind, physical identity/link
destination, sorted directory membership and file content digest. Content checks
cannot depend solely on size/mtime equality. Directory fingerprints include relevant
entry kinds/link destinations so same-name symlink retargeting is not mistaken for
unchanged membership. Retain only current coverage/fingerprints and the active
snapshot, not event history.

Traversal is limited to selected include/membership directories and explicit
resolution/dependency parents. Do not recursively enumerate all `node_modules`:
observe exact loaded declaration/source/metadata files and relevant parent membership.
Use canonical visited identities; do not follow arbitrary recursive symlink trees.
External dependency links are followed only through actual known dependency edges.
Outputs, manifest/IR/surface, build-info/cache and VCS exclusions derive from resolved
policy, including custom output. Overlap with explicitly selected source/config is
an actionable invalid selection, not silently ignored input.

Atomic save/replacement changes identity/content; delete changes existence; rename
changes the old and new parent membership; creating a missing import changes a
failed-probe parent; new included declarations change root enumeration. Reconcile
coverage around initial observation and after each admitted analysis. Open overlay
text remains authoritative even when disk deletes its path; old-URI clearing follows
the frozen close/deletion rule.

Shutdown interrupts and joins the single observation fiber before dropping coverage.
There are no push-watch producer callbacks, per-event pending stat jobs or foreign
watcher timers to outlive that owner. Input cardinality/size limits must be finite,
documented and tested; native directory reads themselves return whole arrays, so
this is a bound on admitted retained coverage and concurrent work, not a claim that
an arbitrary enormous directory listing has constant-memory IO.

### Exact gap in alternatives, not a global rejection

Effect/platform-bun **4.0.0**, MIT, is installed. BunFileSystem delegates to shared
NodeFileSystem (`node_modules/@effect/platform-bun/src/BunFileSystem.ts:10-20`).
The exact installed shared path is
`node_modules/.bun/@effect+platform-node-shared@4.0.0+4b74214ac2ee4e93/node_modules/@effect/platform-node-shared/src/NodeFileSystem.ts`.
Its `:590-649` uses an unbounded-default `Stream.callback`, forks stat per rename,
discards absent filenames and closes the native watcher through acquireRelease.
Default callback buffering is documented in `effect/src/Stream.ts:670-703`.

Installed Chokidar **5.0.0** (Paul Miller, MIT) at
`node_modules/.bun/chokidar@5.0.0/node_modules/chokidar/` performs overlapping async
stat work before consumer callbacks (`handler.js:351-391`); `index.js:413-439` closes
handles/destroys streams/clears maps but does not establish completion of all timers
or in-flight stat/scan work. A downstream dirty bit cannot bound that upstream work.

Pinned Bun **1.3.13** source
[`node_fs_watcher.zig:114-131`](https://github.com/oven-sh/bun/blob/bun-v1.3.13/src/bun.js/node/node_fs_watcher.zig#L114-L131)
allocates/enqueues tasks per flushed batch. Eight-entry batches are not total queue
capacity. These tools are useful for other contracts; the examined versions do not
supply this contract's source-level admission/quiescent ownership guarantee.
Polling trades background reads and observation delay for simple owned admission;
no speed/memory claim is made without measurement.

## 3. One maintained JSON-RPC stdio adapter

### Published artifact and exact public signatures

[npm metadata](https://registry.npmjs.org/vscode-jsonrpc/9.0.3) confirms published
`vscode-jsonrpc` 9.0.3, Microsoft, MIT, with tarball and integrity. This is not an
inference from a GitHub main manifest. `vscode-languageserver-protocol` 3.18.4 is
also published and depends exactly on 9.0.3; the server still advertises only the
frozen LSP 3.17 subset. No dependency was installed during this investigation.

Exact versioned published source:

- [`common/api.d.ts:8-14`](https://unpkg.com/vscode-jsonrpc@9.0.3/lib/common/api.d.ts)
  publicly exports `RAL`, `AbstractMessageBuffer`, reader/writer abstractions,
  `MessageStrategy`, `ConnectionStrategy` and `createMessageConnection`.
- [`common/ral.d.ts:3-27,45-53`](https://unpkg.com/vscode-jsonrpc@9.0.3/lib/common/ral.d.ts):
  `RAL().messageBuffer.create("utf-8")` returns `MessageBuffer` with
  `append(Uint8Array | string)`,
  `tryReadHeaders(lowerCaseKeys?: boolean): Map<string,string> | undefined`,
  `tryReadBody(length: number): Uint8Array | undefined`.
- [`common/messageBuffer.d.ts`](https://unpkg.com/vscode-jsonrpc@9.0.3/lib/common/messageBuffer.d.ts)
  exposes `AbstractMessageBuffer.numberOfBytes`; the generic RAL buffer type does
  not. The factory returns an actual subclass
  ([`node/ril.js:9-38`](https://unpkg.com/vscode-jsonrpc@9.0.3/lib/node/ril.js)).
  Narrow with tested `instanceof AbstractMessageBuffer`; do not cast a hidden field.
- [`common/encoding.d.ts`](https://unpkg.com/vscode-jsonrpc@9.0.3/lib/common/encoding.d.ts):
  maintained `applicationJson.decoder.decode(buffer, { charset: "utf-8" })`
  returns `Promise<Message>`. Treat its result as untrusted and Schema-decode the
  envelope/method payload before domain work. Maintained encoder returns bytes.
- [`common/messageReader.d.ts:9-11,19-40`](https://unpkg.com/vscode-jsonrpc@9.0.3/lib/common/messageReader.d.ts):
  `DataCallback(Message): void`; `MessageReader.listen(callback): Disposable`;
  `dispose(): void` does **not** close underlying transport.
- [`common/connection.d.ts:201-205,289-305`](https://unpkg.com/vscode-jsonrpc@9.0.3/lib/common/connection.d.ts):
  `MessageStrategy.handleMessage(message,next): void | Promise<void>`;
  `ConnectionStrategy.cancelUndispatched(message,next): ResponseMessage | undefined`.
- [`common/messageWriter.d.ts`](https://unpkg.com/vscode-jsonrpc@9.0.3/lib/common/messageWriter.d.ts):
  `MessageWriter.write(Message): Promise<void>`, `end(): void`, `dispose(): void`;
  `WriteableStreamMessageWriter(RAL.WritableStream, options?)` owns outgoing framing.

### Framing, byte limits and decoding

`AbstractMessageBuffer` owns header delimiter recognition, ASCII header parsing
and body extraction. The adapter controls feeding and validates **extracted**
Content-Length/charset values. It does not search for delimiters, split headers or
copy an upstream parser. Strict decimal/nonnegative/safe length validation avoids
stock reader `parseInt` suffix acceptance.

Proposed finite defaults, to be documented and behavior-tested:

| Admission surface | Bound / behavior |
| --- | --- |
| Partial/header bytes | 8 KiB; fail transport when budget is exhausted without valid complete header |
| Declared body | 8 MiB; reject before feeding/allocating that body if larger |
| Source read | At most 64 KiB; feed only remaining header/body budget |
| Decoder | One active body; no upstream serial-decoder waiting array |
| Queued **plus executing** inbound messages | 64 messages and 8 MiB aggregate encoded-body credits; reserve before connection callback |
| Outstanding inbound requests | 32; explicitly refuse excess requests when safe, never build unlimited error replies |
| Mandatory outbound queue | 32 messages / 8 MiB aggregate; one active stock writer call |

Native input stays paused/non-flowing and is pulled on demand; no unrestricted
stock reader `onData` subscription. `RAL.ReadableStream` has only registration
methods, no pause/resume (`ral.d.ts:29-34`), so native stdio demand belongs to this
one boundary module. At ordinary saturation stop pulling. Unsafe notification/byte
overflow closes with stderr explanation rather than dropping range edits. While
synchronous TS blocks JS, no per-message fibers/callback continuations are created;
finite native readable/pipe buffering backpressures the client. Do not describe OS
buffering as unlimited or TS as interruptible. After TS returns, pending input is
admitted before its obsolete completion may publish.

Stock reader does not provide these bounds: `messageReader.js:178-220` appends
whole chunks and queues decodes; `messageBuffer.js:23-27` has no cap;
`semaphore.js:24-28` retains unbounded waiting calls. `maxParallelism` only acts
when dequeuing from connection's unbounded queue (`connection.js:301-312,369-431`).
An Effect queue inside a normal handler would be too late.

Normal credit release wraps MessageStrategy invocation/await in finally. Request
completion includes its response write. Undispatched cancellation bypasses that
strategy (`connection.js:449-480`), so the same module correlates writer completion
with its request credit and supplies `cancelUndispatched`. Running-cancel control
credits release at ingress. Filter unknown cancellation IDs; do not grow the
library's remembered-ID set. Terminal disposal releases remaining credits once.
Unexpected strategy rejection must terminate the owner: `connection.js:420-426`
otherwise leaves its inFlight slot unreleased. No generic credit framework.

Complete framed JSON parse failure receives ParseError/id:null when safely writable;
invalid envelopes receive InvalidRequest; params/unknown methods/lifecycle follow
frozen §6. Bad framing, unsupported charset, oversize or truncated EOF is terminal
when safe resynchronization is unavailable. Unknown notifications are ignored;
malformed known ones are logged without invented response IDs. The maintained
header Map collapses duplicate keys (last wins); there is no claim of duplicate
header detection by a second parser. Logger/trace callbacks report method/ID/status,
not source text, raw params or credentials; stdout contains only framed bytes.

## 4. Writer, disk custody and shutdown

The bounded writer facade calls stock `WriteableStreamMessageWriter` only serially.
Use the maintained encoder to obtain/limit bytes before admission and reuse those
bytes for that stock call through its encoder option; do not encode twice. Latest
unsent diagnostic replacement per open URI is session publication state, bounded
by document/byte limits, not unbounded send promises.

Stock framing is exact-version `messageWriter.js:118-143`: encoded byteLength
becomes Content-Length, then header write is awaited before body write.
`node/ril.js:79-95` resolves native writes from the write callback. It does **not**
implement an explicit drain listener. `end()` and `dispose()` are not awaited-close
APIs. Our owned `RAL.WritableStream` facade retains listener disposables, tracks
completion and guards **both** header and body writes against the closed owner.

`shutdown` stops ordinary admission/analysis/publication, joins the observer and
handlers, sends/awaits its required null response, then awaits exit/EOF. EOF,
SIGINT/SIGTERM and transport failure move the owner to Closing, invalidate future
publication and reject queued writes. An already-started frame gets at most a
native-clock **2-second** completion allowance; blocked/broken output closes the
owned transport and rejects tracked IO, rather than hanging finalizers. Observe
native callback/finish or close before releasing listeners. Already accepted OS
bytes cannot be retracted; no new write call may occur after Closed.

Foreign decoder/write promises do not accept AbortSignal. Interrupting an Effect
wait does not cancel them. Bound each to one active operation, close its native
resource where possible and guard late settlement: it cannot emit the next body,
publish, mutate session state or trigger an unhandled rejection. Request cancellation
returns -32800 through the still-open bounded writer, not an abandoned response.
Process root uses BunRuntime/runMain; EOF/client death/signals ultimately close the
root. `connection.dispose()` alone is insufficient resource cleanup.

For disk writes, extract normal `build` emission to consume the **same admitted**
CompileResult, not recompile after revision validation. Existing ownership guard is
`packages/cli/src/commands.ts:282-384`, especially `:308-337`. One-shot build and
watch-build acquire the same canonical output/manifest-set custody, including
symlink aliases; competing writers fail before artifact writes. Only `dev --build`
acquires that disk resource. Admitted batches serialize to completion/failure; new
edits invalidate not-yet-admitted batches. Check-only/LSP create no locks or output.

## 5. Executable import provenance: established limitation and restart rule

### What is observable without executing config again

Bun 1.3.13 **does** expose evaluated ESM as well as CommonJS through
`Object.keys(require.cache)`: pinned
[`CommonJS.ts:392-412`](https://github.com/oven-sh/bun/blob/bun-v1.3.13/src/js/builtins/CommonJS.ts#L392-L412)
iterates require-map keys plus evaluated Loader.registry keys. The installed
`bun-types@1.4.2/globals.d.ts:1392-1396` declares `require: NodeJS.Require`.
Only enumerate keys; do not inspect exports or delete cache entries. A monotonic
inventory of all loaded file-backed keys conservatively covers physical helper/
plugin files, preloaded files and later successful dynamic imports without a
loader callback. Poll individual keys and known resolution inputs, not all packages.

**This is not a complete executable replacement graph.** Canonical keys do not
retain importer, evaluated specifier, original logical alias, failed lookup or
resolution read-set. For example, config computes `/other/alias` and imports it;
the symlink points at `/outside/old.mjs`. Retargeting `/other/alias` can leave
`/outside/old.mjs` and its parent unchanged. Watching the physical key misses it.
Bun replaces paths with realpaths in pinned
[`resolver.zig:1014-1025`](https://github.com/oven-sh/bun/blob/bun-v1.3.13/src/resolver/resolver.zig#L1014-L1025).
Static source scanning cannot in general recover an arbitrary evaluated string.

### Why a global resolver hook is not proposed

Returning undefined from passive onResolve falls through to native resolution
([`BunPlugin.cpp:833-871`](https://github.com/oven-sh/bun/blob/bun-v1.3.13/src/bun.js/bindings/BunPlugin.cpp#L833-L871)).
That does not make it a complete observer. Runtime eligibility precedes every filter:
[`VirtualMachine.zig:1828-1840`](https://github.com/oven-sh/bun/blob/bun-v1.3.13/src/bun.js/VirtualMachine.zig#L1828-L1840)
uses
[`transpiler.zig:73-83`](https://github.com/oven-sh/bun/blob/bun-v1.3.13/src/transpiler.zig#L73-L83).
Bare package names, extensionless relative names and `#imports` can bypass /.*/
entirely. Later onLoad/cache inventory cannot reconstruct that logical route.
The public plugin API has global `clearAll`, not individual scoped unsubscribe
(`node_modules/.bun/bun-types@1.4.2/node_modules/bun-types/bun.d.ts:6389-6400`).
Do not install this hook, clear other plugins, substitute a resolver or claim a
sandbox. Process ownership could bound a global callback's lifetime, but cannot
repair the missing observation capability.

The documented Node loader-hook alternative is unavailable in the pinned runtime.
[`NodeModuleModule.cpp:878-881,904-928`](https://github.com/oven-sh/bun/blob/bun-v1.3.13/src/bun.js/modules/NodeModuleModule.cpp#L878-L928)
makes `module.register` a literal no-op and exports no `registerHooks` entry.
Installed Bun compatibility guidance corroborates this at
`node_modules/.bun/bun-types@1.4.2/node_modules/bun-types/docs/runtime/nodejs-compat.mdx:122-124`.
Newer Node declarations cannot establish those hooks in Bun 1.3.13. No alternative
loader framework, cache eviction or runtime replacement is proposed.

### Restart policy and rejected fallback — 2026-10-05

Known executable replacement still requires RestartRequired, diagnostic clearing
and a fresh authorized process. Config/plugin imports never reload invisibly.

The director rejected the proposed unobservable-epoch fallback that required
restart before every generation. It makes dev unusable and will not be implemented.
Cache-only fingerprints cannot detect every external computed symlink route.
Section 7 proposes one explicit caller-coverage alternative for operator approval.
The frozen contract remains unchanged until that approval.

## 6. Exception records and retirement

The component records below are registered with root `AGENTS.md`. They remain open
until their named tests and the final gate pass. Config coverage remains unresolved.

| Record | Scope, evidence and retirement |
| --- | --- |
| `EX-0018-stdio` | CLI maintainers; only `lsp-transport.ts`; Effect/platform-bun4.0.0, Bun1.3.13, published vscode-jsonrpc9.0.3/MIT. Native Stdio/Stream provide IO and RpcSerialization unframed/newline JSON-RPC (`node_modules/effect/src/rpc/RpcSerialization.ts:213-265`), not maintained LSP framing. Record finite limits, noncancellable Promise behavior, exact artifact integrity and real framing/cleanup tests. Retire when installed native Effect supplies compatible framed LSP with these ownership/admission semantics; reopen on dependency upgrades. |
| `EX-0018-watch-policy` | CLI observation loop; native FS+Clock composition deliberately replaces installed push-watch policy for this contract. Exact producer gaps are §2, not a global ban on Bun/Chokidar. Retire when native watch offers bounded/coalesced producer admission and owned quiescent close; compare parity/cleanup before changing. |
| Executable observation | **Not approved/resolved.** The inspected Bun cache/plugin paths do not provide full logical provenance. An exception cannot turn a missing guarantee into a fulfilled contract; resolve with maintained capability or an explicit contract amendment first. |

### Registered component records — 2026-10-05

**EX-0030 — maintained LSP stdio boundary (open).**

- Owner: repository root, `AGENTS.md`; implementation directory `packages/cli`.
- Rules: FX002 native-first, FX003 runtime boundary, FX004 decoding, FX006 ownership,
  FX009 capacity, FX012 exception lifecycle. No blanket lint suppression.
- Scope: `packages/cli/src/lsp-transport.ts`; its owned real-client test and
  `packages/cli/test/lsp-transport-peer.ts` process root.
- Reason / missing capability: installed Effect has no maintained LSP Content-Length
  parser and connection lifecycle with this contract. Raw Stdio is not that protocol.
- Native alternatives: Stdio/Stream provide bytes; RpcSerialization JSON-RPC has no
  framing, and ndJsonRpc has newline framing. Neither replaces LSP framing.
- Examined versions: effect/platform-bun/vitest 4.0.0; effect-tsgo 0.48.0; Bun 1.3.13;
  TypeScript analysis 6.0.3; published and installed vscode-jsonrpc 9.0.3 (MIT).
- Maintained 9.0.3 `connection.js:352-356` stringifies queued request IDs, so numeric
  `1` and string `"1"` collide there despite being distinct protocol identities.
  The thin adapter retains the original typed request in existing admission
  credits and uses injective internal IDs only at that connection boundary. Wire
  replies and domain handlers retain original identities; no second decoder or
  request registry is authorized. Typed-ID and cancellation regressions are required.
  Retire this translation when the maintained queue preserves typed identities;
  a dependency upgrade reopens this ABI review.
- Verification: `packages/cli/test/lsp-transport.test.ts` will exercise real maintained
  client framing, admission, invalid messages, cancellation, EOF and shutdown.
  Frozen §8 requires packed CLI tests and the final full gate. None passed yet.
- Retirement: installed Effect supplies compatible maintained framed LSP with
  source-level admission and scoped cleanup. Dependency upgrades reopen the record.

**EX-0031 — native sequential observation policy (open).**

- Owner: repository root, `AGENTS.md`; implementation directory `packages/cli`.
- Rules: FX002 native-first, FX006 ownership, FX009 capacity, FX012 lifecycle.
- Scope: `packages/cli/src/watch-files.ts` and `packages/cli/test/watch-files.test.ts`.
- Reason: installed push-watch producers do not establish this contract's bounds
  and quiescent close. A downstream bounded queue cannot repair that upstream work.
- Native alternative: FileSystem.watch/platform-bun 4.0.0, with §2 source evidence.
  Native FileSystem, Crypto and Effect Clock composition remain the implementation.
- Examined alternatives: Bun 1.3.13 watch; Chokidar 5.0.0; versions and gaps in §2.
- Verification: behavior tests will cover declared files/roots, missing creation,
  rename/deletion, symlink routes, bounded pending work and owned stop. Final packed
  watch tests and the full gate remain required. No acceptance result is claimed.
- Retirement: native watch provides bounded/coalesced producer admission and owned
  quiescent close. Run parity/cleanup tests before removing the observation policy.

**EX-0032 — native TypeScript virtual membership matcher (open).**

- Owner: repository root, `AGENTS.md`; frontend boundary directory `packages/frontend-ts`.
- Rules: FX001 version authority, FX002 native-first, FX004 checked boundary, FX012 lifecycle.
- Scope: runtime ABI guard and local function assertion only in `src/ts.ts`.
- Reason: public ParseConfigHost.readDirectory requires already-filtered filenames.
  It cannot use disk-only sys.readDirectory to discover an unsaved new file.
  A copied glob implementation would create different include/exclude semantics.
- Native alternative: reuse the exact matcher that installed TS sys.readDirectory
  uses. Its runtime export exists, but its public declarations omit the ABI.
- Evidence: installed `node_modules/.bun/typescript@6.0.3/node_modules/typescript/lib/typescript.js:8611-8612,22513-22536`.
- Examined versions: analysis TypeScript 6.0.3, wrapper6.0.2, Effect4.0.0, Bun1.3.13.
- Boundary: verify that the runtime property is a function; assert only its exact
  source-grounded call signature. Guard/validate returned filename data as appropriate.
  This is not authority to cast untrusted project data or TypeScript objects into IR.
- Verification: `packages/frontend-ts/test/watch-overlay.test.ts` will compare actual
  overlay include/exclude/new-file/dependency behavior and one-shot fixture identity.
  No test result is claimed before integration checks.
- Retirement: TypeScript exposes a typed public virtual-directory matching ABI,
  or a public host path provides identical membership without this assertion.

**EX-0033 — read-only evaluated physical module inventory (open).**

- Owner: repository root, `AGENTS.md`; `packages/cli`.
- Scope: `packages/cli/src/config-runtime.ts` only.
- Rules: FX001 version authority, FX002 native-first, FX004 checked boundary, FX012 lifecycle.
- Missing capability: installed Effect has no evaluated module-cache inventory.
- Native alternative: TS host probes cover compiler inputs, not evaluated Bun imports.
- ABI: node-compatible createRequire/cache keys on Bun1.3.13. Enumerate keys only;
  never read exports, evict keys, import application modules or install a hook.
- Examined: Bun1.3.13, bun-types1.4.2, Effect/platform-bun4.0.0, tsgo0.48.0.
- Evidence: pinned CommonJS.ts392-412 and the limitations in §5.
- Verification: actual loaded CJS/ESM/config helper files, no re-evaluation and
  logical declared-alias restart tests; no acceptance result claimed yet.
- Retirement: maintained native evaluated-module inventory; upgrades reopen review.
  This record never claims complete logical provenance or a sandbox.

**EX-0023 — extended installed watch/editor consumer scope (open).**

- Owner: repository root, `AGENTS.md`; `packages/cli/test/packed-watch-peer.ts`.
- The permanent `scripts/watch-editor-smoke.ts` composition root provides Bun services.
- Native alternative: installed Effect4.0.0 `effect/process` owns child process groups,
  stdin, output streams, interruption and joining; no second subprocess framework.
- Scope: only the installed-consumer process adapter; product/session code imports no process API.
- Output admission is 128 lines with backpressure; shutdown receipts precede consumer-file release.
- Rules: FX001 version authority, FX002 native-first and FX012 scoped resource ownership.
- Verification: packed EOF/SIGINT, silence after shutdown and client-exit journeys are specified
  by the permanent consumer; no execution or acceptance result is claimed here.
- Retirement: remove the unstable directive when the maintained process API becomes stable;
  version upgrades reopen the adapter review. Existing persistence EX-0023 ownership is unchanged.

No implementation claim, alternate protocol framework or generic poll/credit engine
is hidden in these records. Real packed CLI and maintained-client acceptance,
unchanged IR/hash/surface/generated-byte proof and final committed full gate remain
all required by frozen §8. Final cleanup follows verified landing only: preserve
refs/evidence/tarballs, release owned processes, remove owned disposable clones,
then only inactive clean merged worktrees with ownership release. Current active,
unmerged, dirty, unknown-owner and separately owned 0016 trees are excluded.

## 7. Proposed contract amendment — explicit executable coverage

**Operator-approved A on 2026-10-06; incorporated into frozen spec commit74c4fe1.**

The director approved isolated portable components with explicit dependency tests.
The operator approved the four defaults and then **"A"**. The authoritative frozen
amendment is commit74c4fe1; config coverage integration now follows that contract.

### Caller data and when it exists

Add optional data to the existing `EffxConfig` / `defineConfig` interface and
the existing `ConfigFields` decoder, not a plugin mechanism:

```ts
executableCoverage?: {
  files?: ReadonlyArray<string>;
  directories?: ReadonlyArray<{ path: string; recursive: boolean }>;
};
```

Equivalent repeatable launcher inputs are `--exec-file <path>` and
`--exec-dir <path>`; a launch directory covers ordinary descendants recursively.
Launch paths resolve from startup cwd. Config paths resolve beside the selected
config. Merge by union and retain logical spellings. Existing selection, precedence,
config syntax and extension behavior do not change. Editor messages cannot supply
new executable authority. This data stays outside ProjectConfig/IR/hash/output.

Before the one trusted import, observe the selected logical config path and launch
declarations. After existing config decoding, add its coverage declarations and
known loaded physical executable files. Reconcile before initial publication and
refresh known files after admitted analyses; never evaluate config again.

Config-returned declarations are unavailable before import. They establish a
post-import baseline, not proof of the exact bytes/routes used during import.
The initial-import guarantee therefore assumes stable inputs during that window.
Complete pre-import launcher coverage permits an import-window comparison, but
neither option promises an atomic filesystem snapshot. State this assumption.

### Proposed normative amendment to 0018 §§3–4

1. Executable observation MUST use the union of caller-declared coverage, known
   physical executable files and observed TS/config/resolution inputs. The caller
   MUST completely declare ALL otherwise-unobservable logical routes and
   resolution-sensitive inputs. This includes static bare-package imports through
   symlinks when known logical coverage or TS-host observations omit their route.
   Computed and external imports are examples, not the scope limit. The guarantee
   is conditional on complete caller data. effx cannot certify its completeness;
   omitted routes can change without detection. Canonical cache files alone
   establish no automatic logical-route guarantee.
2. Exact file declarations MUST preserve logical paths and observe each symlink
   component, raw destination, successive target chain, target identity/content
   and relevant parent membership. Missing paths retain their unresolved suffix
   and nearest existing parent so directory/file creation becomes observable.
3. Explicit directory declarations authorize observation of those trees. Recursive
   traversal covers ordinary descendants within finite documented path/depth/byte
   limits. Child symlink trees require a declared route or known dependency edge;
   traversal MUST NOT follow arbitrary links outside those inputs. Deduplicate
   physical walks without discarding logical aliases. Cycles, inaccessible inputs,
   limits and owned-output overlaps MUST fail visibly, never truncate silently.
4. For package exports, `#imports`, extensionless imports and missing candidates,
   declarations MUST include otherwise-unobserved package.json/tsconfig/lockfiles
   and candidate-directory/missing-parent inputs. A loaded physical file alone
   does not cover a changed selection or new higher-priority candidate. An explicit
   directory can conservatively cover them; effx does not implement another resolver.
5. Covered changes that can replace executable config/plugin code MUST transition
   once to RestartRequired, clear diagnostics and suspend generation/analysis.
   A fresh authorized process evaluates the code once. Unchanged declared inputs
   permit repeated source/overlay analyses without restart. No syntax restriction,
   config re-evaluation, cache-busting, hidden loader hook or sandbox is introduced.
6. The caller declaration covers the entire executable epoch, including later
   computed imports. Scope close joins the native observer and discards its state.
   Observation authority is not execution containment or credential clearance.

Acceptance adds actual logical alias retargets with unchanged old target, target
chains, missing intermediate creation, external declared trees, exports/`#imports`
candidate changes, visible traversal limits and restart/clear/recovery. Tests must
also show unchanged declared inputs allow multiple diagnostics generations.

### Actual operator choice
### Two concrete caller declarations

**Ordinary static package symlink.** `/work/app/effx.config.ts` imports
`effx-tags`. `/work/app/node_modules/effx-tags` links to `/work/plugins/tags-a`.
The loaded canonical cache key is `/work/plugins/tags-a/index.mjs`. Retargeting
the package link to `tags-b` leaves that old file unchanged. If TS/known logical
coverage omits this route, callers must supply it even though the import is static.

Config-relative coverage for this illustrated package route is:

```ts
executableCoverage: {
  files: [
    "package.json",
    "tsconfig.json",
    "bun.lock",
    "node_modules/effx-tags/package.json",
  ],
  directories: [
    { path: "node_modules", recursive: false },
    { path: "node_modules/effx-tags", recursive: true },
  ],
}
```

The logical package root is explicitly declared, so observation follows that root
link and records its raw target, target-chain identities and package tree. Parent
membership covers replacement/missing package creation; package.json content covers
exports selection. The config/lockfile entries cover the stated resolution inputs.
Any other package/config selection input not established by known coverage also
needs declaration. This example does not certify every dependency of a real plugin.

**Computed external alias.** A trusted config computes the pathname
`/opt/effx-plugins/current.mjs` and imports it. That file is a symlink to
`/srv/plugin-releases/v1/plugin.mjs`. The previous canonical target stays unchanged
when the alias points to `v2/plugin.mjs`. The caller must declare the LOGICAL alias:

```text
effx dev --exec-file /opt/effx-plugins/current.mjs
```

The equivalent config data is `files: ["/opt/effx-plugins/current.mjs"]`.
Observation records every path-component link, raw final destination, successive
target chain, target content/identity and missing-parent state. Supplying only
`/srv/plugin-releases/v1/plugin.mjs` is insufficient. If a later callback can choose
different aliases or reads a selector file, callers must declare ALL those logical
routes and selector/resolution inputs too. An explicit directory covers ordinary
candidate descendants; linked subtrees need explicit routes or known dependency edges.

In both cases, declaration completeness is a caller assertion, not automatic
provenance recovered from the canonical module cache. Observed covered changes
require restart; unchanged complete coverage permits repeated diagnostic generations.


**Recommend A: approve the explicit-coverage amendment above.** It preserves the
existing Bun runtime and config behavior. Callers own complete declarations for
ALL otherwise-unobservable routes/selection inputs, including ordinary package
symlinks. The coverage limitation and startup stability condition are explicit.

**B: retain unconditional automatic full executable provenance.** Config integration
must stay held until a maintained capability supplies ungated logical resolution
history, cache hits/prior loads and resolution-sensitive inputs under Bun semantics.
The examined Bun1.3.13 cache, plugin and Node-compat APIs do not supply it (§5).
Preserving Bun semantics requires an upstream-maintained Bun capability/release,
then runtime/package pins and config/loader/packed acceptance across the toolchain.
It is not a local parser, loader hook or passive cache scan.

Node supplies real maintained synchronous `module.registerHooks` from22.15.0
([Node22.23.3 primary docs, lines370-383](https://github.com/nodejs/node/blob/v22.23.3/doc/api/module.md#L370-L383)).
Those hooks can delegate Node resolution and expose specifier/importer context.
They are not implemented in pinned Bun (§5), do not prove its resolution semantics
or a complete filesystem read-set, and require a runtime/toolchain migration plus
TypeScript/Bun config compatibility work. No examined maintained alternative can
honestly be described as complete passive logical-route capture preserving current
Bun semantics. This is evidence from the examined alternatives, not a global claim
that no future runtime can provide the capability.

Only explicit operator approval can amend the frozen guarantee. Component work
continues in isolated branches; no final feature acceptance or main landing occurs
before the whole contract and its gates are settled.

## 8. Integration evidence — not acceptance

The isolated implementation is under verification on 2026-10-06. The frozen
contract, its four defaults and operator amendment A remain unchanged. No main
landing, publication or push is authorized.

- Preliminary `bun run typecheck` at `a82ebbe` failed with 34 diagnostics.
  Integration repairs retain independent callback capabilities, decoded request
  identity and precise success/error/service channels instead of erasing types.
- A subsequent typecheck at `527cc9f` failed with 11 diagnostics: generated
  persistence prerequisites were absent, and three type-law assertions were too
  narrow. The type-law repairs are committed at `55fa4c7` and `9132f8a`; this
  statement does not claim their verification. The ordered gate generates the
  persistence prerequisites before checking the complete project.
- The nine-file focused watch/editor command reached real LSP child boundaries
  but timed out after 120 seconds. Valid initialization attempts lost the child
  connection; negative request probes exposed explicit undefined `data` in the
  maintained error object. The latter is normalized through the maintained
  `ResponseError.toJson()` projection at `493f251`. This incomplete command is
  not a passing suite or final-reference evidence.
- Independent read-only review of `9132f8a` identified admitted-build interruption,
  saved-output-policy migration, document-capacity divergence, incomplete explicit
  directory/link-route coverage, selected-root/output overlap, protocol error and
  excess-request handling, and diagnostic fallback/explanation gaps. Repairs and
  causal regressions must land before final conformance is claimed.
- `onRootSources` observes the existing native frontend root list before program
  creation (`4766818`). It distinguishes declaration roots from resolution-only
  imports without a second configuration parser or persistent IR metadata.
- The actual installed TypeScript implementation is 9,144,216 bytes and fits the
  existing 16 MiB per-file observer budget. A misread historical size was withdrawn;
  no unsupported observer-limit expansion is integrated.
- Operator approval permits a named harness-managed `tool.bash` async job when
  `hub` is unavailable. Retain its process handle, name, cwd, committed reference,
  command and actual exit status; recover existing custody before starting a job.
  Shell backgrounding and lifecycle rehoming remain forbidden.

Compatibility uses the existing `scripts/identity-snapshot.ts` corpus procedure
and one-shot packed build comparisons, not failed-cycle byte preservation alone.
The authoritative pre-0018 baseline is `3d66eda158422282b6e2f44ec12910a362dcb9ae`.
The existing users, rc.116, persistence and external-extension authored inputs must
match before comparing full IR, semantic hash, surface and generated bytes.
Final committed `bun run gate`, maintained-client/installed CLI journeys and
independent conformance remain required by frozen §8.

The admitted dev writer now guards current revision at write admission and shields
only the accepted batch (`c88f7d6`). Saved output policy recomputes canonical
exclusions. Migration retains old/new generated resources and shared metadata
through the writer callback, retires obsolete leases only after success, and rolls
back newly acquired leases on failure while retaining the prior owner (`76939b8`).
Repeated migrations retain only current resources; a union owner cannot begin
another migration. These are implementation changes, not exercised test results.
Explicit recursive executable roots include ordinary nested package directories;
successive raw link destinations and missing suffixes are bounded observed routes
(`c0cec22`, `aa9de30`), without recursively following arbitrary child links.

The first named final-reference attempt (`cde48b8`, `spec0018-gate-cde48b8`)
completed with actual exit 1. Fresh frozen installation, users/persistence builds,
rc.116 installation and compiled documentation/diagnostic fence checks passed.
Typecheck then reported three test type mismatches; later gate stages and packed
smoke were not reached. The retained native process receipt is
`/srv/share/projects/effx-watch-editor-0018-evidence/gate-cde48b8.json`.
The type-law/parity repairs are `1c93fcf` and `073dff0`, without a verification claim.

Independent recheck of that reference found one remaining writer decision: old
custom-output files outside physical `.effx` were incorrectly selected for forbidden
pruning during migration. Migration must preserve those retired custom files, not
fail or widen deletion authority. Current-output obsolete refusal and legitimate
prior `.effx` pruning stay unchanged. New scoped regressions use temporary fixture
roots outside any physical `.effx` ancestor to exercise the restriction itself.

At `aaffc57`, the named gate passed fresh installation, users/persistence builds,
compiled documentation checks, TypeScript, full lint, formatting and AI-document
drift checks. Runtime tests then failed: LSP 10/18, observer 1/24, dev 21/25 and
writer 1/13 in the retained suite reports. The existing failed process was stopped
without claiming a complete test run; its native exit was 1. Later gate stages
and packed smoke were not reached.

Installed native CLI parsing establishes why ordinary launches rejected the new
toggles: `Flag.Boolean` is required without a fallback. `dev.build` and
`lsp.trustConfig` now use `Flag.withDefault(false)` (`0f12cb1`), preserving approved
opt-in intent. The missing-option runtime enum was not captured by the earlier
filtered probe, so the cause claim is source-established, not an observed enum.
Dev tests now wait on real coalesced Console/report receipts and propagate native
Exit failures (`7ea00f5`, `dbcc8fa`); they no longer race real IO with a fast yield
poll. Native observer cleanup is acknowledged only after actual acquisition and
finalizer registration (`ccb5049`). Writer artifact assertions distinguish
manifest-authoritative outputs from independently asserted scoped lease files
(`31d121a`), without ignoring arbitrary tree changes.

### Shared writer cancellation — real before/after evidence

The director requested an uncertain one-shot cancellation boundary investigation.
The same focused native filesystem test failed at test-only `3b5e4e5` (exit 1)
and completed successfully at `81245c3`: one test passed, 13 skipped. The retained
native after response is
`/srv/share/projects/effx-watch-editor-0018-evidence/writer-after-native.json`; it
contains completed status and passing stdout but no explicit numeric exit code.
The before response is retained at `artifact://33745`.

Before admission, interruption writes no generated artifacts/manifest and releases
leases for the next native process. Before the fix, interruption after the first
real write released custody with an incomplete batch and no manifest, permitting
the next process. The shared writer now masks only the admitted native write/prune/
IR/surface/manifest/report sequence (`a9273d3`). Both one-shot and watch call that
writer. The unchanged passing test requires competitor refusal while a real write
is held, complete generated bytes/manifest before release, and next-process
admission afterward. It also requires actual IO-failure settlement before lease
release; pre-admission checks remain interruptible. This is ordered completion or
failure, not a filesystem atomic transaction, rollback, retry or crash recovery.

### Existing split consumers and canonical output dependencies

The rc.116 authored HTTP root imports the other contract project output. Own-output
exclusions are selected-project logical/canonical prefixes, not a ban on every
`.effx` directory. Another project generated contract remains an ordinary input.
An imported same-project own-output contract is readable but its content/identity
changes are excluded from self-invalidation; explicitly selected declaration/config
roots overlapping own output remain visibly invalid under the frozen rule.
Outside logical dependency aliases retain raw link/parent fingerprints but stop
physical observation at canonical own exclusions (`e57da3c`), preserving later
retarget-away detection. Explicit executable declarations still reject overlap.
Saved missing/malformed/invalid referenced JSON now faults through the same frontend
boundary rather than silently publishing success (`260e175`). Valid declaration
root/program semantics are unchanged. Real split and alias consumer tests and the
final code/docs committed-reference gate remain required; no split journey pass is
claimed by these source changes.
