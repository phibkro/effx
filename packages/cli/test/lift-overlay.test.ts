import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { digestTree, testDirectory } from "../../../tools/testing/projects.ts";
import { makeOverlay } from "../src/lift-overlay.ts";

const OverlayConfig = Schema.fromJsonString(
  Schema.Struct({
    extends: Schema.String,
    include: Schema.Array(Schema.String),
    files: Schema.Array(Schema.String),
    compilerOptions: Schema.Struct({ noEmit: Schema.Boolean }),
  }),
);

/** The highest ancestor of a directory, itself included, that holds a `node_modules`: the overlay's mirror root. */
const highestHolder = Effect.fnUntraced(function* (start: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let highest = start;

  for (let current = start; ; current = path.dirname(current)) {
    if (yield* fs.exists(path.join(current, "node_modules"))) highest = current;

    if (path.dirname(current) === current) return highest;
  }
});

/** An authored project that carries everything the overlay must copy, share or withhold. */
const project = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* testDirectory("lift-overlay-");

  const files = {
    "package.json": "{}\n",
    "tsconfig.json": "{}\n",
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 2;\n",
    ".env": "SECRET=top-secret\n",
    ".env.local": "SECRET=local-secret\n",
    "bunfig.toml": "[install]\n",
    ".npmrc": "//registry.npmjs.org/:_authToken=secret\n",
    ".netrc": "machine example login me password secret\n",
    ".git/config": "[core]\n",
    "secret/.env.production": "SECRET=prod-secret\n",
    "node_modules/pkg/index.js": "module.exports = 1;\n",
    "data/file.txt": "shared\n",
  };

  for (const [name, text] of Object.entries(files)) {
    yield* fs.makeDirectory(path.dirname(path.join(directory, name)), { recursive: true });
    yield* fs.writeFileString(path.join(directory, name), text);
  }

  yield* fs.symlink("../data", path.join(directory, "src/linked"));
  yield* fs.symlink("../nowhere", path.join(directory, "src/dangling"));

  return directory;
});

describe("the scoped lift-check overlay (spec 0019 §2.4 steps 1-3)", () => {
  it.effect("mirrors the project, shares node_modules and withholds secrets", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* project();
      const top = yield* highestHolder(directory);
      const before = yield* digestTree(directory);

      const root = yield* Effect.scoped(
        Effect.gen(function* () {
          const overlay = yield* makeOverlay({
            projectRoot: directory,
            tsconfigPath: path.join(directory, "tsconfig.json"),
            patched: [
              { file: path.join(directory, "src/a.ts"), contents: "export const a = 99;\n" },
            ],
            suggestion: {
              file: path.join(directory, "src/profile.effx.ts"),
              contents: "export const Suggested = 1;\n",
            },
          });

          // The overlay mirrors the path from the highest `node_modules` ancestor to the project root.
          assert.strictEqual(
            overlay.projectRoot,
            path.join(overlay.root, path.relative(top, directory)),
          );

          // Verified refactor results replace the copy only; every other file is a byte copy.
          assert.strictEqual(
            yield* fs.readFileString(path.join(overlay.projectRoot, "src/a.ts")),
            "export const a = 99;\n",
          );
          assert.strictEqual(
            yield* fs.readFileString(path.join(overlay.projectRoot, "src/b.ts")),
            "export const b = 2;\n",
          );
          assert.strictEqual(
            yield* fs.readFileString(overlay.suggestionFile),
            "export const Suggested = 1;\n",
          );

          // Nothing that can carry a credential or a VCS state is copied, at any depth.
          for (const withheld of [
            ".env",
            ".env.local",
            "bunfig.toml",
            ".npmrc",
            ".netrc",
            ".git",
            "secret/.env.production",
          ])
            assert.isFalse(
              yield* fs.exists(path.join(overlay.projectRoot, withheld)),
              `${withheld} must not be copied`,
            );

          // node_modules is shared read-only at the project and at the highest ancestor holding one.
          assert.strictEqual(
            yield* fs.realPath(path.join(overlay.projectRoot, "node_modules")),
            yield* fs.realPath(path.join(directory, "node_modules")),
          );
          assert.strictEqual(
            yield* fs.realPath(path.join(overlay.root, "node_modules")),
            yield* fs.realPath(path.join(top, "node_modules")),
          );

          // A link keeps pointing at its real target; a dangling one is not copied.
          assert.strictEqual(
            yield* fs.realPath(path.join(overlay.projectRoot, "src/linked")),
            yield* fs.realPath(path.join(directory, "data")),
          );
          assert.isFalse(yield* fs.exists(path.join(overlay.projectRoot, "src/dangling")));

          // The compile project extends the copied tsconfig and narrows the program to the suggestion.
          const compile = yield* Schema.decodeEffect(OverlayConfig)(
            yield* fs.readFileString(overlay.tsconfigPath),
          );

          assert.deepStrictEqual(compile, {
            extends: "./tsconfig.json",
            include: [],
            files: ["src/profile.effx.ts"],
            compilerOptions: { noEmit: true },
          });

          assert.deepStrictEqual(
            overlay.locate(path.join(directory, "src/a.ts")),
            Option.some(path.join(overlay.projectRoot, "src/a.ts")),
          );
          assert.isTrue(Option.isNone(overlay.locate(path.join(path.dirname(directory), "x.ts"))));

          // Generated artifacts and extra projects land inside the overlay only.
          const written = yield* overlay.writeFile(".effx/lift-check.ts", "// witness\n");

          assert.strictEqual(written, path.join(overlay.projectRoot, ".effx/lift-check.ts"));

          const extra = yield* overlay.writeProject("tsconfig.extra.json", [written]);

          assert.strictEqual(path.dirname(extra), path.dirname(overlay.tsconfigPath));

          assert.deepStrictEqual(
            (yield* Schema.decodeEffect(OverlayConfig)(yield* fs.readFileString(extra))).files,
            [".effx/lift-check.ts"],
          );

          return overlay.root;
        }),
      );

      // The scope owns the overlay and the original is byte-identical, links and all.
      assert.isFalse(yield* fs.exists(root));
      assert.deepStrictEqual(yield* digestTree(directory), before);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("reports a refactored file outside the project root as data, not an IO fault", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const directory = yield* project();
      const before = yield* digestTree(directory);

      const failure = yield* Effect.flip(
        makeOverlay({
          projectRoot: directory,
          tsconfigPath: path.join(directory, "tsconfig.json"),
          patched: [{ file: path.join(path.dirname(directory), "outside.ts"), contents: "x\n" }],
          suggestion: { file: path.join(directory, "src/profile.effx.ts"), contents: "x\n" },
        }),
      );

      assert.strictEqual(failure._tag, "OverlayUnavailable");

      if (failure._tag === "OverlayUnavailable")
        assert.include(failure.detail, "outside the project root");

      assert.deepStrictEqual(yield* digestTree(directory), before);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("extends a tsconfig that lives outside the project root by its absolute path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* project();
      const base = path.join(path.dirname(directory), "tsconfig.shared.json");

      yield* fs.writeFileString(base, "{}\n");

      yield* Effect.addFinalizer(() => Effect.orDie(fs.remove(base, { force: true })));

      const overlay = yield* makeOverlay({
        projectRoot: directory,
        tsconfigPath: base,
        patched: [],
        suggestion: { file: path.join(directory, "src/profile.effx.ts"), contents: "x\n" },
      });

      const compile = yield* Schema.decodeEffect(OverlayConfig)(
        yield* fs.readFileString(overlay.tsconfigPath),
      );

      assert.strictEqual(compile.extends, base);
      assert.strictEqual(path.dirname(overlay.tsconfigPath), overlay.projectRoot);
      assert.deepStrictEqual(compile.files, ["src/profile.effx.ts"]);
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
