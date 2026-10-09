## Watch checks and editor diagnostics

`effx dev --project tsconfig.json` checks saved inputs until you stop it.
It prints increasing cycle markers, complete diagnostic batches, and counts, including zero errors after repair.
Only `dev --build` enables normal build writes. Config output and generator selection do not grant write intent.
Errors and analysis faults preserve the last successful artifacts. No application server starts.
Source: spec 0018 §3, `packages/cli/src/watch.ts`, `commands.ts`, and `project-session.ts`.

`effx lsp --project tsconfig.json` is a stdio server for one project.
Explicit `--config <path>` or launch-time `--trust-config` admits discovered executable config and its imports.
Without authority, initialization fails rather than substituting built-ins. Editor messages cannot grant trust or add executable coverage.
Trusted config executes with process privileges; the compiler's zero-write behavior is not a sandbox for plugin side effects.
Source: spec 0018 §3, `packages/cli/src/lsp.ts`, `lsp-model.ts`, and `commands.ts`.

### Qualified LSP platform

The frozen LSP contract targets declared Linux-x64/glibc systems with Bun 1.3.13.
Unsupported targets must fail explicitly before unsafe IO.
Other CLI commands and `effx dev` retain their existing runtime/platform behavior.
The original four defaults and executable-coverage amendment A remain unchanged.
This qualification does not certify Ubuntu or an unexercised runtime.
The native root exists; CLI adoption and packed-client acceptance remain pending.

The native root loads trusted POSIX readiness code through public Bun dlopen.
The build compiles `tools/native/lsp-readiness.c`; runtime compilation is unsupported.
`scripts/lsp-native-manifest.ts` defines the actual ABI 2 contract.
Source and artifact hashes, minimum glibc, and required libraries derive from each actual build.
An ELF symbol floor is not distribution certification.
The 511-byte prototype does not limit the current source size.
Native C has process authority and no memory-safety containment.

The root exclusively owns stdin. The qualified input forms remain maintained Node-client sockets, FIFO, regular files, and PTY.
Readiness precedes each raw read, with at most 64 KiB of data and backing storage.
Regular-input storage latency remains possible; competing stdin readers violate the ownership premise.
Unusual devices and unsupported forms require explicit limits or failure.

Amendment B requires classified startup refusal for **regular-file stdout**, before protocol writes or native writer acquisition.
Thus `effx lsp > protocol.log` is unsupported; the target receives no protocol bytes.
There is no regular-output writer, fallback, or storage-latency exception.
Maintained Node-client sockets, FIFO, and PTY remain the qualified output forms, with the existing two-second stalled-writer/close budget.
This output restriction does not remove regular-file stdin support.

Cooperative trusted config does not read stdin. Effx-owned Console, logger,
config-fault, help and error output uses stderr or framed protocol messages.
Arbitrary trusted raw-fd writes and global console output bypass that policy.
The process does not add a global console monkeypatch or sandbox.
Source: `docs/specs/0018-watch-editor.md`, amendment B (frozen `B3cffc85`, lines 678–712), Linux amendment, design §10, `scripts/lsp-linux.ts`, and `tools/native/lsp-readiness.c`.
Native smoke evidence alone does not establish full §8, packed-client, or final committed-reference acceptance.

### Complete executable coverage

Both commands accept repeatable `--exec-file <path>` and `--exec-dir <path>`.
Launch paths resolve from startup cwd; launch directories cover ordinary descendants recursively, including ordinary nested `node_modules` directories.
The config accepts `executableCoverage: { files?: readonly string[], directories?: readonly { path: string, recursive: boolean }[] }`.
Config coverage paths resolve beside that config. Launch and config declarations merge by union while retaining logical aliases.
Recursive directories do not follow arbitrary symlink trees. Declare external targets and logical links explicitly.
Implicit source observation does not recursively scan installed packages; explicit executable directories authorize the requested ordinary subtree within finite bounds.

**The caller must completely declare ALL otherwise-unobservable logical executable routes and resolution-sensitive inputs.**
This includes ordinary static bare-package symlinks, package exports, `#imports`, extensionless candidates, and computed/external aliases.
For a static `@acme/effx-plugin` import, declare the logical package link, package metadata, and external executable target tree when otherwise unobserved.
For exports or `#imports`, include the supplying metadata and every selection-sensitive executable candidate.
Known physical module-cache files supplement declarations; they do not prove complete logical provenance.
**Omitted routes can change without detection.** effx cannot certify caller completeness.

Coverage authorizes observation, not credential access, dependency installation, or publication.
Launch coverage exists before the single trusted import. Config-returned coverage establishes a post-import baseline.
Initial import assumes stable inputs during that window unless complete launch coverage detects a change.
Neither route supplies an atomic filesystem snapshot. A detected import-window change requires restart before trusted publication.

A covered executable change reports `RestartRequired` once, clears diagnostic status, and suspends analysis/generation until a fresh authorized process.
There is no config reexecution, cache busting, or partial hot reload.
Unchanged complete coverage permits repeated source analyses without restart.
Source: spec 0018 amendment A, `packages/cli/src/config.ts`, `commands.ts`, `config-runtime.ts`, and `watch-files.ts`.

### Editor text and diagnostics

Open source and dependency text remains authoritative in memory until close; disk events do not overwrite it.
Full and incremental edits use zero-based UTF-16 positions and apply in arrival order.
Versions increase per open instance; gaps are valid. Invalid ranges and stale versions do not mutate text.
Two URIs cannot own the same physical file. Included new files can join roots; excluded files do not become roots merely through open.

Only open URIs receive diagnostic replacements. Close immediately clears the URI and returns dependent analysis to disk.
Repairs, faults, and restart clear stale diagnostics. A superseded snapshot cannot publish.
Compiler points become zero-length ranges; codes, severity, and primary occurrence messages retain compiler meaning.
Located related occurrences use supported related-information fields; other related context remains readable without invented locations.
Unlocated findings use logs with code, severity, and explain guidance, not invented document locations.
Third-party explanation guidance includes `--config <selected path>`; bundled catalogue links explain only bundled codes.
Version tags are supplied when supported by the client.
Unsaved executable config/plugin text never executes; its log requires save and restart.

Capabilities advertise UTF-16 and incremental synchronization with open/close and save notifications without save text.
Supported inputs are initialize/initialized, document open/change/save/close, watched-file/configuration notifications, cancellation, trace control, shutdown, and exit.
No completion, hover, formatting, refactoring, code actions, semantic tokens, pull diagnostics, HTTP transport, or multi-project inference is provided.
This server does not replace the TypeScript server or generated-code typecheck.
Saved tsconfig output-policy changes refresh exclusions without executable config reevaluation.
Selected source/config roots inside output fail selection rather than disappear from observation.
Source: spec 0018 §§4–6, `packages/cli/src/documents.ts`, `lsp.ts`, and `lsp-model.ts`.

### Finite ownership

One analysis and at most one pending dirty/reconcile token bound project work.
Synchronous TypeScript calls are not preemptible; interruption does not promise cancellation of those calls.
The observer admits 8,192 paths, 16 MiB per file, and 64 MiB per pass.
It waits 250 milliseconds after each sequential pass, not a promised response latency.
Native directory listings and TypeScript allocations are not constant-memory guarantees.

LSP frame limits are 8 MiB per body and 8 KiB per header.
Incoming admission is 64 messages and 8 MiB total; outstanding requests are limited to 32.
Output admission is 32 messages and 8 MiB total, with one serialized writer.
Open text is limited to 128 documents and 16 × 1,024 × 1,024 UTF-16 code units total, not bytes.
Excess requests receive bounded correlated rejection without another domain handler when output capacity remains available.
Unsafe notification/byte or output saturation closes the session visibly rather than dropping edits.
Aggregate document-count or text-capacity overflow also closes the session, rather than dropping an edit and retaining divergent text.
Stale-version and invalid-range rejection remain separate; they do not mutate current text. Observer failures are visible and terminal.
Safely framed malformed JSON receives `-32700`; invalid request envelopes receive `-32600`.
The session continues after safe bounded error responses; bad framing, charset, oversize frames, and truncated EOF remain terminal.

SIGINT/SIGTERM close the root scope. LSP shutdown releases the project before its null reply; exit then ends the transport.
EOF, transport failure, and supplied client-process disappearance also release ownership.
No watcher, analysis, or late publication survives its owner.
Build and watch-build acquire `.effx-output-owner.lock` in exact canonical generated and metadata/manifest directories.
Saved output-policy changes refresh exclusions and migrate watch-build custody between completed write batches.
No active batch loses custody; competing owners fail without waiting. Only the owner's token is released; crash locks require explicit operator recovery.
There is no automatic stale-lock reclamation, nested-output exclusion guarantee, or distributed lease claim.
Check-only dev and LSP acquire no output locks.
Source: spec 0018 §5, `packages/cli/src/lsp-transport.ts`, `watch-files.ts`, `project-session.ts`, and `output-owner.ts`.
