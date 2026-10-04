import { Effect, FileSystem, Path } from "effect";
import { surfaceOf, surfaceText } from "@effx/compiler";
import { type ApplicationIR, type GraphIndex, semanticHash } from "@effx/ir";

/** Spec 0021 §3: `.effx/surface.json`, a projection of the IR alone, written next to `ir.json`. */
export const SURFACE_FILE = "surface.json";

export const writeSurface = Effect.fn("writeSurface")(function* (
  effxDir: string,
  ir: ApplicationIR,
  index: GraphIndex,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const surface = yield* surfaceOf(ir, index, yield* semanticHash(ir));

  yield* fs.writeFileString(path.join(effxDir, SURFACE_FILE), surfaceText(surface));
});
