import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { expectTypeOf } from "vitest";
import {
  type AnnotationArg,
  type Declaration,
  HttpDiagnostics,
  Naming,
  type ProjectConfig,
} from "@effx/compiler";
import {
  nameProblems,
  expandProblemIdentifier,
  problemNamingIssue,
} from "../src/problem-naming.ts";

type ProblemOptions = {
  codes: ReadonlyArray<string>;
  identifier?: string;
};

const operation = (
  group: string,
  key: string,
  codes: ReadonlyArray<string>,
  identifier?: string,
): Declaration => {
  const problems: ProblemOptions = { codes };

  if (identifier !== undefined) problems.identifier = identifier;

  return {
    id: `${group}.${key}`,
    kind: "builder",
    export: key,
    module: "./operations.ts",
    annotations: [
      { name: "Query", args: [{}] },
      { name: "Http.Contract", args: [{ group, metadata: { operationId: `${group}.${key}` } }] },
      { name: "Http.Problems", args: [problems] },
    ],
  };
};

const problemArgs = (declaration: Declaration): AnnotationArg | undefined =>
  declaration.annotations.find((annotation) => annotation.name === "Http.Problems")?.args[0];

describe("spec 0024 problem naming laws", () => {
  it("keeps naming data typed, not executable", () => {
    expectTypeOf<NonNullable<ProjectConfig["naming"]>>().toEqualTypeOf<Naming>();
    // @ts-expect-error Naming is data; callbacks are not a project policy.
    const invalid: Naming = { problemIdentifier: () => "Problem" };
    assert.isFalse(Schema.is(Naming)(invalid));
  });

  it("substitutes only the four declared placeholders and preserves casing boundaries", () => {
    assert.strictEqual(
      expandProblemIdentifier("{Group}{Key}Problem", "social-events", "create"),
      "SocialEventsCreateProblem",
    );
    assert.strictEqual(
      expandProblemIdentifier("{Group}_{group}_{Key}_{key}", "social_events.v2", "create"),
      "SocialEventsV2_social_events.v2_Create_create",
    );
    assert.strictEqual(problemNamingIssue("{Key}Problem"), undefined);
    assert.strictEqual(problemNamingIssue("_{key}_${Key}"), undefined);
  });

  it.each([
    "",
    "Problem",
    "{Group}Problem",
    "{Unknown}{Key}",
    "{{Key}}",
    "{Key",
    "Key}",
    "{key}-Problem",
    "1{Key}",
    "{key} Problem",
    "${endpointKey}Problem",
  ])("rejects invalid data pattern %s through its registered entry", (pattern) => {
    const result = nameProblems([], pattern);
    assert.deepStrictEqual(
      result.diagnostics.map((d) => d.code),
      [HttpDiagnostics.EFFX2412.entry.code],
    );
    assert.strictEqual(result.diagnostics[0]?.severity, "error");
  });

  it("rejects unsafe raw expansions, without sanitizing them", () => {
    const result = nameProblems(
      [operation("social-events", "create", ["event.failed"])],
      "{group}{key}Problem",
    );

    assert.strictEqual(result.diagnostics[0]?.code, HttpDiagnostics.EFFX2412.entry.code);
    assert.include(result.diagnostics[0]!.message, "social-eventscreateProblem");
  });

  it("is immutable, repeatable and has no compilation-global collision state", () => {
    const source = Object.freeze([Object.freeze(operation("profile", "read", ["profile.failed"]))]);

    const first = nameProblems(source, "{Group}{Key}Problem");
    assert.deepStrictEqual(problemArgs(source[0]!), { codes: ["profile.failed"] });
    assert.deepStrictEqual(problemArgs(first.declarations[0]!), {
      codes: ["profile.failed"],
      identifier: "ProfileReadProblem",
    });
    assert.deepStrictEqual(nameProblems(source, "{Group}{Key}Problem"), first);
    assert.deepStrictEqual(
      nameProblems([operation("profile", "read", ["other.failed"])], "{Group}{Key}Problem")
        .diagnostics,
      [],
    );
  });

  it("preserves legacy omitted IR and explicit overrides", () => {
    const legacy = operation("profile", "read", ["profile.failed"]);
    assert.deepStrictEqual(nameProblems([legacy], undefined).declarations, [legacy]);

    const shared = operation(
      "directory",
      "execute",
      ["school.failed"],
      "SchoolAdministrationProblem",
    );

    assert.deepStrictEqual(nameProblems([shared], "{Group}{Key}Problem").declarations, [shared]);
  });

  it("allows equal code lists in either order, but rejects distinct derived unions", () => {
    const left = operation("profile", "read", ["a", "b"]);
    const equal = operation("content", "read", ["b", "a"]);
    assert.deepStrictEqual(nameProblems([left, equal], "{Key}Problem").diagnostics, []);
    const different = operation("content", "read", ["c"]);
    const result = nameProblems([left, different], "{Key}Problem");
    assert.deepStrictEqual(
      result.diagnostics.map((d) => d.code),
      [HttpDiagnostics.EFFX2413.entry.code],
    );
    assert.include(result.diagnostics[0]!.message, "profile.read");
    assert.include(result.diagnostics[0]!.message, "content.read");
    assert.deepStrictEqual(
      nameProblems([left, operation("content", "read", ["c"], "ReadProblem")], "{Key}Problem")
        .diagnostics,
      [],
    );
  });
});
