import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Layer, Option, Path, Predicate, Schema } from "effect";
import {
  Extensions,
  type AnnotationArg,
  SourceFrontend,
  compileCollected,
  type BindingConclusion,
  type Diagnostic,
  type FormOutcome,
  type ProjectConfig,
} from "@effx/compiler";
import { LiftTsSourceFrontend, TsSourceFrontend } from "@effx/frontend-ts";
import { canonical, semanticHash } from "@effx/ir";
import {
  LiftJsonReport,
  prepareLift,
  resolveProject,
  runLiftCheck,
  type LiftRunParams,
  type Project,
} from "@effx/cli";
import { digestTree } from "../../tools/testing/projects.ts";
import {
  app,
  corpusGroups,
  inputOf,
  type CorpusGroup,
} from "../../packages/frontend-ts/test/lift-corpus-input.ts";
import {
  copyLiftCorpus,
  readVerifiedBlob,
  requireLiftCorpusRuntime,
  type CorpusSnapshot,
} from "../../packages/frontend-ts/test/lift-corpus.ts";
import { liftCheckExecutionLayer, liftToolchainLayer } from "../lift-execution.ts";
import {
  metadataOf,
  runCli,
  withAnnotation,
  withoutAnnotation,
  type Options,
} from "./lift-fixtures.ts";

/*
 * The real stable corpus through the native check (spec 0019 §10 items 1 and 3). The application is the
 * pinned `stable-original` snapshot (mono-web f433ea90 after the stable-Effect migration): the check
 * executes ITS Profile, Directory and SocialEvents groups and the generated contracts in real Bun children.
 * The lifter rules and names point to the exports of the pinned 8152 human adaptation (the adapter law,
 * §5.5), so the application under check carries that adaptation: the oracle's support modules (which only
 * add exports), its three adapters and its one-line `emptyInput` declarations, every byte proven against
 * the corpus manifest. The original groups are otherwise byte-identical. The 0024 dense oracle is the
 * `stable-oracle` snapshot: the printed suggestions must compile to its canonical IR.
 */

requireLiftCorpusRuntime();

/** The real services of the check, exactly as the process root composes them. */
const services = Layer.mergeAll(
  TsSourceFrontend.layer,
  LiftTsSourceFrontend.layer,
  liftCheckExecutionLayer,
  liftToolchainLayer,
).pipe(Layer.provideMerge(BunServices.layer));

const decodeReport = Schema.decodeUnknownEffect(LiftJsonReport);

type LiftConfig = NonNullable<ProjectConfig["lift"]>;

type LiftDraft = { -readonly [K in keyof LiftConfig]: LiftConfig[K] };

/** Operations per group in the 0024 dense oracle: 9 endpoints of the corpus' 108 are lifted here. */
const endpointCounts = {
  profile: 2,
  directory: 4,
  "social-events": 3,
} satisfies Record<CorpusGroup, number>;

/** The refactors a lift can require (spec 0019 §4.3, §6): errors that stay until the source edit is applied. */
const refactorCodes: ReadonlyArray<string> = ["EFFX3002", "EFFX3003", "EFFX3004"];

const deadline = 900_000;

/**
 * The reviewed data of one group plus the application's own opaque-Context projector (§5.4): the access
 * annotation key and the exported `reflectAccessSpec` that reads the merged annotations of one endpoint.
 */
const liftOf = (group: CorpusGroup, hook = "reflectAccessSpec"): LiftConfig => {
  const input = inputOf(group);

  const draft: LiftDraft = {
    rules: input.rules,
    names: input.names,
    output: input.output,
    projections: [
      {
        key: { module: `${app}/access`, export: "AccessSpecAnnotation" },
        hook: { module: `${app}/access`, export: hook },
      },
    ],
  };

  if (input.emptyInput !== undefined) draft.emptyInput = input.emptyInput;

  return draft;
};

const snapshotNamed = <A extends { readonly name: string }>(
  snapshots: ReadonlyArray<A>,
  name: string,
): A =>
  Arr.findFirst(snapshots, (snapshot) => snapshot.name === name).pipe(
    Option.getOrThrowWith(() => new Error(`the corpus has no snapshot ${name}`)),
  );

/**
 * The pinned adaptation's support modules taken whole: the oracle's `common` and `http-semantics` only add
 * exports (the operation annotator, the response-header schemas the success wrappers are registered with)
 * and rewrite the original helpers to use them (§5.5). Nothing in them is a refactor the lift plans.
 */
const adaptedModules = ["common", "http-semantics"] as const;

/**
 * The pinned adaptation's one-line `emptyInput` declarations (§2.3, seam S3), per original group module.
 * The declaration is the oracle's own line; a module that does not bind `Schema` yet gets the oracle's own
 * `Schema` import with it, so the group module the application runs still evaluates.
 */
const emptyInputs = [
  { module: "directory", name: "EmptyDirectoryInput" },
  { module: "social-events", name: "EmptySocialEventInput" },
] as const;

const schemaImport = 'import { Schema } from "effect";';

const bindsSchema = (text: string): boolean =>
  /^import\s*\{[^}]*\bSchema\b[^}]*\}\s*from\s*"effect";$/m.test(text);

const sourceOf = (module: string): string => `packages/http-api/src/${module}.ts`;

/** One file of the pinned oracle, proven against the manifest before anyone reads it. */
const pinnedFile = Effect.fnUntraced(function* (pinned: CorpusSnapshot, logical: string) {
  const file = Arr.findFirst(pinned.files, (entry) => entry.path === logical).pipe(
    Option.getOrThrowWith(() => new Error(`the pinned oracle has no ${logical}`)),
  );

  return yield* readVerifiedBlob(pinned, file);
});

/** The text of one verified oracle file. */
const pinnedText = Effect.fnUntraced(function* (pinned: CorpusSnapshot, logical: string) {
  const fs = yield* FileSystem.FileSystem;
  const { source } = yield* pinnedFile(pinned, logical);

  return yield* fs.readFileString(source);
});

/** The exact lines of `text` from the first one starting `from` through the first later one ending `through`. */
const linesBetween = (text: string, from: string, through: string): string => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(from));
  const end = lines.findIndex((line, index) => index >= start && line.endsWith(through));

  assert.isAtLeast(start, 0, `the pinned oracle has a line starting ${from}`);
  assert.isAtLeast(end, start, `the pinned oracle has a line ending ${through}`);

  return lines.slice(start, end + 1).join("\n");
};

/** `text` with its one occurrence of `part` replaced by `by`. */
const replacedOnce = (text: string, part: string, by: string): string => {
  const pieces = text.split(part);

  assert.strictEqual(pieces.length, 2, `${part} occurs once`);

  return pieces.join(by);
};

/**
 * One fresh copy of both stable snapshots. With `adapted`, the pinned human adaptation the rules name is
 * applied to the ORIGINAL application, and only its adapter exports: the oracle's `common` and
 * `http-semantics` and its three adapters join the original's, `endpoint-problems` gains the oracle's
 * `nativeProblems` registry with the imports it needs, and each group module gains the oracle's one-line
 * `emptyInput` declaration. The oracle's extracted code tuples stay out: the lift plans those exports itself
 * (spec 0019 §4.3), under the pinned names, and the check compiles them against the original problem unions.
 */
const stage = Effect.fnUntraced(function* (adapted: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const copied = yield* copyLiftCorpus();
  const original = snapshotNamed(copied.snapshots, "stable-original");
  const oracle = snapshotNamed(copied.snapshots, "stable-oracle");

  if (adapted) {
    const pinned = snapshotNamed(copied.manifest.snapshots, "stable-oracle");
    const targetOf = (module: string): string => path.join(original.directory, sourceOf(module));

    for (const module of [
      ...adaptedModules,
      ...corpusGroups.map((group) => `${group}-effx-adapters`),
    ]) {
      const { bytes } = yield* pinnedFile(pinned, sourceOf(module));

      yield* fs.writeFile(targetOf(module), bytes);
    }

    const problems = yield* pinnedText(pinned, sourceOf("endpoint-problems"));

    const registryImports = linesBetween(
      problems,
      'import { Schema, Struct } from "effect";',
      '} from "./http-semantics.js";',
    );

    const registry = linesBetween(
      problems,
      "const nativeProblemCode = ",
      "export const nativeProblems = deriveNativeProblems;",
    );

    const originalProblems = yield* fs.readFileString(targetOf("endpoint-problems"));

    yield* fs.writeFileString(
      targetOf("endpoint-problems"),
      `${replacedOnce(originalProblems, 'import { problemUnion } from "./http-semantics.js";', registryImports)}\n${registry}\n`,
    );

    for (const { module, name } of emptyInputs) {
      const text = yield* pinnedText(pinned, sourceOf(module));

      const declarations = text
        .split("\n")
        .filter((line) => line.startsWith(`export const ${name} =`));

      assert.strictEqual(declarations.length, 1, `the pinned oracle declares ${name} once`);

      const current = yield* fs.readFileString(targetOf(module));

      if (!bindsSchema(current)) {
        assert.strictEqual(
          text.split("\n").filter((line) => line === schemaImport).length,
          1,
          "the pinned oracle imports Schema once",
        );
      }

      yield* fs.writeFileString(
        targetOf(module),
        `${bindsSchema(current) ? "" : `${schemaImport}\n`}${current}\n${declarations.join("")}\n`,
      );
    }
  }

  return { original, oracle };
});

interface Lifted {
  readonly project: Project;
  readonly run: LiftRunParams;
}

/** Analyzes the copied original and lifts one group with the selected registry: one canonical request. */
const lifted = Effect.fnUntraced(function* (
  tsconfigPath: string,
  group: CorpusGroup,
  lift: LiftConfig,
) {
  const resolved = yield* resolveProject(tsconfigPath, true, "effect-4.0");
  const project: Project = { ...resolved, config: { ...resolved.config, lift } };

  const prepared = yield* prepareLift(project, { group, module: Option.none(), form: "verbose" });

  return { project, run: prepared.run } satisfies Lifted;
});

const check = Effect.fnUntraced(function* ({ project, run }: Lifted) {
  const checked = yield* runLiftCheck({ run, extensions: project.extensions }).pipe(Effect.orDie);

  assert.isTrue(Option.isSome(checked.value), JSON.stringify(checked.diagnostics));

  return Option.getOrThrow(checked.value);
});

/** Diagnostics with their related causes, bounded, for assertion messages only. */
const describeDiagnostics = (diagnostics: ReadonlyArray<Diagnostic>): string =>
  diagnostics
    .slice(0, 8)
    .flatMap((diagnostic) => [
      `${diagnostic.code} ${diagnostic.message}`,
      ...(diagnostic.related ?? [])
        .slice(0, 12)
        .map(
          (cause) =>
            `  - ${cause.code} ${cause.message}${cause.location === undefined ? "" : ` (${cause.location.file}:${cause.location.line})`}`,
        ),
    ])
    .join("\n");

/** A bounded view of one outcome for assertion messages: never the two complete OpenAPI documents. */
const describeOutcome = (outcome: FormOutcome | undefined): string => {
  if (outcome === undefined) return "not requested";

  if (outcome._tag === "Pass") return `Pass ${outcome.deltas.join(",")}`;

  if (outcome._tag === "Mismatch")
    return `Mismatch\n${outcome.differences.slice(0, 12).join("\n")}`;

  return `Impossible ${outcome.reason}: ${outcome.detail}\n${describeDiagnostics(outcome.diagnostics)}`;
};

/** The same bounded view of the binding gate. */
const describeBinding = (binding: BindingConclusion | undefined): string => {
  if (binding === undefined) return "no check";

  if (binding._tag === "Passed") return `Passed keys=${binding.keyProof.declared.join(",")}`;

  return `${binding._tag}\n${describeDiagnostics(binding.diagnostics)}`;
};

/** An annotation argument that names a symbol: the shape the printer resolves to an import. */
const isSymbolArg = (
  arg: AnnotationArg | undefined,
): arg is Extract<AnnotationArg, { readonly _tag: "Symbol" }> =>
  Predicate.isObject(arg) && Predicate.hasProperty(arg, "_tag") && arg["_tag"] === "Symbol";

/**
 * Re-points the management query's access declaration (the only read-snapshot management operation) at the
 * other read-only directory capability, with that capability's own resolver (§5.5): a different AccessSpec
 * that the human decoder and the decision-time rules both accept. Every other declaration is unchanged.
 */
const repointed = (options: Options): Options => {
  const resolver = options["canonicalScopeResolver"];

  return JSON.stringify(options).includes("schools.manage") &&
    options["decisionTime"] === "SnapshotRead" &&
    isSymbolArg(resolver)
    ? {
        ...options,
        capabilities: { _tag: "One", capability: "schools.read-directory" },
        canonicalScopeResolver: {
          ...resolver,
          ref: { ...resolver.ref, export: "SchoolsDirectoryResolver" },
        },
      }
    : options;
};

/** A real wire difference: the differing path is named in the report. */
const expectMismatch = (
  outcome: FormOutcome | undefined,
  names: (difference: string) => boolean,
): void => {
  assert.strictEqual(outcome?._tag, "Mismatch", describeOutcome(outcome));

  if (outcome?._tag === "Mismatch")
    assert.isTrue(outcome.differences.some(names), outcome.differences.join("\n"));
};

/** The declaration file of one group in the oracle project, compiled by THIS compiler. */
const compileOracle = Effect.fnUntraced(function* (
  oracle: { readonly tsconfigPath: string },
  group: CorpusGroup,
) {
  const forward = yield* SourceFrontend;

  const collected = yield* forward.analyze({
    tsconfigPath: oracle.tsconfigPath,
    entry: [`packages/http-api/src/${group}.effx.ts`],
    emit: "contract",
    strictAccess: true,
  });

  const built = yield* compileCollected(collected, Extensions.builtin);

  assert.deepStrictEqual(
    built.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    [],
  );

  return Option.getOrThrow(built.ir.value);
});

/** Every printed suggestion must compile to the canonical IR and hash of the oracle declaration (§10 item 1). */
const matchesOracle = Effect.fnUntraced(function* (
  oracle: { readonly directory: string; readonly tsconfigPath: string },
  group: CorpusGroup,
  suggestions: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const expected = yield* compileOracle(oracle, group);
  const expectedHash = yield* semanticHash(expected);
  const destination = path.join(oracle.directory, `packages/http-api/src/${group}.effx.ts`);

  for (const text of suggestions) {
    yield* fs.writeFileString(destination, text);

    const built = yield* compileOracle(oracle, group);

    assert.strictEqual(canonical(built), canonical(expected));
    assert.strictEqual(yield* semanticHash(built), expectedHash);
  }
});

/** The tail of a CLI run for assertion messages. */
const tail = (run: { readonly stdout: string; readonly stderr: string }): string =>
  `${run.stdout.slice(0, 3_000)}\n${run.stderr.slice(0, 3_000)}`;

/** `effx lift --check --form both --json` through the real process root on the real application. */
const journey = Effect.fnUntraced(function* (group: CorpusGroup) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { original, oracle } = yield* stage(true);

  // The executable config is the reviewed data only: rules, names, output and the one opaque projector.
  yield* fs.writeFileString(
    path.join(original.directory, "effx.config.ts"),
    `export default ${JSON.stringify({ target: "effect-4.0", strictAccess: true, lift: liftOf(group) })};\n`,
  );

  const before = yield* digestTree(original.directory);

  const cli = yield* runCli(original.directory, [
    "lift",
    "--group",
    group,
    "--module",
    `packages/http-api/src/${group}.effx.ts`,
    "--check",
    "--form",
    "both",
    "--json",
  ]);

  // The report is decoded and its parts asserted before the exit code, so a red run names its cause.
  assert.isTrue(cli.stdout.startsWith("{"), tail(cli));

  const report = yield* decodeReport(cli.stdout.trimEnd());
  const verbose = report.check?.verbose;
  const dense = report.check?.dense;
  const binding = report.check?.binding;

  assert.strictEqual(report.check?.group, group);
  assert.strictEqual(verbose?._tag, "Pass", describeOutcome(verbose));
  assert.strictEqual(dense?._tag, "Pass", describeOutcome(dense));
  assert.strictEqual(binding?._tag, "Passed", describeBinding(binding));

  // Every group of this corpus needs source refactors (EFFX3002 to EFFX3004): the printed suggestion is not
  // adoptable until the patch is applied, and that alone raises the exit code (spec 0019 §6). The check
  // itself passed above, so nothing else is an error.
  const errors = report.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

  assert.isAbove(errors.length, 0, tail(cli));

  assert.isTrue(
    errors.every((diagnostic) => refactorCodes.includes(diagnostic.code)),
    JSON.stringify(errors.map((diagnostic) => diagnostic.code)),
  );

  assert.strictEqual(cli.code, 1, tail(cli));

  // The mechanical comparison saw every endpoint of the group on both sides.
  for (const outcome of [verbose, dense])
    if (outcome?._tag === "Pass") {
      const { original: reflected, generated } = outcome.reflections;

      assert.strictEqual(reflected.endpoints.length, endpointCounts[group]);
      assert.deepStrictEqual(
        generated.endpoints
          .map((endpoint) => `${endpoint.group}.${endpoint.identifier}`)
          .toSorted(),
        reflected.endpoints
          .map((endpoint) => `${endpoint.group}.${endpoint.identifier}`)
          .toSorted(),
      );
    }

  if (binding?._tag === "Passed") {
    assert.deepStrictEqual(binding.keyProof.missing, []);
    assert.deepStrictEqual(binding.keyProof.extra, []);
    assert.strictEqual(binding.keyProof.declared.length, endpointCounts[group]);
    assert.strictEqual(binding.receipt.exit, 0);
  }

  // Both printed forms keep every explicit status witness, including 200 (§0.7), and one text per form.
  assert.strictEqual(report.suggestions.length, 2);

  for (const text of report.suggestions) {
    assert.include(text, "status: 200");

    if (group === "social-events") assert.include(text, "status: 201");
  }

  yield* matchesOracle(oracle, group, report.suggestions);

  // The analyzed application is read, never written: the config file is the only thing this test added.
  assert.deepStrictEqual(yield* digestTree(original.directory), before);
});

describe("effx lift --check on the real stable corpus (spec 0019 §10 items 1 and 3)", () => {
  it.live.each(corpusGroups)(
    "checks %s on the real application: both forms, the binding gate and the dense oracle",
    (group) => journey(group).pipe(Effect.scoped, Effect.provide(services)),
    deadline,
  );

  it.live(
    "fails with the differing path when the real summary, media type or status changes the wire",
    () =>
      Effect.gen(function* () {
        const { original } = yield* stage(true);
        const before = yield* digestTree(original.directory);
        const base = yield* lifted(original.tsconfigPath, "profile", liftOf("profile"));

        // The explicit source 200 survives the lift: it is what the status control changes.
        const contracts = base.run.result.collected.declarations.flatMap((declaration) =>
          declaration.annotations.filter((annotation) => annotation.name === "Http.Contract"),
        );

        assert.strictEqual(contracts.length, endpointCounts.profile);
        assert.isTrue(
          contracts.every((annotation) => JSON.stringify(annotation.args).includes('"status":200')),
        );

        const summary = yield* check({
          project: base.project,
          run: withAnnotation(base.run, "Http.Contract", (options) => ({
            ...options,
            metadata: { ...metadataOf(options), summary: "Mutated summary" },
          })),
        });

        expectMismatch(
          summary.verbose,
          (difference) => difference.startsWith("openapi:") && difference.includes("summary"),
        );

        const media = yield* check({
          project: base.project,
          run: withAnnotation(base.run, "Http.Contract", (options) =>
            options["mediaType"] === undefined
              ? options
              : { ...options, mediaType: "application/json" },
          ),
        });

        expectMismatch(media.verbose, (difference) => difference.includes("requestBody"));

        const status = yield* check({
          project: base.project,
          run: withAnnotation(base.run, "Http.Contract", (options) => ({
            ...options,
            status: 201,
          })),
        });

        expectMismatch(status.verbose, (difference) => difference.includes("responses"));

        // The binding gate is independent evidence: the keys agree and the typecheck passes either way.
        assert.strictEqual(summary.binding._tag, "Passed", JSON.stringify(summary.binding));
        assert.deepStrictEqual(yield* digestTree(original.directory), before);
      }).pipe(Effect.scoped, Effect.provide(services)),
    deadline,
  );

  it.live(
    "lets an explicit 200 override the source 201 and names the differing response",
    () =>
      Effect.gen(function* () {
        const { original } = yield* stage(true);
        const base = yield* lifted(original.tsconfigPath, "social-events", liftOf("social-events"));

        const overridden = yield* check({
          project: base.project,
          run: withAnnotation(base.run, "Http.Contract", (options) =>
            options["status"] === 201 ? { ...options, status: 200 } : options,
          ),
        });

        expectMismatch(overridden.verbose, (difference) => difference.includes("responses"));
      }).pipe(Effect.scoped, Effect.provide(services)),
    deadline,
  );

  it.live(
    "reports a changed access projection and a missing access projection, never a pass",
    () =>
      Effect.gen(function* () {
        const { original } = yield* stage(true);
        const directory = yield* lifted(original.tsconfigPath, "directory", liftOf("directory"));

        // The management query re-pointed at the other read-only directory capability, with that capability's
        // own resolver and its snapshot decision time: valid for the human adapter's decoder and for the
        // compiler's decision-time rules, so both sides build and only the application's own projection of the
        // AccessSpec differs. The command keeps its declaration.
        const changed = yield* check({
          project: directory.project,
          run: withAnnotation(directory.run, "Http.Access", repointed),
        });

        expectMismatch(changed.verbose, (difference) => difference.includes("projections"));

        // Without the access declaration the generated endpoints carry no AccessSpec at all.
        const social = yield* lifted(
          original.tsconfigPath,
          "social-events",
          liftOf("social-events"),
        );

        const lenient: Lifted = {
          project: { ...social.project, config: { ...social.project.config, strictAccess: false } },
          run: {
            ...withoutAnnotation(social.run, "Http.Access"),
            project: { ...social.run.project, strictAccess: false },
          },
        };

        const missing = yield* check(lenient);

        expectMismatch(missing.verbose, (difference) => difference.includes("projections"));
      }).pipe(Effect.scoped, Effect.provide(services)),
    deadline,
  );

  it.live(
    "reports a projection hook the application does not export as inability, never a pass",
    () =>
      Effect.gen(function* () {
        const { original } = yield* stage(true);

        const base = yield* lifted(
          original.tsconfigPath,
          "profile",
          liftOf("profile", "reflectNoSuchAccessSpec"),
        );

        const result = yield* check(base);

        assert.strictEqual(result.verbose?._tag, "Impossible", describeOutcome(result.verbose));

        if (result.verbose?._tag === "Impossible")
          assert.strictEqual(result.verbose.reason, "projection-hook");
      }).pipe(Effect.scoped, Effect.provide(services)),
    deadline,
  );

  it.live(
    "reports a missing adapter prerequisite as an overlay compile inability, never a pass",
    () =>
      Effect.gen(function* () {
        const { original } = yield* stage(false);
        const before = yield* digestTree(original.directory);
        const base = yield* lifted(original.tsconfigPath, "profile", liftOf("profile"));
        const result = yield* check(base);

        assert.strictEqual(result.verbose?._tag, "Impossible", describeOutcome(result.verbose));

        if (result.verbose?._tag === "Impossible") {
          assert.strictEqual(result.verbose.reason, "overlay-compile");

          // The cause is the unresolved adapter prerequisite itself: the problem registry the rules name.
          assert.isTrue(
            result.verbose.diagnostics
              .flatMap((diagnostic) => diagnostic.related ?? [])
              .some(
                (cause) => cause.code === "EFFX1102" && cause.message.includes("nativeProblems"),
              ),
            describeOutcome(result.verbose),
          );
        }

        assert.notStrictEqual(result.binding._tag, "Passed");
        assert.deepStrictEqual(yield* digestTree(original.directory), before);
      }).pipe(Effect.scoped, Effect.provide(services)),
    deadline,
  );
});
