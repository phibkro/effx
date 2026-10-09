import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { LiftFrontend, groupKeysOf } from "@effx/compiler";
import { LiftTsSourceFrontend } from "@effx/frontend-ts";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { testDirectory } from "../../../tools/testing/projects.ts";

const repo = new URL("../../../", import.meta.url).pathname;

const Services = LiftTsSourceFrontend.layer.pipe(Layer.provideMerge(BunServices.layer));

/** The original group's module: one endpoint, the group id the generated contract reuses. */
const original = `import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export const Read = HttpApiEndpoint.get("read", "/read", { success: Schema.String, error: Schema.Never });
export class OriginalGroup extends HttpApiGroup.make("profile").add(Read) {}
`;

/** A generated-contract shape: it imports from the original module, so the program holds both groups. */
const generated = `import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Read } from "./original.ts";

export const Extra = HttpApiEndpoint.get("extra", "/extra", { success: Schema.String, error: Schema.Never });
export class GeneratedGroup extends HttpApiGroup.make("profile").add(Read, Extra) {}
`;

describe("the group a check reads from a generated contract (spec 0019 §2.4 step 6, §7)", () => {
  it.effect(
    "selects the group a module declares when the program also holds another group with the same id",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* testDirectory("lift-check-facts-");

        yield* fs.makeDirectory(path.join(directory, "src"));
        yield* fs.writeFileString(path.join(directory, "src/original.ts"), original);
        yield* fs.writeFileString(path.join(directory, "src/generated.ts"), generated);

        yield* fs.writeFileString(
          path.join(directory, "tsconfig.json"),
          `{ "extends": "${repo}tsconfig.json", "include": ["src/generated.ts"], "exclude": [], "effx": { "projectRoot": "." } }`,
        );

        const analyzed = yield* (yield* LiftFrontend).analyze({
          tsconfigPath: path.join(directory, "tsconfig.json"),
        });

        const model = Option.getOrThrow(analyzed.value);

        const moduleOf = (name: string): string =>
          Option.getOrThrowWith(
            Option.fromUndefinedOr(
              model.files.find((file) => file.file === path.join(directory, `src/${name}.ts`)),
            ),
            () => new Error(`the program does not hold ${name}`),
          ).module;

        // The program holds BOTH groups: the id alone cannot select one, the declaring module does.
        assert.strictEqual(model.groups.length, 2);

        const fromGenerated = groupKeysOf(model, "profile", moduleOf("generated"));
        const fromOriginal = groupKeysOf(model, "profile", moduleOf("original"));

        assert.deepStrictEqual(
          Option.map(fromGenerated, (keys) => [keys.group.export, keys.endpointKeys]),
          Option.some(["GeneratedGroup", ["extra", "read"]]),
        );

        assert.deepStrictEqual(
          Option.map(fromOriginal, (keys) => [keys.group.export, keys.endpointKeys]),
          Option.some(["OriginalGroup", ["read"]]),
        );

        // A module that declares no such group, or another id, has none.
        assert.isTrue(Option.isNone(groupKeysOf(model, "profile", "./nowhere")));
        assert.isTrue(Option.isNone(groupKeysOf(model, "other", moduleOf("generated"))));
      }).pipe(Effect.provide(Services)),
    60_000,
  );
});
