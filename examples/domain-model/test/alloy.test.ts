import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, FileSystem, Path, Result, Schedule, Schema } from "effect";
import effectPackage from "effect/package.json";
import {
  AlloyReceiptJson,
  ConformanceVectorsJson,
  generateAlloy,
  snapshotsFromSolutions,
  type ConformanceVectors,
  type DomainDescription,
  type VectorSnapshot,
} from "@effx/domain-model";
import {
  alloyCli,
  alloyTool,
  killOwnedGroup,
  testToolPath,
} from "../../../scripts/test/alloy-cli.ts";
import { printLines } from "@effx/cli";
import { encodeJsonString, testDirectory } from "../../../tools/testing/projects.ts";
import { domain } from "../domain.ts";
import { mutants, withoutDirectoryGrant } from "../mutants.ts";
import { authorize, machineCan } from "./interpreter.ts";

const fixtureTsconfig = new URL("../tsconfig.json", import.meta.url).pathname;

const domainModule = new URL("../domain.ts", import.meta.url).href;

const mutantModule = new URL("../mutants.ts", import.meta.url).href;

const decodeVectors = Schema.decodeEffect(ConformanceVectorsJson);

const decodePid = Schema.decodeEffect(Schema.fromJsonString(Schema.Int));

const decodeReceipt = Schema.decodeEffect(AlloyReceiptJson);

type FixtureName =
  | "domain"
  | "withoutDirectoryGrant"
  | "withoutOptionalBindings"
  | keyof typeof mutants;

const configure = Effect.fnUntraced(function* (
  directory: string,
  name: FixtureName,
  enabled = true,
  steps = 4,
  scope = 1,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const expression =
    name === "domain" || name === "withoutDirectoryGrant" || name === "withoutOptionalBindings"
      ? name
      : `mutants.${name}`;

  yield* fs.writeFileString(
    path.join(directory, "effx.config.ts"),
    `
import { defineConfig } from "@effx/cli/config";
import { domainModel } from "@effx/domain-model";
import { domain } from ${yield* encodeJsonString(domainModule)};
import { mutants, withoutDirectoryGrant, withoutOptionalBindings } from ${yield* encodeJsonString(mutantModule)};
export default defineConfig({ models: { alloy: ${enabled} }, extensions: [domainModel(${expression}, { steps: ${steps}, scope: ${scope} })] });
`,
  );
});

const fixture = Effect.fnUntraced(function* (
  name: FixtureName,
  enabled = true,
  steps = 4,
  scope = 1,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* testDirectory("domain-alloy-");
  yield* fs.writeFileString(path.join(directory, "entry.ts"), "export const fixture = true;\n");
  yield* fs.writeFileString(
    path.join(directory, "package.json"),
    `{"type":"module","dependencies":{"effect":"${effectPackage.version}"}}\n`,
  );
  yield* fs.writeFileString(
    path.join(directory, "tsconfig.json"),
    `{ "extends": ${yield* encodeJsonString(fixtureTsconfig)}, "include": ["entry.ts"], "exclude": [] }\n`,
  );
  yield* configure(directory, name, enabled, steps, scope);

  return directory;
});

const build = Effect.fnUntraced(function* (directory: string) {
  const result = yield* alloyCli(directory, ["build"]);
  assert.strictEqual(result.code, 0, result.stdout + result.stderr);
});

const readVectors = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* decodeVectors(
    yield* fs.readFileString(
      path.join(directory, ".effx", "models", "alloy", "community.vectors.json"),
    ),
  );
});

const boundedProbe = Effect.fnUntraced(function* (
  directory: string,
  model: string,
  command: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const output = path.join(directory, `${command}-probe`);

  const run = yield* alloyTool(directory, [
    "exec",
    "--quiet",
    "--command",
    command,
    "--output",
    output,
    "--type",
    "json",
    "--repeat",
    "1",
    "-y",
    "0",
    model,
  ]);

  assert.strictEqual(run.code, 0, run.stdout + run.stderr);
  const receipt = yield* decodeReceipt(yield* fs.readFileString(path.join(output, "receipt.json")));
  const result = receipt.commands[command];

  if (result === undefined) return assert.fail(`Alloy omitted ${command}`);
  assert.strictEqual(result.maxprefix, 4);

  return result;
});

const assertConforms = (description: DomainDescription, vectors: ConformanceVectors): void => {
  assert.isAbove(vectors.instances.length, 0);

  for (const snapshot of vectors.instances) {
    if (description.memberships !== undefined) {
      const binding = description.memberships;
      const entities = snapshot.machineStates.filter((state) => state.machine === binding.machine);
      assert.strictEqual(entities.length, snapshot.memberships.length);

      for (const membership of snapshot.memberships) {
        const entity = entities.find((state) => state.id === membership.id);
        assert.isDefined(entity, "each membership is the same atom as its machine entity");
        assert.strictEqual(membership.active, binding.grantingStates.includes(entity!.state));
      }
    }

    for (const principal of snapshot.principals)
      for (const permission of vectors.permissions)
        for (const target of snapshot.targets) {
          const modelAllows = snapshot.allows.some(
            (row) =>
              row.principal === principal.id &&
              row.permission === permission.name &&
              row.target === target.id,
          );

          assert.strictEqual(
            authorize(description, snapshot, principal.id, permission.name, target.id),
            modelAllows,
          );
        }

    for (const [machineIndex, machine] of description.machines.entries()) {
      for (const context of snapshot.contexts.filter((entry) => entry.machine === machine.name)) {
        for (const state of ["[*]", ...machine.states]) {
          for (
            let index = 0;
            index < machine.transitions.length + machine.calculated.length;
            index++
          ) {
            for (const phase of ["atNow", "afterTick"] as const) {
              const modelEnabled = snapshot.enabled[phase].some(
                (row) =>
                  row.machine === machine.name &&
                  row.state === state &&
                  row.context === context.id &&
                  row.transition === `Transition${machineIndex}_${index}`,
              );

              assert.strictEqual(
                machineCan(description, snapshot, machine.name, state, context.id, index, phase),
                modelEnabled,
              );
            }
          }
        }
      }
    }
  }
};

const worldKey = (snapshot: VectorSnapshot): string =>
  JSON.stringify({
    principals: snapshot.principals,
    targets: snapshot.targets,
    departments: snapshot.departments,
    teams: snapshot.teams,
    memberships: snapshot.memberships,
    orders: snapshot.orders,
    contexts: snapshot.contexts,
    clock: snapshot.clock,
    machineStates: snapshot.machineStates,
  });

const allowedSet = (snapshot: VectorSnapshot): Set<string> =>
  new Set(
    snapshot.allows.map(
      (entry) => `${entry.principal}\u0000${entry.permission}\u0000${entry.target}`,
    ),
  );

describe("spec 0032: real Alloy 6.2.0", () => {
  it.live(
    "checks all six asserts and the fixture interpreter agrees with all vectors; removing one grant changes only its row",
    () =>
      Effect.gen(function* () {
        const directory = yield* fixture("domain");
        yield* build(directory);
        const checked = yield* alloyCli(directory, ["models", "check"]);
        assert.strictEqual(checked.code, 0, checked.stdout + checked.stderr);

        for (const assertion of [
          "A7_TimeMonotonic",
          "A2_NonterminalExit",
          "A3_CommandGrant",
          "A4_AdminSelfChange",
          "A5_EndedMembership",
          "A6_SystemJob",
        ]) {
          assert.include(checked.stdout, `${assertion} PASS (scope 1, steps 4`);
        }

        for (const state of ["Draft", "Open", "Closed"]) {
          assert.include(checked.stdout, `A1_Reachability Review:${state} PASS (scope 1, steps 4`);
        }

        assert.include(checked.stdout, "Alloy 6.2.0 assertion process exit 0");
        yield* printLines(
          "stdout",
          checked.stdout
            .split("\n")
            .filter(
              (line) =>
                line.includes(" PASS (scope") ||
                line.includes("Alloy 6.2.0 assertion process exit 0"),
            ),
        );
        const before = yield* readVectors(directory);
        assertConforms(domain, before);
        // 212 worlds without memberships; 432 membership worlds × 4 stored bounds × 4 states × 2 context cardinalities; two clock values.
        const expectedConfigurations = (212 + 432 * 4 * 4 * 2) * 2;
        assert.strictEqual(before.instances.length, expectedConfigurations);
        assert.strictEqual(new Set(before.instances.map(worldKey)).size, expectedConfigurations);
        assert.isTrue(before.instances.some((snapshot) => snapshot.targets.length === 0));

        const calculated = (snapshot: VectorSnapshot, phase: "atNow" | "afterTick") =>
          snapshot.enabled[phase].some(
            (row) =>
              row.machine === "Review" &&
              row.state === "Open" &&
              row.transition === "Transition0_3",
          );

        assert.isTrue(
          before.instances.some(
            (snapshot) =>
              snapshot.clock?.afterTick !== null &&
              snapshot.clock !== null &&
              calculated(snapshot, "atNow") !== calculated(snapshot, "afterTick"),
          ),
          "vectors must distinguish the current and successor guard outcomes",
        );
        yield* configure(directory, "withoutDirectoryGrant");
        yield* build(directory);
        const mutated = yield* alloyCli(directory, ["models", "check"]);
        assert.strictEqual(mutated.code, 1, mutated.stdout + mutated.stderr);
        assert.include(mutated.stdout, "EFFX4307 error");
        const after = yield* readVectors(directory);
        assertConforms(withoutDirectoryGrant, after);
        assert.strictEqual(after.instances.length, expectedConfigurations);
        const worlds = new Map(after.instances.map((snapshot) => [worldKey(snapshot), snapshot]));
        let differences = 0;

        for (const original of before.instances) {
          const changed = worlds.get(worldKey(original));
          assert.isDefined(changed, "the same configuration must exist after removing a grant");
          const previous = allowedSet(original);
          const current = allowedSet(changed!);

          for (const row of previous) {
            if (current.has(row)) continue;
            const [principal, permission] = row.split("\u0000");
            assert.strictEqual(permission, "RefreshDirectory");
            assert.isTrue(
              original.principals.some(
                (entry) =>
                  entry.id === principal && entry.kind === "System" && entry.job === "directory",
              ),
            );
            differences++;
          }

          for (const row of current)
            assert.isTrue(previous.has(row), "removing a grant cannot add permission");
        }

        assert.isAbove(differences, 0);
        yield* printLines("stdout", [
          `vectors: ${before.instances.length} before, ${after.instances.length} after, ${differences} removed directory-job rows; no other rows changed`,
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    900_000,
  );

  it.live.each([
    ["unreachable", "EFFX4305", "A1"],
    ["deadEnd", "EFFX4306", "A2"],
    ["ungranted", "EFFX4307", "A3"],
    ["adminSelf", "EFFX4308", "A4"],
    ["endedMembership", "EFFX4309", "A5"],
    ["otherJob", "EFFX4310", "A6"],
  ] as const)(
    "%s mutant is diagnosed as %s",
    ([name, code, assertion]) =>
      Effect.gen(function* () {
        const directory = yield* fixture(name);
        yield* build(directory);
        const result = yield* alloyCli(directory, ["models", "check"]);
        assert.strictEqual(result.code, 1, result.stdout + result.stderr);
        assert.include(result.stdout, `${code} error`);
        assert.include(result.stdout, assertion);
        assert.include(result.stdout, "Alloy 6.2.0 assertion process exit 0");

        if (code === "EFFX4305") {
          assert.include(result.stdout, "Review:Lost not reached within 4 steps at scope 1");
        } else {
          assert.include(result.stdout, "principals=[");
          assert.include(result.stdout, "memberships=[");
          assert.include(result.stdout, "commands=[");
          assert.include(result.stdout, "states=[");
        }

        const solverLine = result.stdout
          .split("\n")
          .find((line) => line.includes("Alloy 6.2.0 assertion process exit 0"));

        const diagnosticLine = result.stdout
          .split("\n")
          .find((line) => line.includes(`${code} error`));

        yield* printLines("stdout", [
          `${name}: effx exit ${result.code}`,
          solverLine?.trim() ?? "",
          diagnosticLine?.trim() ?? "",
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    900_000,
  );

  it.live(
    "A5 detects grants from a non-granting membership state",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const directory = yield* fixture("endedMembership");
        yield* build(directory);
        const model = path.join(directory, ".effx/models/alloy/community.als");
        const checked = yield* boundedProbe(directory, model, "A5_EndedMembership");

        if (checked.solution === undefined || checked.solution.length === 0)
          return assert.fail("A5 found no counterexample");

        const decoded = snapshotsFromSolutions(
          checked.solution,
          generateAlloy(mutants.endedMembership).symbols,
        );

        if (Result.isFailure(decoded)) return assert.fail(decoded.failure);

        const witness = decoded.success.find((snapshot) =>
          snapshot.memberships.some(
            (membership) =>
              !membership.active &&
              snapshot.machineStates.some(
                (state) =>
                  state.id === membership.id &&
                  state.machine === "Review" &&
                  state.state !== "Open",
              ),
          ),
        );

        assert.isDefined(witness);
        yield* printLines("stdout", [
          "A5: a non-granting membership atom contributes permission; Alloy check exit 0 with a counterexample",
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    120_000,
  );

  it.live(
    "a transition to the sentinel removes the entity state and its grant",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("withRemoval");
        yield* build(directory);

        const source = yield* fs.readFileString(
          path.join(directory, ".effx/models/alloy/community.als"),
        );

        const run = source.split("\n").find((line) => line.startsWith("run MembershipEnds "));

        if (run === undefined) return assert.fail("missing bounded model command");
        const model = path.join(directory, "removal-probe.als");
        yield* fs.writeFileString(
          model,
          `${source}\npred RemovalStep { some p: Principal, t: Target, entity: Machine0 | transition0_2[p,t,entity] and no entity.current0' }\n${run.replace("MembershipEnds", "RemovalStep")}\n`,
        );
        const result = yield* boundedProbe(directory, model, "RemovalStep");

        if (result.solution === undefined || result.solution.length === 0)
          return assert.fail("no removal trace");

        const decoded = snapshotsFromSolutions(
          result.solution,
          generateAlloy(mutants.withRemoval).symbols,
        );

        if (Result.isFailure(decoded)) return assert.fail(decoded.failure);
        const before = decoded.success[0];
        const after = decoded.success[1];

        if (before === undefined || after === undefined)
          return assert.fail("removal trace has fewer than two states");
        const active = before.memberships.find((membership) => membership.active);
        assert.isDefined(active);
        assert.isTrue(
          after.memberships.some(
            (membership) => membership.id === active!.id && !membership.active,
          ),
        );
        assert.isTrue(
          after.machineStates.some((state) => state.id === active!.id && state.state === "[*]"),
        );
        yield* printLines("stdout", [
          "removal: the same membership moves to [*] and stops granting at scope 1, steps 4",
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    120_000,
  );

  it.live(
    "toggle off writes no models and does not invoke even a present binary",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("domain", false);
        const marker = path.join(directory, "called");
        const fake = path.join(directory, "alloy6");
        yield* fs.writeFileString(
          fake,
          `#!/bin/sh\n: > ${yield* encodeJsonString(marker)}\nexit 1\n`,
        );
        yield* fs.chmod(fake, 0o755);
        const built = yield* alloyCli(directory, ["build"], directory);
        assert.strictEqual(built.code, 0, built.stdout + built.stderr);
        const checked = yield* alloyCli(directory, ["models", "check"], directory);
        assert.strictEqual(checked.code, 0, checked.stdout + checked.stderr);
        assert.include(checked.stdout, "no files written and no tool started");
        assert.isFalse(yield* fs.exists(marker));
        yield* printLines("stdout", [
          `toggle off: effx exit ${checked.code}; fake Alloy marker absent`,
        ]);
        assert.isFalse(yield* fs.exists(path.join(directory, ".effx", "models", "alloy")));
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    120_000,
  );

  it.live(
    "model output cannot escape through a symlink",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("domain");
        const outside = path.join(directory, "outside");
        yield* fs.makeDirectory(outside);
        yield* fs.makeDirectory(path.join(directory, ".effx"));
        yield* fs.symlink(outside, path.join(directory, ".effx", "models"));
        const result = yield* alloyCli(directory, ["build"]);
        assert.notStrictEqual(result.code, 0);
        assert.include(result.stdout + result.stderr, "model directory escapes .effx");
        assert.deepStrictEqual(yield* fs.readDirectory(outside), []);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    60_000,
  );

  it.live(
    "reachability does not join individually satisfiable edges by moving time backward",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("timeTravel", true, 4, 2);
        yield* build(directory);
        const original = path.join(directory, ".effx", "models", "alloy", "community.als");
        const model = path.join(directory, "one-entity-two-contexts.als");
        const source = yield* fs.readFileString(original);
        yield* fs.writeFileString(
          model,
          `${source}\nfact OneEntityTwoContexts { one Machine0 and one Person and no System and one Target and one Department and one Team and one MembershipRecord and (some disj a,b: Context0 | Context0 = a + b) }\n`,
        );

        for (const command of ["Reach0_1", "A2_NonterminalExit"]) {
          const output = path.join(directory, `witness-${command}`);

          const run = yield* alloyTool(directory, [
            "exec",
            "--quiet",
            "--command",
            command,
            "--output",
            output,
            "--type",
            "json",
            "--repeat",
            "1",
            "-y",
            "0",
            model,
          ]);

          assert.strictEqual(run.code, 0, run.stdout + run.stderr);

          const receipt = yield* decodeReceipt(
            yield* fs.readFileString(path.join(output, "receipt.json")),
          );

          const result = receipt.commands[command];

          if (result === undefined) return assert.fail(`Alloy omitted ${command}`);
          assert.strictEqual(result.maxprefix, 4);
          assert.lengthOf(result.solution ?? [], 0);
        }

        yield* printLines("stdout", [
          "timeTravel: A2 has no counterexample, but A1 finds no trace to Open for one entity and two contexts at scope 2, steps 4",
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    180_000,
  );

  it.live(
    "stored bounds stay fixed while caller parameters can change on a command",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("withParameter", true, 4, 2);
        yield* build(directory);

        const source = yield* fs.readFileString(
          path.join(directory, ".effx/models/alloy/community.als"),
        );

        const run = source.split("\n").find((line) => line.startsWith("run MembershipEnds "));
        const check = source.split("\n").find((line) => line.startsWith("check A7_TimeMonotonic "));

        if (run === undefined || check === undefined)
          return assert.fail("missing bounded model commands");
        const model = path.join(directory, "parameter-probe.als");
        yield* fs.writeFileString(
          model,
          `${source}\nfact ParameterWorld { one Machine0 and one Person and no System and one Target and one Department and one Team and one MembershipRecord and (some disj a,b: Context0 | Context0 = a + b) }\npred ParameterChanges { some entity: Machine0, p: Principal, t: Target, first: Order0 | transition0_0[p,t,entity,first] and after (some p2: Principal, t2: Target, second: Order0 | transition0_1[p2,t2,entity,second] and second != first) }\nassert StoredFieldsStable { always (stored0f0' = stored0f0 and stored0f1' = stored0f1) }\n${run.replace("MembershipEnds", "ParameterChanges")}\n${check.replace("A7_TimeMonotonic", "StoredFieldsStable")}\n`,
        );
        const witness = yield* boundedProbe(directory, model, "ParameterChanges");
        const invariant = yield* boundedProbe(directory, model, "StoredFieldsStable");
        assert.isAbove(witness.solution?.length ?? 0, 0);
        assert.lengthOf(invariant.solution ?? [], 0);
        yield* printLines("stdout", [
          "parameter: successive commands choose different caller values while stored fields stay fixed for one entity at scope 2, steps 4",
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    180_000,
  );

  it.live(
    "declared writes over-approximate one entity and frame the others",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("withWrite", true, 4, 2);
        const built = yield* alloyCli(directory, ["build"]);
        assert.strictEqual(built.code, 0, built.stdout + built.stderr);
        assert.include(built.stdout, "EFFX4313 warning");
        assert.include(built.stdout, "effect on Review.review.end not modelled precisely");

        const source = yield* fs.readFileString(
          path.join(directory, ".effx/models/alloy/community.als"),
        );

        const run = source.split("\n").find((line) => line.startsWith("run MembershipEnds "));
        const check = source.split("\n").find((line) => line.startsWith("check A7_TimeMonotonic "));

        if (run === undefined || check === undefined)
          return assert.fail("missing bounded model commands");
        const model = path.join(directory, "write-probe.als");
        yield* fs.writeFileString(
          model,
          `${source}\nfact NarrowWriteWorld { one Person and no System and one Target and one Department and one Team and (some disj m,n: MembershipRecord | MembershipRecord = m + n) }\npred WriteCanChangeOne { some disj a,b: Machine0 | some p: Principal, t: Target | transition0_1[p,t,a] and a.stored0f1 != b.stored0f1 and a.stored0f1' != a.stored0f1 and b.stored0f1' = b.stored0f1 and stored0f0' = stored0f0 }\nassert WriteFramesOthers { always (all disj a,b: Machine0 | all p: Principal, t: Target | transition0_1[p,t,a] implies (b.stored0f1' = b.stored0f1 and stored0f0' = stored0f0)) }\n${run.replace("MembershipEnds", "WriteCanChangeOne")}\n${check.replace("A7_TimeMonotonic", "WriteFramesOthers")}\n`,
        );
        const witness = yield* boundedProbe(directory, model, "WriteCanChangeOne");
        const invariant = yield* boundedProbe(directory, model, "WriteFramesOthers");
        assert.isAbove(witness.solution?.length ?? 0, 0);
        assert.lengthOf(invariant.solution ?? [], 0);
        yield* printLines("stdout", [
          "declared write: EFFX4313 warning; target may change and other entities stay fixed at scope 2, steps 4",
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    180_000,
  );

  it.live(
    "a write without a machine transition may affect multiple entities",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("withUnboundWrite", true, 4, 2);
        const built = yield* alloyCli(directory, ["build"]);
        assert.strictEqual(built.code, 0, built.stdout + built.stderr);
        assert.include(built.stdout, "EFFX4313 warning");

        const source = yield* fs.readFileString(
          path.join(directory, ".effx/models/alloy/community.als"),
        );

        const run = source.split("\n").find((line) => line.startsWith("run MembershipEnds "));

        if (run === undefined) return assert.fail("missing bounded model command");
        const model = path.join(directory, "unbound-write-probe.als");
        yield* fs.writeFileString(
          model,
          `${source}\nfact NarrowUnboundWorld { one Person and one System and one Target and one Department and one Team and (some disj m,n: MembershipRecord | MembershipRecord = m + n) }\npred UnboundWriteCanAffectBoth { some disj a,b: Machine0 | some p: System, t: Target | stepCommand5[p,t] and a.stored0f1' != a.stored0f1 and b.stored0f1' != b.stored0f1 and stored0f0' = stored0f0 }\n${run.replace("MembershipEnds", "UnboundWriteCanAffectBoth")}\n`,
        );
        const witness = yield* boundedProbe(directory, model, "UnboundWriteCanAffectBoth");
        assert.isAbove(witness.solution?.length ?? 0, 0);
        yield* printLines("stdout", [
          "unbound write: two membership entities may change at scope 2, steps 4; EFFX4313 warns",
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    180_000,
  );

  it.live(
    "a calculated guard fires on the tick whose successor satisfies it",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("domain");
        yield* build(directory);
        const original = path.join(directory, ".effx", "models", "alloy", "community.als");
        const model = path.join(directory, "successor-law.als");
        const source = yield* fs.readFileString(original);

        const command = source
          .split("\n")
          .find((line) => line.startsWith("check A7_TimeMonotonic "));

        const run = source.split("\n").find((line) => line.startsWith("run MembershipEnds "));

        if (command === undefined || run === undefined)
          return assert.fail("model has no bounded commands");
        yield* fs.writeFileString(
          model,
          `${source}\nassert SuccessorGuardFires { always (all entity: Machine0 | (Clock.now' != Clock.now and entity.current0 = State0_1 and not Ordering0/lt[Ordering0/next[Clock.now], entity.stored0f1]) implies entity.current0' = State0_2) }\npred TickWithoutContext { no Context0 and some entity: Machine0 | entity.current0 = State0_1 and Clock.now != Ordering0/last and Clock.now' = Ordering0/next[Clock.now] and not Ordering0/lt[Ordering0/next[Clock.now], entity.stored0f1] }\npred AdminExpiryWithoutContext { no Context0 and some Admin - Admin' and Clock.now != Ordering0/last and Clock.now' = Ordering0/next[Clock.now] }\n${command.replace("A7_TimeMonotonic", "SuccessorGuardFires")}\n${run.replace("MembershipEnds", "TickWithoutContext")}\n${run.replace("MembershipEnds", "AdminExpiryWithoutContext")}\n`,
        );
        const checked = yield* boundedProbe(directory, model, "SuccessorGuardFires");
        const witness = yield* boundedProbe(directory, model, "TickWithoutContext");
        const expiry = yield* boundedProbe(directory, model, "AdminExpiryWithoutContext");
        assert.lengthOf(checked.solution ?? [], 0);
        assert.isAbove(witness.solution?.length ?? 0, 0);
        assert.isAbove(expiry.solution?.length ?? 0, 0);
        yield* printLines("stdout", [
          "SuccessorGuardFires: no counterexample; calculated tick and admin expiry both occur without a caller context at scope 1, steps 4",
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    60_000,
  );
  it.live(
    "a time step can end a membership in the temporal model",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("domain", true, 2);
        yield* build(directory);
        const output = path.join(directory, "witness-output");
        const model = path.join(directory, ".effx", "models", "alloy", "community.als");

        const run = yield* alloyTool(directory, [
          "exec",
          "--quiet",
          "--command",
          "MembershipEnds",
          "--output",
          output,
          "--type",
          "json",
          "--repeat",
          "1",
          "-y",
          "0",
          model,
        ]);

        assert.strictEqual(run.code, 0, run.stdout + run.stderr);

        const receipt = yield* decodeReceipt(
          yield* fs.readFileString(path.join(output, "receipt.json")),
        );

        const command = receipt.commands.MembershipEnds;
        const solution = command?.solution?.[0];

        if (command === undefined || solution === undefined)
          return assert.fail("Alloy found no membership-end witness");
        assert.strictEqual(command.maxprefix, 2);
        assert.lengthOf(solution.instances, 2);
        const before = solution.instances[0]?.values["Projection$0"]?.activeMembers;
        const after = solution.instances[1]?.values["Projection$0"]?.activeMembers;

        if (before === undefined || after === undefined)
          return assert.fail("witness has no membership projection");
        assert.isAbove(before.length, after.length);
        yield* printLines("stdout", [
          `MembershipEnds: Alloy exit ${run.code}; ${before.length} active before, ${after.length} after; scope 1, steps 2`,
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    60_000,
  );

  it.live(
    "interrupting the real CLI releases its owned Alloy child",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("domain");
        yield* build(directory);
        const fakeDir = path.join(directory, "fake-bin");
        yield* fs.makeDirectory(fakeDir);
        const fake = path.join(fakeDir, "alloy6");
        const started = path.join(directory, "child-started");
        const pidFile = path.join(directory, "child-pid");
        const startPath = yield* encodeJsonString(started);
        const pidPath = yield* encodeJsonString(pidFile);
        yield* fs.writeFileString(
          fake,
          `#!/bin/sh\nif [ "$1" = version ]; then printf '6.2.0\n'; exit 0; fi\nprintf '%s' "$$" > ${pidPath}\n: > ${startPath}\nkill -STOP "$$"\n`,
        );
        yield* fs.chmod(fake, 0o755);
        const waiting = yield* Effect.forkScoped(alloyCli(directory, ["models", "check"], fakeDir));

        const observed = yield* Effect.raceFirst(
          fs.exists(started).pipe(
            Effect.repeat({
              while: (present) => !present,
              schedule: Schedule.spaced("10 millis"),
            }),
            Effect.as({ _tag: "Started" as const }),
          ),
          Fiber.await(waiting).pipe(Effect.map((exit) => ({ _tag: "Exited" as const, exit }))),
        ).pipe(Effect.timeout("20 seconds"));

        if (observed._tag === "Exited") {
          const detail = Exit.isSuccess(observed.exit)
            ? observed.exit.value.stdout + observed.exit.value.stderr
            : Cause.pretty(observed.exit.cause);

          assert.fail(`CLI exited before the child started: ${detail}`);
        }

        const pid = yield* decodePid(yield* fs.readFileString(pidFile));
        assert.isAbove(pid, 1);
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            const alive = yield* fs.exists(`/proc/${pid}`);

            if (alive) yield* killOwnedGroup(pid);
          }).pipe(Effect.orDie),
        );
        yield* Fiber.interrupt(waiting);
        const exit = yield* Fiber.await(waiting);
        assert.isTrue(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause));
        assert.isFalse(yield* fs.exists(`/proc/${pid}`), "the owned child was reaped");
        yield* printLines("stdout", [
          "interruption: CLI fiber interrupted and the stopped Alloy child was reaped",
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    60_000,
  );

  it.live(
    "absent admin, membership, and clock bindings are not reported as passes",
    () =>
      Effect.gen(function* () {
        const directory = yield* fixture("withoutOptionalBindings");
        yield* build(directory);
        const checked = yield* alloyCli(directory, ["models", "check"]);
        assert.strictEqual(checked.code, 0, checked.stdout + checked.stderr);
        assert.include(checked.stdout, "A4_AdminSelfChange NOT APPLICABLE");
        assert.notInclude(checked.stdout, "A4_AdminSelfChange PASS");
        assert.include(checked.stdout, "A5_EndedMembership NOT APPLICABLE");
        assert.notInclude(checked.stdout, "A5_EndedMembership PASS");
        assert.include(checked.stdout, "A7_TimeMonotonic NOT APPLICABLE");
        assert.notInclude(checked.stdout, "A7_TimeMonotonic PASS");
        assert.include(checked.stdout, "EFFX4311 warning");
        yield* printLines(
          "stdout",
          checked.stdout
            .split("\n")
            .filter((line) => line.includes("NOT APPLICABLE") || line.includes("EFFX4311 warning")),
        );
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    900_000,
  );

  it.live.each(["missing", "wrong-version"] as const)(
    "%s Alloy executable is EFFX4303",
    (kind) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("domain");
        yield* build(directory);
        const fakeDir = path.join(directory, "fake-bin");
        yield* fs.makeDirectory(fakeDir);

        if (kind === "wrong-version") {
          const fake = path.join(fakeDir, "alloy6");
          yield* fs.writeFileString(fake, "#!/bin/sh\nprintf '5.0.0\n'\n");
          yield* fs.chmod(fake, 0o755);
        }

        const checked = yield* alloyCli(directory, ["models", "check"], fakeDir);
        assert.strictEqual(checked.code, 1, checked.stdout + checked.stderr);
        assert.include(checked.stdout, "EFFX4303 error");
        yield* printLines("stdout", [`${kind} tool: effx exit ${checked.code}, EFFX4303`]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    120_000,
  );

  it.live.each(["missing", "malformed", "incomplete"] as const)(
    "%s Alloy receipt is an EFFX4304 error",
    (kind) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fixture("domain");
        yield* build(directory);
        const fakeDir = path.join(directory, "fake-bin");
        yield* fs.makeDirectory(fakeDir);
        const fake = path.join(fakeDir, "alloy6");
        const mkdir = yield* encodeJsonString(yield* testToolPath("mkdir"));

        const body =
          kind === "missing"
            ? "exit 0"
            : `while [ "$#" -gt 0 ]; do if [ "$1" = "--output" ]; then out="$2"; shift 2; else shift; fi; done\n${mkdir} -p "$out"\nprintf '%s' '${kind === "malformed" ? "{not-json" : '{"commands":{}}'}' > "$out/receipt.json"`;

        yield* fs.writeFileString(
          fake,
          `#!/bin/sh\nif [ "$1" = version ]; then printf '6.2.0\\n'; exit 0; fi\n${body}\n`,
        );
        yield* fs.chmod(fake, 0o755);
        const checked = yield* alloyCli(directory, ["models", "check"], fakeDir);
        assert.strictEqual(checked.code, 1, checked.stdout + checked.stderr);
        assert.include(checked.stdout, "EFFX4304 error");
        assert.include(
          checked.stdout,
          kind === "missing"
            ? "missing Alloy receipt"
            : kind === "malformed"
              ? "malformed Alloy receipt"
              : "missing or invalid reachability Reach0_0",
        );

        const diagnostic = checked.stdout
          .split("\n")
          .find((line) => line.includes("EFFX4304 error"));

        assert.isDefined(diagnostic);
        yield* printLines("stdout", [`${kind} receipt: effx exit ${checked.code}`, diagnostic!]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    120_000,
  );
});
