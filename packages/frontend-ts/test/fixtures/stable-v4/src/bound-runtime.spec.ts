import { expect, test } from "bun:test";
import { observeBoundBehaviors } from "./bound-behaviors.js";

// This Bun entry point and the outer Vitest bridge execute the same native stable
// Effect program. Assertions remain independent of its observed results.
test("bound Profile/Content HTTP success, guard failure, backend defect, cleanup and cancellation", () =>
  observeBoundBehaviors().then((observed) => {
    expect(observed.packageVersion).toBe("4.0.0");
    expect(observed.moduleOrigin).toBe(import.meta.resolve("effect"));
    expect(observed.runtimeIdentityMatches).toBe(true);
    expect(observed.profile.status).toBe(200);
    expect(observed.profile.body).toBe('{"firstName":"bound:substitute","lastName":"bound"}');
    expect(observed.profile.releases).toBe(1);
    expect(observed.content.map(({ action }) => action)).toEqual(["publish", "unpublish"]);
    for (const response of observed.content) {
      expect(response.status).toBe(200);
      expect(response.body).toBe(`article-1:${response.action}ed:8192`);
    }
    expect(observed.cancellation.interrupted).toBe(true);
    expect(observed.cancellation.releases).toBe(1);
    expect(observed.guardFailure.status).toBe(401);
    expect(observed.guardFailure.reads).toBe(0);
    expect(observed.defect.status).toBe(500);
    expect(observed.defect.releases).toBe(1);
  }));
