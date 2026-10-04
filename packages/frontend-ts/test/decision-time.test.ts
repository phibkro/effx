import { copyUsersFixture } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { Extensions, compile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { canonical, semanticHash } from "@effx/ir";

/*
 * Spec 0024 §4 on real declarations: leaving `decisionTime` out of `Http.Access` compiles to the IR, hash
 * and generated files of writing the kind's default, in the builder and in the decorator spelling.
 */

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

/** `decisionTime: "…",` lines, which both fixtures spell at the kind's default. */
const decisionTimeLine = /^[ \t]*decisionTime: "(?:SnapshotRead|Transaction)",\n/gmu;

const Names = Schema.Struct({ decisionTime: Schema.optionalKey(Schema.String) });

const decisionTimes = (
  annotations: ReadonlyArray<{ readonly name: string; readonly args: ReadonlyArray<unknown> }>,
) =>
  annotations.flatMap((annotation) =>
    annotation.name === "Http.Access"
      ? [Option.getOrThrow(Schema.decodeUnknownOption(Names)(annotation.args[0])).decisionTime]
      : [],
  );

describe("decisionTime default on real declarations", () => {
  it.effect(
    "builder and decorator declarations that omit it compile like the kind's default",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixtureRoot = yield* copyUsersFixture();
        const tsconfigPath = path.join(fixtureRoot, "tsconfig.json");

        // One file name for both spellings: the IR names the handler's module, so it must not differ.
        const file = path.join(fixtureRoot, "src", "_decision-time.ts");

        yield* Effect.addFinalizer(() => fs.remove(file).pipe(Effect.ignore));

        for (const syntax of ["operations.access.builder.ts", "operations.access.ts"]) {
          const verbose = yield* fs.readFileString(path.join(fixtureRoot, "src", syntax));
          const dense = verbose.replace(decisionTimeLine, "");

          // The test must really remove something: both operations spell their default.
          assert.notStrictEqual(dense, verbose);
          assert.strictEqual(verbose.match(decisionTimeLine)?.length, 2);

          const results = [];

          for (const [label, contents] of [
            ["spelled", verbose],
            ["omitted", dense],
          ] as const) {
            yield* fs.writeFileString(file, contents);

            const result = yield* compile(
              { tsconfigPath, entry: ["src/_decision-time.ts"] },
              Extensions.builtin,
            );

            assert.deepStrictEqual(
              result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
              [],
              `${syntax} ${label}`,
            );
            results.push(result);
          }

          const [spelled, omitted] = results;

          assert.isDefined(spelled);
          assert.isDefined(omitted);

          // Collected keeps what the author wrote: the omitted spelling has no decisionTime to lower.
          assert.deepStrictEqual(
            Option.getOrThrow(spelled.collected.value).declarations.flatMap((declaration) =>
              decisionTimes(declaration.annotations),
            ),
            ["SnapshotRead", "Transaction"],
          );
          assert.deepStrictEqual(
            Option.getOrThrow(omitted.collected.value).declarations.flatMap((declaration) =>
              decisionTimes(declaration.annotations),
            ),
            [undefined, undefined],
          );

          const left = Option.getOrThrow(spelled.ir.value);
          const right = Option.getOrThrow(omitted.ir.value);

          assert.strictEqual(canonical(left), canonical(right));
          assert.strictEqual(yield* semanticHash(left), yield* semanticHash(right));

          const files = Option.getOrThrow(spelled.files.value);

          assert.isAbove(files.length, 0);
          assert.deepStrictEqual(Option.getOrThrow(omitted.files.value), files);
          // The default reached the contract: the generated annotator call carries the resolved value.
          assert.include(
            files.map((file) => file.contents).join("\n"),
            'decisionTime: "Transaction"',
          );
          assert.include(
            files.map((file) => file.contents).join("\n"),
            'decisionTime: "SnapshotRead"',
          );
        }
      }).pipe(Effect.scoped, Effect.provide(Services)),
    120_000,
  );
});
