import { Result, Schema } from "effect";
import type { AlloySymbols, AlloyMachineSymbols } from "./Alloy.ts";

const Atom = Schema.String;

const Tuples = Schema.Array(Schema.Array(Atom));

const Values = Schema.Record(Schema.String, Schema.Record(Schema.String, Tuples));

const Instance = Schema.Struct({ values: Values });

const Solution = Schema.Struct({ instances: Schema.NonEmptyArray(Instance) });

export type AlloySolution = typeof Solution.Type;

const ReceiptCommand = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(["run", "check"]),
  source: Schema.String,
  overall: Schema.Int,
  minprefix: Schema.Int,
  maxprefix: Schema.Int,
  scopes: Schema.Array(Schema.String),
  solution: Schema.optionalKey(Schema.Array(Solution)),
});

/** The small subset of Alloy 6.2.0 receipt JSON that the checker consumes. */
export const AlloyReceiptJson = Schema.fromJsonString(
  Schema.Struct({ commands: Schema.Record(Schema.String, ReceiptCommand) }),
);

export type AlloyReceipt = typeof AlloyReceiptJson.Type;

/** A receipt must report the command and the exact bounds of the generated model. */
export const receiptCommandMatches = (
  command: AlloyReceipt["commands"][string],
  name: string,
  symbols: AlloySymbols,
  kind: "check" | "run" | "temporal-run",
): boolean => {
  const expected = symbols.scopeParts.toSorted();
  const actual = command.scopes.toSorted();

  const commandType = kind === "temporal-run" ? "run" : kind;

  return (
    command.name === name &&
    command.type === commandType &&
    command.overall === symbols.scope &&
    command.source.startsWith(`${commandType} ${name} `) &&
    command.minprefix === (kind === "run" ? -1 : 1) &&
    command.maxprefix === (kind === "run" ? -1 : symbols.steps) &&
    expected.length === actual.length &&
    expected.every((value, index) => value === actual[index])
  );
};

const PrincipalVector = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["Anonymous", "Person", "System"]),
  admin: Schema.Boolean,
  job: Schema.optionalKey(Schema.String),
});

const TargetVector = Schema.Struct({
  id: Schema.String,
  owner: Schema.optionalKey(Schema.String),
  department: Schema.optionalKey(Schema.String),
});

type TargetDraft = {
  -readonly [K in keyof typeof TargetVector.Type]: (typeof TargetVector.Type)[K];
};

const TeamVector = Schema.Struct({
  id: Schema.String,
  function: Schema.String,
  department: Schema.String,
});

const MembershipVector = Schema.Struct({
  id: Schema.String,
  person: Schema.String,
  team: Schema.String,
  position: Schema.String,
  active: Schema.Boolean,
});

const OrderVector = Schema.Struct({
  name: Schema.String,
  values: Schema.Array(Schema.String),
  before: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
});

const ContextVector = Schema.Struct({
  machine: Schema.String,
  id: Schema.String,
  values: Schema.Array(
    Schema.Struct({
      path: Schema.Array(Schema.String),
      order: Schema.String,
      value: Schema.String,
    }),
  ),
});

const EnabledVector = Schema.Struct({
  machine: Schema.String,
  state: Schema.String,
  context: Schema.String,
  transition: Schema.String,
  to: Schema.String,
  command: Schema.optionalKey(Schema.String),
});

type EnabledDraft = {
  -readonly [K in keyof typeof EnabledVector.Type]: (typeof EnabledVector.Type)[K];
};

const Snapshot = Schema.Struct({
  solution: Schema.Int,
  step: Schema.Int,
  principals: Schema.Array(PrincipalVector),
  targets: Schema.Array(TargetVector),
  departments: Schema.Array(Schema.String),
  teams: Schema.Array(TeamVector),
  memberships: Schema.Array(MembershipVector),
  orders: Schema.Array(OrderVector),
  clock: Schema.NullOr(
    Schema.Struct({
      order: Schema.String,
      now: Schema.String,
      afterTick: Schema.NullOr(Schema.String),
    }),
  ),
  contexts: Schema.Array(ContextVector),
  machineStates: Schema.Array(Schema.Struct({ machine: Schema.String, state: Schema.String })),
  allows: Schema.Array(
    Schema.Struct({ principal: Schema.String, permission: Schema.String, target: Schema.String }),
  ),
  enabled: Schema.Struct({
    atNow: Schema.Array(EnabledVector),
    afterTick: Schema.Array(EnabledVector),
  }),
});

export const ConformanceVectors = Schema.Struct({
  format: Schema.Literal("effx-alloy-vectors"),
  version: Schema.Literal(1),
  domain: Schema.String,
  scope: Schema.Int,
  steps: Schema.Int,
  orderedAtoms: Schema.Int,
  scopeParts: Schema.Array(Schema.String),
  permissions: Schema.Array(
    Schema.Struct({ name: Schema.String, kind: Schema.Literals(["Command", "Read"]) }),
  ),
  unknownGuards: Schema.Array(Schema.String),
  nondeterministic: Schema.Array(Schema.String),
  instances: Schema.Array(Snapshot),
});

export const ConformanceVectorsJson = Schema.fromJsonString(ConformanceVectors, { space: 2 });

export type ConformanceVectors = typeof ConformanceVectors.Type;

export type VectorSnapshot = typeof Snapshot.Type;

const atomNames = (items: ReadonlyArray<{ readonly name: string; readonly atom: string }>) =>
  new Map(items.map((item) => [`${item.atom}$0`, item.name]));

type Projection = Readonly<Record<string, ReadonlyArray<ReadonlyArray<string>>>>;

const projectionSnapshot = (
  projection: Projection,
  symbols: AlloySymbols,
  solution: number,
  step: number,
): Result.Result<VectorSnapshot, string> => {
  const required: Array<readonly [string, number]> = [
    ["principals", 1],
    ["persons", 1],
    ["systems", 1],
    ["targets", 1],
    ["departments", 1],
    ["teams", 1],
    ["memberships", 1],
    ["targetOwner", 2],
    ["targetDept", 2],
    ["teamFunctionView", 2],
    ["teamDept", 2],
    ["memberPerson", 2],
    ["memberTeam", 2],
    ["memberPosition", 2],
    ["systemJob", 2],
    ["activeMembers", 1],
    ["adminPeople", 1],
    ["allowed", 3],
    ...(symbols.clock === null ? [] : [["clockNow", 1] as const, ["clockNext", 1] as const]),
    ...symbols.orders.flatMap((_, index): Array<readonly [string, number]> => [
      [`order${index}Values`, 1],
      [`order${index}Before`, 2],
    ]),
    ...symbols.machines.flatMap((machine, index): Array<readonly [string, number]> => [
      [`contexts${index}`, 1],
      [`machineState${index}`, 1],
      [`enabledNow${index}`, 3],
      [`enabledAfterTick${index}`, 3],
      ...machine.fields.map((_, fieldIndex): readonly [string, number] => [
        `field${index}_${fieldIndex}`,
        2,
      ]),
    ]),
  ];

  for (const [field, arity] of required) {
    const tuples = projection[field];

    if (tuples === undefined || tuples.some((tuple) => tuple.length !== arity)) {
      return Result.fail(`missing or malformed projection field ${field}`);
    }
  }

  const unary = (name: string): ReadonlyArray<string> =>
    projection[name]!.map((tuple) => tuple[0]!);

  const pairs = (name: string): Map<string, string> =>
    new Map(projection[name]!.map((tuple) => [tuple[0]!, tuple[1]!]));

  const persons = new Set(unary("persons"));
  const systems = new Set(unary("systems"));
  const admins = new Set(unary("adminPeople"));
  const active = new Set(unary("activeMembers"));
  const jobs = atomNames(symbols.jobs);
  const functions = atomNames(symbols.functions);
  const positions = atomNames(symbols.positions);
  const permissions = atomNames(symbols.permissions);
  const systemJobs = pairs("systemJob");
  const targetOwners = pairs("targetOwner");
  const targetDepartments = pairs("targetDept");
  const teamFunctions = pairs("teamFunctionView");
  const teamDepartments = pairs("teamDept");
  const memberPersons = pairs("memberPerson");
  const memberTeams = pairs("memberTeam");
  const memberPositions = pairs("memberPosition");
  const principals: Array<typeof PrincipalVector.Type> = [];

  for (const id of unary("principals")) {
    if (persons.has(id)) principals.push({ id, kind: "Person", admin: admins.has(id) });
    else if (systems.has(id)) {
      const job = jobs.get(systemJobs.get(id) ?? "");

      if (job === undefined) return Result.fail(`unknown job for ${id}`);
      principals.push({ id, kind: "System", admin: false, job });
    } else if (id.startsWith("Anonymous$"))
      principals.push({ id, kind: "Anonymous", admin: false });
    else return Result.fail(`unknown principal ${id}`);
  }

  const targets = unary("targets").map((id) => {
    const target: TargetDraft = { id };
    const owner = targetOwners.get(id);
    const department = targetDepartments.get(id);

    if (owner !== undefined) target.owner = owner;

    if (department !== undefined) target.department = department;

    return target;
  });

  const teams: Array<typeof TeamVector.Type> = [];

  for (const id of unary("teams")) {
    const fn = functions.get(teamFunctions.get(id) ?? "");
    const department = teamDepartments.get(id);

    if (fn === undefined || department === undefined) return Result.fail(`incomplete team ${id}`);
    teams.push({ id, function: fn, department });
  }

  const memberships: Array<typeof MembershipVector.Type> = [];

  for (const id of unary("memberships")) {
    const person = memberPersons.get(id);
    const team = memberTeams.get(id);
    const position = positions.get(memberPositions.get(id) ?? "");

    if (person === undefined || team === undefined || position === undefined)
      return Result.fail(`incomplete membership ${id}`);
    memberships.push({ id, person, team, position, active: active.has(id) });
  }

  const orders = symbols.orders.map((order, index) => ({
    name: order.name,
    values: unary(`order${index}Values`),
    before: projection[`order${index}Before`]!.map((tuple) => [tuple[0]!, tuple[1]!] as const),
  }));

  const clockValues = symbols.clock === null ? [] : unary("clockNow");
  const nextValues = symbols.clock === null ? [] : unary("clockNext");

  if (symbols.clock !== null && (clockValues.length !== 1 || nextValues.length > 1))
    return Result.fail("missing or invalid clock value");

  const clock =
    symbols.clock === null
      ? null
      : { order: symbols.clock.order, now: clockValues[0]!, afterTick: nextValues[0] ?? null };

  if (clock !== null) {
    const order = orders.find((entry) => entry.name === clock.order);

    if (order === undefined || !order.values.includes(clock.now))
      return Result.fail("clock value is outside its declared order");
    const later = order.before.flatMap(([first, second]) => (first === clock.now ? [second] : []));

    const next = later.find(
      (candidate) =>
        !later.some(
          (middle) =>
            middle !== candidate &&
            order.before.some(([first, second]) => first === middle && second === candidate),
        ),
    );

    if ((next ?? null) !== clock.afterTick)
      return Result.fail("clock successor does not match the order");
  }

  const contexts: Array<typeof ContextVector.Type> = [];
  const machineStates: Array<{ readonly machine: string; readonly state: string }> = [];
  const atNow: Array<typeof EnabledVector.Type> = [];
  const afterTick: Array<typeof EnabledVector.Type> = [];

  for (const [index, machine] of symbols.machines.entries()) {
    const stateNames = atomNames(machine.states);
    const current = unary(`machineState${index}`);

    if (current.length > 1) return Result.fail(`multiple machine states for ${machine.name}`);
    const state = current.length === 0 ? "[*]" : stateNames.get(current[0]!);

    if (state === undefined) return Result.fail(`unknown machine state for ${machine.name}`);
    machineStates.push({ machine: machine.name, state });

    const transitions = new Map(
      machine.transitions.map((transition) => [`${transition.atom}$0`, transition]),
    );

    const contextIds = new Set(unary(`contexts${index}`));

    const contextFields = machine.fields.map((_, fieldIndex) =>
      pairs(`field${index}_${fieldIndex}`),
    );

    for (const id of contextIds) {
      const values: Array<(typeof ContextVector.Type.values)[number]> = [];

      for (const [fieldIndex, field] of machine.fields.entries()) {
        const value = contextFields[fieldIndex]!.get(id);

        if (value === undefined) return Result.fail(`missing context field ${machine.name} ${id}`);
        values.push({ path: field.path, order: field.order, value });
      }

      if (machine.clockPath !== null && clock !== null) {
        const bound = values.find(
          (entry) =>
            entry.path.length === machine.clockPath!.length &&
            entry.path.every((part, i) => part === machine.clockPath![i]),
        );

        if (bound?.value !== clock.now || bound.order !== clock.order)
          return Result.fail(`invalid clock binding for ${machine.name} ${id}`);
      }

      contexts.push({ machine: machine.name, id, values });
    }

    for (const [field, destination] of [
      [`enabledNow${index}`, atNow],
      [`enabledAfterTick${index}`, afterTick],
    ] as const) {
      for (const tuple of projection[field]!) {
        const state = stateNames.get(tuple[0]!);

        const transition: AlloyMachineSymbols["transitions"][number] | undefined = transitions.get(
          tuple[2]!,
        );

        if (state === undefined || transition === undefined || !contextIds.has(tuple[1]!)) {
          return Result.fail(`unknown transition projection in ${machine.name}`);
        }

        const entry: EnabledDraft = {
          machine: machine.name,
          state,
          context: tuple[1]!,
          transition: transition.atom,
          to: transition.to,
        };

        if (transition.command !== undefined) entry.command = transition.command;
        destination.push(entry);
      }
    }
  }

  const allows: Array<(typeof Snapshot.Type.allows)[number]> = [];

  for (const tuple of projection.allowed!) {
    const permission = permissions.get(tuple[1]!);

    if (permission === undefined) return Result.fail(`unknown permission ${tuple[1]}`);
    allows.push({ principal: tuple[0]!, permission, target: tuple[2]! });
  }

  return Result.succeed({
    solution,
    step,
    principals,
    targets,
    departments: unary("departments"),
    teams,
    memberships,
    orders,
    clock,
    contexts,
    machineStates,
    allows,
    enabled: { atNow, afterTick },
  });
};

/** Decode model-produced relation tuples, not a second authorization or machine interpreter. */
export const snapshotsFromSolutions = (
  solutions: ReadonlyArray<AlloySolution>,
  symbols: AlloySymbols,
): Result.Result<ReadonlyArray<VectorSnapshot>, string> => {
  const instances: Array<VectorSnapshot> = [];

  for (const [solutionIndex, solution] of solutions.entries()) {
    for (const [step, instance] of solution.instances.entries()) {
      const projection = instance.values["Projection$0"];

      if (projection === undefined) return Result.fail("missing Projection atom");
      const snapshot = projectionSnapshot(projection, symbols, solutionIndex, step);

      if (Result.isFailure(snapshot)) return Result.fail(snapshot.failure);
      instances.push(snapshot.success);
    }
  }

  return Result.succeed(instances);
};

export const vectorsFromReceipt = (
  receipt: AlloyReceipt,
  symbols: AlloySymbols,
): Result.Result<ConformanceVectors, string> => {
  const command = receipt.commands.Vectors;

  if (
    command === undefined ||
    !receiptCommandMatches(command, "Vectors", symbols, "run") ||
    command.solution === undefined ||
    command.solution.length === 0
  ) {
    return Result.fail("missing or invalid Vectors run, scope or solutions");
  }

  const instances = snapshotsFromSolutions(command.solution, symbols);

  if (Result.isFailure(instances)) return Result.fail(instances.failure);

  return Result.succeed({
    format: "effx-alloy-vectors",
    version: 1,
    domain: symbols.domain,
    scope: symbols.scope,
    steps: symbols.steps,
    orderedAtoms: symbols.orderedAtoms,
    scopeParts: symbols.scopeParts,
    permissions: symbols.permissions.map(({ name, kind }) => ({ name, kind })),
    unknownGuards: symbols.unknownGuards,
    nondeterministic: symbols.nondeterministic,
    instances: instances.success,
  });
};
