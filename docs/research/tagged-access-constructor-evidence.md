# Tagged access source constructors — separate local acceptance

Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.

Observed 2026-10-03. This is a **separate source-language upgrade**, after SocialEvents' three-endpoint parity acceptance at clean mono-web `feb3af33c994274b72631db284aa71e4e41e6972 (unpublished)` (`social-events-slice-evidence.md`). The upgrade is accepted at **clean mono-web `da1f63f240fb382df60b2768c59f0da5461c70b4 (unpublished)`**, on the same retained, unlanded `effx/profile-baseline` branch in `mw`. The operator's mono-web `main` was read-only. No deployment, credentials, provider, production data or writer transfer occurred. This revision does **not** add a fourth SocialEvents endpoint or lost-response UI recovery.

## Source-bound pack and exception retirement

The first follow-up commit, `b519cf4d3157df50e76fc63305560ec23fb43c35 (unpublished)`, replaces only the mono-web vendor archives/manifests/lockfile with the pack from clean effx compiler commit **`cbea7c7440a3b177b3e04b6ab4b3a9c686a6b026`**. Runtime archive SHA-256 is `7a2a4d26e5003ecfab13ddf783a8c8be5304945ab678d2eeb191a294b3ecd909`; CLI archive is `6d0ecfdc6e511199c127bfc3cbaccd9279407bd6efdca411e7a10f5be828698f`. Both copied archives matched the source manifest, and the obsolete efdc archives were removed. A disposable **clean detached checkout of final `da1f63f2 (unpublished)`** ran `devenv shell -- bun install --frozen-lockfile` (exit 0, command wall about 9 s), then the unified `just effx-native` recipe (exit 0; exact ledger 6,872 ms, 937,857,024 B peak RSS) without a sibling effx checkout (`tools/effx-dist/manifest.json`; `packages/http-api/package.json`; root `package.json`/`bun.lock`). The compiler still emits the informational `EFFX0001` TypeScript 6.0.3-versus-target-7.0.2 warning; the target typecheck and strict Effect lint pass below.

The second, independently scoped commit, **`da1f63f240fb382df60b2768c59f0da5461c70b4 (unpublished)`**, converts the existing nine `One` capabilities to `Capability.one(...)` and seven `Reveal` policies to `Concealment.reveal` in `packages/http-api/src/{profile,directory,social-events}.effx.ts`. These are the compiler-recognized `@effx/runtime` constructors, not runtime domain/authorization replacements; no Profile, Schools or SocialEvents domain/SQL/UI handler changed. The source metadata now needs **zero** `anti-slop-effect/no-manual-tagged-construction` suppressions in those declarations: all **16** corresponding comments and the complete unused **EX-0011** registry entry were removed. `just exceptions` and full `just check` reported **10 exceptions, 20 suppressions, 22 references and 0 findings** (`docs/effect-exceptions.json`; effx `packages/runtime/src/authority.ts:23-65`; effx compiler's constructor/literal parity tests). Profile/Directory/SocialEvents declaration physical lines changed 111→107, 203→195 and 132→128 respectively: **446→430, −16**; this count excludes the vendor archives and deleted exception JSON and is not a product gate.

## Same semantic model and exact projections

Before and after **both** the cbea pack swap and the constructor source change, `packages/http-api/.effx/manifest.json` and `apps/backend/.effx/manifest.json` retained the identical three-group semantic hash **`615feee59b8b725dc7c5b001745428396ec492045cfaaaf6f3c797253b4ed50b`**. The clean final detached emit and integration emit agreed byte-for-byte on every generated output:

| Generated projection | SHA-256 before **and** after |
| --- | --- |
| Profile contract | `50f242dcb933b3e747c0b566dd9423123d5b4cf07f3e62a8c99c252f42b95f2c` |
| Directory contract | `2dfd8621968fc2287199dd393ae7aa2a5c2a5e154ddf00d2cf162d192fa51342` |
| SocialEvents contract | `4869821fe0c37160640b36125d6ba35257bbb963f0091233d581377d72a08bd9` |
| Profile raw handlers | `c0e4c2e0608433a7f3c4a6fba89efce4ef196bc7bd98b674e76c847d0d5e2882` |
| Directory raw handlers | `de4f29823b9ec30ba5be783a191c0368f9809418918c8f2f873f740e5272351f` |
| SocialEvents raw handlers | `16d1cde50003a4998e90564da76d40c3b3aa7674fa3361ae464018a8711ac848` |

The independently regenerated complete external OpenAPI is also **byte-identical to the accepted efdc projection**, SHA-256 `81e7b872178803a3c8bf6ccf86b96b5185ba560e9661b47e98d1d0d4e827b749`. The SDK operation index is **byte-identical**, SHA-256 `c4abcca1878171c84fd3c531c3fe5c93f92329818c59d4b73a8bf796bca8aad3`: 107 external operations (three SocialEvents), with one internal receipts operation excluded. The two already approved `SocialEventResource` `$ref` suffix swaps **against the older handwritten contract** are unchanged by this follow-up; see `social-events-slice-evidence.md#whole-api-projections-and-exact-investigated-delta`. No generated code or OpenAPI JSON was hand-edited.

## Complete measured acceptance at clean `da1f63f2 (unpublished)`

The following ran serially inside mono-web's `devenv shell` through `just measure` and its machine-wide heavy lock. All per-run ledger entries have `revision=da1f63f240fb382df60b2768c59f0da5461c70b4 (unpublished)`, `dirty:false`, **exit 0**; durations/RSS are per-run, not class maxima. The full check regenerated the native HTTP/OpenAPI/SDK projections, ran all 16 package type checks, source-safety, format, strict type-aware lint, layout, constructs, guides and the retired-exception assertion; the full test ran all 16 packages. The three browser suites used the real generated SDK, native Effect backend, Better Auth, production dashboard, Chromium and disposable PostgreSQL 18.6, not SDK echoes (`justfile`; mono-web `AGENTS.md#verification-and-resources`).

| Command after `devenv shell --` | Exit | Ledger wall | Peak RSS | Observation |
| --- | ---: | ---: | ---: | --- |
| `just measure --class check -- just effx-native` | 0 | 6,872 ms | 937,857,024 B | Clean detached final-source emit; one unchanged IR/hash and six unchanged files. |
| `just measure --class check -- just check --concurrency=1` | 0 | 60,981 ms | 3,619,876,864 B | All native/compiler-derived contracts and strict diagnostics clean; `just exceptions` reported no remaining EX-0011 site. |
| `just measure --class test -- just test --concurrency=1` | 0 | 321,167 ms | 2,607,443,968 B | Complete 16-package test graph passed, including generated native API, real PostgreSQL retry/receipts and SDK index; no aggregate test count is inferred from truncated logs. |
| `just measure --class e2e -- just e2e social-events` | 0 | 70,175 ms | 3,015,946,240 B | Spec 0110 real SocialEvents browser/API/PostgreSQL scope, create/replay/conflict, authority, immutability, accessibility and cleanup passed. |
| `just measure --class e2e -- just e2e profile` | 0 | 47,354 ms | 2,700,165,120 B | Original Profile authenticated edit, denial, stale/replay, strict wire, actor/axe journey passed. |
| `just measure --class e2e -- just e2e schools` | 0 | 70,026 ms | 3,667,673,088 B | Both original Schools directory and administration real journeys passed. |

`just measure --report` was also read. The operator-owned mono-web `main` was not edited; branch landing remains operator-controlled. No separate whole-response-loss browser journey, fourth GET-by-ID endpoint, provider proof, production cutover, Cedar leases or other context migration is claimed. The next product slice remains outside this constructor-only source upgrade.
