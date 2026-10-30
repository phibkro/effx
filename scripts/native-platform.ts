import { BunCrypto, BunServices } from "@effect/platform-bun";
import { Layer } from "effect";

/**
 * The native capabilities effx programs run on: Bun's FileSystem, Path and Stdio, plus the `Digest` and
 * `SecureRandom` services. Effect 4.1 no longer bundles crypto into the runtime `*Services` layers, so
 * every process root and test that runs a program needing a digest or a secure random token provides it
 * from here, once, instead of each file merging its own.
 */
export const NativePlatform = Layer.mergeAll(
  BunServices.layer,
  BunCrypto.layerDigest,
  BunCrypto.layerSecureRandom,
);
