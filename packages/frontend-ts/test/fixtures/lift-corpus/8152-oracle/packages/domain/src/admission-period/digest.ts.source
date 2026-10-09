import { flow } from "effect";

import { canonicalJson, canonicalJsonBytes, sha256Hex } from "../shared-kernel/index.js";

/** Canonical JSON bytes used for command replay identity. */
export const admissionPeriodCommandBytes = canonicalJsonBytes;

export const admissionPeriodCommandDigest = flow(canonicalJsonBytes, sha256Hex);

export { canonicalJson, canonicalJsonBytes, sha256Hex };
