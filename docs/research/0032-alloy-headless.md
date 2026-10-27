# Spec 0032: Alloy 6.2.0 headless interface

The upstream Alloy site identifies 6.2.0 as its 2025-01-09 release:
<https://alloytools.org/>. The inspected Nix package was
`nixpkgs#alloy6`, realized as `alloy6-6.2.0`; its executable is **`alloy6`**,
not `alloy`. Its wrapper runs the bundled `alloy6.jar` with OpenJDK 21.
`nix shell nixpkgs#alloy6 -c alloy6 version` printed `6.2.0`. The registry
reference `nixpkgs#alloy6` by itself is not an immutable Nix pin, so consumers
must check the executable's version rather than infer it from that spelling.

The final toolchain is pinned by `flake.nix` and `flake.lock` to nixpkgs
`1f607aa79b6356ed45d3cd3c8079c196e79efa2c` (nar hash
`sha256-Mg3rRjsbMqhSMxop5PYMXos8SwAjejrxSgVThTvP9eg=`).
`nix eval --raw .#alloy6.version` returned `6.2.0`; local tests and CI use
`nix shell .#alloy6`, not a channel. `nix shell .#alloy6 -c alloy6 version`
also exited 0 and printed `6.2.0`. Its Alloy jar and the initially probed jar
have the same SHA-256
`6b8c1cb5bc93bedfc7c61435c4e1ab6e688a242dc702a394628d9a9801edb78d`.
The Check and separate release-gate jobs
use `contents: read`, no npm token, and the maintained
[`cachix/install-nix-action`](https://github.com/cachix/install-nix-action)
at full commit `13d8dd58da0234aa297dedd986986ccb8e7f3e24` (v31.11.1).
Its upstream documentation says flakes and `nix-command` are enabled by
default. The publish job depends on the gate, retains its existing write
authority, and installs no Nix. These workflow changes are unverified on
GitHub because this branch has not been pushed. Local `actionlint` from that
same nixpkgs revision exited 0 for both workflow files.
The effx worktree now uses Effect 4.0.6; the initial implementation used 4.0.0.
Consumer check representations cross the boundary as JSON, not runtime objects.

`alloy6 help`, `alloy6 help commands`, and `alloy6 help exec` expose the
headless dispatcher. The relevant interface is:

```text
alloy6 commands <model.als>
alloy6 exec --quiet --command '*' --output <empty-directory> --type json --repeat 0 <model.als>
```

`--command '*'` selects all commands. `--repeat 0` requests all solutions the
solver can find; the help states that the default is one. `--type` supports
`none`, `text`, `table`, `json`, and `xml`; the default solver is SAT4J.
`--output -` writes solutions to stdout, but multiple JSON documents are
concatenated without a separator and no receipt is written. An output directory
instead contains `receipt.json` and per-solution files. An existing nonempty
output directory is rejected unless `--force` deletes and recreates it; use a
fresh scoped directory instead. The help spells the long symmetry flag
`--ymmetry`; `--symmetry` was rejected by the executable. The tested
short spelling is `-y 0`, which disables symmetry breaking; the default is
20. Model scope and temporal steps bound the results.
In a temporal JSON solution, the `instances` array holds the states and
field values appear as tuple arrays under their owning atom. The probe's
`View$0.allows` was `[["Person$0", "Target$0"]]`.

## Observed bounded probe

The following probe was run from the worktree (scope 2):

```alloy
module alloy_probe
sig Person {}
pred people { some Person }
run people for 2
assert SomePeople { some Person }
check SomePeople for 2
assert Trivial { no Person or some Person }
check Trivial for 2
```

```text
$ nix shell nixpkgs#alloy6 -c alloy6 commands .alloy-0032-probe.als
0 . Run people for 2
1 . Check SomePeople for 2
2 . Check Trivial for 2
$ nix shell nixpkgs#alloy6 -c alloy6 exec --quiet --command '*' --output .alloy-0032-probe-output --type json --repeat 0 .alloy-0032-probe.als
$ echo $?
0
$ jq -r '.commands | to_entries[] | [.key, .value.type, ((.value.solution // []) | length), .value.source] | @tsv' .alloy-0032-probe-output/receipt.json
people      run    2    run people for 2
SomePeople  check  1    check SomePeople for 2
Trivial     check  0    check Trivial for 2
```

A check's nonempty `solution` array is therefore a counterexample; an absent
or empty array means no counterexample was found in this bounded probe. The
process returned zero despite the failing `SomePeople` assertion, so exit code
alone cannot determine conformance. A parser must also validate that every
expected command is present in the receipt and reject malformed or incomplete
output instead of treating it as a pass. The two temporary probe artifacts were
not retained as product files.

## Temporal traces are not all configurations

The official Alloy 6 documentation distinguishes a new static configuration
from a new trace under the same configuration: <https://alloytools.org/alloy6.html>.
In the generated temporal fixture, `alloy6 exec --command Vectors --repeat 0
-y 0` returned 20 solutions; all 20 had the same principals, memberships,
team function, position and target, varying only temporal state. It is therefore
not evidence of exhaustive configuration vectors.

A separate static scope-1 probe declared `sig Person {}` and `sig Target {
owner: lone Person }`, with a projection exposing persons, targets and owners.
Running `alloy6 exec --quiet --command Vectors --output <directory> --type json
--repeat 0 -y 0 <probe.als>` returned exactly five configurations. Counts
of (persons, targets, owner tuples) were `(0,0,0)`, `(0,1,0)`, `(1,0,0)`,
`(1,1,0)`, and `(1,1,1)`, each once: the five possible configurations at that
scope. The generated static companion uses the same declaration-derived
authorization and guard formulas, without temporal syntax, to enumerate
configurations; the temporal module remains the assertion model.

An earlier clocked fixture probe required a target and returned 35,280
vectors before and after removing the directory grant. Its interpreter found
exactly 8,280 removed directory-job permission rows and no other changes.
That probe exposed an unjustified nonempty-target assumption: the description
does not require a target. The final static model permits zero targets and A6
compares permissions for every target that exists.

The earlier singleton-machine model produced 43,040 vectors at scope 1;
`bun run --cwd examples/domain-model effx:build && nix shell .#alloy6 -c bun run --cwd examples/domain-model models:check`
exited 0 with the three A1 runs and A2–A7 passing. Removing the directory
grant removed 8,280 rows and no others. This observation predates the R1
per-entity field change and is not evidence for the revised vector count.

Before membership was bound to the machine, the entity-aware fixture produced
71,016 vectors on each side of the grant removal, with 13,662 removed
directory-job rows and no other changes. The independent count was 1,076
authorization worlds × 33 machine/context worlds × two clock values.
That observation predates the membership-state binding in R1.

With membership bound to the machine, the independent scope-1 expected count
is `(212 + 432 × 4 × 4 × 2) × 2 = 28,072`: 212 authorization worlds have no
membership; the other 432 have one membership before choosing its four stored
bound pairs, four machine states and two context cardinalities. The last factor
is the two clock values. Membership activity is derived from the machine state,
not counted as an independent Boolean.

`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "checks all six"`
exited 0. All three A1 runs and A2–A7 passed; it printed `vectors: 28072 before,
28072 after, 4734 removed directory-job rows; no other rows changed`. The
interpreter agreed with both sets, including membership/state identity and
both guard phases, and all projected world keys were distinct.


`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "reachability does not join|stored bounds stay fixed|declared writes over|a calculated guard fires|a time step can end"`
exited 0 with five tests. At scope 2 and four steps, the `timeTravel` case
found no trace to `Open` for one entity and two contexts, although A2 had no
counterexample. A declared write produced `EFFX4313`, could change its target
entity, and framed another entity. A clock-driven transition and admin expiry
occurred even with no caller context; the membership-end witness had one
active membership before and none after.

`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "stored bounds stay fixed"`
exited 0: successive commands chose different caller values while stored
fields stayed fixed for one entity at scope 2 and four steps.

`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "declared writes over|write without a machine transition"`
exited 0 with two tests: a selected entity could change while others were
framed; without a machine transition, two membership entities could both
change. Both cases reported `EFFX4313` at scope 2 and four steps.

`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "A5 detects"`
exited 0: Alloy returned a counterexample where the same membership/machine
atom was outside `grantingStates` but its `term: "any"` subject contributed
permission. Alloy itself exited 0 for that failed assertion.

`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "transition to the sentinel"`
exited 0: the same membership moved to `[*]` and stopped granting at scope 1
and four steps.

`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "absent admin, membership"`
exited 0. A4, A5 and A7 each reported `NOT APPLICABLE`, not PASS; the
unbound time conditions also produced `EFFX4311` warnings.


`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "mutant is diagnosed"`
exited 0 with six tests passed. Each invocation of `effx models check`
exited 1 while the Alloy assertion process exited 0:

| Mutant | Diagnostic | Observed witness |
| --- | --- | --- |
| unreachable | EFFX4305 | `Review:Lost not reached within 4 steps at scope 1` |
| deadEnd | EFFX4306 | nonterminal `Review:Stuck` has no outgoing transition |
| ungranted | EFFX4307 | `Unassigned` has no grant |
| adminSelf | EFFX4308 | non-admin `Person$0` can `GrantAdmin` to its own target |
| endedMembership | EFFX4309 | `MembershipRecord$0` is `Closed` and its inactive recruitment membership allows `AdvanceReview` |
| otherJob | EFFX4310 | directory system can run `CleanDirectory` for the cleanup job |

The last five diagnostics included the principal, membership, target, command
and state projections. The reachability run had no solution, so it reports the
bound rather than inventing a counterexample. This run used the repository's
locked Alloy 6.2.0 package.

Before the per-entity revision, the locked-tool command
`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "toggle off|Alloy receipt|Alloy executable|interrupting the real CLI|model output cannot escape|a calculated guard|a time step can end|reachability does not join"`
exited 0 with 11 tests passed. The disabled toggle printed `effx exit 0; fake
Alloy marker absent`. Missing and wrong-version tools produced `EFFX4303` and
exit 1. Missing, malformed and incomplete receipts each produced `EFFX4304`
and exit 1; none was treated as a pass. The stopped child was reaped after
the CLI was interrupted.

After the membership binding,
`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "toggle off|Alloy receipt|Alloy executable|interrupting the real CLI|model output cannot escape"`
exited 0 with eight tests. The disabled toggle left the fake-tool marker absent;
missing and wrong-version tools returned `EFFX4303`, while missing, malformed
and incomplete receipts returned `EFFX4304` and exit 1. The interrupted CLI
reaped its stopped child.

An exact-commit pack produced seven distribution archives, including
`@effx/domain-model`. The first lower-bound consumer smoke failed before the
new model journey: its fresh resolver chose `@effect/platform-node-shared`
4.0.6 alongside Effect and `@effect/platform-bun` 4.0.0, and Bun reported a
missing `make` export from `effect/dist/Path.js`. Both packed consumer scripts
now override the shared adapter to their declared platform-bun version.
`nix shell .#alloy6 -c bun scripts/stable-v4-smoke.ts` then exited 0 and
reported `stable installed consumer: checks, channels, HTTP, RPC, CLI, Alloy
models, and RC rejection passed`. It checked both generated model files and
43,040 vectors through the installed CLI at the Effect 4.0.0 lower bound,
before the per-entity revision.
`bun scripts/watch-editor-smoke.ts 7e9ed6d43569398e642344fa3a77ed2ce9a7da6f`
also exited 0 with `tarballs: 7` and `protocolErrorCount: 0`.

On committed `52373d7d09e0aad3098053eae25f54b420fc46d0`,
`bun run pack && nix shell .#alloy6 -c bun scripts/stable-v4-smoke.ts && bun scripts/watch-editor-smoke.ts "$(git rev-parse HEAD)"`
exited 0. The lower-bound installed CLI checked both membership-bound models
and 28,072 vectors; the watch smoke reported seven tarballs and zero protocol
errors.

On committed `8d62a57790be987a683eddd871dfa462b0a2b4b1`, with the workspace
on Effect 4.0.5, the same pack, pinned-Alloy stable-v4 smoke and exact-SHA
watch command exited 0. The separately installed consumer remained on Effect
4.0.0; it checked both generated models and 28,072 vectors. The watch result
reported seven tarballs, 12 cycles and zero protocol errors.

An interim no-opt-in comparison archived `aa72a792` and `cd9632a` into the
same disposable source path with Effect 4.0.0 dependencies. The existing
`scripts/identity-snapshot.ts` ran 190 cases per side and `cmp` reported the
two snapshots byte-identical. Its subsequent summary command failed because
`jq` was not available in that shell, so this run did not establish the fault
count or snapshot hash. It predates the per-entity revision and upgrade.

The corrected comparison archived `aa72a792` and `1e6d974` into the same
disposable path, ran `bun scripts/identity-snapshot.ts` for each and compared
their bytes with `cmp`. It exited 0: 190 cases, zero faults, 190 IR results
and 93 generated files per side. Both snapshot SHA-256 values were
`cf819ea19ed2890db4b528f7046bffb0a84fd0d229b1a05eb42d6af331e0b246`.
This run used Effect 4.0.0 on both sides.

Falsifier 1 isolates this slice from Effect upgrades. The current authoritative
baseline is `3419f263` and both archives use Effect 4.0.6. The 4.0.0 and
4.0.5 comparisons are pre-rebase evidence.

The pre-rebase 4.0.5 comparison at candidate `978f762` was also byte-identical:
190 cases, zero faults, 190 IR results and 93 files on each side, snapshot
SHA-256 `85cd8581ab51f3f609c41207178c579dfbcda72461d9b0e03a124a010b1746a4`.

The authoritative 4.0.6 comparison command, run from the worktree root after
`bash scripts/install-public.sh .`, uses a disposable directory and the repository snapshot harness:

```bash
set -euo pipefail
root=$PWD
base=$(mktemp -d "$root/.effx/identity-0032.XXXXXX")
source="$base/source"
trap 'rm -rf -- "$base"' EXIT
snapshot() {
  local revision="$1" output="$2"
  mkdir -p "$source"
  git archive "$revision" | tar -x -C "$source"
  ln -s "$root/node_modules" "$source/node_modules"
  for d in packages/cli packages/compiler packages/diagnostics packages/domain-model packages/frontend-ts packages/ir packages/persistence packages/runtime examples/domain-model examples/extension-openapi-tags examples/persistence examples/users packages/frontend-ts/test/fixtures/stable-v4; do
    if [ -d "$source/$d" ] && [ -d "$root/$d/node_modules" ]; then ln -s "$root/$d/node_modules" "$source/$d/node_modules"; fi
  done
  local resolved
  resolved=$(cd "$source" && bun -e 'console.log(import.meta.resolve("@effx/compiler"))')
  printf 'compiler resolution: %s\n' "$resolved"
  case "$resolved" in "file://$source/packages/compiler/src/index.ts") ;; *) printf 'unexpected compiler resolution\n' >&2; return 1 ;; esac
  (cd "$source" && bun -e 'import { version } from "effect/package.json"; console.log("effect="+version); if(version!=="4.0.6") process.exitCode=1' && bun run --cwd examples/users effx:build && bun scripts/identity-snapshot.ts "$output")
}
snapshot 3419f263 "$base/before.json"
rm -rf -- "$source"
snapshot HEAD "$base/after.json"
if cmp -s "$base/before.json" "$base/after.json"; then printf 'identity snapshots: byte-identical\n'; else printf 'identity snapshots differ\n' >&2; export BEFORE="$base/before.json" AFTER="$base/after.json"; bun -e 'import { Effect, Schema } from "effect"; const decode=Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String,Schema.Unknown))); const [a,b]=await Promise.all([Bun.file(Bun.env.BEFORE).text(),Bun.file(Bun.env.AFTER).text()]); const [left,right]=await Promise.all([Effect.runPromise(decode(a)),Effect.runPromise(decode(b))]); for (const key of [...new Set([...Object.keys(left),...Object.keys(right)])]) { const x=left[key],y=right[key]; if(JSON.stringify(x)!==JSON.stringify(y)) { const fields=[...new Set([...Object.keys(x??{}),...Object.keys(y??{})])].filter(k=>JSON.stringify(x?.[k])!==JSON.stringify(y?.[k])); console.log(key+": "+fields.join(", ")); } }'; exit 1; fi
export BEFORE="$base/before.json" AFTER="$base/after.json"
bun -e 'import { Effect, Schema } from "effect"; const decode=Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String,Schema.Unknown))); for (const path of [Bun.env.BEFORE,Bun.env.AFTER]) { const bytes=await Bun.file(path).arrayBuffer(); const data=await Effect.runPromise(decode(new TextDecoder().decode(bytes))); const values=Object.values(data); const faults=values.filter(x=>x && typeof x==="object" && "fault" in x).length; const ir=values.filter(x=>x && typeof x==="object" && "hash" in x && x.hash!==null).length; const files=values.reduce((n,x)=>n+(x && typeof x==="object" && x.files && typeof x.files==="object" ? Object.keys(x.files).length : 0),0); const hash=new Bun.CryptoHasher("sha256").update(bytes).digest("hex"); console.log("cases="+values.length+" faults="+faults+" ir="+ir+" generated-files="+files+" sha256="+hash); if (faults!==0 || ir!==values.length) process.exitCode=1; }'
```

At candidate `da30264`, the command exited 0 with Effect 4.0.6 on both
sides. `cmp` reported byte-identical snapshots: each had 190 cases, zero
faults, 190 IR results and 93 generated files. Both snapshot SHA-256 values
were `ea3109f38ba98e79148b9f7bc7bf049259490560f1a77c3af03af006ae4a9f2b`.

The real-tool unsupported-guard test,
`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "unknown guard is warned"`,
exited 0 with one test passed and reported `EFFX4302 warning` plus
`unmodelled guards: example/unregistered (scope 1, steps 4)`.

At product commit `978f762` with Effect 4.0.5,
`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "mutant is diagnosed|Alloy receipt|Alloy executable|interrupting the real CLI|toggle off|stored bounds stay fixed|declared writes over|unknown guard is warned"`
exited 0: 16 tests passed, nine skipped. The six mutants each produced their
named `EFFX4305`–`EFFX4310`, effx exit 1 and Alloy assertion-process exit 0.
The disabled toggle left the fake-tool marker absent; missing and wrong-version
tools returned `EFFX4303`; missing, malformed and incomplete receipts returned
`EFFX4304`; interruption reaped the stopped child. Scope-2 parameter and write
checks passed, and the unknown guard reported `EFFX4302`.

At product commit `da30264` on Effect 4.0.6,
`nix shell .#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "Alloy receipt|Alloy executable|interrupting the real CLI|toggle off"`
exited 0 with seven tests passed and 18 skipped. The disabled toggle did not
invoke the fake tool; the stopped child was reaped; missing and wrong-version
tools returned `EFFX4303`, and missing, malformed and incomplete receipts
returned `EFFX4304`. `bun run docs:api` also exited 0 (90 compiler, 11 IR and
12 runtime modules).

## Effect 4.0.6 lookup coverage

The installed `ai-docs/src` examples contain no exact use of these APIs used
by this slice. Their signatures and source documentation were checked in the
installed Effect 4.0.6 source:

- `Cause.hasInterrupts`, `Cause.pretty`; `Effect.all`, `Effect.cached`, `Effect.raceFirst`, `Effect.result`, `Effect.timeout`.
- `Exit.isFailure`, `Exit.isSuccess`; `Fiber.await`, `Fiber.interrupt`; `Option.getOrThrow`.
- `FileSystem.FileSystem`, `Path.Path`; `Result.fail`, `Result.isFailure`, `Result.isSuccess`, `Result.succeed`.
- `Schema.Json`, `Schema.NonEmptyArray`, `Schema.Record`, `Schema.TaggedStruct`, `Schema.TaggedUnion`, `Schema.Tuple`, `Schema.decodeEffect`, `Schema.decodeUnknownResult`, `Schema.fromJsonString`, `Schema.isGreaterThan`, `Schema.make`, `Schema.makeFilter`, `Schema.makeFilterGroup`, `Schema.optionalKey`.
- `SchemaRepresentation.fromJson`, `SchemaRepresentation.fromRepresentation`, `SchemaRepresentation.isFiniteReviver`, `SchemaRepresentation.makeReviverFilter`, `SchemaRepresentation.toJson`, `SchemaRepresentation.toRepresentation`; `Stream.mkString`.

## Native child boundary: EX-0038 (open)

- **Rules:** FX002, FX003, FX006, FX012 and `effecttsgo/unstable-api-usage`.
- **Owner:** repository root (`AGENTS.md`). The production adapter is `scripts/alloy-execution.ts`. The real-child test adapter is `scripts/test/alloy-cli.ts`.
- **Scope:** The portable CLI uses `AlloyExecution`. Only the adapters import unstable `effect/process`. The process root selects the implementation.
- **Reason:** Effect 4.0.0, 4.0.5 and 4.0.6 expose child process custody through the unstable `ChildProcess` and `ChildProcessSpawner` APIs. No stable equivalent is installed.
- **Alternatives:** `@effect/platform-bun` supplies the native spawner. It is used instead of `Bun.spawn` or `node:child_process`. `Bun.which` resolves `alloy6` only at the root.
- **Ownership:** Each call owns a child scope. The child receives an empty environment and a forced-kill grace. Two streams drain concurrently and retain at most 8 KiB each.
- **Data boundary:** The CLI checks the version, exit code and decoded receipt. Its scope owns the temporary output directory. The adapter makes no sandbox claim.
- **Examined versions:** Effect `4.0.0`, `4.0.5` and `4.0.6`, `@effect/platform-bun` and `@effect/vitest` `4.0.0`, `4.0.5` and `4.0.6`, Bun `1.3.13`, Alloy `6.2.0`.
- **Verification at Effect 4.0.0:** `nix shell nixpkgs#alloy6 -c bun --bun vitest run examples/domain-model/test/alloy.test.ts -t "interrupting the real CLI"` exited 0 (one test). The test interrupted the CLI after a stopped child reported its PID and observed that the child was reaped. The parent test grants five seconds for the CLI to complete its one-second child escalation.
- **Verification at Effect 4.0.5:** The 16-test pinned-tool selection above exited 0 and included the real interruption and receipt checks.
- **Verification at Effect 4.0.6:** The seven-test pinned-tool selection above exited 0 and included the real interruption and receipt checks.
- **Receipt checks:** The `-t "Alloy receipt"` selection exited 0 (three tests). Missing, malformed and incomplete receipts each produced `EFFX4304`.
- **Status:** This record stays open until the committed-tree gate passes.
- **Retirement:** Remove the directive and record when Effect marks the process APIs stable and the real-child and interruption tests pass.
