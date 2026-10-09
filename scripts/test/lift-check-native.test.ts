// @effect-diagnostics unstableApiUsage:off -- EX-0034: real native child execution of the lift check.
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { SchemaArg, type AnnotationArg, type ProjectConfig } from "@effx/compiler";
import { LiftTsSourceFrontend, TsSourceFrontend } from "@effx/frontend-ts";
import {
  prepareLift,
  resolveProject,
  runLiftCheck,
  type LiftCheckBounds,
  type LiftForm,
  type LiftRunParams,
  type Project,
} from "@effx/cli";
import { digestTree } from "../../tools/testing/projects.ts";
import { liftCheckExecutionLayer, liftToolchainLayer } from "../lift-execution.ts";
import {
  api,
  metadataOf,
  miniFiles,
  miniProject,
  projection,
  withAnnotation,
  writeProject,
  type Fixture,
  type Options,
} from "./lift-fixtures.ts";

/** The real services of the check: production frontends, the Bun platform, the one native adapter. */
const services = Layer.mergeAll(
  TsSourceFrontend.layer,
  LiftTsSourceFrontend.layer,
  liftCheckExecutionLayer,
  liftToolchainLayer,
).pipe(Layer.provideMerge(BunServices.layer));

interface Lifted {
  readonly project: Project;
  readonly run: LiftRunParams;
}

/** Analyze and lift the `profile` group of a fixture with the selected registry; one canonical request. */
const lifted = Effect.fnUntraced(function* (
  fixture: Fixture,
  options: { readonly lift?: ProjectConfig["lift"]; readonly form?: LiftForm } = {},
) {
  const path = yield* Path.Path;
  const resolved = yield* resolveProject(fixture.tsconfigPath, undefined, "effect-4.0");

  const project: Project =
    options.lift === undefined
      ? resolved
      : { ...resolved, config: { ...resolved.config, lift: options.lift } };

  const prepared = yield* prepareLift(project, {
    group: "profile",
    module: Option.some(path.join(fixture.directory, "src/profile.effx.ts")),
    form: options.form ?? "both",
  });

  return { project, run: prepared.run } satisfies Lifted;
});

const check = Effect.fnUntraced(function* ({ project, run }: Lifted, bounds?: LiftCheckBounds) {
  const checked = yield* runLiftCheck(
    bounds === undefined
      ? { run, extensions: project.extensions }
      : { run, extensions: project.extensions, bounds },
  ).pipe(Effect.orDie);

  assert.isTrue(Option.isSome(checked.value), JSON.stringify(checked.diagnostics));

  return Option.getOrThrow(checked.value);
});

/** The same lift with every `Http.Contract` option bag rewritten before the real stages process it. */
const withContract = (run: LiftRunParams, rewrite: (options: Options) => Options): LiftRunParams =>
  withAnnotation(run, "Http.Contract", rewrite);

/** A bounded check that keeps the dense form out, for controls that rewrite the verbose bytes. */
const verboseOnly = ({ project, run }: Lifted): Lifted => ({
  project,
  run: { ...run, form: "verbose", dense: Option.none() },
});

const summaryProjection = (module: string): ProjectConfig["lift"] => ({
  rules: [],
  names: {},
  output: { module },
  projections: [
    {
      key: { module: "../../src/projection", export: "SummaryKey" },
      hook: { module: "../../src/projection", export: "summaryOf" },
    },
  ],
});

describe("effx lift --check on a real Bun child (spec 0019 §2.4)", () => {
  it.live(
    "passes both forms and the binding gate on an exact lift without touching the original",
    () =>
      Effect.gen(function* () {
        const fixture = yield* miniProject;
        const before = yield* digestTree(fixture.directory);
        const result = yield* check(yield* lifted(fixture));

        assert.strictEqual(result.group, "profile");
        assert.strictEqual(result.verbose?._tag, "Pass", JSON.stringify(result.verbose));
        assert.strictEqual(result.dense?._tag, "Pass", JSON.stringify(result.dense));
        assert.strictEqual(result.binding._tag, "Passed", JSON.stringify(result.binding));

        if (result.binding._tag === "Passed") {
          assert.deepStrictEqual(result.binding.keyProof, {
            declared: ["readOwnProfile", "updateOwnProfile"],
            bound: ["readOwnProfile", "updateOwnProfile"],
            missing: [],
            extra: [],
          });
          assert.strictEqual(result.binding.receipt.stage, "overlay-binding-typecheck");
          assert.strictEqual(result.binding.receipt.exit, 0);
        }

        // The mechanical comparison saw two real reflections of the same two endpoints.
        if (result.verbose?._tag === "Pass") {
          const { original, generated } = result.verbose.reflections;

          assert.deepStrictEqual(
            original.endpoints.map((endpoint) => endpoint.identifier).toSorted(),
            ["readOwnProfile", "updateOwnProfile"],
          );
          assert.deepStrictEqual(
            generated.endpoints.map((endpoint) => endpoint.identifier).toSorted(),
            ["readOwnProfile", "updateOwnProfile"],
          );
        }

        // Nothing is written outside the scoped overlay: the authored project is byte-identical.
        assert.deepStrictEqual(yield* digestTree(fixture.directory), before);
      }).pipe(Effect.scoped, Effect.provide(services)),
    300_000,
  );

  it.live(
    "fails with the differing path when the suggested summary, media type or status changes the wire",
    () =>
      Effect.gen(function* () {
        const fixture = yield* miniProject;
        const base = yield* lifted(fixture);

        const summary = yield* check({
          project: base.project,
          run: withContract(base.run, (options) => ({
            ...options,
            metadata: { ...metadataOf(options), summary: "Mutated summary" },
          })),
        });

        assert.strictEqual(summary.verbose?._tag, "Mismatch", JSON.stringify(summary.verbose));

        if (summary.verbose?._tag === "Mismatch") {
          assert.isTrue(
            summary.verbose.differences.some(
              (difference) => difference.startsWith("openapi:") && difference.includes("summary"),
            ),
            summary.verbose.differences.join("\n"),
          );
        }

        const media = yield* check({
          project: base.project,
          run: withContract(base.run, (options) =>
            options["payload"] === undefined
              ? options
              : { ...options, mediaType: "application/merge-patch+json" },
          ),
        });

        assert.strictEqual(media.verbose?._tag, "Mismatch", JSON.stringify(media.verbose));

        if (media.verbose?._tag === "Mismatch") {
          assert.isTrue(
            media.verbose.differences.some((difference) => difference.includes("requestBody")),
            media.verbose.differences.join("\n"),
          );
        }

        const status = yield* check({
          project: base.project,
          run: withContract(base.run, (options) => ({ ...options, status: 201 })),
        });

        assert.strictEqual(status.verbose?._tag, "Mismatch", JSON.stringify(status.verbose));

        if (status.verbose?._tag === "Mismatch") {
          assert.isTrue(
            status.verbose.differences.some((difference) => difference.includes("responses")),
            status.verbose.differences.join("\n"),
          );
        }

        // The binding gate is independent evidence: keys agree and the typecheck passes either way.
        assert.strictEqual(summary.binding._tag, "Passed");
      }).pipe(Effect.scoped, Effect.provide(services)),
    600_000,
  );

  it.live(
    "runs registered opaque-Context projections on both sides and reports their difference",
    () =>
      Effect.gen(function* () {
        const fixture = yield* writeProject({ ...miniFiles, "src/projection.ts": projection }, [
          "src/api.ts",
          "src/projection.ts",
        ]);

        const base = yield* lifted(fixture, { lift: summaryProjection("../../src/profile.effx") });

        const exact = yield* check(verboseOnly(base));

        assert.strictEqual(exact.verbose?._tag, "Pass", JSON.stringify(exact.verbose));

        if (exact.verbose?._tag === "Pass") {
          const name = "../../src/projection#SummaryKey";

          for (const side of [
            exact.verbose.reflections.original,
            exact.verbose.reflections.generated,
          ])
            for (const endpoint of side.endpoints)
              assert.deepStrictEqual(endpoint.projections, { [name]: null });
        }

        const mutated = yield* check({
          project: base.project,
          run: withContract(base.run, (options) => ({
            ...options,
            metadata: { ...metadataOf(options), summary: "Mutated summary" },
          })),
        });

        assert.strictEqual(mutated.verbose?._tag, "Mismatch", JSON.stringify(mutated.verbose));

        if (mutated.verbose?._tag === "Mismatch") {
          assert.isTrue(
            mutated.verbose.differences.some((difference) => difference.includes("projections")),
            mutated.verbose.differences.join("\n"),
          );
        }
      }).pipe(Effect.scoped, Effect.provide(services)),
    600_000,
  );

  it.live(
    "reports a projection hook module outside the analyzed project as inability, never a pass",
    () =>
      Effect.gen(function* () {
        const fixture = yield* miniProject;

        const base = yield* lifted(fixture, {
          lift: {
            rules: [],
            names: {},
            output: { module: "../../src/profile.effx" },
            projections: [
              {
                key: { module: "../../src/nowhere", export: "Key" },
                hook: { module: "../../src/nowhere", export: "hook" },
              },
            ],
          },
        });

        const result = yield* check(verboseOnly(base));

        assert.strictEqual(result.verbose?._tag, "Impossible", JSON.stringify(result.verbose));

        if (result.verbose?._tag === "Impossible")
          assert.strictEqual(result.verbose.reason, "projection-hook");
      }).pipe(Effect.scoped, Effect.provide(services)),
    300_000,
  );

  it.live(
    "reports a suggestion that does not compile as an impossible form",
    () =>
      Effect.gen(function* () {
        const fixture = yield* miniProject;
        const base = yield* lifted(fixture);

        const result = yield* check({
          project: base.project,
          run: withContract(base.run, (options) => {
            const success = options["success"];

            if (!Schema.is(SchemaArg)(success)) return options;

            const renamed: AnnotationArg = {
              _tag: "Schema",
              ref: { ...success.ref, export: "NoSuchSchema" },
            };

            return { ...options, success: renamed };
          }),
        });

        assert.strictEqual(result.verbose?._tag, "Impossible", JSON.stringify(result.verbose));

        if (result.verbose?._tag === "Impossible")
          assert.strictEqual(result.verbose.reason, "overlay-compile");

        assert.notStrictEqual(result.binding._tag, "Passed");
      }).pipe(Effect.scoped, Effect.provide(services)),
    300_000,
  );

  it.live(
    "keeps private values out of the report when the original module fails or prints noise",
    () =>
      Effect.gen(function* () {
        const secret = "private-token-must-not-leak";

        const throwing = yield* writeProject(
          {
            ...miniFiles,
            "src/api.ts": `${api}\nif (Date.now() > 0) throw new Error("${secret}");\n`,
          },
          ["src/api.ts"],
        );

        const failed = yield* check(verboseOnly(yield* lifted(throwing)));

        assert.strictEqual(failed.verbose?._tag, "Impossible", JSON.stringify(failed.verbose));

        if (failed.verbose?._tag === "Impossible") {
          assert.strictEqual(failed.verbose.reason, "root-build");
          assert.include(failed.verbose.detail, "import-original");
        }

        assert.notInclude(JSON.stringify(failed), secret);

        const noisy = yield* writeProject(
          { ...miniFiles, "src/api.ts": `${api}\nconsole.log("${secret}-on-stdout");\n` },
          ["src/api.ts"],
        );

        const passed = yield* check(verboseOnly(yield* lifted(noisy)));

        assert.strictEqual(passed.verbose?._tag, "Pass", JSON.stringify(passed.verbose));
        assert.notInclude(JSON.stringify(passed), secret);
      }).pipe(Effect.scoped, Effect.provide(services)),
    600_000,
  );

  it.live(
    "stops a hung original at the explicit deadline and reports the observed stop",
    () =>
      Effect.gen(function* () {
        const fixture = yield* writeProject(
          { ...miniFiles, "src/api.ts": `${api}\nawait new Promise<never>(() => undefined);\n` },
          ["src/api.ts"],
        );

        const result = yield* check(verboseOnly(yield* lifted(fixture)), {
          captureBytes: 1_048_576,
          witnessDeadlineMs: 3_000,
          typecheckDeadlineMs: 120_000,
        });

        assert.strictEqual(result.verbose?._tag, "Impossible", JSON.stringify(result.verbose));

        if (result.verbose?._tag === "Impossible") {
          assert.strictEqual(result.verbose.reason, "root-build");
          assert.match(result.verbose.detail, /stopped \(deadline\) after \d+ms/u);
        }
      }).pipe(Effect.scoped, Effect.provide(services)),
    300_000,
  );

  it.live(
    "refuses a witness document that exceeds the capture bound",
    () =>
      Effect.gen(function* () {
        const fixture = yield* miniProject;

        const result = yield* check(verboseOnly(yield* lifted(fixture)), {
          captureBytes: 64,
          witnessDeadlineMs: 60_000,
          typecheckDeadlineMs: 120_000,
        });

        assert.strictEqual(result.verbose?._tag, "Impossible", JSON.stringify(result.verbose));

        if (result.verbose?._tag === "Impossible")
          assert.include(result.verbose.detail, "capture bound");
      }).pipe(Effect.scoped, Effect.provide(services)),
    300_000,
  );

  it.live(
    "fails both the wire and the binding when an endpoint cannot be lifted",
    () =>
      Effect.gen(function* () {
        const fixture = yield* writeProject(
          {
            ...miniFiles,
            "src/api.ts": api
              .replace(
                "export class ProfileGroup",
                'export const RemoveOwnProfile = HttpApiEndpoint.delete("removeOwnProfile", "/profile", { success: ProfileResponse });\nexport class ProfileGroup',
              )
              .replace(
                ".add(ReadOwnProfile, UpdateOwnProfile)",
                ".add(ReadOwnProfile, UpdateOwnProfile, RemoveOwnProfile)",
              ),
          },
          ["src/api.ts"],
        );

        const base = yield* lifted(fixture);

        assert.strictEqual(base.run.result.unsupported.length, 1);

        const result = yield* check(verboseOnly(base));

        assert.strictEqual(result.verbose?._tag, "Mismatch", JSON.stringify(result.verbose));
        assert.strictEqual(result.binding._tag, "Failed", JSON.stringify(result.binding));

        if (result.binding._tag === "Failed") {
          assert.deepStrictEqual(result.binding.keyProof?.missing, ["removeOwnProfile"]);
          assert.isTrue(
            result.binding.diagnostics.some((diagnostic) => diagnostic.code === "EFFX3201"),
          );
        }
      }).pipe(Effect.scoped, Effect.provide(services)),
    300_000,
  );

  it.live(
    "keeps the executed typecheck receipt when an unrelated type error fails the binding gate",
    () =>
      Effect.gen(function* () {
        const fixture = yield* writeProject(
          {
            ...miniFiles,
            "src/api.ts": `import "./broken.ts";\n${api}`,
            "src/broken.ts": 'export const broken: number = "not a number";\n',
          },
          ["src/api.ts"],
        );

        const result = yield* check(verboseOnly(yield* lifted(fixture)));

        // The runtime wire is exact; only the type-level binding evidence fails, with its real receipt.
        assert.strictEqual(result.verbose?._tag, "Pass", JSON.stringify(result.verbose));
        assert.strictEqual(result.binding._tag, "Failed", JSON.stringify(result.binding));

        if (result.binding._tag === "Failed") {
          assert.isDefined(result.binding.receipt);
          assert.notStrictEqual(result.binding.receipt?.exit, 0);
          assert.isTrue(
            result.binding.diagnostics.some((diagnostic) => diagnostic.message.includes("TS2322")),
            JSON.stringify(result.binding.diagnostics),
          );
        }
      }).pipe(Effect.scoped, Effect.provide(services)),
    300_000,
  );

  it.live(
    "applies verified refactors only in the overlay and refuses a stale analyzed source",
    () =>
      Effect.gen(function* () {
        const inline = api.replace(
          "{ query: ProfileQuery,",
          "{ query: Schema.Struct({ expand: Schema.optionalKey(Schema.String) }),",
        );

        const fixture = yield* writeProject({ ...miniFiles, "src/api.ts": inline }, ["src/api.ts"]);
        const before = yield* digestTree(fixture.directory);
        const base = yield* lifted(fixture);

        assert.isAbove(base.run.result.refactors.length, 0);

        const passed = yield* check(base);

        assert.strictEqual(passed.verbose?._tag, "Pass", JSON.stringify(passed.verbose));
        assert.strictEqual(passed.binding._tag, "Passed", JSON.stringify(passed.binding));
        assert.deepStrictEqual(yield* digestTree(fixture.directory), before);

        // The analyzed text changes after the refactors were planned: the SHA check refuses them.
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        yield* fs.writeFileString(
          path.join(fixture.directory, "src/api.ts"),
          `${inline}\n// drift\n`,
        );

        const stale = yield* check(verboseOnly(base));

        assert.strictEqual(stale.verbose?._tag, "Impossible", JSON.stringify(stale.verbose));

        if (stale.verbose?._tag === "Impossible") {
          assert.strictEqual(stale.verbose.reason, "overlay-compile");
          assert.include(stale.verbose.detail, "changed after it was analyzed");
        }
      }).pipe(Effect.scoped, Effect.provide(services)),
    600_000,
  );
});
