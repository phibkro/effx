import { BunServices } from "@effect/platform-bun";
import { bundledDiagnosticEntries, extension, implement } from "@effx/compiler";
import { DiagnosticEntry, renderEntry } from "@effx/diagnostics";
import { Annotation } from "@effx/runtime";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { testDirectory } from "../../../tools/testing/projects.ts";

const main = new URL("../src/main.ts", import.meta.url).pathname;

const customCode = "EFFX[@acme/effx-test]/0001";

const customEntry: DiagnosticEntry = {
  code: customCode,
  owner: "@acme/effx-test",
  title: "Test extension contract",
  severity: "warning",
  severityPolicy: { kind: "fixed" },
  explanation: "The selected extension found an invalid declaration.",
  examples: [{ before: "invalid()", after: "valid()", explanation: "Use a valid declaration." }],
};

const run = Effect.fnUntraced(function* (cwd: string, ...args: ReadonlyArray<string>) {
  return yield* Effect.sync(() => {
    const result = Bun.spawnSync(["bun", main, ...args], { cwd, stdout: "pipe", stderr: "pipe" });

    return {
      code: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  });
});

const fixture = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const directory = yield* testDirectory("explain-test-");

    return yield* use(directory);
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer));

const configSource = (entries: string) =>
  `export default { project: "missing-tsconfig.json", outDir: "must-not-write", extensions: [{ name: "@acme/effx-test", interpreters: {}, analyses: [], generators: [], diagnosticEntries: ${entries} }] };`;

// Static trusted fixture data, not a boundary decoder.
const entrySource = `{
  code: "${customCode}", owner: "@acme/effx-test", title: "Test extension contract",
  severity: "warning", severityPolicy: { kind: "fixed" },
  explanation: "The selected extension found an invalid declaration.",
  examples: [{ before: "invalid()", after: "valid()", explanation: "Use a valid declaration." }]
}`;

describe("spec 0016 explain subprocess journeys", () => {
  it("collects registration from implement and extension without changing emitters", () => {
    const definition = Annotation.define({ name: "ExplainTest", target: "operation", args: [] });
    const implementation = implement(definition, { diagnosticEntries: [customEntry] });

    const selected = extension("@acme/effx-test", [implementation], {
      diagnosticEntries: [customEntry],
    });

    assert.deepStrictEqual(selected.diagnosticEntries, [customEntry, customEntry]);
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
            assert.strictEqual(result.stderr, "Unknown diagnostic code: EFFX9999\n");
          }

          if (code === customCode) {
            assert.strictEqual(result.stdout, "");
            assert.include(result.stderr, `Unknown diagnostic code: ${customCode}`);
            assert.include(result.stderr, "--config <path>");
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
            assert.isTrue(result.stdout.startsWith(`# ${customCode} — Test extension contract\n`));
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
    ["missing.ts", undefined, /config file does not exist/],
    ["invalid.ts", "export default { strictAccess: 'yes' };", /invalid fields/],
    ["throw.ts", "throw new Error('import trap');", /module import failed/],
    [
      "callback.ts",
      "export default { extensions: () => { throw new Error('callback trap'); } };",
      /extensions callback threw/,
    ],
    ["shape.ts", configSource("{}"), /diagnosticEntries must be an array/],
    ["malformed.ts", configSource("[{ code: 'EFFX9999' }]"), /EFFX0010/],
    ["duplicates.ts", configSource(`[${entrySource}, ${entrySource}]`), /EFFX0010/],
    [
      "numeric.ts",
      configSource(
        `[${entrySource.replace(customCode, "EFFX0099").replace("@acme/effx-test", "frontend")}]`,
      ),
      /EFFX0010.*numeric diagnostic code EFFX0099/,
    ],
    ["shadow.ts", configSource(`[${entrySource.replace(customCode, "EFFX2504")}]`), /EFFX0010/],
    [
      "owner.ts",
      configSource(
        `[${entrySource.replace('owner: "@acme/effx-test"', 'owner: "@other/plugin"')}]`,
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
        assert.match(result.stderr, expected);
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
        assert.match(result.stderr, /usage/i);
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
});
