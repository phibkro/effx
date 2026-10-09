// @effect-diagnostics unstableApiUsage:off -- EX-0034: real native child execution of the lift check.
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { LiftTsSourceFrontend, TsSourceFrontend } from "@effx/frontend-ts";
import { prepareLift, resolveProject, runLiftCheck, type LiftCheckRequest } from "@effx/cli";
import { testDirectory } from "../../tools/testing/projects.ts";
import { liftCheckExecutionLayer, liftToolchainLayer } from "../lift-execution.ts";

const repo = new URL("../../", import.meta.url).pathname;

/** The real services of the check: production frontends, the Bun platform, the one native adapter. */
const services = Layer.mergeAll(
  TsSourceFrontend.layer,
  LiftTsSourceFrontend.layer,
  liftCheckExecutionLayer,
  liftToolchainLayer,
).pipe(Layer.provideMerge(BunServices.layer));

const support = `import { Schema } from "effect";
export const ProfileResponse = Schema.Struct({ id: Schema.String, name: Schema.String }).annotate({ identifier: "ProfileResponse" });
export const ProfileQuery = Schema.Struct({ expand: Schema.optionalKey(Schema.String) }).annotate({ identifier: "ProfileQuery" });
export const ProfilePatch = Schema.Struct({ name: Schema.String }).annotate({ identifier: "ProfilePatch" });
`;

const api = `import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { ProfilePatch, ProfileQuery, ProfileResponse } from "./support.ts";

export const ReadOwnProfile = HttpApiEndpoint.get("readOwnProfile", "/profile", { query: ProfileQuery, success: ProfileResponse, error: Schema.Never });
export const UpdateOwnProfile = HttpApiEndpoint.patch("updateOwnProfile", "/profile", { payload: ProfilePatch, success: ProfileResponse, error: Schema.Never });
export class ProfileGroup extends HttpApiGroup.make("profile").add(ReadOwnProfile, UpdateOwnProfile) {}
export class Root extends HttpApi.make("mini-api").add(ProfileGroup) {}
`;

/** One authored real project, owned by the test scope. */
const miniProject = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* testDirectory("lift-check-native-");

  yield* fs.makeDirectory(path.join(directory, "src"));
  yield* fs.writeFileString(path.join(directory, "src/support.ts"), support);
  yield* fs.writeFileString(path.join(directory, "src/api.ts"), api);
  yield* fs.writeFileString(
    path.join(directory, "tsconfig.json"),
    `{ "extends": "${repo}tsconfig.json", "include": ["src/api.ts"], "exclude": [], "effx": { "projectRoot": "." } }`,
  );

  return { directory, tsconfigPath: path.join(directory, "tsconfig.json") };
});

describe("effx lift --check on a real child", () => {
  it.live(
    "passes both forms and the binding gate on an exact lift",
    () =>
      Effect.gen(function* () {
        const fixture = yield* miniProject();

        const project = yield* resolveProject(fixture.tsconfigPath, undefined, "effect-4.0");

        const prepared = yield* prepareLift(project, {
          group: "profile",
          module: Option.some(`${fixture.directory}/src/profile.effx.ts`),
          form: "both",
        });

        assert.deepStrictEqual(prepared.run.result.unsupported, []);

        const request: LiftCheckRequest = { run: prepared.run, extensions: project.extensions };

        const checked = yield* runLiftCheck(request);

        assert.isTrue(Option.isSome(checked.value), JSON.stringify(checked.diagnostics));

        const check = Option.getOrThrow(checked.value);

        assert.strictEqual(check.verbose?._tag, "Pass", JSON.stringify(check.verbose));
        assert.strictEqual(check.dense?._tag, "Pass", JSON.stringify(check.dense));
        assert.strictEqual(check.binding._tag, "Passed", JSON.stringify(check.binding));
      }).pipe(Effect.provide(services)),
    300_000,
  );
});
