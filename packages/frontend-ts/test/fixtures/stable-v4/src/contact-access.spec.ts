import { expect, test } from "bun:test";
import { Context } from "effect";
import { HttpApi, OpenApi } from "effect/http-api";
import { ContactApi, submitContactMessage } from "../.effx/generated/contact-contract.js";
import { ContactAccessAnnotation, contactAccessAnnotations } from "./contact-support.js";

// Importing the generated contract already ran the strict annotator on the emitted AccessSpec.
const emitted = Context.getOrUndefined(submitContactMessage.annotations, ContactAccessAnnotation);

const document = OpenApi.fromApi(HttpApi.make("external-native-api").add(ContactApi));

test("the emitted AccessSpec carries exactly the original fields", () => {
  expect(Object.keys(emitted ?? {})).toEqual([
    "exposure",
    "acceptedCredentials",
    "principalKinds",
    "capabilities",
    "requirements",
    "canonicalScopeResolver",
    "concealment",
    "decisionTime",
  ]);
  expect(emitted).not.toHaveProperty("snapshotDecisionForCommand");
});

test("the strict annotator rejects the claim flag that the generator must never emit", () => {
  const claimed = Object.assign({}, emitted, { snapshotDecisionForCommand: true });

  expect(() => contactAccessAnnotations(claimed)).toThrow();
  expect(() => contactAccessAnnotations(emitted)).not.toThrow();
});

test("the generated 201 has no body or media type and keeps the no-store headers", () => {
  const operation = document.paths["/api/contact-messages"]?.post;
  const created = operation?.responses[201];

  expect(created).toBeDefined();
  expect(created?.content).toBeUndefined();
  expect(Object.keys(created?.headers ?? {}).toSorted()).toEqual(["cache-control", "vary"]);
  expect(operation?.responses[200]).toBeUndefined();
  expect(operation?.responses[204]).toBeUndefined();
  expect(Object.keys(operation ?? {}).filter((key) => key.startsWith("x-"))).toEqual([]);
  expect(JSON.stringify(document)).not.toContain("snapshotDecisionForCommand");
});
