import { Effect, Schema } from "effect";
import { ReflectionPair, type Location } from "@effx/compiler";

/*
 * The static check witness and the binding skeleton (spec 0019 §2.4 steps 4-6, §7). Both are plain text
 * rendered from reviewed model facts: a witness imports the ORIGINAL exported group and the ACTUAL
 * generated contract group, mounts each ALONE on a fresh root with the original root's identity, and
 * reports one strict document. Nothing in a plan is derived from application output. The witness reports
 * failures by stage and error name only; messages, stack frames and values from application modules never
 * leave the child, because they may carry private data.
 */

/** The line prefix that frames the witness document among whatever an application module prints. */
export const WITNESS_FRAME = "effx-lift-check/v1";

/** Where in the witness a failure happened; the CLI maps each to a registered EFFX3103 reason. */
export const WitnessStage = Schema.Literals([
  "import-original",
  "import-generated",
  "import-projection",
  "build-original",
  "build-generated",
  "projection-original",
  "projection-generated",
]);

export type WitnessStage = typeof WitnessStage.Type;

/** The one document the witness prints: the strict reflection pair or a stage-named failure. */
export const WitnessDocument = Schema.TaggedUnion({
  Reflected: { pair: ReflectionPair },
  Failed: { stage: WitnessStage, cause: Schema.String },
});

export type WitnessDocument = typeof WitnessDocument.Type;

/** An exported value (optionally a static member of it) at an absolute module file. */
export interface WitnessExport {
  readonly file: string;
  readonly export: string;
  readonly member?: string | undefined;
}

/** One registered opaque-Context projection: its report key and the application hook that computes it. */
export interface WitnessProjection {
  readonly name: string;
  readonly hook: WitnessExport;
}

/** Everything the witness embeds: all of it reviewed model or generated-output facts. */
export interface WitnessPlan {
  /** The identity literal of the unique original application root; both fresh roots reuse it. */
  readonly rootId: string;
  readonly original: WitnessExport;
  readonly generated: WitnessExport;
  readonly projections: ReadonlyArray<WitnessProjection>;
}

/** The child produced no usable document: this is check inability data, never a pass. */
export class WitnessUnreadable extends Schema.TaggedError<WitnessUnreadable>()(
  "WitnessUnreadable",
  { reason: Schema.Literals(["no-frame", "several-frames", "decode"]) },
) {}

const decodeDocument = Schema.decodeUnknownEffect(Schema.fromJsonString(WitnessDocument), {
  onExcessProperty: "error",
});

/** Finds the single framed line in the child's bounded stdout and strictly decodes its document. */
export const readWitnessDocument = (
  stdout: string,
): Effect.Effect<WitnessDocument, WitnessUnreadable> => {
  const prefix = `${WITNESS_FRAME} `;

  const framed = stdout.split("\n").filter((line) => line.startsWith(prefix));

  const [only] = framed;

  if (only === undefined) return Effect.fail(new WitnessUnreadable({ reason: "no-frame" }));

  if (framed.length > 1) return Effect.fail(new WitnessUnreadable({ reason: "several-frames" }));

  return decodeDocument(only.slice(prefix.length)).pipe(
    Effect.mapError(() => new WitnessUnreadable({ reason: "decode" })),
  );
};

/** The fixed witness logic; every variable fact arrives through the `plan` literal above it. */
const witnessBody = `
import { Option } from "effect";
import { HttpApi, OpenApi } from "effect/http-api";

const frame = "effx-lift-check/v1";
const identifierKey = "effect/http-api/OpenApi/Identifier";

/** A failure stage; only the stage and the error NAME ever leave the child. */
class StageError extends Error {
  constructor(stage, cause) {
    super(stage);
    this.stage = stage;
    this.causeName = cause instanceof Error ? cause.name : "NonError";
  }
}

const json = (value) => JSON.parse(JSON.stringify(value === undefined ? null : value));

const exported = (module, location) => {
  const value = module[location.export];

  return location.member === undefined || value === undefined || value === null
    ? value
    : value[location.member];
};

// The specifier is runtime-selected: the generated plan names the original and generated module files.
const load = async (location, stage) => {
  let module;

  try {
    module = await import(location.file);
  } catch (error) {
    throw new StageError(stage, error);
  }

  const value = exported(module, location);

  if (value === undefined || value === null) {
    throw new StageError(stage, new Error("MissingExport"));
  }

  return value;
};

const hooksOf = async () => {
  const hooks = [];

  for (const projection of plan.projections) {
    const hook = await load(projection.hook, "import-projection");

    if (typeof hook !== "function") {
      throw new StageError("import-projection", new TypeError("NotAFunction"));
    }

    hooks.push({ name: projection.name, hook });
  }

  return hooks;
};

const projectionsOf = (mergedAnnotations, hooks, side) => {
  const projections = {};

  for (const { name, hook } of hooks) {
    try {
      const value = hook({ annotations: mergedAnnotations });

      projections[name] = json(Option.isOption(value) ? Option.getOrNull(value) : value);
    } catch (error) {
      throw new StageError("projection-" + side, error);
    }
  }

  return projections;
};

const reflectGroup = (group, hooks, side) => {
  const api = HttpApi.make(plan.rootId).add(group);
  const endpoints = [];

  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: ({ group: mounted, endpoint, mergedAnnotations, middleware, successes, errors }) => {
      const identifier = mergedAnnotations.mapUnsafe.get(identifierKey);

      const record = {
        group: mounted.identifier,
        identifier: endpoint.identifier,
        method: endpoint.method,
        path: endpoint.path,
        middleware: [...middleware].map((service) => service.key).sort(),
        successStatuses: [...successes.keys()].sort((left, right) => left - right),
        errorStatuses: [...errors.keys()].sort((left, right) => left - right),
        annotationKeys: [...mergedAnnotations.mapUnsafe.keys()].sort(),
        projections: projectionsOf(mergedAnnotations, hooks, side),
      };

      endpoints.push(
        identifier === undefined
          ? record
          : {
              ...record,
              identifierAnnotation: {
                key: identifierKey,
                endpoint: endpoint.identifier,
                value: String(identifier),
              },
            },
      );
    },
  });

  return { openapi: json(OpenApi.fromApi(api)), endpoints };
};

const reflectSide = (side, group, hooks) => {
  try {
    return reflectGroup(group, hooks, side);
  } catch (error) {
    throw error instanceof StageError ? error : new StageError("build-" + side, error);
  }
};

const run = async () => {
  try {
    const original = await load(plan.original, "import-original");
    const generated = await load(plan.generated, "import-generated");
    const hooks = await hooksOf();

    return {
      _tag: "Reflected",
      pair: {
        original: reflectSide("original", original, hooks),
        generated: reflectSide("generated", generated, hooks),
      },
    };
  } catch (error) {
    return error instanceof StageError
      ? { _tag: "Failed", stage: error.stage, cause: error.causeName }
      : { _tag: "Failed", stage: "build-original", cause: "Unclassified" };
  }
};

const document = await run();

const written = Promise.withResolvers();

process.stdout.write(frame + " " + JSON.stringify(document) + "\\n", () => written.resolve(undefined));

await written.promise;

process.exit(0);
`;

/** The complete witness program text for one plan. Static logic; the plan is the only variable part. */
export const witnessProgram = (plan: WitnessPlan): string =>
  [
    "// Generated by `effx lift --check` (spec 0019 §2.4 step 4). Static text: no application output feeds it.",
    `const plan = ${JSON.stringify(plan)};`,
    witnessBody,
  ].join("\n");

/** The type-level skeleton of the rewritten binding: never executed, never emitted, no handler is invented. */
export const bindingSkeleton = (input: {
  /** Relative specifier of the generated handlers module, from the skeleton file. */
  readonly handlers: string;
  /** The original model's complete endpoint key set of the group. */
  readonly declared: ReadonlyArray<string>;
}): string =>
  [
    "// Generated by `effx lift --check` (spec 0019 §7). Type-level evidence only: nothing here runs.",
    `import * as handlers from ${JSON.stringify(input.handlers)};`,
    "",
    "type FactoryName = Extract<keyof typeof handlers, `${string}ApiHandlers`>;",
    "type Factory = (typeof handlers)[FactoryName];",
    'type Raw = Parameters<Factory>[0]["raw"];',
    `type Declared = ${input.declared.length === 0 ? "never" : input.declared.map((key) => JSON.stringify(key)).join(" | ")};`,
    "type Same<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;",
    "type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;",
    "",
    "export const exactlyOneFactory: [IsUnion<FactoryName>] extends [false]",
    "  ? ([FactoryName] extends [never] ? false : true)",
    "  : false = true;",
    "export const rawKeysAreTheOriginalGroupKeys: Same<keyof Raw, Declared> = true;",
    "",
  ].join("\n");

/** One structured TypeScript diagnostic of the overlay typecheck (`file(line,col): error TSnnnn: message`). */
export interface TypecheckFinding {
  readonly code: string;
  readonly message: string;
  /** Present when tsc anchored the diagnostic in a file (as tsc prints it, relative to the cwd). */
  readonly location?: Location;
}

const anchored = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/u;

const global = /^error (TS\d+): (.*)$/u;

/** The structured findings of tsc's plain output; every other line is ignored and never echoed. */
export const typecheckFindings = (lines: ReadonlyArray<string>): ReadonlyArray<TypecheckFinding> =>
  lines.flatMap((line): ReadonlyArray<TypecheckFinding> => {
    const match = anchored.exec(line);

    if (match !== null) {
      const [, file, row, col, code, message] = match;

      return file !== undefined &&
        row !== undefined &&
        col !== undefined &&
        code !== undefined &&
        message !== undefined
        ? [{ code, message, location: { file, line: Number(row), col: Number(col) } }]
        : [];
    }

    const unanchored = global.exec(line);

    return unanchored?.[1] !== undefined && unanchored[2] !== undefined
      ? [{ code: unanchored[1], message: unanchored[2] }]
      : [];
  });
