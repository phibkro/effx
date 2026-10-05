import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { type EmitMode, Extensions, SourceFrontend, compileCollected } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import type { CompilerFault, HttpApiGroupInventory, StageResult } from "@effx/compiler";
import type { SymbolRef } from "@effx/ir";

const testDirectory = new URL("./", import.meta.url).pathname;

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

const declarations = (full: boolean) => `
import { Schema } from "effect";
import { Http, Operation } from "@effx/runtime";
import { Root } from "./root.ts";
export const Input = Schema.Struct({});
export const Output = Schema.String;
export const Profile = Http.group({ root: Root, group: "profile" });
export const Read = Operation.query({ name: "Read", input: Input, success: Output })
  .in(Profile).http.get("/")
  .http.contract({ success: Output, metadata: { operationId: "profile.read" } }).declare();
${
  full
    ? `
export const Onboarding = Http.group({ root: Root, group: "onboarding" });
export const ReadBoard = Operation.query({ name: "ReadBoard", input: Input, success: Output })
  .in(Onboarding).http.get("/board")
  .http.contract({ success: Output, metadata: { operationId: "onboarding.readBoard" } }).declare();
`
    : ""
}
`;

const project = Effect.fnUntraced(function* (authored = false) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ directory: testDirectory });
  const tsconfigPath = path.join(directory, "tsconfig.json");
  yield* fs.writeFileString(
    tsconfigPath,
    '{"extends":"../../../../tsconfig.json","include":["operations.ts"],"exclude":[],"effx":{"projectRoot":"."}}',
  );
  yield* fs.writeFileString(path.join(directory, "operations.ts"), declarations(true));
  yield* fs.writeFileString(
    path.join(directory, "root.ts"),
    `
import { Schema } from "effect";
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "effect/http-api";
${authored ? 'const readBoard = HttpApiEndpoint.get("readBoard", "/board", { success: Schema.String });' : 'import { readBoard } from "./.effx/generated/onboarding-contract.ts";'}
export const Root = HttpApi.make("inventory")
  .add(HttpApiGroup.make("profile").add(HttpApiEndpoint.get("read", "/", { success: Schema.String })))
  .add(HttpApiGroup.make("onboarding").add(readBoard));
`,
  );

  return { directory, tsconfigPath };
});

const compileProject = Effect.fnUntraced(function* (tsconfigPath: string, emit: EmitMode) {
  const collected = yield* SourceFrontend.use((frontend) =>
    frontend.analyze({ tsconfigPath, entry: ["operations.ts"], emit }),
  );

  return yield* compileCollected(collected, Extensions.builtin);
});

describe("cold HttpApi contract bootstrap", () => {
  it.effect.each([
    ["contract", false, 0],
    ["handlers", false, 1],
    ["handlers", true, 0],
  ] as const)(
    "resolver evaluation follows demand (emit=%s fatal=%s calls=%s)",
    ([emit, fatal, expectedCalls]) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { directory, tsconfigPath } = yield* project(true);

        if (fatal) {
          yield* fs.writeFileString(
            path.join(directory, "operations.ts"),
            declarations(true).replace("profile.read", "invalid.read"),
          );
        }

        const collected = yield* SourceFrontend.use((frontend) =>
          frontend.analyze({ tsconfigPath, entry: ["operations.ts"], emit }),
        );

        const resolve: (
          root: SymbolRef,
        ) => Effect.Effect<StageResult<ReadonlyArray<HttpApiGroupInventory>>, CompilerFault> =
          collected.resolveHttpApiInventory!;

        let calls = 0;

        const resolveHttpApiInventory: typeof resolve = (root) =>
          Effect.sync(() => {
            calls++;
          }).pipe(Effect.flatMap(() => resolve(root)));

        const probed = { ...collected, resolveHttpApiInventory };

        assert.strictEqual(calls, 0);
        const result = yield* compileCollected(probed, Extensions.builtin);

        assert.strictEqual(calls, expectedCalls);
        assert.deepStrictEqual(
          result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code),
          fatal ? ["EFFX2403"] : [],
        );

        if (!fatal && emit === "handlers") {
          assert.includeMembers(
            Option.getOrThrow(result.files.value).map((file) => file.path),
            ["profile-handlers.ts", "onboarding-handlers.ts"],
          );
        }
      }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect.each([false, true])(
    "full contract permits full and healthy-only handlers (authored=%s)",
    (authored) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { directory, tsconfigPath } = yield* project(authored);
        const contract = yield* compileProject(tsconfigPath, "contract");
        assert.deepStrictEqual(
          contract.diagnostics.filter((d) => d.severity === "error"),
          [],
        );
        const files = Option.getOrThrow(contract.files.value);
        assert.includeMembers(
          files.map((file) => file.path),
          ["profile-contract.ts", "onboarding-contract.ts"],
        );
        const generated = path.join(directory, ".effx", "generated");
        yield* fs.makeDirectory(generated, { recursive: true });

        for (const file of files) {
          yield* fs.writeFileString(path.join(generated, file.path), file.contents);
        }

        for (const full of [true, false]) {
          yield* fs.writeFileString(path.join(directory, "operations.ts"), declarations(full));
          const handlers = yield* compileProject(tsconfigPath, "handlers");
          assert.deepStrictEqual(
            handlers.diagnostics.filter((d) => d.severity === "error"),
            [],
          );
          assert.isTrue(Option.isSome(handlers.files.value));
        }
      }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("healthy-only contract ignores an unrelated unresolved endpoint leaf", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { directory, tsconfigPath } = yield* project();
      yield* fs.writeFileString(path.join(directory, "operations.ts"), declarations(false));
      const result = yield* compileProject(tsconfigPath, "contract");
      assert.deepStrictEqual(
        result.diagnostics.filter((d) => d.severity === "error"),
        [],
      );
      assert.deepStrictEqual(
        Option.getOrThrow(result.files.value).map((file) => file.path),
        ["profile-contract.ts"],
      );
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect.each([
    [true, "handlers"],
    [false, "handlers"],
    [true, "all"],
    [false, "all"],
  ] as const)("cold root fails atomically without cascades (full=%s emit=%s)", ([full, emit]) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { directory, tsconfigPath } = yield* project();
      yield* fs.writeFileString(path.join(directory, "operations.ts"), declarations(full));
      const result = yield* compileProject(tsconfigPath, emit);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      assert.deepStrictEqual(
        errors.map((d) => d.code),
        ["EFFX2415"],
      );
      assert.include(errors[0]!.message, "readBoard");
      assert.isDefined(errors[0]!.location);
      assert.isTrue(Option.isNone(result.files.value));
      assert.isFalse(yield* fs.exists(path.join(directory, ".effx")));
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
});
