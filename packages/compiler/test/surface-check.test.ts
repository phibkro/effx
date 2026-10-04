import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  type Surface,
  SurfaceJson,
  type WiringFacts,
  checkWiring,
  isWiringExport,
  surfaceText,
} from "@effx/compiler";

const emptySurface: Surface = {
  format: "effx-surface",
  version: 1,
  semanticHash: "0".repeat(64),
  operations: [],
  http: [],
  rpc: [],
  cli: [],
  foldkit: [],
};

const group = (root: string, name: string, wiring: string): Surface["http"][number] => ({
  root,
  group: name,
  binding: "external",
  wiring,
  endpoints: [],
});

const at = { file: "/p/worker.ts", line: 3, col: 1 };

const worker: WiringFacts = { workers: [at], references: [], undecidable: [] };

const codes = (diagnostics: ReadonlyArray<{ readonly code: string }>) =>
  diagnostics.map((diagnostic) => diagnostic.code);

describe("checkWiring (spec 0021 §4.2)", () => {
  it("treats only AppRoutes of http.ts and <Group>ApiHandlers of *-handlers.ts as wiring", () => {
    assert.isTrue(isWiringExport("/o/http.ts", "AppRoutes"));
    assert.isTrue(isWiringExport("/o/profile-handlers.ts", "ProfileApiHandlers"));
    assert.isFalse(isWiringExport("/o/profile-contract.ts", "ProfileApi"));
    assert.isFalse(isWiringExport("/o/rpc.ts", "OperationsHandlers"));
    assert.isFalse(isWiringExport("/o/http.ts", "ApiHandlers"));
  });

  it("requires every file that exports a wiring name, so one group id under two roots needs both", () => {
    const surface: Surface = {
      ...emptySurface,
      http: [group("a", "users", "UsersApiHandlers"), group("b", "users", "UsersApiHandlers")],
    };

    const generated = [
      { path: "/o/a-users-handlers.ts", contents: "export const UsersApiHandlers = 1;\n" },
      { path: "/o/b-users-handlers.ts", contents: "export const UsersApiHandlers = 2;\n" },
    ];

    const one = checkWiring({
      surface,
      generated,
      entry: "worker.ts",
      facts: {
        ...worker,
        references: [{ file: "/o/a-users-handlers.ts", name: "UsersApiHandlers", location: at }],
      },
    });

    assert.deepStrictEqual(codes(one), ["EFFX2802"]);
    assert.include(one[0]?.message ?? "", "b-users-handlers.ts");

    const both = checkWiring({
      surface,
      generated,
      entry: "worker.ts",
      facts: {
        ...worker,
        references: generated.map((file) => ({
          file: file.path,
          name: "UsersApiHandlers",
          location: at,
        })),
      },
    });

    assert.deepStrictEqual(both, []);
  });

  it("flags a referenced wiring export that the current output lacks as extra, and ignores non-wiring exports", () => {
    const surface: Surface = { ...emptySurface, http: [group("a", "users", "UsersApiHandlers")] };

    const diagnostics = checkWiring({
      surface,
      generated: [
        { path: "/o/users-handlers.ts", contents: "export const UsersApiHandlers = 1;\n" },
      ],
      entry: "worker.ts",
      facts: {
        ...worker,
        references: [
          { file: "/o/users-handlers.ts", name: "UsersApiHandlers", location: at },
          { file: "/o/gone-handlers.ts", name: "GoneApiHandlers", location: at },
          { file: "/o/users-contract.ts", name: "UsersApi", location: at },
        ],
      },
    });

    assert.deepStrictEqual(codes(diagnostics), ["EFFX2803"]);
  });

  it("reports a non-Worker entry, undecidable sites and an empty emit as separate codes", () => {
    const diagnostics = checkWiring({
      surface: emptySurface,
      generated: [],
      entry: "x.ts",
      facts: {
        workers: [],
        references: [],
        undecidable: [{ location: at, reason: "import() with a non-literal specifier" }],
      },
    });

    assert.deepStrictEqual(codes(diagnostics), ["EFFX2801", "EFFX2807", "EFFX2806"]);
    assert.deepStrictEqual(
      diagnostics.map((diagnostic) => diagnostic.severity),
      ["error", "info", "warning"],
    );
  });
});

describe("surface text (spec 0021 §2)", () => {
  it.effect("is canonical JSON that decodes back to the same surface", () =>
    Effect.gen(function* () {
      const surface: Surface = {
        ...emptySurface,
        http: [
          {
            ...group("effx", "operations", "AppRoutes"),
            binding: "local",
            endpoints: [
              {
                operation: "User.Get",
                endpoint: "User.Get",
                operationId: "operations.User.Get",
                method: "GET",
                path: "/users/:id",
                conditional: false,
                middleware: [],
                security: [],
              },
            ],
          },
        ],
      };

      const text = surfaceText(surface);
      assert.isTrue(text.endsWith("}\n"));
      assert.notInclude(text, " ");
      const decoded = yield* Schema.decodeEffect(SurfaceJson)(text);
      assert.deepStrictEqual(decoded, surface);
      assert.strictEqual(surfaceText(decoded), text);
    }),
  );
});
