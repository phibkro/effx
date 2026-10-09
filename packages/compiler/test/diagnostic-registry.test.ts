import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import {
  bundledDiagnosticEntries,
  DiagnosticDefinitions,
  CoreDiagnostics,
  HttpDiagnostics,
  composeRegistry,
} from "@effx/compiler";
import { inspectDiagnosticSource } from "./fixtures/diagnostic-conformance.ts";

const root = new URL("../../../", import.meta.url).pathname;

describe("diagnostic registry conformance", () => {
  it.effect("composes all 68 reserved legacy entries plus the bootstrap contract error", () =>
    Effect.gen(function* () {
      const registry = yield* composeRegistry(bundledDiagnosticEntries);
      assert.strictEqual(registry.entries.length, 69);
      const keys = Object.keys(DiagnosticDefinitions).toSorted();
      assert.deepStrictEqual(
        keys,
        registry.entries.map((entry) => entry.code),
      );
      assert.strictEqual(new Set(bundledDiagnosticEntries.map((entry) => entry.code)).size, 69);

      for (const [code, definition] of Object.entries(DiagnosticDefinitions)) {
        assert.strictEqual(definition.entry.code, code);
        assert.strictEqual(
          bundledDiagnosticEntries.filter((entry) => entry.code === code).length,
          1,
        );
        assert.strictEqual(
          bundledDiagnosticEntries.find((entry) => entry.code === code),
          definition.entry,
        );
        assert.deepStrictEqual(
          registry.entries.find((entry) => entry.code === code),
          definition.entry,
        );
      }

      for (const [code, definition] of Object.entries({ ...CoreDiagnostics, ...HttpDiagnostics })) {
        assert.strictEqual(
          Object.entries(DiagnosticDefinitions).find(([key]) => key === code)?.[1],
          definition,
        );
      }
    }),
  );

  it.effect("duplicate roots fail before a keyed projection can overwrite them", () =>
    Effect.gen(function* () {
      const duplicate = bundledDiagnosticEntries[0];
      assert.isDefined(duplicate);

      const failure = yield* composeRegistry([...bundledDiagnosticEntries, duplicate]).pipe(
        Effect.flip,
      );

      assert.strictEqual(failure._tag, "RegistryError");
      assert.include(failure.message.toLowerCase(), "duplicate");
    }),
  );

  it.effect("missing documentation cannot enter the composed distribution", () =>
    Effect.gen(function* () {
      const invalid = { ...bundledDiagnosticEntries[0], explanation: "" };
      const failure = yield* composeRegistry([invalid]).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "RegistryError");
    }),
  );

  it.effect(
    "production emitters use factories and each distribution code has one source root",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const violations: Array<string> = [];
        const declarations: Array<string> = [];
        const files: Array<string> = [];
        // Scan every production package, including catalogue modules. There are no folder exemptions.

        for (const name of yield* fs.readDirectory(path.join(root, "packages"))) {
          const directory = path.join(root, "packages", name, "src");

          if (!(yield* fs.exists(directory))) continue;

          for (const file of yield* fs.readDirectory(directory, { recursive: true })) {
            if (file.endsWith(".ts")) files.push(path.join("packages", name, "src", file));
          }
        }

        for (const file of yield* fs.readDirectory(path.join(root, "ai-docs/src"), {
          recursive: true,
        })) {
          if (file.endsWith(".ts")) files.push(path.join("ai-docs/src", file));
        }

        files.push("examples/extension-openapi-tags/deprecated-extension.ts");

        for (const file of files) {
          const inspected = inspectDiagnosticSource(
            file,
            yield* fs.readFileString(path.join(root, file)),
          );

          violations.push(...inspected.violations);
          declarations.push(...inspected.declarations.filter((code) => /^EFFX\d{4}$/.test(code)));
        }

        assert.deepStrictEqual(violations, [], violations.join("\n"));
        // Source declarations expose duplicate roots even if a keyed object spread erased one.
        assert.deepStrictEqual(
          declarations.toSorted(),
          bundledDiagnosticEntries.map((entry) => entry.code).toSorted(),
        );
      }).pipe(Effect.provide(BunServices.layer)),
  );

  for (const [label, source, reason] of [
    [
      "raw code construction",
      'const finding = { code: "EFFX1101", message: "message" };',
      "raw Diagnostic construction",
    ],
    ["raw helper", 'error("EFFX1101", "message");', "string-code diagnostic helper call"],
    [
      "import alias",
      'import { warning as warn } from "@effx/compiler"; warn(entry.code, "message");',
      "deleted string-code helper import",
    ],
    [
      "local alias",
      'import { warning as warn } from "@effx/compiler"; const alias = warn; alias(entry.code, "message");',
      "string-code diagnostic helper call",
    ],
    [
      "namespace alias",
      'import * as Compiler from "@effx/compiler"; const emit = Compiler.warning; emit(entry.code, "message");',
      "string-code diagnostic helper call",
    ],
    [
      "direct info",
      'const finding = { code: entry.code, severity: "info", message: "message" };',
      "raw Diagnostic construction",
    ],
    [
      "shorthand construction",
      "const finding = { code, severity, message };",
      "raw Diagnostic construction",
    ],
    [
      "severity override",
      'const finding = { ...diagnostic, severity: "info" };',
      "raw Diagnostic construction",
    ],
    [
      "projection override",
      'const finding = { code: d.code, severity: "warning", message: d.message };',
      "raw Diagnostic construction",
    ],
    [
      "registry folder bypass",
      'const finding = { code: entry.code, severity: "info", message: "message" };',
      "raw Diagnostic construction",
    ],
  ] as const) {
    it(`rejects mutation snippet: ${label}`, () => {
      const file =
        label === "registry folder bypass"
          ? "packages/compiler/src/diagnostics/injected.ts"
          : "packages/compiler/src/injected.ts";

      assert.isTrue(
        inspectDiagnosticSource(file, source).violations.some((violation) =>
          violation.includes(reason),
        ),
      );
    });
  }

  it("allows declared plugin entries, typed emissions, and location/data projections", () => {
    const source = `
      import { defineDiagnostic as define } from "@effx/diagnostics";
      const note = define({ code: "EFFX[plugin]/0001", owner: "plugin", title: "Note", severity: "warning", severityPolicy: { kind: "fixed" }, explanation: "Note", examples: [{ before: "a", after: "b", explanation: "Fix" }] }, Schema.Struct({}), () => "Note");
      const finding = note.emit({}, { location });
      const enriched = { code: finding.code, severity: finding.severity, message: finding.message, location, related: finding.related };
      const runtimeData = { code: finding.code, message: finding.message };
    `;

    const inspected = inspectDiagnosticSource("plugins/note.ts", source);
    assert.deepStrictEqual(inspected.violations, []);
    assert.deepStrictEqual(inspected.declarations, ["EFFX[plugin]/0001"]);
  });

  it("allows typed numeric protocol projections but still rejects compiler severity overrides", () => {
    const projection =
      'type WireFinding = { code: string; message: string; severity: 1 | 2 | 3 }; const projected: WireFinding = { code: finding.code, message: related.length ? finding.message + related.join("\\n") : finding.message, severity: protocolSeverity(finding), source: "effx" };';

    assert.deepStrictEqual(inspectDiagnosticSource("projection.ts", projection).violations, []);
    assert.isTrue(
      inspectDiagnosticSource(
        "projection.ts",
        projection.replace("1 | 2 | 3", '"error" | "warning" | "info"'),
      ).violations.some((violation) => violation.includes("raw Diagnostic construction")),
    );
  });

  it("allows only the named runtime definition projection adapter", () => {
    const source =
      'const definitionDiagnostics = () => ({ ...problem, severity: RuntimeDiagnostics["EFFX1301"].entry.severity });';

    assert.deepStrictEqual(
      inspectDiagnosticSource("packages/compiler/src/annotation.ts", source).violations,
      [],
    );
    assert.isTrue(
      inspectDiagnosticSource("packages/compiler/src/injected.ts", source).violations.some(
        (violation) => violation.includes("raw Diagnostic construction"),
      ),
    );
    assert.isTrue(
      inspectDiagnosticSource(
        "packages/compiler/src/annotation.ts",
        source.replace("definitionDiagnostics", "injected"),
      ).violations.some((violation) => violation.includes("raw Diagnostic construction")),
    );
    assert.isTrue(
      inspectDiagnosticSource(
        "packages/compiler/src/annotation.ts",
        'const definitionDiagnostics = () => { const injected = () => ({ ...problem, severity: RuntimeDiagnostics["EFFX1301"].entry.severity }); };',
      ).violations.some((violation) => violation.includes("raw Diagnostic construction")),
    );
  });

  for (const source of [
    'const label = "EFFX1001";',
    'log("EFFX1001");',
    'assert.strictEqual(diagnostic.code, "EFFX1001");',
    'const factory = CoreDiagnostics["EFFX1001"];',
    "// EFFX1001 is documented here",
    "const match = /EFFX1001/;",
    "const fields = Schema.Struct({ code: DiagnosticCode, severity: Severity, message: Schema.String });",
    'Schema.decodeUnknownEffect(Diagnostic)({ code: "EFFX1001", severity: "error", message: "wire fixture" });',
  ]) {
    it(`allows non-emission code mention: ${source}`, () => {
      assert.deepStrictEqual(inspectDiagnosticSource("injected.ts", source).violations, []);
    });
  }

  it("ignores prose and rejects new emitters in the leaf factory file", () => {
    assert.deepStrictEqual(
      inspectDiagnosticSource(
        "injected.ts",
        '// EFFX1101\nconst example = "error(\\\"EFFX1101\\\", \\\"example\\\")";',
      ).violations,
      [],
    );
    assert.isTrue(
      inspectDiagnosticSource(
        "packages/diagnostics/src/definition.ts",
        'const fake = { code: entry.code, severity: "info", message: "fake" };',
      ).violations.some((violation) => violation.includes("raw Diagnostic construction")),
    );
  });
});
