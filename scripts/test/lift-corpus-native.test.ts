// @effect-diagnostics unstableApiUsage:off -- EX-0034: real native child execution of the lift check.
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import {
  Extensions,
  SourceFrontend,
  compileCollected,
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
} from "../../packages/frontend-ts/test/lift-corpus.ts";
import { liftCheckExecutionLayer, liftToolchainLayer } from "../lift-execution.ts";
import { metadataOf, runCli, withAnnotation, withoutAnnotation } from "./lift-fixtures.ts";

/*
 * The real stable corpus through the native check (spec 0019 §10 items 1 and 3). The application is the
 * pinned `stable-original` snapshot (mono-web f433ea90 after the stable-Effect migration): the check
 * executes ITS Profile, Directory and SocialEvents groups and the generated contracts in real Bun children.
 * The lifter rules name the human adapter modules of the pinned 8152 adaptation (the adapter law, §5.5);
 * their exact bytes are verified against the corpus manifest and copied beside the original. The 0024
 * dense oracle is the `stable-oracle` snapshot: the printed suggestions must compile to its canonical IR.
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
 * One fresh copy of both stable snapshots. With `adapters`, the three human adapter modules of the pinned
 * adaptation (hash-verified against the manifest) stand beside the original groups, which are untouched.
 */
const stage = Effect.fnUntraced(function* (adapters: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const copied = yield* copyLiftCorpus();
  const original = snapshotNamed(copied.snapshots, "stable-original");
  const oracle = snapshotNamed(copied.snapshots, "stable-oracle");

  if (adapters) {
    const pinned = snapshotNamed(copied.manifest.snapshots, "stable-oracle");

    for (const group of corpusGroups) {
      const file = Arr.findFirst(
        pinned.files,
        (entry) => entry.path === `packages/http-api/src/${group}-effx-adapters.ts`,
      ).pipe(Option.getOrThrowWith(() => new Error(`the oracle has no ${group} adapter`)));

      const { bytes } = yield* readVerifiedBlob(pinned, file);

      yield* fs.writeFile(path.join(original.directory, file.path), bytes);
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

/** A bounded view of one outcome for assertion messages: never the two complete OpenAPI documents. */
const describeOutcome = (outcome: FormOutcome | undefined): string => {
  if (outcome === undefined) return "not requested";

  if (outcome._tag === "Pass") return `Pass ${outcome.deltas.join(",")}`;

  if (outcome._tag === "Mismatch")
    return `Mismatch\n${outcome.differences.slice(0, 12).join("\n")}`;

  return `Impossible ${outcome.reason}: ${outcome.detail}\n${outcome.diagnostics
    .slice(0, 8)
    .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`)
    .join("\n")}`;
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

  assert.strictEqual(cli.code, 0, tail(cli));

  const report = yield* decodeReport(cli.stdout.trimEnd());
  const verbose = report.check?.verbose;
  const dense = report.check?.dense;
  const binding = report.check?.binding;

  assert.strictEqual(report.check?.group, group);
  assert.strictEqual(verbose?._tag, "Pass", describeOutcome(verbose));
  assert.strictEqual(dense?._tag, "Pass", describeOutcome(dense));
  assert.strictEqual(binding?._tag, "Passed", JSON.stringify(binding));

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

        // Flipping the decision time of the management operations still decodes in the human adapter,
        // so both sides build and only the application's own projection of the AccessSpec differs.
        const changed = yield* check({
          project: directory.project,
          run: withAnnotation(directory.run, "Http.Access", (options) =>
            JSON.stringify(options).includes("schools.manage")
              ? {
                  ...options,
                  decisionTime:
                    options["decisionTime"] === "Transaction" ? "SnapshotRead" : "Transaction",
                }
              : options,
          ),
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

        if (result.verbose?._tag === "Impossible")
          assert.strictEqual(result.verbose.reason, "overlay-compile");

        assert.notStrictEqual(result.binding._tag, "Passed");
        assert.deepStrictEqual(yield* digestTree(original.directory), before);
      }).pipe(Effect.scoped, Effect.provide(services)),
    deadline,
  );
});
