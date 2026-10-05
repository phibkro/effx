import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Extensions, compile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { canonical, semanticHash } from "@effx/ir";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { ManifestJson } from "../src/manifest.ts";

const repoRoot = new URL("../../../", import.meta.url).pathname;

const runtime = new URL("../../runtime/src/index.ts", import.meta.url).pathname;

const main = new URL("../src/main.ts", import.meta.url).pathname;

const Services = Layer.mergeAll(
  BunServices.layer,
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
);

const withProject = Effect.fnUntraced(function* <A, E, R>(
  use: (root: string, project: string) => Effect.Effect<A, E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const root = yield* fs.makeTempDirectoryScoped({
    directory: repoRoot,
    prefix: ".problem-spreads-",
  });

  const project = path.join(root, "tsconfig.json");
  yield* fs.writeFileString(
    project,
    yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        paths: {
          "@effx/runtime": [runtime],
          "@effx/diagnostics": [
            new URL("../../diagnostics/src/index.ts", import.meta.url).pathname,
          ],
          "@effx/runtime/diagnostics": [
            new URL("../../runtime/src/diagnostics.ts", import.meta.url).pathname,
          ],
        },
      },
      include: ["*.ts"],
    }),
  );
  yield* fs.writeFileString(
    path.join(root, "support.ts"),
    `
import { Schema } from "effect";
export const Input = Schema.Struct({});
export const Output = Schema.String;
export const registry = (_identifier: string, _codes: ReadonlyArray<string>): ReadonlyArray<Schema.Top> => [Schema.String];
export const Shared = ["shared.first", "shared.second"] as const;
export const Local = ["local.last"] as const;
export const Nested = [...Shared, ...Local] as const;
`,
  );
  yield* fs.writeFileString(
    path.join(root, "barrel.ts"),
    'export { Nested as Codes, Shared } from "./support.ts";',
  );

  return yield* use(root, project);
});

const source = (codes: string, setup = "", syntax: "builder" | "decorator" = "builder") => `
import { Http, Operation, Query } from "@effx/runtime";
import { Effect } from "effect";
import { Input, Output, registry } from "./support.ts";
import { Codes, Shared } from "./barrel.ts";
import * as Lists from "./support.ts";
${setup}
${
  syntax === "builder"
    ? `
export const read = Operation.query({ name: "test.read", input: Input, success: Output })
  .http.get("/test").http.contract({ group: "test", success: Output })
  .http.problems({ registry, codes: ${codes} }).handler(() => Effect.succeed("ok"));
`
    : `
export class Reads {
  @Query({ name: "test.read", input: Input, success: Output })
  @Http.Get("/test")
  @Http.Contract({ group: "test", success: Output })
  @Http.Problems({ registry, codes: ${codes} })
  static read() { return Effect.succeed("ok"); }
}
`
}
`;

const writeAndCompile = Effect.fnUntraced(function* (root: string, project: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(root, "operation.ts"), text);

  return yield* compile({ tsconfigPath: project, entry: ["operation.ts"] }, Extensions.builtin);
});

describe("problem-code const tuple spreads", () => {
  for (const syntax of ["builder", "decorator"] as const) {
    it.effect(`keeps ${syntax} canonical IR and hash identical to literal lists`, () =>
      withProject((root, project) =>
        Effect.gen(function* () {
          const flat = yield* writeAndCompile(
            root,
            project,
            source(
              '["before", "shared.first", "shared.second", "local.last", "after"]',
              "",
              syntax,
            ),
          );

          const spread = yield* writeAndCompile(
            root,
            project,
            source('["before", ...Alias, "after"] as const', "const Alias = Codes;", syntax),
          );

          assert.deepStrictEqual(
            spread.diagnostics.filter((d) => d.severity === "error"),
            [],
          );
          const flatIr = Option.getOrThrow(flat.ir.value);
          const spreadIr = Option.getOrThrow(spread.ir.value);
          assert.strictEqual(canonical(flatIr), canonical(spreadIr));
          assert.strictEqual(yield* semanticHash(flatIr), yield* semanticHash(spreadIr));
          assert.deepStrictEqual(
            Option.getOrThrow(spread.files.value),
            Option.getOrThrow(flat.files.value),
          );
          const provenance = Option.getOrThrow(spread.collected.value).spreads;
          assert.deepStrictEqual(
            provenance?.map((s) => s.operand),
            ["Alias", "Shared", "Local"],
          );
          assert.isTrue(provenance?.every((s) => s.location.line > 0 && s.location.col > 0));
          assert.notInclude(canonical(spreadIr), '"spreads"');
        }),
      ).pipe(Effect.scoped, Effect.provide(Services)),
    );
  }

  it.effect("retains duplicate-code diagnostics and namespace imports", () =>
    withProject((root, project) =>
      Effect.gen(function* () {
        const flat = yield* writeAndCompile(
          root,
          project,
          source('["shared.first", "shared.first", "shared.second"]'),
        );

        const spread = yield* writeAndCompile(
          root,
          project,
          source('["shared.first", ...Lists.Shared] as const'),
        );

        assert.deepStrictEqual(
          spread.diagnostics.map((d) => d.code),
          flat.diagnostics.map((d) => d.code),
        );
        assert.include(
          spread.diagnostics.map((d) => d.code),
          "EFFX2402",
        );
      }),
    ).pipe(Effect.scoped, Effect.provide(Services)),
  );

  const invalid = [
    { operand: "Mutable", setup: 'const Mutable = ["dynamic"];' },
    {
      operand: "Alias",
      setup: 'const Mutable = ["actual"]; const Alias = Mutable as unknown as readonly ["actual"];',
    },
    {
      operand: "Chained",
      setup:
        'const Mutable = ["actual"]; const Intermediate = Mutable as unknown as readonly ["actual"]; const Chained = Intermediate;',
    },
    {
      operand: "LiteralCast",
      setup: 'const LiteralCast = ["actual"] as unknown as readonly ["actual"];',
    },
    {
      operand: '(Mutable as unknown as readonly ["actual"])',
      setup: 'const Mutable = ["actual"];',
    },
    {
      operand: "ConstLie",
      setup:
        'const Actual = ["actual"] as const; const ConstLie = Actual as unknown as readonly ["asserted"];',
    },
    { operand: "LetTuple", setup: 'let LetTuple = ["dynamic"] as const;' },
    { operand: "Computed", setup: 'const Computed = ["a" + "b"] as const;' },
    { operand: "makeCodes()", setup: 'const makeCodes = () => ["dynamic"] as const;' },
    { operand: "Cycle", setup: 'const Cycle: readonly ["cycle"] = [...Cycle];' },
    { operand: "Lie", setup: 'const Lie = ["actual"] as unknown as readonly ["asserted"];' },
    {
      operand: "Reordered",
      setup: 'const Reordered = ["first", "second"] as unknown as readonly ["second", "first"];',
    },
    { operand: "Unknown", setup: "" },
  ];

  for (const { operand, setup } of invalid) {
    it.effect(`diagnoses ${operand} as data at the spread`, () =>
      withProject((root, project) =>
        Effect.gen(function* () {
          const result = yield* writeAndCompile(
            root,
            project,
            source(`[...${operand}] as const`, setup),
          );

          const diagnostics = result.diagnostics.filter((d) => d.code === "EFFX1102");
          assert.lengthOf(diagnostics, 1);
          assert.include(diagnostics[0]!.message, operand);
          assert.isDefined(diagnostics[0]!.location);
          const fs = yield* FileSystem.FileSystem;
          const text = yield* fs.readFileString(diagnostics[0]!.location!.file);
          const line = text.split("\n")[diagnostics[0]!.location!.line - 1]!;
          assert.strictEqual(
            line.slice(diagnostics[0]!.location!.col - 1, diagnostics[0]!.location!.col + 2),
            "...",
          );
          assert.isTrue(Option.isSome(result.collected.value));
        }),
      ).pipe(Effect.scoped, Effect.provide(Services)),
    );
  }

  it.effect("writes successful spread locations only into the CLI manifest", () =>
    withProject((root, project) =>
      Effect.gen(function* () {
        yield* writeAndCompile(root, project, source("[...Codes] as const"));

        const result = yield* Effect.sync(() =>
          Bun.spawnSync(["bun", main, "build", "--project", project], {
            cwd: repoRoot,
            stdout: "pipe",
            stderr: "pipe",
          }),
        );

        assert.strictEqual(result.exitCode, 0, new TextDecoder().decode(result.stderr));
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const manifest = yield* Schema.decodeEffect(ManifestJson)(
          yield* fs.readFileString(path.join(root, ".effx", "manifest.json")),
        );

        assert.deepStrictEqual(
          manifest.spreads?.map((s) => s.location.file),
          ["operation.ts", "support.ts", "support.ts"],
        );
        const ir = yield* fs.readFileString(path.join(root, ".effx", "ir.json"));
        assert.notInclude(ir, '"spreads"');
        assert.notInclude(ir, '"location"');
      }),
    ).pipe(Effect.scoped, Effect.provide(Services)),
  );
});
