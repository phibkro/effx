import { BunServices } from "@effect/platform-bun";
import { bundledDiagnosticEntries, extension, implement } from "@effx/compiler";
import { DiagnosticEntry, defineDiagnostic, renderEntry } from "@effx/diagnostics";
import { Annotation } from "@effx/runtime";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { testDirectory } from "../../../tools/testing/projects.ts";
import { ManifestJson } from "../src/manifest.ts";

const main = new URL("../../../scripts/effx.ts", import.meta.url).pathname;

const invalidDeclaration = defineDiagnostic(
  {
    code: "EFFX[@fixture/effx-example]/0001",
    owner: "@fixture/effx-example",
    title: "Test extension contract",
    severity: "warning",
    severityPolicy: { kind: "fixed" },
    explanation: "The selected extension found an invalid declaration.",
    examples: [{ before: "invalid()", after: "valid()", explanation: "Use a valid declaration." }],
  } as const satisfies DiagnosticEntry,
  Schema.Struct({ subject: Schema.String }),
  ({ subject }) => `${subject}: invalid declaration`,
);

const customEntry = invalidDeclaration.entry;

const customCode = customEntry.code;

const runExecutable = Effect.fnUntraced(function* (
  executable: string,
  cwd: string,
  ...args: ReadonlyArray<string>
) {
  return yield* Effect.sync(() => {
    const result = Bun.spawnSync(["bun", executable, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      code: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  });
});

const run = (cwd: string, ...args: ReadonlyArray<string>) => runExecutable(main, cwd, ...args);

const fixture = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const directory = yield* testDirectory("explain-test-");

    return yield* use(directory);
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer));

const configSource = (entries: string) =>
  `export default { project: "missing-tsconfig.json", outDir: "must-not-write", extensions: [{ name: "${customEntry.owner}", interpreters: {}, analyses: [], generators: [], diagnosticEntries: ${entries} }] };`;

// Static trusted fixture data, not a boundary decoder.
const entrySource = `{
  code: "${customCode}", owner: "${customEntry.owner}", title: "Test extension contract",
  severity: "warning", severityPolicy: { kind: "fixed" },
  explanation: "The selected extension found an invalid declaration.",
  examples: [{ before: "invalid()", after: "valid()", explanation: "Use a valid declaration." }]
}`;

describe("spec 0016 explain subprocess journeys", () => {
  it("collects registration from implement and extension without changing emitters", () => {
    const definition = Annotation.define({ name: "ExplainTest", target: "operation", args: [] });
    const implementation = implement(definition, { diagnosticEntries: [customEntry] });

    const selected = extension(customEntry.owner, [implementation], {
      diagnosticEntries: [customEntry],
    });

    assert.deepStrictEqual(selected.diagnosticEntries, [customEntry, customEntry]);
    const { code, severity } = invalidDeclaration.emit({ subject: "Users.get" });
    assert.deepStrictEqual(
      { code, severity },
      {
        code: customEntry.code,
        severity: customEntry.severity,
      },
    );
  });

  it.effect("explains bundled and optional codes from an empty directory without writes", () =>
    fixture((directory) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        for (const code of ["EFFX0010", "EFFX2504", "EFFX3401", "EFFX4101"]) {
          const entry = bundledDiagnosticEntries.find((entry) => entry.code === code);
          assert.isDefined(entry);

          if (entry === undefined) assert.fail(`Missing bundled entry ${code}`);
          const result = yield* run(directory, "explain", code);
          assert.strictEqual(result.code, 0, result.stderr);
          assert.strictEqual(result.stderr, "");
          assert.strictEqual(result.stdout, `${renderEntry(entry).replace(/\n+$/, "")}\n`);
          assert.notInclude(result.stdout, String.fromCharCode(27));
        }

        assert.deepStrictEqual(yield* fs.readDirectory(directory), []);
      }),
    ),
  );

  it.effect("never discovers a throwing config, even for an unknown namespaced code", () =>
    fixture((directory) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(
          path.join(directory, "effx.config.ts"),
          'throw new Error("CONFIG TRAP");',
        );
        yield* fs.writeFileString(path.join(directory, "tsconfig.json"), "NOT JSON");

        for (const code of ["EFFX2504", "EFFX9999", customCode]) {
          const result = yield* run(directory, "explain", code);
          assert.strictEqual(result.code, code === "EFFX2504" ? 0 : 1);
          assert.notInclude(result.stderr, "CONFIG TRAP");

          if (code === "EFFX9999") {
            assert.strictEqual(result.stdout, "");
            assert.include(result.stderr, "EFFX9999");
          }

          if (code === customCode) {
            assert.strictEqual(result.stdout, "");
            assert.include(result.stderr, customCode);
          }
        }

        assert.deepStrictEqual((yield* fs.readDirectory(directory)).sort(), [
          "effx.config.ts",
          "tsconfig.json",
        ]);
      }),
    ),
  );

  it.effect(
    "loads only an explicitly selected config and its imports, not its missing project",
    () =>
      fixture((directory) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* fs.writeFileString(
            path.join(directory, "effx.config.ts"),
            'throw new Error("DISCOVERY TRAP");',
          );
          yield* fs.writeFileString(
            path.join(directory, "entries.ts"),
            `export const entries = [${entrySource}];`,
          );
          yield* fs.writeFileString(
            path.join(directory, "selected.ts"),
            `import { entries } from "./entries.ts"; ${configSource("entries")}`,
          );

          for (const args of [
            ["explain", customCode, "--config", "selected.ts"],
            ["--config", "selected.ts", "explain", customCode],
          ]) {
            const result = yield* run(directory, ...args);
            assert.strictEqual(result.code, 0, result.stderr);
            assert.strictEqual(result.stderr, "");
            assert.strictEqual(result.stdout, `${renderEntry(customEntry).replace(/\n+$/, "")}\n`);
          }

          assert.deepStrictEqual((yield* fs.readDirectory(directory)).sort(), [
            "effx.config.ts",
            "entries.ts",
            "selected.ts",
          ]);
        }),
      ),
  );

  it.effect.each([
    ["missing.ts", undefined, undefined],
    ["invalid.ts", "export default { strictAccess: 'yes' };", undefined],
    ["throw.ts", "throw new Error('import trap');", undefined],
    [
      "callback.ts",
      "export default { extensions: () => { throw new Error('callback trap'); } };",
      undefined,
    ],
    ["shape.ts", configSource("{}"), undefined],
    ["malformed.ts", configSource("[{ code: 'EFFX9999' }]"), /EFFX0010/],
    ["duplicates.ts", configSource(`[${entrySource}, ${entrySource}]`), /EFFX0010/],
    [
      "numeric.ts",
      configSource(
        `[${entrySource.replace(customCode, "EFFX0099").replace(customEntry.owner, "frontend")}]`,
      ),
      /EFFX0010/,
    ],
    ["shadow.ts", configSource(`[${entrySource.replace(customCode, "EFFX2504")}]`), /EFFX0010/],
    [
      "owner.ts",
      configSource(
        `[${entrySource.replace(`owner: "${customEntry.owner}"`, 'owner: "@other/plugin"')}]`,
      ),
      /EFFX0010/,
    ],
  ] as const)("validates explicit config for built-in queries: %s", ([name, source, expected]) =>
    fixture((directory) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        if (source !== undefined) yield* fs.writeFileString(path.join(directory, name), source);
        const result = yield* run(directory, "explain", "EFFX2504", "--config", name);
        assert.strictEqual(result.code, 1, result.stderr);
        assert.strictEqual(result.stdout, "");
        assert.include(result.stderr, name);

        if (expected !== undefined) assert.match(result.stderr, expected);
        assert.isFalse(yield* fs.exists(path.join(directory, "must-not-write")));
      }),
    ),
  );

  it.effect.each([
    [],
    ["EFFX2504", "EFFX1102"],
    ["2504"],
    ["effx2504"],
    ["EFFX[@ACME/test]/0001"],
    ["EFFX2504", "--project", "missing.json"],
    ["EFFX2504", "--out-dir", "output"],
    ["EFFX2504", "--emit", "all"],
    ["EFFX2504", "--target", "effect-4.0"],
    ["EFFX2504", "--strict-access"],
    ["EFFX2504", "--unknown-option"],
    ["EFFX2504", "--config"],
    ["EFFX2504", "--wizard"],
    ["EFFX2504", "--completions", "bash"],
    ["EFFX2504", "--log-level", "debug"],
  ])("rejects usage mistakes without stdout or config evaluation: %j", (args) =>
    fixture((directory) =>
      Effect.gen(function* () {
        const result = yield* run(directory, "explain", ...args);
        assert.strictEqual(result.code, 2, result.stderr);
        assert.strictEqual(result.stdout, "");
      }),
    ),
  );

  it.effect.each([
    ["--log-level", "debug", "explain", "EFFX2415"],
    ["--completions", "bash", "explain", "EFFX2415"],
    ["--log-level=debug", "explain", "EFFX2415"],
    ["--completions=bash", "explain", "EFFX2415"],
  ])("rejects native valued globals before explain: %j", (args) =>
    fixture((directory) =>
      Effect.gen(function* () {
        const result = yield* run(directory, ...args);
        assert.strictEqual(result.code, 2, result.stderr);
        assert.strictEqual(result.stdout, "");
      }),
    ),
  );

  it.effect.each([
    ["--log-level", "debug", "check", "--help"],
    ["--completions", "bash", "check"],
  ])("retains native valued globals for existing commands: %j", (args) =>
    fixture((directory) =>
      Effect.gen(function* () {
        const result = yield* run(directory, ...args);
        assert.strictEqual(result.code, 0, result.stderr);
        assert.strictEqual(result.stderr, "");
        assert.isNotEmpty(result.stdout);
      }),
    ),
  );

  it.effect("rejects invalid usage before evaluating an explicitly selected config", () =>
    fixture((directory) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        yield* fs.writeFileString(
          path.join(directory, "selected.ts"),
          'throw new Error("IMPORT TRAP");',
        );

        for (const args of [["2504"], ["EFFX2504", "--project", "missing.json"]]) {
          const result = yield* run(directory, "explain", ...args, "--config", "selected.ts");
          assert.strictEqual(result.code, 2, result.stderr);
          assert.strictEqual(result.stdout, "");
          assert.notInclude(result.stderr, "IMPORT TRAP");
        }
      }),
    ),
  );

  it.effect("preserves normal help and version behavior", () =>
    fixture((directory) =>
      Effect.gen(function* () {
        for (const flag of ["--help", "-h", "--version", "-v"]) {
          const result = yield* run(directory, "explain", flag);
          assert.strictEqual(result.code, 0, result.stderr);
          assert.strictEqual(result.stderr, "");
          assert.isNotEmpty(result.stdout);
        }
      }),
    ),
  );
  it.effect(
    "the built executable explains core and explicit-config entries without compiling or writing",
    () =>
      fixture((directory) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const buildDirectory = yield* testDirectory("explain-built-");
          const executable = path.join(buildDirectory, "effx.js");

          const build = yield* Effect.sync(() =>
            Bun.spawnSync(
              [
                "bun",
                "build",
                main,
                "--target=bun",
                "--outfile",
                executable,
                "--external",
                "@typescript/typescript6",
                "--external",
                "@cedar-policy/cedar-wasm",
              ],
              { stdout: "pipe", stderr: "pipe" },
            ),
          );

          assert.strictEqual(build.exitCode, 0, new TextDecoder().decode(build.stderr));

          for (const code of ["EFFX1102", "EFFX2415", "EFFX3401"]) {
            const result = yield* runExecutable(executable, directory, "explain", code);

            assert.strictEqual(result.code, 0, result.stderr);
            assert.strictEqual(result.stderr, "");
            const entry = bundledDiagnosticEntries.find((entry) => entry.code === code);

            if (entry === undefined) assert.fail("Missing bundled entry " + code);
            assert.strictEqual(result.stdout, renderEntry(entry));
          }

          const unknown = yield* runExecutable(executable, directory, "explain", "EFFX9999");

          assert.strictEqual(unknown.code, 1);
          assert.strictEqual(unknown.stdout, "");
          assert.include(unknown.stderr, "EFFX9999");

          const malformed = yield* runExecutable(executable, directory, "explain", "EFFX12");

          assert.strictEqual(malformed.code, 2);
          assert.strictEqual(malformed.stdout, "");
          assert.deepStrictEqual(yield* fs.readDirectory(directory), []);

          yield* fs.writeFileString(
            path.join(directory, "selected.ts"),
            configSource(`[${entrySource}]`),
          );

          const selected = yield* runExecutable(
            executable,
            directory,
            "explain",
            customCode,
            "--config",
            "selected.ts",
          );

          assert.strictEqual(selected.code, 0, selected.stderr);
          assert.strictEqual(selected.stderr, "");
          assert.strictEqual(selected.stdout, renderEntry(customEntry));
          assert.deepStrictEqual(yield* fs.readDirectory(directory), ["selected.ts"]);
        }),
      ),
  );
  it.effect(
    "explicit package-qualified diagnostics agree across explain, check, build and manifest",
    () =>
      fixture((directory) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const repository = new URL("../../../", import.meta.url).pathname;
          const config = path.join(directory, "effx.config.ts");

          yield* fs.symlink(
            path.join(repository, "node_modules"),
            path.join(directory, "node_modules"),
          );
          yield* fs.writeFileString(
            path.join(directory, "tsconfig.json"),
            yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))({
              compilerOptions: {
                target: "ES2023",
                module: "ESNext",
                moduleResolution: "bundler",
                strict: true,
                noEmit: true,
                allowImportingTsExtensions: true,
                skipLibCheck: true,
                paths: {
                  "@effx/runtime": [path.join(repository, "packages/runtime/src/index.ts")],
                  "@effx/diagnostics": [path.join(repository, "packages/diagnostics/src/index.ts")],
                },
              },
              include: ["operation.ts"],
            }),
          );
          yield* fs.writeFileString(
            path.join(directory, "operation.ts"),
            'import { Schema } from "effect"; import { Operation } from "@effx/runtime"; export const Input = Schema.Struct({}); export const Output = Schema.String; export const lookup = Operation.query({ name: "Legacy.lookup", input: Input, success: Output }).declare();\n',
          );
          yield* fs.writeFileString(
            config,
            `import { Schema } from "effect"; import { defineDiagnostic } from "@effx/diagnostics"; const note = defineDiagnostic(${entrySource}, Schema.Struct({ subject: Schema.String }), ({ subject }) => subject + ": invalid declaration"); export default { extensions: [{ name: "${customEntry.owner}", interpreters: {}, generators: [], diagnosticEntries: [note.entry], analyses: [(ir) => ir.nodes.flatMap((node) => node._tag === "Operation" && node.name.startsWith("Legacy.") ? [note.emit({ subject: node.name })] : [])] }] };`,
          );

          const explained = yield* run(directory, "explain", customCode, "--config", config);

          assert.strictEqual(explained.code, 0, explained.stderr);
          assert.strictEqual(explained.stdout, renderEntry(customEntry));
          assert.isFalse(yield* fs.exists(path.join(directory, ".effx")));

          for (const command of ["check", "build"]) {
            const result = yield* run(directory, command, "--config", config);

            assert.strictEqual(result.code, 0, result.stderr || result.stdout);
            assert.include(result.stdout, customCode);
          }

          const manifest = yield* Schema.decodeEffect(ManifestJson)(
            yield* fs.readFileString(path.join(directory, ".effx/manifest.json")),
          );

          assert.deepStrictEqual(
            manifest.diagnostics.find((diagnostic) => diagnostic.code === customCode),
            invalidDeclaration.emit({ subject: "Legacy.lookup" }),
          );
        }),
      ),
  );
});
