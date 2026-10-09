# Lift corpus provenance

## Source snapshots

The source repository is `https://github.com/vektorprogrammet/mono-web`.

| Snapshot          | Role                  | Source revision                            | Bytes                                                                                           |
| ----------------- | --------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `f433-original`   | historical provenance | `f433ea906c9f9af5134c7316d54c78d8c859038f` | Untouched Effect source, application roots, and complete transitive source closure              |
| `8152-oracle`     | historical provenance | `8152c389f1176ede38b70417bab1332b0a311c21` | Untouched committed Profile, Directory, and SocialEvents declarations with their source closure |
| `stable-original` | acceptance input      | `f433ea906c9f9af5134c7316d54c78d8c859038f` | `f433-original` after the migration `effect-4.0.0-v1`                                           |
| `stable-oracle`   | oracle input          | `8152c389f1176ede38b70417bab1332b0a311c21` | `8152-oracle` after the same migration                                                          |

`manifest.json` records every logical path with the SHA-256 of its exact UTF-8 bytes (`sha256`).
A stable snapshot also records the SHA-256 of the historical bytes it derives from (`originalSha256`).
Each snapshot has a digest (`snapshotSha256`): the SHA-256 of its path-sorted `path<TAB>sha256` lines.

The `.source` suffix is a storage convention, not a source edit. Copies remove only that suffix.
The suffix prevents formatters and TypeScript project scans from changing these authored inputs.
A historical file keeps its bytes under its historical snapshot.
A stable snapshot stores a blob only where the migration changed the file. Every other logical path resolves to the historical blob and keeps its hash.

The snapshots preserve the application root and its complete composition.
The source identity of `ExternalNativeApi` remains `../../packages/http-api/src/api#ExternalNativeApi`.
The mechanical comparison mounts the original exported group alone. The binding report refers to the original application root.
Root behavior and manual cutover remain unverified.

The oracle contains references to ignored generated contracts. Those references remain in the original bytes.
The acceptance compiler rebuilds the declarations and generates their contracts in owned scratch projects.
No historical semantic hash serves as the oracle.

## Stable migration `effect-4.0.0-v1`

The operator's stable-only Effect cutover makes the two original snapshots historical provenance.
Their bytes and hashes stay unchanged. They are not stable-native acceptance inputs.
The stable snapshots are the acceptance inputs. They are the historical bytes with the migration rules applied, and nothing else.

| Rule                                                                                                                  | Application commit     |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| The `effect/unstable/httpapi`, `effect/unstable/http` and `effect/unstable/schema` entry points become stable modules | `c9d19722`, `a39aca10` |
| The `Encoding` namespace becomes the `effect/encoding` module (`Base64.encode`, `Base64.decodeString`)                | `a39aca10`             |
| `Schema.brand` takes a literal name, so the shared integer schema is a value and each export names its brand          | `43149389`             |

Each rule is a change the application's own stable migration made to the same declarations because installed Effect 4.0.0 requires it.
`test/lift-corpus-migration.ts` is the only definition of the rules.
`test/lift-corpus-migration.test.ts` re-derives every stable blob from the historical bytes.
It fails on any difference, on a file that changed without a migration, on a trimmed logical path, and on a remaining unstable entry point or removed spelling.

The migration does not carry the application's lint-only edits (diagnostic headers, exception comments, synchronous decoders turned into `Result`) or its later feature changes.
The stable snapshots are therefore not byte-identical to the application's current sources.
The application owner's own acceptance of the lifted output is separate and unverified here.

The corpus test type-checks both stable snapshots with TypeScript 6.0.3 against the installed Effect runtime, with `strict`, `noEmit`, `skipLibCheck`, and the paths the test generates.
`stable-original` has no diagnostic.
`stable-oracle` has only the six generated-contract imports the manifest lists as unresolved.

## Licenses

Neither source revision contains a root license file. Neither owning package manifest declares a license.
The operator authorized this copy of operator-owned source for the assignment. This fixture does not invent an upstream license grant.

The installed runtime dependencies remain dependencies, not vendored application source.
`runtime/package.json` and `runtime/bun.lock` pin their identities and package integrity.
The `licenses` directory preserves license text from the installed dependency packages.

| Dependency    | Version  | License text                         |
| ------------- | -------- | ------------------------------------ |
| Effect        | `4.0.0`  | `licenses/effect-4.0.0.source`       |
| parse5        | `8.0.1`  | `licenses/parse5-8.0.1.source`       |
| ip-address    | `10.7.0` | `licenses/ip-address-10.7.0.source`  |
| @noble/hashes | `2.3.0`  | `licenses/noble-hashes-2.3.0.source` |

`licenses/effect-4.0.0-rc.116.source` is retained only with the historical dependency provenance.

## Ownership

Tests create unique copies of the stable snapshots under the ignored repository `.effx` directory.
Their Effect scope removes each copy on success, failure, or interruption.
The tests hash the authored inputs before copying them. They never write into these snapshots.
