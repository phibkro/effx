import { assert, describe, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import type { Diagnostic } from "@effx/diagnostics";
import { HttpDiagnostics } from "../src/diagnostics/http.ts";

describe("HTTP diagnostic registry", () => {
  it("preserves EFFX2402 variant 1", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "InvalidData", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 2", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "InvalidEdge", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 3", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "NotOperation", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 4", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "ExposureCount", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 5", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "PayloadIsQuery", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 6", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "GetPayload", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 7", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "Conditional", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 8", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "MediaType", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 9", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "Status", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 10", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "Identifiers", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 11", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "ParamsRequired", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 12", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "ParamsMismatch", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 13", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({
      _tag: "CommandIdentityKind",
      subject: "op",
    });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 14", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({
      _tag: "CommandIdentityHeaders",
      subject: "op",
    });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 15", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "GroupTarget", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 16", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "GroupIdentity", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 17", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "GroupConflict", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2404 variant 18", () => {
    const diagnostic = HttpDiagnostics.EFFX2404.emit({ _tag: "NotOperation", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2404");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2404 variant 19", () => {
    const diagnostic = HttpDiagnostics.EFFX2404.emit({
      _tag: "MultipleAssociations",
      subject: "op",
    });

    assert.strictEqual(diagnostic.code, "EFFX2404");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2404 variant 20", () => {
    const diagnostic = HttpDiagnostics.EFFX2404.emit({
      _tag: "MalformedAssociation",
      subject: "op",
    });

    assert.strictEqual(diagnostic.code, "EFFX2404");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2404 variant 21", () => {
    const diagnostic = HttpDiagnostics.EFFX2404.emit({
      _tag: "UnresolvedReference",
      subject: "op",
    });

    assert.strictEqual(diagnostic.code, "EFFX2404");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2404 variant 22", () => {
    const diagnostic = HttpDiagnostics.EFFX2404.emit({ _tag: "InvalidAssociation", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2404");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2404 variant 23", () => {
    const diagnostic = HttpDiagnostics.EFFX2404.emit({
      _tag: "MultipleDeclarations",
      subject: "op",
    });

    assert.strictEqual(diagnostic.code, "EFFX2404");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2404 variant 24", () => {
    const diagnostic = HttpDiagnostics.EFFX2404.emit({ _tag: "MultipleIn", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2404");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2404 variant 25", () => {
    const diagnostic = HttpDiagnostics.EFFX2404.emit({ _tag: "InTarget", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2404");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2405 variant 26", () => {
    const diagnostic = HttpDiagnostics.EFFX2405.emit({ _tag: "MissingContract", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2405");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2405 variant 27", () => {
    const diagnostic = HttpDiagnostics.EFFX2405.emit({ _tag: "RootConflict", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2405");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2405 variant 28", () => {
    const diagnostic = HttpDiagnostics.EFFX2405.emit({ _tag: "GroupConflict", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2405");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2405 variant 29", () => {
    const diagnostic = HttpDiagnostics.EFFX2405.emit({ _tag: "QueryDefault", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2405");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2401 variant 30", () => {
    const diagnostic = HttpDiagnostics.EFFX2401.emit({
      subject: "read",
      method: "PUT",
      path: "/users",
    });

    assert.strictEqual(diagnostic.code, "EFFX2401");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 31", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({
      _tag: "AnnotationTarget",
      subject: "op",
      annotation: "Http.Contract",
    });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 32", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({
      _tag: "DuplicateAnnotation",
      subject: "op",
      annotation: "Http.Contract",
    });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 33", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({
      _tag: "ExternalGroup",
      subject: "op",
      root: "api",
      group: "users",
      missing: "group",
    });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 variant 34", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({
      _tag: "ExternalGroup",
      subject: "op",
      root: "api",
      group: "users",
      missing: "root",
    });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2403 variant 35", () => {
    const diagnostic = HttpDiagnostics.EFFX2403.emit({ _tag: "MissingId", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2403");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2403 variant 36", () => {
    const diagnostic = HttpDiagnostics.EFFX2403.emit({
      _tag: "InvalidId",
      subject: "op",
      group: "users",
    });

    assert.strictEqual(diagnostic.code, "EFFX2403");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2403 variant 37", () => {
    const diagnostic = HttpDiagnostics.EFFX2403.emit({
      _tag: "DuplicateKey",
      subject: "op",
      operationId: "users.getUser",
      previous: "other",
    });

    assert.strictEqual(diagnostic.code, "EFFX2403");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2403 variant 38", () => {
    const diagnostic = HttpDiagnostics.EFFX2403.emit({
      _tag: "MixedBindings",
      subject: "op",
      root: "api",
      group: "users",
      previous: "other",
    });

    assert.strictEqual(diagnostic.code, "EFFX2403");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2403 variant 39", () => {
    const diagnostic = HttpDiagnostics.EFFX2403.emit({ _tag: "MissingContract", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2403");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2406 variant 40", () => {
    const diagnostic = HttpDiagnostics.EFFX2406.emit({
      name: "Users",
      first: "api/users",
      second: "api/user_s",
    });

    assert.strictEqual(diagnostic.code, "EFFX2406");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2410 variant 41", () => {
    const diagnostic = HttpDiagnostics.EFFX2410.emit({ _tag: "HeaderConflict", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2410");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2410 variant 42", () => {
    const diagnostic = HttpDiagnostics.EFFX2410.emit({
      _tag: "MixedFields",
      subject: "op",
      params: ["z", "a"],
      fields: ["z", "a", "limit", "cursor"],
      body: "query",
    });

    assert.strictEqual(diagnostic.code, "EFFX2410");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2410 variant 43", () => {
    const diagnostic = HttpDiagnostics.EFFX2410.emit({
      _tag: "MixedFields",
      subject: "op",
      params: ["z", "a"],
      fields: ["z", "a", "limit", "cursor"],
      body: "payload",
    });

    assert.strictEqual(diagnostic.code, "EFFX2410");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2411 variant 44", () => {
    const diagnostic = HttpDiagnostics.EFFX2411.emit({ subject: "op", verb: "Get" });

    assert.strictEqual(diagnostic.code, "EFFX2411");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2411 variant 45", () => {
    const diagnostic = HttpDiagnostics.EFFX2411.emit({ subject: "op", verb: "Delete" });

    assert.strictEqual(diagnostic.code, "EFFX2411");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2414 variant 46", () => {
    const diagnostic = HttpDiagnostics.EFFX2414.emit({ subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2414");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves the landed root-level missing-candidate message", () => {
    const diagnostic = HttpDiagnostics.EFFX2415.emit({ _tag: "NoCandidate", root: "AuthoredApi" });

    assert.strictEqual(diagnostic.code, "EFFX2415");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2415 variant 48", () => {
    const diagnostic = HttpDiagnostics.EFFX2415.emit({
      _tag: "MissingInventory",
      root: "api",
      group: "users",
    });

    assert.strictEqual(diagnostic.code, "EFFX2415");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2415 variant 49", () => {
    const diagnostic = HttpDiagnostics.EFFX2415.emit({
      _tag: "MissingEndpoint",
      subject: "op",
      root: "api",
      group: "users",
      key: "getUser",
    });

    assert.strictEqual(diagnostic.code, "EFFX2415");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("pins naming diagnostic messages and caller-owned locations", () => {
    const location = { file: "effx.config.ts", line: 1, col: 1 };

    const invalid = HttpDiagnostics.EFFX2412.emit(
      { pattern: "{Group}Problem", reason: "include {Key} or {key}" },
      { location },
    );

    assert.strictEqual(invalid.severity, "error");
    assert.deepStrictEqual(invalid.location, location);

    const collision = HttpDiagnostics.EFFX2413.emit({
      identifier: "ReadProblem",
      first: "profile.read",
      second: "content.read",
    });

    assert.strictEqual(collision.severity, "error");
  });

  it("preserves EFFX2500 variant 50", () => {
    const diagnostic = HttpDiagnostics.EFFX2500.emit({
      _tag: "DuplicateAnnotation",
      subject: "op",
      annotation: "Http.Access",
    });

    assert.strictEqual(diagnostic.code, "EFFX2500");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2500 variant 51", () => {
    const diagnostic = HttpDiagnostics.EFFX2500.emit({ _tag: "DuplicateContract", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2500");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2500 variant 52", () => {
    const diagnostic = HttpDiagnostics.EFFX2500.emit({
      _tag: "Malformed",
      subject: "op",
      validationMessage: "expected annotator",
    });

    assert.strictEqual(diagnostic.code, "EFFX2500");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2501 variant 53", () => {
    const diagnostic = HttpDiagnostics.EFFX2501.emit({ subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2501");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2502 variant 54", () => {
    const diagnostic = HttpDiagnostics.EFFX2502.emit({ subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2502");
    assert.strictEqual(diagnostic.severity, "warning");
  });
  it("preserves EFFX2503 variant 55", () => {
    const diagnostic = HttpDiagnostics.EFFX2503.emit({ subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2503");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2504 variant 56", () => {
    const diagnostic = HttpDiagnostics.EFFX2504.emit({ subject: "op", strictAccess: false });

    assert.strictEqual(diagnostic.code, "EFFX2504");
    assert.strictEqual(diagnostic.severity, "warning");
  });
  it("preserves EFFX2504 variant 57", () => {
    const diagnostic = HttpDiagnostics.EFFX2504.emit({ subject: "op", strictAccess: true });

    assert.strictEqual(diagnostic.code, "EFFX2504");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2505 variant 58", () => {
    const diagnostic = HttpDiagnostics.EFFX2505.emit({ root: "api" });

    assert.strictEqual(diagnostic.code, "EFFX2505");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2506 variant 59", () => {
    const diagnostic = HttpDiagnostics.EFFX2506.emit({
      subject: "op",
      violations: [
        "only a Command may claim a snapshot decision",
        'decisionTime must be "SnapshotRead"',
        "requirements must be empty",
        'acceptedCredentials must be exactly ["ObjectCapability"]',
        'principalKinds must be exactly ["CapabilityHolder"]',
      ],
    });

    assert.strictEqual(diagnostic.code, "EFFX2506");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2506 variant 60", () => {
    const diagnostic = HttpDiagnostics.EFFX2506.emit({
      subject: "op",
      violations: ["only a Command may claim a snapshot decision"],
    });

    assert.strictEqual(diagnostic.code, "EFFX2506");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2506 variant 61", () => {
    const diagnostic = HttpDiagnostics.EFFX2506.emit({
      subject: "op",
      violations: ['decisionTime must be "SnapshotRead"'],
    });

    assert.strictEqual(diagnostic.code, "EFFX2506");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2506 variant 62", () => {
    const diagnostic = HttpDiagnostics.EFFX2506.emit({
      subject: "op",
      violations: ["requirements must be empty"],
    });

    assert.strictEqual(diagnostic.code, "EFFX2506");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2506 variant 63", () => {
    const diagnostic = HttpDiagnostics.EFFX2506.emit({
      subject: "op",
      violations: ['acceptedCredentials must be exactly ["ObjectCapability"]'],
    });

    assert.strictEqual(diagnostic.code, "EFFX2506");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2506 variant 64", () => {
    const diagnostic = HttpDiagnostics.EFFX2506.emit({
      subject: "op",
      violations: ['principalKinds must be exactly ["CapabilityHolder"]'],
    });

    assert.strictEqual(diagnostic.code, "EFFX2506");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves occurrence location and related data without global state", () => {
    const location = { file: "users.ts", line: 3, col: 5 };
    const related = [HttpDiagnostics.EFFX2501.emit({ subject: "other" })];

    const diagnostic = HttpDiagnostics.EFFX2504.emit(
      { subject: "op", strictAccess: true },
      { location, related },
    );

    assert.deepStrictEqual(diagnostic.location, location);
    assert.deepStrictEqual(diagnostic.related, related);
    assert.strictEqual(
      HttpDiagnostics.EFFX2504.emit({ subject: "op", strictAccess: false }).severity,
      "warning",
    );
    assert.strictEqual(
      HttpDiagnostics.EFFX2504.emit({ subject: "op", strictAccess: false }).location,
      undefined,
    );
  });
  it("keeps trusted factory parameters and output structural", () => {
    expectTypeOf<ReturnType<typeof HttpDiagnostics.EFFX2504.emit>>().toExtend<Diagnostic>();
    expectTypeOf<Parameters<typeof HttpDiagnostics.EFFX2504.emit>[0]>().toEqualTypeOf<{
      readonly subject: string;
      readonly strictAccess: boolean;
    }>();
    expectTypeOf<typeof HttpDiagnostics.EFFX2415.entry.code>().toEqualTypeOf<"EFFX2415">();
  });
  it("preserves EFFX2402 DuplicateProblems", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "DuplicateProblems", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 ProblemsExposure", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "ProblemsExposure", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 MalformedProblems", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({
      _tag: "MalformedProblems",
      subject: "op",
      validationMessage: "expected registry",
    });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 ProblemsIdentifier", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "ProblemsIdentifier", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves EFFX2402 ProblemsCodes", () => {
    const diagnostic = HttpDiagnostics.EFFX2402.emit({ _tag: "ProblemsCodes", subject: "op" });

    assert.strictEqual(diagnostic.code, "EFFX2402");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("preserves the landed root-level unresolved-leaf diagnostic and location", () => {
    const location = { file: "http-root.ts", line: 9, col: 3 };

    const diagnostic = HttpDiagnostics.EFFX2415.emit(
      {
        _tag: "UnprovenRoot",
        root: "AuthoredApi",
        inventoryIssue: "cannot resolve HTTP group import ./generated/onboarding",
      },
      { location },
    );

    assert.strictEqual(diagnostic.code, "EFFX2415");
    assert.strictEqual(diagnostic.severity, "error");
    assert.strictEqual(diagnostic.location, location);
  });
  it("preserves the pipeline unavailable-root message without invented detail", () => {
    const diagnostic = HttpDiagnostics.EFFX2415.emit({
      _tag: "InventoryUnavailable",
      root: "AuthoredApi",
    });

    assert.strictEqual(diagnostic.code, "EFFX2415");
    assert.strictEqual(diagnostic.severity, "error");
  });
  it("declares both strictAccess outcomes without an unrestricted severity escape", () => {
    assert.deepStrictEqual(HttpDiagnostics.EFFX2504.entry.severityPolicy.allowedSeverities, [
      "warning",
      "error",
    ]);
    expectTypeOf<
      (typeof HttpDiagnostics.EFFX2504.entry.severityPolicy.allowedSeverities)[number]
    >().toEqualTypeOf<"warning" | "error">();
  });
});
