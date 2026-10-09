import { Crypto, Effect, Exit, FileSystem, Option, Path, Schema, Scope, Semaphore } from "effect";
import {
  bundledDiagnosticEntries,
  compile,
  CompilerFault,
  type EmitMode,
  type TargetProfile,
} from "@effx/compiler";
import { resolveProject, rereadProject, type Project } from "./commands.ts";
import {
  makeProjectSession,
  type ProjectSession,
  type SessionClosed,
  type SessionEvent,
  type ProjectSnapshot,
} from "./project-session.ts";
import { canonicalDocument, type OpenDocument } from "./documents.ts";
import {
  acquireLspTransport,
  RpcFailure,
  LspPlatform,
  type LspIO,
  type TransportError,
  type LspTransport,
  type RequestEnvelope,
} from "./lsp-transport.ts";
import {
  makeWatchFiles,
  sameFingerprint,
  type WatchChanges,
  type WatchClosed,
  type WatchFiles,
  type WatchInput,
  type WatchSnapshot,
} from "./watch-files.ts";
import {
  capabilities,
  decodeInitialize,
  decodeInitialized,
  decodeOpen,
  decodeChange,
  decodeClose,
  decodeSave,
  decodeConfiguration,
  decodeWatchedFiles,
  decodeTrace,
  decodeShutdown,
  diagnosticLog,
  projectDiagnostic,
  selectRoot,
  type Initialize,
  type DiagnosticsPublication,
  type ProjectedDiagnostic,
} from "./lsp-model.ts";
import { loadedExecutableFiles } from "./config-runtime.ts";

export interface LspOptions {
  readonly project?: string;
  readonly config?: string;
  readonly outDir?: string;
  readonly target?: TargetProfile;
  readonly emit?: EmitMode;
  readonly strictAccess?: boolean;
  readonly trustConfig?: boolean;
  readonly executableFiles?: ReadonlyArray<string>;
  readonly executableDirectories?: ReadonlyArray<string>;
  /** Startup cwd is captured before initialize; editor paths never reinterpret launch options. */
  readonly cwd?: string;
  /** Scoped transport substitution for real-client integration. No native handles cross this seam. */
  readonly io?: Effect.Effect<LspIO, TransportError, Scope.Scope>;
}

const unavailable = (reason: string) => new CompilerFault({ stage: "lsp", message: reason });

const invalidParams = () => new RpcFailure({ code: -32602, message: "Invalid method parameters" });

const bundledCodes = {
  has: (code: string) => bundledDiagnosticEntries.some((entry) => entry.code === code),
};

// Deployment derives from configure-pages project base /effx and the site docs route /docs.
const registryHref = "https://phibkro.github.io/effx/docs/diagnostics/registry";

const withKnownExecutableFiles = (
  inputs: ReadonlyArray<WatchInput>,
  files: ReadonlyArray<string>,
): ReadonlyArray<WatchInput> => {
  const coverage = [...inputs];

  for (const file of files) {
    if (!inputs.some((input) => input.directory !== true && input.path === file))
      coverage.push({ path: file, kind: "executable" });
  }

  return coverage;
};

const outputPaths = (project: Project): ReadonlyArray<string> => {
  const outputs = [project.effxDir];

  if (project.config.outDir !== undefined) outputs.push(project.config.outDir);

  return outputs;
};

/** Immediate membership is authority from enumeration, never an existence probe. @internal */
export const lspSourceCoverage = (
  file: string,
  membership: boolean,
  previous?: WatchInput,
): WatchInput => ({
  path: file,
  kind: "source",
  directory: membership || previous?.directory === true,
});

/** poll refuses a concurrent pass with None, and a pass begun before replaceInputs is
 * discarded without notification. Call after replaceInputs: it returns only after a
 * completed pass has taken the baseline of the coverage just installed, so no
 * publication can precede that baseline. @internal */
export const awaitCoverageBaseline = Effect.fnUntraced(function* (watch: WatchFiles) {
  const replaced = yield* watch.current;
  const polled = yield* watch.poll;

  if (Option.isNone(polled)) yield* watch.waitForPass(replaced.pass);
});

/** What the watch saw while an analysis ran: a fresh pass, the snapshot it produced, and
 * every external change noticed since the previous analysis consumed its own. @internal */
export const observeAnalysis = Effect.fnUntraced(function* (watch: WatchFiles) {
  yield* watch.poll;
  const previous = yield* watch.current;
  const previousChanges = yield* watch.takeChanges;

  return { previous, previousChanges };
});

export class CoverageFault extends Schema.TaggedError<CoverageFault>()("CoverageFault", {
  stage: Schema.Literals(["Install", "Baseline", "Verify", "Session"]),
}) {}

export interface CoverageInstall {
  readonly watch: WatchFiles;
  readonly session: Pick<ProjectSession, "invalidate" | "restartRequired">;
  /** One permit orders this analysis's coverage change against the watch loop. */
  readonly gate: Semaphore.Semaphore;
  readonly inputs: ReadonlyArray<WatchInput>;
  readonly exclusions: ReadonlyArray<string>;
  /** Observation before this analysis's compile finished: snapshot and changes taken then. */
  readonly previous: WatchSnapshot;
  readonly previousChanges: WatchChanges;
  /** Exact texts the compile read, and the subset served from editor overlays. */
  readonly read: ReadonlyMap<string, string>;
  readonly overlaid: ReadonlySet<string>;
}

/** Installs the coverage a finished analysis observed and decides whether that analysis
 * must be repeated. replaceInputs always marks the watch dirty; that signal is this
 * analysis's own change and is consumed under the gate, so it neither wakes the watch
 * loop into superseding this analysis nor forces a second compile. A second analysis
 * is requested only for a real change: an external edit observed before or after the
 * baseline, a covered executable change, or a file whose saved text no longer equals
 * the text the compile read (an edit between the read and the new baseline, which the
 * baseline pass would otherwise adopt silently). Inputs observed but never read
 * (existence probes, directory listings) have no text to compare; their changes after
 * the compile are detected only from the baseline on. @internal */
export const installCoverage = Effect.fnUntraced(function* (
  input: CoverageInstall,
): Effect.fn.Return<void, CoverageFault, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const { watch } = input;

  const window = yield* input.gate.withPermit(
    Effect.gen(function* () {
      // Edits noticed before this call are external; the next take sees only our signal.
      const before = yield* watch.takeChanges;

      yield* watch
        .replaceInputs(input.inputs, input.exclusions)
        .pipe(Effect.mapError(() => new CoverageFault({ stage: "Install" })));
      yield* watch.takeChanges;
      yield* awaitCoverageBaseline(watch).pipe(
        Effect.mapError(() => new CoverageFault({ stage: "Baseline" })),
      );
      const current = yield* watch.current;
      const after = yield* watch.takeChanges;

      return { before, after, current };
    }),
  );

  const executableChanged =
    input.previousChanges.executableDirty ||
    window.before.executableDirty ||
    window.after.executableDirty ||
    input.previous.fingerprints.some((previous) => {
      if (previous.input.kind !== "executable") return false;

      const next = window.current.fingerprints.find(
        (candidate) =>
          candidate.input.path === previous.input.path &&
          candidate.input.kind === previous.input.kind &&
          candidate.input.directory === previous.input.directory &&
          candidate.input.recursive === previous.input.recursive,
      );

      return next === undefined || !sameFingerprint(previous, next);
    });

  if (executableChanged)
    return yield* input.session
      .restartRequired("Covered executable input changed")
      .pipe(Effect.mapError(() => new CoverageFault({ stage: "Session" })));

  const edited = yield* Effect.forEach(
    [...input.read].filter(([file]) => !input.overlaid.has(file)),
    ([file, text]) =>
      fs.readFileString(file).pipe(
        Effect.map((saved) => saved !== text),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(true)),
        Effect.mapError(() => new CoverageFault({ stage: "Verify" })),
      ),
    { concurrency: 16 },
  );

  if (
    input.previousChanges.dirty ||
    window.before.dirty ||
    window.after.dirty ||
    edited.some(Boolean)
  )
    yield* input.session.invalidate.pipe(
      Effect.mapError(() => new CoverageFault({ stage: "Session" })),
    );
});

/** One watch-loop step. Taking the changes waits for any analysis holding the gate, so an
 * analysis's own coverage signal is never mistaken for an external edit. @internal */
export const applyWatchChanges = Effect.fnUntraced(function* (
  watch: WatchFiles,
  session: Pick<ProjectSession, "invalidate" | "restartRequired">,
  gate: Semaphore.Semaphore,
): Effect.fn.Return<void, WatchClosed | CompilerFault | SessionClosed> {
  yield* watch.awaitChanges;
  const changes = yield* gate.withPermit(watch.takeChanges);

  if (changes.executableDirty) yield* session.restartRequired("Covered executable input changed");
  else if (changes.dirty) yield* session.invalidate;
});

/** Portable one-project LSP owner. Building this Effect performs no work. The outer
 * scope owns transport/client liveness; shutdown closes the nested project owner
 * before replying null, leaving transport alive until exit or EOF. No disk emission. */
export const lsp = Effect.fn("lsp")(function* (options: LspOptions) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const cwd = path.resolve(options.cwd ?? path.resolve());
  const rootScope = yield* Effect.scope;
  const coverageGate = yield* Semaphore.make(1);
  let projectScope: Scope.Closeable | undefined;
  let project: Project | undefined;
  let session: ProjectSession | undefined;
  let watch: WatchFiles | undefined;
  let transport: LspTransport;
  let state: "new" | "initialized" | "running" | "shutdown" | "exited" = "new";
  let exitCode = 1;
  let client: Initialize | undefined;
  let executableInputs: ReadonlyArray<WatchInput> = [];
  let sourceInputs: ReadonlyArray<WatchInput> = [];
  let selectedConfig: string | undefined;
  let initialRestartReason: string | undefined;

  const analyzedSources = new WeakMap<
    ProjectSnapshot,
    ReadonlyMap<string, { readonly uri: string; readonly text: string }>
  >();

  const analyzedMembers = new WeakMap<ProjectSnapshot, ReadonlySet<string>>();
  let executableDirectoryIdentities: ReadonlyArray<string> = [];
  let ownedIdentities: ReadonlyArray<string> = [];

  const under = (file: string, root: string): boolean =>
    file === root || file.startsWith(`${root}${path.sep}`);

  const isExecutable = (document: Pick<OpenDocument, "file" | "identity">): boolean =>
    executableInputs.some(
      (input) =>
        input.path === document.file ||
        input.path === document.identity ||
        (input.directory === true && under(document.file, input.path)),
    ) || executableDirectoryIdentities.some((root) => under(document.identity, root));

  const isSourceDocument = (document: OpenDocument): boolean =>
    !isExecutable(document) &&
    !ownedIdentities.some((root) => under(document.file, root) || under(document.identity, root)) &&
    !document.file.endsWith(".json");

  const refreshOwnedIdentities = Effect.fnUntraced(function* () {
    const roots: string[] = [];

    for (const file of outputPaths(project!)) {
      const uri = yield* path
        .toFileUrl(file)
        .pipe(Effect.mapError(() => unavailable("Output URI unavailable")));

      const admitted = yield* canonicalDocument(uri.href).pipe(
        Effect.mapError(() => unavailable("Output identity unavailable")),
      );

      roots.push(admitted.file, admitted.identity);
    }

    ownedIdentities = roots;
  });

  const send = Effect.fnUntraced(function* (method: string, params: Schema.Json) {
    yield* transport
      .sendNotification(method, params)
      .pipe(Effect.mapError((error) => unavailable(`LSP transport ${error.reason}`)));
  });

  const log = Effect.fnUntraced(function* (message: string, type = 2) {
    yield* send("window/logMessage", { type, message });
  });

  const clear = Effect.fnUntraced(function* (document: OpenDocument) {
    const params: DiagnosticsPublication = { uri: document.uri, diagnostics: [] };

    if (client?.capabilities.textDocument?.publishDiagnostics?.versionSupport)
      params.version = document.version;
    yield* send("textDocument/publishDiagnostics", params);
  });

  const stopProject = Effect.fnUntraced(function* () {
    if (projectScope) yield* Scope.close(projectScope, Exit.void);
    projectScope = undefined;
    session = undefined;
    watch = undefined;
    project = undefined;
  });

  const terminateCapacity = Effect.fnUntraced(function* () {
    state = "exited";
    exitCode = 1;
    yield* Effect.logError("effx lsp: document admission capacity exceeded; closing session.");
    yield* stopProject();
    yield* transport.close;
  });

  const assertSelectedRoots = Effect.fnUntraced(function* (roots: ReadonlyArray<string>) {
    for (const file of roots) {
      const uri = yield* path
        .toFileUrl(file)
        .pipe(Effect.mapError(() => unavailable("Selected root URI unavailable")));

      const admitted = yield* canonicalDocument(uri.href).pipe(
        Effect.mapError(() => unavailable("Selected root identity unavailable")),
      );

      if (
        ownedIdentities.some(
          (output) => under(admitted.file, output) || under(admitted.identity, output),
        )
      )
        return yield* new CompilerFault({
          stage: "lsp.selection",
          message: "Selected source/configuration root overlaps effx-owned output",
        });
    }
  });

  const publish = Effect.fnUntraced(function* (event: SessionEvent) {
    if (state !== "running") return;

    switch (event._tag) {
      case "Cleared":
        yield* clear(event.document);

        return;
      case "RestartRequired":
        for (const document of event.documents.values()) yield* clear(document);
        yield* log(
          `RestartRequired: ${event.reason}. Restart effx lsp with renewed launch authority.`,
        );

        return;
      case "Faulted":
        for (const document of event.snapshot.documents.values()) yield* clear(document);
        yield* log(
          event.fault.stage === "lsp.selection"
            ? "Analysis unavailable: selected source/configuration root overlaps effx-owned output. Repair selection to resume."
            : "Analysis unavailable: saved project inputs could not be analyzed. Repair them to resume.",
          1,
        );

        return;
      case "Completed": {
        const support = client?.capabilities.textDocument?.publishDiagnostics;
        const replacements = new Map<string, ProjectedDiagnostic[]>();

        for (const document of event.snapshot.documents.values())
          replacements.set(document.uri, []);

        const lookup = (location: { readonly file: string }) => {
          const file = path.resolve(project!.rootDir, location.file);

          for (const document of event.snapshot.documents.values()) {
            if (path.resolve(document.file) === file || document.identity === file)
              return { uri: document.uri, text: document.text };
          }

          return analyzedSources.get(event.snapshot)?.get(file);
        };

        for (const diagnostic of event.result.diagnostics) {
          const projected = projectDiagnostic(diagnostic, lookup, {
            relatedInformation: support?.relatedInformation === true,
            selectedConfig,
            codeDescription: support?.codeDescriptionSupport === true,
            bundledCodes,
            registryHref: registryHref,
          });

          if (projected && replacements.has(projected.uri)) {
            replacements.get(projected.uri)!.push(projected.diagnostic);

            for (const message of projected.logs) yield* log(message);
          } else
            yield* log(
              diagnosticLog(diagnostic, selectedConfig, bundledCodes.has(diagnostic.code)),
              diagnostic.severity === "error" ? 1 : diagnostic.severity === "warning" ? 2 : 3,
            );
        }

        for (const document of event.snapshot.documents.values()) {
          if (!(yield* session!.isCurrent(event.snapshot))) return;

          if (
            !isSourceDocument(document) ||
            !(
              analyzedMembers.get(event.snapshot)?.has(document.file) ||
              analyzedMembers.get(event.snapshot)?.has(document.identity)
            )
          ) {
            replacements.set(document.uri, []);
            yield* log(
              `Analysis unavailable for ${document.uri}: document is outside admitted source membership or is a saved-only executable/config/output input.`,
            );
          }

          const params: DiagnosticsPublication = {
            uri: document.uri,
            diagnostics: replacements.get(document.uri)!,
          };

          if (support?.versionSupport) params.version = document.version;
          yield* send("textDocument/publishDiagnostics", params);
        }
      }
    }
  });

  const analyze = Effect.fnUntraced(function* (snapshot: ProjectSnapshot) {
    if ((yield* watch!.current).error)
      return yield* unavailable("Filesystem observation unavailable");
    project = yield* rereadProject(project!).pipe(
      Effect.mapError(() => unavailable("Saved project configuration is unavailable")),
    );
    yield* refreshOwnedIdentities();
    const observed = new Map<string, WatchInput>();
    const texts = new Map<string, string>();
    observed.set(project.tsconfigPath, { path: project.tsconfigPath, kind: "source" });
    const sources = new Map<string, string | undefined>();
    let selectedRoots: ReadonlyArray<string> = [];

    for (const [file, text] of snapshot.sources) {
      if (!ownedIdentities.some((root) => under(file, root))) sources.set(file, text);
    }

    const attempt = yield* compile(project.config, project.extensions, {
      sources,
      onObserve: (input) =>
        observed.set(
          input.path,
          lspSourceCoverage(input.path, input.membership === true, observed.get(input.path)),
        ),
      onReadSource: (file, text) => {
        texts.set(path.resolve(file), text);
      },
      onRootSources: (roots: ReadonlyArray<string>) => {
        selectedRoots = roots;
      },
    }).pipe(
      Effect.match({
        onFailure: (fault) => ({ _tag: "Faulted" as const, fault }),
        onSuccess: (result) => ({ _tag: "Compiled" as const, result }),
      }),
    );

    yield* assertSelectedRoots([project.tsconfigPath, ...selectedRoots]);

    if (attempt._tag === "Compiled") {
      const result = attempt.result;
      analyzedMembers.set(snapshot, new Set(texts.keys()));
      const locations = new Map<string, { readonly uri: string; readonly text: string }>();
      const locationFiles = new Set<string>();

      const recordLocation = (diagnostic: import("@effx/diagnostics").Diagnostic): void => {
        if (diagnostic.location)
          locationFiles.add(path.resolve(project!.rootDir, diagnostic.location.file));

        for (const related of diagnostic.related ?? []) recordLocation(related);
      };

      for (const diagnostic of result.diagnostics) recordLocation(diagnostic);

      for (const file of locationFiles) {
        const text = texts.get(file);

        if (text !== undefined) {
          const uri = yield* path
            .toFileUrl(file)
            .pipe(Effect.mapError(() => unavailable("Diagnostic URI unavailable")));

          locations.set(file, { uri: uri.href, text });
        }
      }

      analyzedSources.set(snapshot, locations);
    }

    const { previous, previousChanges } = yield* observeAnalysis(watch!).pipe(
      Effect.mapError(() => unavailable("Watch reconciliation unavailable")),
    );

    executableInputs = withKnownExecutableFiles(executableInputs, yield* loadedExecutableFiles());
    // A failed attempt contributes recovery coverage, never a successful snapshot.
    const observedSources = new Map<string, WatchInput>();

    if (attempt._tag === "Faulted") {
      for (const input of sourceInputs) {
        if (!ownedIdentities.some((output) => under(input.path, output)))
          observedSources.set(input.path, input);
      }
    }

    for (const input of observed.values()) {
      if (!ownedIdentities.some((output) => under(input.path, output)))
        observedSources.set(
          input.path,
          lspSourceCoverage(input.path, input.directory === true, observedSources.get(input.path)),
        );
    }

    const nextSourceInputs = [...observedSources.values()];
    sourceInputs = nextSourceInputs;

    yield* installCoverage({
      watch: watch!,
      session: session!,
      gate: coverageGate,
      inputs: [...executableInputs, ...nextSourceInputs],
      exclusions: [...ownedIdentities, path.join(project!.rootDir, ".git")],
      previous,
      previousChanges,
      read: texts,
      overlaid: new Set([...sources.keys()].map((file) => path.resolve(file))),
    }).pipe(
      Effect.mapError((fault) =>
        unavailable(
          fault.stage === "Install"
            ? "Watch coverage unavailable"
            : fault.stage === "Session"
              ? "Session unavailable"
              : "Watch reconciliation unavailable",
        ),
      ),
    );

    if (attempt._tag === "Faulted") return yield* attempt.fault;

    return attempt.result;
  });

  const initialize = Effect.fnUntraced(function* (decoded: Initialize) {
    if (state !== "new")
      return yield* new RpcFailure({ code: -32600, message: "Already initialized" });

    if (decoded.processId !== undefined && decoded.processId !== null)
      yield* transport
        .watchClient(decoded.processId)
        .pipe(
          Effect.mapError(
            () => new RpcFailure({ code: -32602, message: "Client process unavailable" }),
          ),
        );
    const selection = selectRoot(decoded, options.project, cwd);

    if (!selection)
      return yield* new RpcFailure({ code: -32602, message: "Exactly one workspace is supported" });
    let selected: string;

    if (selection.kind === "uri") {
      const root = yield* canonicalDocument(selection.value).pipe(Effect.mapError(invalidParams));
      selected = path.join(root.file, "tsconfig.json");
    } else {
      selected = path.resolve(cwd, selection.value);

      if (options.project === undefined) selected = path.join(selected, "tsconfig.json");
    }

    projectScope = yield* Scope.fork(rootScope);
    client = decoded;
    let trustDenied = false;

    const initializedProject = Effect.gen(function* () {
      const watchContext = yield* Effect.context<
        FileSystem.FileSystem | Path.Path | Crypto.Crypto | Scope.Scope
      >();

      project = yield* resolveProject(
        selected,
        options.strictAccess,
        options.target,
        options.emit,
        options.config === undefined ? undefined : path.resolve(cwd, options.config),
        options.outDir === undefined ? undefined : path.resolve(cwd, options.outDir),
        options.project !== undefined,
        {
          trustDiscoveredConfig: options.trustConfig === true,
          executableFiles: (options.executableFiles ?? []).map((file) => path.resolve(cwd, file)),
          executableDirectories: (options.executableDirectories ?? []).map((directory) =>
            path.resolve(cwd, directory),
          ),
          beforeImport: Effect.fnUntraced(function* (
            candidate: string,
            inputs: ReadonlyArray<WatchInput>,
          ) {
            selectedConfig = candidate;
            trustDenied =
              options.config === undefined &&
              options.trustConfig !== true &&
              (yield* fs
                .exists(candidate)
                .pipe(Effect.mapError(() => unavailable("Configuration admission unavailable"))));
            executableInputs = withKnownExecutableFiles(inputs, yield* loadedExecutableFiles());
            watch = yield* makeWatchFiles({
              inputs: executableInputs,
              maxFileBytes: 16 * 1024 * 1024,
            }).pipe(Effect.mapError(() => unavailable("Executable coverage admission failed")));
            yield* watch.poll.pipe(
              Effect.mapError(() => unavailable("Executable coverage observation failed")),
            );
          }, Effect.provideContext(watchContext)),
        },
      );
      let importWindowChanged = false;

      if (watch) {
        yield* watch.poll.pipe(
          Effect.mapError(() => unavailable("Import-window reconciliation unavailable")),
        );
        importWindowChanged = (yield* watch.takeChanges).executableDirty;
      }

      executableInputs = withKnownExecutableFiles(
        project.executableCoverage ?? [],
        yield* loadedExecutableFiles(),
      );
      selectedConfig = project.configPath;
      sourceInputs = [
        { path: project.tsconfigPath, kind: "source" },
        { path: path.dirname(project.tsconfigPath), kind: "source", directory: true },
      ];
      const preimportWatch = watch;
      const preimportBaseline = preimportWatch ? yield* preimportWatch.current : undefined;
      watch = yield* makeWatchFiles({
        inputs: [...executableInputs, ...sourceInputs],
        maxFileBytes: 16 * 1024 * 1024,
        exclusions: [...outputPaths(project), path.join(project.rootDir, ".git")],
      }).pipe(Effect.mapError(() => unavailable("Watch coverage admission failed")));
      yield* watch.poll.pipe(
        Effect.mapError(() => unavailable("Initial reconciliation unavailable")),
      );
      const admittedBaseline = yield* watch.current;

      if (preimportBaseline)
        importWindowChanged ||= preimportBaseline.fingerprints.some((previous) => {
          const current = admittedBaseline.fingerprints.find(
            (next) =>
              next.input.path === previous.input.path &&
              next.input.kind === previous.input.kind &&
              next.input.directory === previous.input.directory &&
              next.input.recursive === previous.input.recursive,
          );

          return current === undefined || !sameFingerprint(previous, current);
        });

      if (preimportWatch) yield* preimportWatch.stop;
      yield* watch.takeChanges;
      const directoryIdentities: string[] = [];

      for (const input of executableInputs) {
        if (input.directory !== true) continue;

        const uri = yield* path
          .toFileUrl(input.path)
          .pipe(Effect.mapError(() => unavailable("Executable directory URI unavailable")));

        const admitted = yield* canonicalDocument(uri.href).pipe(
          Effect.mapError(() => unavailable("Executable directory identity unavailable")),
        );

        directoryIdentities.push(admitted.identity);
      }

      executableDirectoryIdentities = directoryIdentities;
      yield* refreshOwnedIdentities();
      session = yield* makeProjectSession({
        analyze,
        publish,
        beforePublish: transport.admitPending.pipe(
          Effect.mapError((error) => unavailable(`LSP transport ${error.reason}`)),
        ),
        isSourceDocument,
      });

      if (importWindowChanged)
        initialRestartReason = "Executable inputs changed during trusted import";
    }).pipe(Scope.provide(projectScope));

    yield* initializedProject.pipe(
      Effect.onError(() => stopProject()),
      Effect.mapError(
        () =>
          new RpcFailure({
            code: -32603,
            message: trustDenied
              ? `Executable config ${selectedConfig} requires launch-time --trust-config or explicit --config`
              : `Project admission failed for ${selectedConfig ?? selected}; repair saved configuration before retrying`,
          }),
      ),
    );
    state = "initialized";

    return capabilities;
  });

  const notification = Effect.fnUntraced(function* (message: {
    readonly method: string;
    readonly params?: unknown;
  }) {
    if (message.method === "exit") {
      exitCode = state === "shutdown" ? 0 : 1;
      state = "exited";
      yield* stopProject();
      yield* transport.close;

      return;
    }

    if (state === "new" || state === "shutdown" || state === "exited") return;

    if (message.method === "$/setTrace") {
      yield* decodeTrace(message.params);

      return;
    }

    if (message.method === "initialized") {
      yield* decodeInitialized(message.params).pipe(Effect.mapError(invalidParams));

      if (state !== "initialized") return;
      state = "running";

      if (initialRestartReason) yield* session!.restartRequired(initialRestartReason);
      yield* session!.start;
      yield* watch!.start;
      yield* session!.awaitExit.pipe(
        Effect.flatMap((exit) => (Exit.isFailure(exit) ? transport.close : Effect.void)),
        Effect.forkIn(projectScope!),
      );
      yield* Effect.gen(function* () {
        while (state === "running") {
          yield* applyWatchChanges(watch!, session!, coverageGate);
        }
      }).pipe(
        Effect.catch(() => log("Analysis unavailable: filesystem observation failed", 1)),
        Effect.forkIn(projectScope!),
      );

      return;
    }

    if (state !== "running") return;

    switch (message.method) {
      case "textDocument/didOpen": {
        const { textDocument } = yield* decodeOpen(message.params);
        const admitted = yield* canonicalDocument(textDocument.uri);
        yield* session!.open({
          ...admitted,
          text: textDocument.text,
          version: textDocument.version,
        });

        if (isExecutable(admitted))
          yield* log(
            "Unsaved executable configuration is not evaluated. Save and restart to apply changes.",
          );

        return;
      }

      case "textDocument/didChange": {
        const value = yield* decodeChange(message.params);
        const admitted = yield* canonicalDocument(value.textDocument.uri);
        yield* session!.change(admitted.uri, value.textDocument.version, value.contentChanges);

        if (isExecutable(admitted))
          yield* log(
            "Unsaved executable configuration is not evaluated. Save and restart to apply changes.",
          );

        return;
      }

      case "textDocument/didClose": {
        const value = yield* decodeClose(message.params);
        const admitted = yield* canonicalDocument(value.textDocument.uri);
        yield* session!.closeDocument(admitted.uri);

        return;
      }

      case "textDocument/didSave": {
        const value = yield* decodeSave(message.params);
        yield* canonicalDocument(value.textDocument.uri);
        yield* session!.invalidate;

        return;
      }

      case "workspace/didChangeConfiguration": {
        const value = yield* decodeConfiguration(message.params);

        if (value.settings.effx && Object.keys(value.settings.effx).length > 0)
          yield* session!.restartRequired(
            "Editor effx settings cannot change launch selection or trust",
          );

        return;
      }

      case "workspace/didChangeWatchedFiles": {
        const value = yield* decodeWatchedFiles(message.params);

        for (const change of value.changes) yield* canonicalDocument(change.uri);
        yield* watch!.poll;
        const changes = yield* watch!.takeChanges;

        if (changes.executableDirty)
          yield* session!.restartRequired("Covered executable input changed");
        else if (changes.dirty) yield* session!.invalidate;

        return;
      }
    }
  });

  const acquireIO = options.io ?? (yield* LspPlatform).acquireIO;
  transport = yield* acquireLspTransport(acquireIO, {
    request: Effect.fnUntraced(function* (message: RequestEnvelope) {
      if (message.method === "initialize") {
        const params = yield* decodeInitialize(message.params).pipe(Effect.mapError(invalidParams));

        return yield* initialize(params);
      }

      if (state === "new")
        return yield* new RpcFailure({ code: -32002, message: "Server not initialized" });

      if (state === "shutdown" || state === "exited")
        return yield* new RpcFailure({ code: -32600, message: "Server has shut down" });

      if (message.method === "shutdown") {
        yield* decodeShutdown(message.params).pipe(Effect.mapError(invalidParams));
        state = "shutdown";
        yield* stopProject();
        exitCode = 0;

        return null;
      }

      return yield* new RpcFailure({ code: -32601, message: "Method not found" });
    }),
    notification: (message) =>
      notification(message).pipe(
        Effect.catchTag("DocumentError", (error) =>
          error.reason === "Limit"
            ? terminateCapacity()
            : log("Invalid notification or unavailable project operation", 2),
        ),
        Effect.catch(() =>
          state === "running" || state === "initialized"
            ? log("Invalid notification or unavailable project operation", 2).pipe(
                Effect.catchTag("CompilerFault", () => transport.close),
              )
            : Effect.void,
        ),
      ),
  });
  yield* transport.awaitClosed;
  yield* stopProject();

  return exitCode;
}, Effect.scoped);
