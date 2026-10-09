import {
  CompilerFault,
  compile,
  hasErrors,
  type EmitMode,
  type TargetProfile,
} from "@effx/compiler";
import { Console, Effect, Exit, Fiber, FileSystem, Path, Scope, Semaphore } from "effect";
import {
  acquireBuildOutput,
  migrateBuildOutput,
  rereadProject,
  resolveProject,
  writeCompileResult,
  type Project,
  type Versions,
} from "./commands.ts";
import { loadedExecutableFiles } from "./config-runtime.ts";
import type { OutputOwner } from "./output-owner.ts";
import { canonicalDocument } from "./documents.ts";
import { makeProjectSession, type ProjectSession, type SessionEvent } from "./project-session.ts";
import { count, report, summary } from "./report.ts";
import {
  makeWatchFiles,
  sameFingerprint,
  type WatchFiles,
  type WatchInput,
} from "./watch-files.ts";

export interface DevOptions {
  readonly project?: string;
  readonly config?: string;
  readonly outDir?: string;
  readonly strictAccess?: boolean;
  readonly target?: TargetProfile;
  readonly emit?: EmitMode;
  readonly projectSelected?: boolean;
  readonly build?: boolean;
  readonly executableFiles?: ReadonlyArray<string>;
  readonly executableDirectories?: ReadonlyArray<string>;
}

const fault = (message: string, cause: unknown) =>
  new CompilerFault({ stage: "collect", message, cause });

const routeKey = (input: WatchInput) =>
  `${input.kind}:${input.directory === true ? "directory" : "file"}:${input.path}`;

/** Check-only unless build is explicit. The process invocation owns this scope:
 * one coordinator, one observer, one coalesced revision, and retained output custody.
 * Reconciliation has one permit and at most one waiter: only the observer and
 * current analysis call it. Closing the scope cancels admission and joins them.
 * Saved JSON is reread, executable values are never reevaluated. Executable changes
 * stop analysis/write admission until restart. Interruption joins both workers before
 * releasing custody. The root runMain owns SIGINT; no application process is started.
 */
export const dev = Effect.fn("dev")(function* (options: DevOptions, versions: Versions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;
  const gate = yield* Semaphore.make(1);
  let launchWatch: WatchFiles | undefined;

  const initial = yield* resolveProject(
    options.project ?? "tsconfig.json",
    options.strictAccess,
    options.target,
    options.emit,
    options.config,
    options.outDir,
    options.projectSelected ?? options.project !== undefined,
    {
      executableFiles: options.executableFiles ?? [],
      executableDirectories: options.executableDirectories ?? [],
      beforeImport: Effect.fnUntraced(
        function* (_candidate: string, inputs: ReadonlyArray<WatchInput>) {
          launchWatch = yield* makeWatchFiles({ inputs, maxFileBytes: 16 * 1024 * 1024 });
          yield* launchWatch.poll;
        },
        Effect.mapError((cause) =>
          fault("Cannot observe executable inputs before config import", cause),
        ),
      ),
    },
  );

  if (launchWatch === undefined)
    return yield* fault("Missing pre-import executable observation", undefined);
  const launchBaseline = yield* launchWatch.current;
  yield* launchWatch.poll;
  const importChanges = yield* launchWatch.takeChanges;

  const canonicalIdentity = Effect.fnUntraced(function* (file: string) {
    const uri = yield* path
      .toFileUrl(file)
      .pipe(Effect.mapError((cause) => fault("Cannot resolve dev input URI", cause)));

    return (yield* canonicalDocument(uri.href).pipe(
      Effect.mapError((cause) => fault("Cannot resolve dev input identity", cause)),
    )).identity;
  });

  const outputExclusions = Effect.fnUntraced(function* (selected: Project) {
    const logical = [
      selected.effxDir,
      selected.config.outDir ?? path.join(selected.effxDir, "generated"),
    ];

    const identities: Array<string> = [];

    for (const root of logical) identities.push(yield* canonicalIdentity(root));

    return [...logical, ...identities];
  });

  let exclusions = yield* outputExclusions(initial);

  const excluded = (name: string) =>
    exclusions.some((root) => name === root || name.startsWith(root + path.sep));

  const coverage = new Map<string, WatchInput>();

  const add = (input: WatchInput) => {
    const key = input.kind === "source" ? "source:" + input.path : routeKey(input);
    const previous = coverage.get(key);

    if (
      previous !== undefined &&
      (previous.directory === true || input.directory !== true) &&
      (previous.recursive === true || input.recursive !== true)
    )
      return;

    coverage.set(
      key,
      previous === undefined
        ? input
        : {
            ...input,
            directory: previous.directory === true || input.directory === true,
            recursive: previous.recursive === true || input.recursive === true,
          },
    );
  };

  for (const input of initial.executableCoverage ?? []) add(input);

  for (const file of yield* loadedExecutableFiles()) add({ path: file, kind: "executable" });
  add({ path: initial.tsconfigPath, kind: "source" });

  const watch = yield* makeWatchFiles({
    inputs: [...coverage.values()],
    exclusions,
    maxFileBytes: 16 * 1024 * 1024,
  });

  yield* watch.poll;
  const expandedBaseline = yield* watch.current;

  const importWindowChanged =
    importChanges.executableDirty ||
    launchBaseline.fingerprints.some((old) => {
      const next = expandedBaseline.fingerprints.find(
        (entry) => routeKey(entry.input) === routeKey(old.input),
      );

      return next === undefined || !sameFingerprint(old, next);
    });

  yield* launchWatch.stop;
  yield* watch.takeChanges;
  let project: Project = initial;
  let owner: OutputOwner | undefined;
  let session: ProjectSession;
  let cycle = 0;
  let restarting = false;
  let observed = new Map<string, WatchInput>();
  let reads = new Map<string, string>();
  let overflow = false;
  let selectedRoots: ReadonlyArray<string> = [];

  const reconcile = Effect.fnUntraced(
    function* () {
      yield* watch.poll;
      const changes = yield* watch.takeChanges;

      if (changes.executableDirty) {
        restarting = true;
        yield* session.restartRequired(
          "Executable configuration or dependency changed; restart effx dev.",
        );
      } else if (changes.dirty && !restarting) {
        yield* session.invalidate;
      }
    },
    Effect.mapError((cause) => fault("Filesystem observation failed", cause)),
  );

  session = yield* makeProjectSession({
    analyze: Effect.fnUntraced(function* () {
      observed = new Map();
      reads = new Map();
      overflow = false;
      selectedRoots = [];
      project = yield* rereadProject(initial).pipe(
        Effect.mapError((cause) =>
          cause._tag === "CompilerFault" ? cause : fault("Cannot reread saved dev project", cause),
        ),
      );
      exclusions = yield* outputExclusions(project);

      return yield* compile(project.config, project.extensions, {
        onRootSources: (roots) => {
          if (roots.length > 8192) {
            overflow = true;

            return;
          }

          selectedRoots = roots;
        },
        onObserve: (input) => {
          if (excluded(input.path)) return;

          const previous = observed.get(input.path);

          if (previous !== undefined && (previous.directory === true || input.membership !== true))
            return;

          const value: WatchInput = {
            path: input.path,
            kind: "source",
            directory: previous?.directory === true || input.membership === true,
          };

          if (observed.size >= 8192 && !observed.has(input.path)) {
            overflow = true;

            return;
          }

          observed.set(input.path, value);
        },
        onReadSource: (file, text) => {
          if (excluded(file)) return;

          if (reads.size >= 8192 && !reads.has(file)) {
            overflow = true;

            return;
          }

          reads.set(file, text);
        },
      });
    }),
    beforePublish: gate.withPermits(1)(
      Effect.gen(function* () {
        yield* reconcile();

        if (restarting) return;

        if (overflow) return yield* fault("Filesystem observation exceeds 8192 paths", undefined);

        for (const file of [
          ...selectedRoots,
          initial.tsconfigPath,
          ...(initial.configPath === undefined ? [] : [initial.configPath]),
        ]) {
          const identity = yield* canonicalIdentity(file);

          if (excluded(file) || excluded(identity))
            return yield* fault(
              "Invalid selection: selected source/config root overlaps owned output: " + file,
              undefined,
            );
        }
        // Keep this analysis's sources, not a history of obsolete roots.

        if (observed.size > 0) {
          for (const [key, input] of coverage) if (input.kind === "source") coverage.delete(key);
          add({ path: initial.tsconfigPath, kind: "source" });
        }

        for (const input of observed.values()) add(input);

        for (const file of reads.keys()) add({ path: file, kind: "source" });

        for (const file of yield* loadedExecutableFiles()) add({ path: file, kind: "executable" });
        const previous = yield* watch.current;
        yield* watch
          .replaceInputs([...coverage.values()], exclusions)
          .pipe(Effect.mapError((cause) => fault("Cannot admit analysis input coverage", cause)));
        yield* watch.poll.pipe(
          Effect.mapError((cause) => fault("Cannot establish analysis input baseline", cause)),
        );
        const next = yield* watch.current;
        yield* watch.takeChanges;
        let changed = false;

        for (const old of previous.fingerprints) {
          const current = next.fingerprints.find(
            (entry) => routeKey(entry.input) === routeKey(old.input),
          );

          if (current === undefined && old.input.kind === "source") continue;

          if (current === undefined || !sameFingerprint(old, current)) {
            if (old.input.kind === "executable") {
              restarting = true;
              yield* session.restartRequired(
                "Executable configuration or dependency changed; restart effx dev.",
              );

              return;
            }

            changed = true;
          }
        }
        // Newly discovered inputs must still equal the immutable text the frontend read.

        for (const [file, text] of reads) {
          const saved = yield* fs.readFileString(file).pipe(
            Effect.catchIf(
              (error) => error.reason._tag === "NotFound",
              () => Effect.void,
            ),
            Effect.mapError((cause) => fault("Cannot reconcile saved source", cause)),
          );

          changed ||= saved !== text;
        }

        if (changed)
          yield* session.invalidate.pipe(
            Effect.mapError((cause) => fault("Dev session closed during reconciliation", cause)),
          );
      }).pipe(
        Effect.mapError((cause) =>
          cause._tag === "CompilerFault"
            ? cause
            : fault("Dev session closed before publication", cause),
        ),
      ),
    ),
    publish: Effect.fnUntraced(function* (event: SessionEvent) {
      if (event._tag === "RestartRequired") {
        yield* Console.log(`RestartRequired: ${event.reason}`);

        return;
      }

      if (event._tag === "Cleared") return;
      cycle++;
      yield* Console.log(`effx dev cycle ${cycle}`);

      if (event._tag === "Faulted") {
        yield* Console.log(`CompilerFault: ${event.fault.message}`);
        yield* Console.log("Diagnostics cleared: failed cycle; previous build artifacts retained.");

        return;
      }

      const relative = (file: string) => {
        const name = path.relative(path.resolve(), file);

        return name === ".." || name.startsWith(".." + path.sep) ? file : name;
      };

      for (const line of report(event.result.diagnostics, relative)) yield* Console.log(line);
      yield* Console.log(summary(count(event.result.diagnostics)));

      if (options.build && !hasErrors(event.result.diagnostics)) {
        yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            yield* restore(Effect.void);

            if (!(yield* session.isCurrent(event.snapshot))) return yield* Effect.interrupt;

            if (owner === undefined)
              owner = yield* acquireBuildOutput(project, event.result).pipe(
                Effect.provideService(Scope.Scope, scope),
                Effect.mapError((cause) => fault("Cannot acquire dev build output custody", cause)),
              );

            const migration = yield* migrateBuildOutput(
              project,
              event.result,
              owner,
              Effect.fnUntraced(function* (admittedOwner: OutputOwner) {
                // Acquisition is not write admission: consume readable edits again.
                yield* restore(gate.withPermits(1)(reconcile()));

                if (!(yield* session.isCurrent(event.snapshot))) return yield* Effect.interrupt;

                // Guard, admitted batch, custody retirement and owner assignment
                // share the mask. Supersession joins them, never half a batch.
                yield* writeCompileResult(project, versions, event.result, admittedOwner).pipe(
                  Effect.mapError((cause) =>
                    fault("Cannot write accepted dev build result", cause),
                  ),
                );
              }),
            ).pipe(
              Effect.provideService(Scope.Scope, scope),
              Effect.mapError((cause) =>
                cause._tag === "CompilerFault"
                  ? cause
                  : fault("Cannot migrate dev build custody", cause),
              ),
            );

            owner = migration.owner;
            yield* Console.log(`effx dev build cycle ${cycle} complete`);
          }),
        );
      }
    }),
  });

  if (importWindowChanged) {
    restarting = true;
    yield* session.restartRequired(
      "Executable input changed while configuration was imported; restart effx dev.",
    );
  }

  yield* session.start;

  const observer = yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep("250 millis");
        yield* gate.withPermits(1)(reconcile());
      }
    }),
  );

  yield* Effect.raceFirst(
    session.awaitExit.pipe(
      Effect.flatMap((exit) => (Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.void)),
    ),
    Fiber.join(observer),
  ).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* Fiber.interrupt(observer);
        yield* watch.stop;
        yield* session.close;
      }),
    ),
  );
}, Effect.scoped);
