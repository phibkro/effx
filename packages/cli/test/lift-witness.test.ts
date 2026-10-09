import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { OPEN_API_IDENTIFIER_KEY } from "@effx/compiler";
import {
  WITNESS_FRAME,
  bindingSkeleton,
  readWitnessDocument,
  typecheckFindings,
  witnessProgram,
  type WitnessPlan,
} from "../src/lift-witness.ts";

const reflection = {
  openapi: { openapi: "3.1.0" },
  endpoints: [
    {
      group: "profile",
      identifier: "readOwnProfile",
      method: "GET",
      path: "/profile",
      middleware: [],
      successStatuses: [200],
      errorStatuses: [],
      annotationKeys: [],
      projections: {},
    },
  ],
};

const pair = { original: reflection, generated: reflection };

const frame = (document: Schema.Json): string => `${WITNESS_FRAME} ${JSON.stringify(document)}`;

const failure = (stdout: string) =>
  Effect.map(Effect.flip(readWitnessDocument(stdout)), (error) => error.reason);

describe("the lift-check witness protocol (spec 0019 §2.4 steps 5-6)", () => {
  it.effect("reads the one framed document among whatever the application printed", () =>
    Effect.gen(function* () {
      const stdout = ["listening on port 3000", frame({ _tag: "Reflected", pair }), "bye", ""].join(
        "\n",
      );

      assert.deepStrictEqual(yield* readWitnessDocument(stdout), { _tag: "Reflected", pair });

      assert.deepStrictEqual(
        yield* readWitnessDocument(
          frame({ _tag: "Failed", stage: "import-original", cause: "TypeError" }),
        ),
        { _tag: "Failed", stage: "import-original", cause: "TypeError" },
      );
    }),
  );

  it.effect("treats a missing, repeated or undecodable frame as inability, never as data", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* failure("no frame here\n"), "no-frame");
      assert.strictEqual(yield* failure(""), "no-frame");

      const document = frame({ _tag: "Reflected", pair });

      assert.strictEqual(yield* failure(`${document}\n${document}\n`), "several-frames");
      assert.strictEqual(yield* failure(`${WITNESS_FRAME} {not json}`), "decode");
      assert.strictEqual(
        yield* failure(frame({ _tag: "Failed", stage: "somewhere-else", cause: "Error" })),
        "decode",
      );
      assert.strictEqual(yield* failure(frame({ _tag: "Reflected" })), "decode");
    }),
  );

  it.effect("refuses excess properties at every level of the strict document", () =>
    Effect.gen(function* () {
      const [endpoint] = reflection.endpoints;

      assert.isDefined(endpoint);

      assert.strictEqual(yield* failure(frame({ _tag: "Reflected", pair, extra: true })), "decode");
      assert.strictEqual(
        yield* failure(
          frame({ _tag: "Reflected", pair: { ...pair, original: { ...reflection, extra: 1 } } }),
        ),
        "decode",
      );
      assert.strictEqual(
        yield* failure(
          frame({
            _tag: "Reflected",
            pair: {
              ...pair,
              generated: { ...reflection, endpoints: [{ ...endpoint, unexpected: "field" }] },
            },
          }),
        ),
        "decode",
      );
    }),
  );

  it.effect("accepts the Δ2 identifier witness only with its exact key", () =>
    Effect.gen(function* () {
      const [endpoint] = reflection.endpoints;

      assert.isDefined(endpoint);

      const witnessed = {
        ...endpoint,
        annotationKeys: [OPEN_API_IDENTIFIER_KEY],
        identifierAnnotation: {
          key: OPEN_API_IDENTIFIER_KEY,
          endpoint: "readOwnProfile",
          value: "profile.readOwnProfile",
        },
      };

      const side = { ...reflection, endpoints: [witnessed] };

      const document = yield* readWitnessDocument(
        frame({ _tag: "Reflected", pair: { original: side, generated: side } }),
      );

      assert.strictEqual(document._tag, "Reflected");

      if (document._tag === "Reflected")
        assert.deepStrictEqual(document.pair.original.endpoints[0]?.identifierAnnotation, {
          key: OPEN_API_IDENTIFIER_KEY,
          endpoint: "readOwnProfile",
          value: "profile.readOwnProfile",
        });

      const wrong = {
        ...side,
        endpoints: [
          {
            ...witnessed,
            identifierAnnotation: { ...witnessed.identifierAnnotation, key: "other" },
          },
        ],
      };

      assert.strictEqual(
        yield* failure(frame({ _tag: "Reflected", pair: { original: wrong, generated: side } })),
        "decode",
      );
    }),
  );

  const PlanJson = Schema.fromJsonString(
    Schema.Struct({
      rootId: Schema.String,
      original: Schema.Struct({
        file: Schema.String,
        export: Schema.String,
        member: Schema.optionalKey(Schema.String),
      }),
      generated: Schema.Struct({
        file: Schema.String,
        export: Schema.String,
        member: Schema.optionalKey(Schema.String),
      }),
      projections: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          hook: Schema.Struct({
            file: Schema.String,
            export: Schema.String,
            member: Schema.optionalKey(Schema.String),
          }),
        }),
      ),
    }),
  );

  it.effect("embeds the plan as exact JSON, whatever characters the paths contain", () =>
    Effect.gen(function* () {
      const hostile = '/tmp/odd "dir"/`x`/${y}\nnew\u2028line\\back.ts';

      const plan: WitnessPlan = {
        rootId: "mini-api",
        original: { file: hostile, export: "ProfileGroup", member: undefined },
        generated: { file: "/tmp/g.ts", export: "ProfileApi", member: "inner" },
        projections: [{ name: "m#K", hook: { file: hostile, export: "hook", member: undefined } }],
      };

      const program = witnessProgram(plan);
      const line = program.split("\n").find((entry) => entry.startsWith("const plan = "));

      assert.isDefined(line);

      const embedded = yield* Schema.decodeEffect(PlanJson)(
        (line ?? "").slice("const plan = ".length, -1),
      );

      assert.strictEqual(embedded.rootId, "mini-api");
      assert.strictEqual(embedded.original.file, hostile);
      assert.strictEqual(embedded.generated.member, "inner");
      assert.strictEqual(embedded.projections[0]?.hook.file, hostile);

      // The frame is spelled once, and no application value is ever interpolated into the logic.
      assert.strictEqual(program.split(WITNESS_FRAME).length - 1, 1);
      assert.notInclude(program.split("\n").slice(2).join("\n"), "ProfileGroup");
    }),
  );

  it.effect("reads only structured TypeScript findings from the typecheck output", () =>
    Effect.sync(() => {
      const findings = typecheckFindings([
        "src/api.ts(3,14): error TS2322: Type 'string' is not assignable to type 'number'.",
        "some other line the compiler printed",
        "error TS5083: Cannot read file '/x/tsconfig.json'.",
        "  src/api.ts(4,1): not an error line",
        ".effx/generated/profile-handlers.ts(10,5): error TS2345: Argument is not assignable.",
      ]);

      assert.deepStrictEqual(findings, [
        {
          code: "TS2322",
          message: "Type 'string' is not assignable to type 'number'.",
          location: { file: "src/api.ts", line: 3, col: 14 },
        },
        { code: "TS5083", message: "Cannot read file '/x/tsconfig.json'." },
        {
          code: "TS2345",
          message: "Argument is not assignable.",
          location: { file: ".effx/generated/profile-handlers.ts", line: 10, col: 5 },
        },
      ]);
    }),
  );

  it.effect(
    "writes a type-level skeleton that names the original group's keys and nothing else",
    () =>
      Effect.sync(() => {
        const skeleton = bindingSkeleton({
          handlers: "./generated/profile-handlers.ts",
          declared: ["readOwnProfile", "updateOwnProfile"],
        });

        assert.include(skeleton, 'import * as handlers from "./generated/profile-handlers.ts";');
        assert.include(skeleton, 'type Declared = "readOwnProfile" | "updateOwnProfile";');
        assert.include(skeleton, "export const exactlyOneFactory");
        assert.include(skeleton, "export const rawKeysAreTheOriginalGroupKeys");
        // Type-level evidence: no handler body, no call of the factory, nothing executable.
        assert.notInclude(skeleton, "handleRaw");
        assert.notMatch(skeleton, /\bhandlers\.[A-Za-z]+\(/u);

        assert.include(
          bindingSkeleton({ handlers: "./h.js", declared: [] }),
          "type Declared = never;",
        );
      }),
  );
});
