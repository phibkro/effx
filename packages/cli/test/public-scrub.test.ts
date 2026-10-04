import { assert, describe, it } from "@effect/vitest";
import { lineLossViolation } from "../../../scripts/public-scrub.ts";

const fixturePath = new URL("./public-scrub-truncation.fixture.mdx", import.meta.url).pathname;

describe("public scrub line-retention guard", () => {
  it("rejects a partial write of long MDX but allows a path replacement", () =>
    Bun.file(fixturePath)
      .text()
      .then((original) => {
        assert.isAbove(original.split("\n").length, 600);

        const mapped = original.replace(
          "LOCAL_EFFECT_SOURCE",
          "https://github.com/Effect-TS/effect/blob/revision/source.ts",
        );

        assert.isUndefined(lineLossViolation(fixturePath, original, mapped, 1));

        const partialWrite = original.split("\n").slice(0, 300).join("\n");
        const violation = lineLossViolation(fixturePath, original, partialWrite, 1);
        assert.isString(violation);
        assert.isTrue(violation?.includes("scrub would remove"));
      }));
});
