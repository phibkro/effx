import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { StableId, make } from "@effx/ir";
import { type Collected, Extensions, compileCollected } from "@effx/compiler";
import type { GenerationContext } from "../src/Extension.ts";
import { Imports as ImportCollector, handlerCall, schemaExpr } from "../src/generate/emit.ts";
import {
  Imports,
  isTargetModuleSupported,
  moduleSpecifier,
  unsupportedModules,
} from "../src/generate/target.ts";

const rc = {
  target: "effect-4.0-rc",
  emit: "contract",
  allowImportingTsExtensions: false,
  canonicalImportBase: "/work/app/.effx/generated",
  outputDir: "/work/app/apps/backend/.effx/generated",
} satisfies GenerationContext;

const stable: GenerationContext = { ...rc, target: "effect-4.0" };

describe("target import resolution", () => {
  it("uses one table for all stable and rc modules, including net", () => {
    assert.deepStrictEqual(Imports(), {
      core: "effect",
      http: "effect/http",
      httpApi: "effect/http-api",
      net: "effect/net",
      rpc: "effect/rpc",
      cli: "effect/cli",
      sql: "effect/sql",
    });
    assert.deepStrictEqual(Imports(rc), {
      core: "effect",
      http: "effect/unstable/http",
      httpApi: "effect/unstable/httpapi",
      net: "effect/unstable/net",
      rpc: "effect/unstable/rpc",
      cli: "effect/unstable/cli",
      sql: "effect/unstable/sql",
    });

    for (const [base, mapped] of [
      ["effect/http", "effect/unstable/http"],
      ["effect/http-api", "effect/unstable/httpapi"],
      ["effect/net", "effect/unstable/net"],
      ["effect/rpc", "effect/unstable/rpc"],
      ["effect/cli", "effect/unstable/cli"],
      ["effect/sql", "effect/unstable/sql"],
    ] as const) {
      assert.strictEqual(moduleSpecifier(stable, base), base);
      assert.strictEqual(moduleSpecifier(rc, base), mapped);
      assert.strictEqual(moduleSpecifier(rc, mapped), mapped);
    }

    assert.strictEqual(moduleSpecifier(rc, "effect"), "effect");
    assert.strictEqual(moduleSpecifier(rc, "@effx/runtime"), "@effx/runtime");
    assert.isFalse(isTargetModuleSupported(rc, "effect/unstable/http-api"));
    assert.isFalse(isTargetModuleSupported(stable, "effect/not-a-module"));

    const unsupported = make(
      [
        {
          _tag: "Schema",
          id: StableId.make("schema", "Unsupported"),
          ref: {
            module: "effect/not-a-module",
            export: "Unsupported",
            symbolId: StableId.make("schema", "Unsupported"),
          },
        },
      ],
      [],
    );

    assert.deepStrictEqual(unsupportedModules(unsupported, rc), ["effect/not-a-module"]);
    const defaults = new ImportCollector();
    defaults.add("./http.ts", "UsersHttp");
    assert.deepStrictEqual(defaults.render(), ['import { UsersHttp } from "./http.js";']);
  });

  it("maps resolvable source leaves with the project profile and rejects unknown leaves", () => {
    const available = new Set(["effect/Schema", "effect/unstable/sql/SqlError"]);

    const project: GenerationContext = {
      ...rc,
      resolveEffectModule: (specifier) => available.has(specifier),
    };

    assert.isTrue(isTargetModuleSupported(project, "effect/Schema"));
    assert.isTrue(isTargetModuleSupported(project, "effect/sql/SqlError"));
    assert.isTrue(isTargetModuleSupported(project, "effect/unstable/sql/SqlError"));
    assert.strictEqual(moduleSpecifier(project, "effect/Schema"), "effect/Schema");
    assert.strictEqual(
      moduleSpecifier(project, "effect/sql/SqlError"),
      "effect/unstable/sql/SqlError",
    );
    assert.isFalse(isTargetModuleSupported(project, "effect/sql/NotReal"));
    assert.isFalse(isTargetModuleSupported(project, "effect/not-a-module"));
    assert.isFalse(isTargetModuleSupported(project, "effect/unstable/http-api"));

    const ir = make(
      ["effect/Schema", "effect/sql/SqlError", "effect/sql/NotReal"].map((module) => ({
        _tag: "Schema" as const,
        id: StableId.make("schema", module),
        ref: { module, export: "Schema", symbolId: StableId.make("schema", module) },
      })),
      [],
    );

    assert.deepStrictEqual(unsupportedModules(ir, project), ["effect/sql/NotReal"]);
  });

  it("checks a concrete HttpGroup root symbol before emitting handlers", () => {
    const context: GenerationContext = {
      ...stable,
      resolveEffectModule: (specifier) => specifier === "effect/Schema",
    };

    const group = (module: string) =>
      make(
        [
          {
            _tag: "HttpGroup" as const,
            id: StableId.make("group", "Api/profile"),
            root: "Api",
            group: "profile",
            rootSymbol: { module, export: "Api" },
          },
        ],
        [],
      );

    assert.deepStrictEqual(unsupportedModules(group("effect/Schema"), context), []);
    assert.deepStrictEqual(unsupportedModules(group("effect/not-a-module"), context), [
      "effect/not-a-module",
    ]);
  });

  it("rebases frontend references but keeps generated siblings in the artifact directory", () => {
    assert.strictEqual(
      moduleSpecifier(rc, "../../packages/http-api/src/profile"),
      "../../../../packages/http-api/src/profile.js",
    );
    assert.strictEqual(
      moduleSpecifier(rc, "../../packages/http-api/src/schema.v2"),
      "../../../../packages/http-api/src/schema.v2.js",
    );
    assert.strictEqual(moduleSpecifier(rc, "./profile-contract.ts"), "./profile-contract.js");
    assert.strictEqual(
      moduleSpecifier(
        { ...rc, allowImportingTsExtensions: true },
        "../../packages/http-api/src/profile",
      ),
      "../../../../packages/http-api/src/profile.ts",
    );
    assert.strictEqual(
      moduleSpecifier({ ...rc, allowImportingTsExtensions: true }, "./profile-contract.ts"),
      "./profile-contract.ts",
    );
    assert.strictEqual(
      moduleSpecifier(
        { ...rc, outputDir: rc.canonicalImportBase },
        "../../packages/http-api/src/profile",
      ),
      "../../packages/http-api/src/profile.js",
    );
  });

  it("renders SchemaRef and SymbolRef imports without changing their semantic IDs", () => {
    const ref = {
      module: "../../packages/http-api/src/profile",
      export: "Profile",
      symbolId: StableId.make("schema", "packages/http-api/src/profile/Profile"),
    };

    const imports = new ImportCollector(rc);

    assert.strictEqual(schemaExpr(imports, ref), "Profile");
    assert.strictEqual(
      handlerCall(imports, { module: ref.module, export: "readProfile" }, "request"),
      "readProfile(request)",
    );
    imports.add("effect/http-api", "HttpApiGroup");
    assert.deepStrictEqual(imports.render(), [
      'import { HttpApiGroup } from "effect/unstable/httpapi";',
      'import { Profile, readProfile } from "../../../../packages/http-api/src/profile.js";',
    ]);
    assert.strictEqual(ref.symbolId, "schema:packages/http-api/src/profile/Profile");
  });

  it.effect("EFFX2701 rejects unsupported app symbol imports before generator execution", () =>
    Effect.gen(function* () {
      const input = {
        module: "effect/not-a-module",
        export: "Unsupported",
        symbolId: StableId.make("schema", "app/Unsupported"),
      };

      const success = {
        module: "app/schema",
        export: "Success",
        symbolId: StableId.make("schema", "app/Success"),
      };

      const collected: Collected = {
        project: rc,
        resolveEffectModule: (specifier) => specifier === "effect/Schema",
        diagnostics: [],
        declarations: [
          {
            id: "Bad.get",
            kind: "builder",
            module: "app/operations",
            export: "Bad",
            member: "handler",
            annotations: [
              {
                name: "Query",
                args: [
                  {
                    name: "Bad.Get",
                    input: { _tag: "Schema", ref: input },
                    success: { _tag: "Schema", ref: success },
                  },
                ],
              },
              { name: "Http.Get", args: ["/bad"] },
            ],
            handlerSignature: {
              success: { _tag: "Schema", ref: success },
              errors: [],
              requirements: [],
            },
          },
        ],
      };

      const result = yield* compileCollected(collected, Extensions.builtin);
      assert.include(
        result.diagnostics.map((diagnostic) => diagnostic.code),
        "EFFX2701",
      );
      assert.isTrue(Option.isNone(result.files.value));
    }),
  );
});
