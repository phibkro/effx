import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import {
  Extensions,
  LiftFrontend,
  SourceFrontend,
  compileCollected,
  dense,
  lift,
  liftRegistryOf,
  printSuggestion,
} from "@effx/compiler";
import { LiftTsSourceFrontend, TsSourceFrontend } from "@effx/frontend-ts";
import { canonical, semanticHash } from "@effx/ir";
import { Effect, FileSystem, Layer, Option, Path, Result, Schema } from "effect";
import { copyLiftCorpus, requireLiftCorpusRuntime, snapshotDiagnostics } from "./lift-corpus.ts";
import { app, corpusGroups, inputOf } from "./lift-corpus-input.ts";

requireLiftCorpusRuntime();

const Services = Layer.mergeAll(LiftTsSourceFrontend.layer, TsSourceFrontend.layer).pipe(
  Layer.provideMerge(BunServices.layer),
);

const registry = liftRegistryOf(Extensions.builtin);

const decodeInstalled = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
);

const deadline = 120_000;

describe("0019 stable source corpus through the production frontend", () => {
  it.effect(
    "type-checks both stable snapshots against the installed stable Effect runtime",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const copied = yield* copyLiftCorpus();

        assert.deepStrictEqual(
          copied.snapshots.map((snapshot) => snapshot.name),
          ["stable-original", "stable-oracle"],
        );

        for (const snapshot of copied.snapshots) {
          const installed = yield* decodeInstalled(
            yield* fs.readFileString(
              path.join(snapshot.directory, "node_modules/effect/package.json"),
            ),
          );

          // A stable release: major version 4 and no prerelease suffix.
          assert.match(installed.version, /^4\.\d+\.\d+$/u);

          // Only the generated contracts the oracle always left unresolved may fail to resolve.
          assert.deepStrictEqual(
            snapshotDiagnostics(snapshot),
            snapshot.unresolvedGeneratedImports
              .map((entry) => `${entry.from} module not found ${entry.spec}`)
              .toSorted(),
          );
        }
      }).pipe(Effect.provide(Services)),
    deadline,
  );

  it.effect(
    "checks every source hash and records the complete stable root without executing it",
    () =>
      Effect.gen(function* () {
        const copied = yield* copyLiftCorpus();
        const original = copied.snapshots.find((snapshot) => snapshot.name === "stable-original");
        assert.isDefined(original);

        if (original === undefined) return;
        const result = yield* (yield* LiftFrontend).analyze(original);
        const model = Option.getOrThrow(result.value);
        assert.strictEqual(model.project.target, "effect-4.0");
        assert.strictEqual(model.endpoints.length, 108);
        assert.strictEqual(model.groups.length, 16);
        const root = model.roots.find((root) => root.symbol.export === "ExternalNativeApi");
        assert.strictEqual(root?.symbol.module, `${app}/api`);
        assert.isTrue(
          root?.steps.some((step) => step._tag === "Method" && step.name === "middleware"),
        );
        assert.isTrue(
          model.files.some((file) => file.idPath === "packages/http-api/src/http-semantics"),
        );
        assert.isTrue(
          model.values.some((value) => value.symbol.export === "ProfileReadOwnProfileProblem"),
        );
        const headers = model.schemas.find((fact) => fact.ref.export === "ConditionalReadHeaders");
        assert.deepStrictEqual(headers?.allKeys, ["if-match", "if-none-match"]);
        assert.deepStrictEqual(headers?.requiredKeys, []);
        assert.isTrue(
          model.markers.some((fact) => fact.ref.export === "PersonSecurity" && fact.security),
        );
      }).pipe(Effect.provide(Services)),
    deadline,
  );

  it.effect.each(corpusGroups)(
    "rebuilds %s with THIS compiler and compares complete verbose/dense IR and hashes",
    (group) =>
      Effect.gen(function* () {
        const copied = yield* copyLiftCorpus();
        const original = copied.snapshots.find((snapshot) => snapshot.name === "stable-original");
        const oracle = copied.snapshots.find((snapshot) => snapshot.name === "stable-oracle");
        assert.isDefined(original);
        assert.isDefined(oracle);

        if (original === undefined || oracle === undefined) return;
        const model = Option.getOrThrow((yield* (yield* LiftFrontend).analyze(original)).value);
        const input = inputOf(group);
        const result = lift(model, input, registry);
        assert.deepStrictEqual(result.unsupported, []);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const forward = yield* SourceFrontend;

        const config = {
          tsconfigPath: oracle.tsconfigPath,
          entry: [`packages/http-api/src/${group}.effx.ts`],
          emit: "contract" as const,
          strictAccess: true,
        };

        const expectedCollected = yield* forward.analyze(config);
        const expected = yield* compileCollected(expectedCollected, Extensions.builtin);
        assert.deepStrictEqual(
          expected.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        const expectedIR = Option.getOrThrow(expected.ir.value);
        const expectedHash = yield* semanticHash(expectedIR);

        const verbose = printSuggestion(result.collected, {
          module: input.output.module,
          codeReferences: result.codeReferences,
        });

        assert.isTrue(Result.isSuccess(verbose));

        if (Result.isFailure(verbose)) return;
        const destination = path.join(oracle.directory, `packages/http-api/src/${group}.effx.ts`);
        yield* fs.writeFileString(destination, verbose.success);
        const collected = yield* forward.analyze(config);
        const built = yield* compileCollected(collected, Extensions.builtin);
        assert.deepStrictEqual(
          built.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        assert.strictEqual(canonical(Option.getOrThrow(built.ir.value)), canonical(expectedIR));
        assert.strictEqual(yield* semanticHash(Option.getOrThrow(built.ir.value)), expectedHash);

        const denseText = printSuggestion(Option.getOrThrow(dense(result.collected)), {
          module: input.output.module,
          codeReferences: result.codeReferences,
        });

        assert.isTrue(Result.isSuccess(denseText));

        if (Result.isFailure(denseText)) return;
        yield* fs.writeFileString(destination, denseText.success);

        const denseBuilt = yield* compileCollected(
          yield* forward.analyze(config),
          Extensions.builtin,
        );

        assert.deepStrictEqual(
          denseBuilt.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        assert.strictEqual(
          canonical(Option.getOrThrow(denseBuilt.ir.value)),
          canonical(expectedIR),
        );
        assert.strictEqual(
          yield* semanticHash(Option.getOrThrow(denseBuilt.ir.value)),
          expectedHash,
        );
        assert.isTrue(result.codeReferences.every((reference) => reference.codes.length > 0));
      }).pipe(Effect.provide(Services)),
    deadline,
  );
});
