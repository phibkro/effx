import { Schema } from "effect";
import { defineDiagnostic, type DiagnosticEntry, type DiagnosticExample } from "@effx/diagnostics";

const Params = Schema.Struct({
  domain: Schema.String,
  detail: Schema.String,
  scope: Schema.Int,
  steps: Schema.Int,
});

const entry = <const Code extends string, const Severity extends "error" | "warning">(
  code: Code,
  title: string,
  severity: Severity,
  explanation: string,
  example: DiagnosticExample,
) =>
  ({
    code,
    owner: "domain-model",
    title,
    severity,
    severityPolicy: { kind: "fixed" },
    explanation,
    examples: [example],
  }) as const;

const render =
  (title: string) =>
  ({ domain, detail, scope, steps }: typeof Params.Type) =>
    `${domain}: ${title} (scope ${scope}, steps ${steps}): ${detail}`;

const titles = {
  EFFX4301: "Invalid domain description",
  EFFX4302: "Guard not modelled",
  EFFX4303: "Alloy 6.2.0 unavailable",
  EFFX4304: "Alloy execution or receipt invalid",
  EFFX4305: "A1 state reachability",
  EFFX4306: "A2 nonterminal exit",
  EFFX4307: "A3 command grant",
  EFFX4308: "A4 admin self-change",
  EFFX4309: "A5 ended membership",
  EFFX4310: "A6 system job authority",
  EFFX4311: "Nondeterministic time condition",
  EFFX4312: "A7 clock monotonicity",
  EFFX4313: "Command effect not modelled precisely",
} as const;

/** Each example uses the community-review domain of `examples/domain-model/domain.ts`. */
const examples = {
  EFFX4301: {
    before: `domainModel({ ...domain, grants: [...domain.grants, { subject: "Board", permits: ["StartReview"], scope: "all" }] })
// community: Invalid domain description: unknown subject set Board`,
    after: `domainModel({
  ...domain,
  subjectSets: [
    ...domain.subjectSets,
    {
      name: "Board",
      expression: { _tag: "Membership", function: "board", position: "leader", department: "target", term: "active" },
    },
  ],
  grants: [...domain.grants, { subject: "Board", permits: ["StartReview"], scope: "all" }],
})`,
    explanation:
      "Names resolve on decode: a grant names a declared subject set, and a transition, write, job, order or state names a declared one. Declare the missing name or correct the reference.",
  },
  EFFX4302: {
    before: `{ command: "StartReview", from: ["[*]"], to: "Draft",
  guard: { context: "ReviewContext", representation: { id: "example/unregistered", payload: null } } }
// community: Guard not modelled: example/unregistered`,
    after: `{ command: "StartReview", from: ["[*]"], to: "Draft",
  guard: {
    context: "ReviewContext",
    representation: { id: "effx/order/same", payload: { left: ["current"], right: ["review", "start"] } },
  } }
// or register a trusted compiler for the id: domainModel(domain, { guardCompilers: { "example/unregistered": compile } })`,
    explanation:
      "The built-in representation ids are effx/order/after, effx/order/same, effx/guard/not and effx/guard/or. An unknown id is a warning and the model omits the guard, so the transition is over-approximated until the id is compiled.",
  },
  EFFX4303: {
    before: `$ effx models check
community: Alloy 6.2.0 unavailable (scope 1, steps 4): expected 6.2.0; observed 5.1.0 (exit 0)`,
    after: `$ nix shell .#alloy6 -c effx models check
community A1_Reachability Review:Open PASS (scope 1, steps 4, ...)`,
    explanation:
      "The check runs the executable named alloy6 and requires its version output to be exactly 6.2.0. Put that pinned build on PATH; an unavailable or different build never counts as a pass.",
  },
  EFFX4304: {
    before: `$ effx models check
community: Alloy execution or receipt invalid (scope 1, steps 4): missing or invalid check A3_CommandGrant`,
    after: `# the child must exit 0 and write receipt.json with every generated command at the generated bounds
$ nix shell .#alloy6 -c effx models check`,
    explanation:
      "alloy6 exec exits 0 even for a counterexample, so effx reads the JSON receipt. A missing, malformed or incomplete receipt, or one whose command names or bounds differ from the generated model, is an error. Rebuild the model with effx build and run the real pinned tool.",
  },
  EFFX4305: {
    before: `machines: [{ ...review, states: ["Draft", "Open", "Closed", "Lost"], terminal: ["Closed", "Lost"] }]
// community: A1 state reachability: Review:Lost not reached within 4 steps at scope 1`,
    after: `machines: [{ ...review, states: ["Draft", "Open", "Closed", "Lost"], terminal: ["Closed", "Lost"],
  transitions: [...review.transitions, { command: "AdvanceReview", from: ["Draft"], to: "Lost" }] }]`,
    explanation:
      "Each declared state needs a trace from the initial state within the stated scope and steps. Add the missing transition, or raise scope and steps if the trace is longer than the bound; a failed bounded run does not prove the state is unreachable.",
  },
  EFFX4306: {
    before: `machines: [{ ...review, states: ["Draft", "Open", "Closed", "Stuck"],
  transitions: [...review.transitions, { command: "AdvanceReview", from: ["Draft"], to: "Stuck" }] }]
// community: A2 nonterminal exit: Review:Stuck has no transition out`,
    after: `machines: [{ ...review, states: ["Draft", "Open", "Closed", "Stuck"], terminal: ["Closed", "Stuck"],
  transitions: [...review.transitions, { command: "AdvanceReview", from: ["Draft"], to: "Stuck" }] }]
// or add a transition out of Stuck`,
    explanation:
      "A state that is not listed in terminal must have a transition out. Declare the state terminal or give it an exit.",
  },
  EFFX4307: {
    before: `commands: [...domain.commands, { name: "Unassigned", kind: "Command" }]
// community: A3 command grant: Unassigned has no applicable grant`,
    after: `commands: [...domain.commands, { name: "Unassigned", kind: "Command" }],
grants: [...domain.grants, { subject: "Admin", permits: ["Unassigned"], scope: "all" }]`,
    explanation:
      "Every command is granted to some subject set, and a command with runBy is granted only to its own job. Add the grant row, or remove the command.",
  },
  EFFX4308: {
    before: `grants: [...domain.grants, { subject: "Self", permits: ["GrantAdmin"], scope: "own" }]
// community: A4 admin self-change: a principal outside the admin set can change its own admin status`,
    after: `grants: domain.grants // only the Admin subject set is granted GrantAdmin and RevokeAdmin`,
    explanation:
      "With adminList declared, only the admin set may run the grant and revoke commands. Do not grant them to Self or to a membership set.",
  },
  EFFX4309: {
    before: `{ name: "Recruiter", expression: { _tag: "Membership", function: "recruitment", position: "member", department: "any", term: "any" } }
// community: A5 ended membership: a membership outside grantingStates contributes permission`,
    after: `{ name: "Recruiter", expression: { _tag: "Membership", function: "recruitment", position: "member", department: "any", term: "active" } }`,
    explanation:
      "memberships.grantingStates names the machine states that count as active. A granted membership subject with term any also admits ended memberships; use term active, or widen grantingStates deliberately.",
  },
  EFFX4310: {
    before: `principals: { ...domain.principals, System: { jobs: ["directory", "cleanup"] } },
commands: [...domain.commands, { name: "CleanDirectory", kind: "Command", runBy: { job: "cleanup" } }],
grants: [...domain.grants, { subject: "DirectoryJob", permits: ["CleanDirectory"], scope: "all" }]
// community: A6 system job authority: the directory job is permitted CleanDirectory, a command of job cleanup`,
    after: `subjectSets: [...domain.subjectSets, { name: "CleanupJob", expression: { _tag: "System", job: "cleanup" } }],
grants: [...domain.grants, { subject: "CleanupJob", permits: ["CleanDirectory"], scope: "all" }]`,
    explanation:
      "A System principal is permitted exactly the commands that name its own job in runBy. Grant a job-only command to that job's own subject set.",
  },
  EFFX4311: {
    before: `calculated: [{ from: "Open", to: "Closed" }]
// community: Nondeterministic time condition: machine Review calculated transition 0 cannot be determined from stored fields and clock`,
    after: `calculated: [{ from: "Open", to: "Closed", when: expired }]
// expired: { context: "ReviewContext", representation: { id: "effx/guard/not", payload: { id: "effx/order/after", payload: { left: ["review", "end"], right: ["current"] } } } }`,
    explanation:
      "A calculated transition or admin expiry needs a guard over the context's declared clock path and no caller parameter. Without one the model lets the time condition hold at any tick, which over-approximates the behavior.",
  },
  EFFX4312: {
    before: `// A7_TimeMonotonic counterexample: Clock.now' is neither Clock.now nor a later value
// (reachable only if the generated model was edited or the generator is defective)`,
    after: `$ effx build && nix shell .#alloy6 -c effx models check
community A7_TimeMonotonic PASS (scope 1, steps 4, ...)`,
    explanation:
      "Generated steps keep the declared clock fixed or move it to its successor. A counterexample means the .als file no longer matches the description. Regenerate it with effx build and report a defect if it persists.",
  },
  EFFX4313: {
    before: `{ name: "AdvanceReview", kind: "Command", writes: [{ machine: "Review", path: ["review", "end"] }] }
// community: Command effect not modelled precisely: AdvanceReview: effect on Review.review.end not modelled precisely`,
    after: `// accepted: the warning stays while the write is over-approximated to any value of the field's order.
// Remove the writes entry if the command does not change the stored field.
{ name: "AdvanceReview", kind: "Command" }`,
    explanation:
      "A declared write lets the model choose any value of the field's order. The warning marks the over-approximation; precise command effects belong to a later slice.",
  },
} as const satisfies Record<string, DiagnosticExample>;

export const DomainDiagnostics = {
  EFFX4301: defineDiagnostic(
    entry(
      "EFFX4301",
      titles.EFFX4301,
      "error",
      "The description does not decode or contains an unresolved domain reference.",
      examples.EFFX4301,
    ),
    Params,
    render(titles.EFFX4301),
  ),
  EFFX4302: defineDiagnostic(
    entry(
      "EFFX4302",
      titles.EFFX4302,
      "warning",
      "No Alloy compiler is registered for a guard representation; the transition is modelled without that guard.",
      examples.EFFX4302,
    ),
    Params,
    render(titles.EFFX4302),
  ),
  EFFX4303: defineDiagnostic(
    entry(
      "EFFX4303",
      titles.EFFX4303,
      "error",
      "The required Alloy executable is missing or reports a different version.",
      examples.EFFX4303,
    ),
    Params,
    render(titles.EFFX4303),
  ),
  EFFX4304: defineDiagnostic(
    entry(
      "EFFX4304",
      titles.EFFX4304,
      "error",
      "The child failed, or its receipt is missing, malformed, or does not contain all expected commands.",
      examples.EFFX4304,
    ),
    Params,
    render(titles.EFFX4304),
  ),
  EFFX4305: defineDiagnostic(
    entry(
      "EFFX4305",
      titles.EFFX4305,
      "error",
      "No trace reached the named state from the initial state within the stated scope and step bound.",
      examples.EFFX4305,
    ),
    Params,
    render(titles.EFFX4305),
  ),
  EFFX4306: defineDiagnostic(
    entry(
      "EFFX4306",
      titles.EFFX4306,
      "error",
      "A state not declared terminal has no transition out.",
      examples.EFFX4306,
    ),
    Params,
    render(titles.EFFX4306),
  ),
  EFFX4307: defineDiagnostic(
    entry(
      "EFFX4307",
      titles.EFFX4307,
      "error",
      "A command has no applicable grant, or a job-only command is granted outside its job.",
      examples.EFFX4307,
    ),
    Params,
    render(titles.EFFX4307),
  ),
  EFFX4308: defineDiagnostic(
    entry(
      "EFFX4308",
      titles.EFFX4308,
      "error",
      "A principal outside the active admin set can change its own admin status.",
      examples.EFFX4308,
    ),
    Params,
    render(titles.EFFX4308),
  ),
  EFFX4309: defineDiagnostic(
    entry(
      "EFFX4309",
      titles.EFFX4309,
      "error",
      "A membership outside the declared granting states contributes permission.",
      examples.EFFX4309,
    ),
    Params,
    render(titles.EFFX4309),
  ),
  EFFX4310: defineDiagnostic(
    entry(
      "EFFX4310",
      titles.EFFX4310,
      "error",
      "A system principal is permitted a different set of commands than its own job.",
      examples.EFFX4310,
    ),
    Params,
    render(titles.EFFX4310),
  ),
  EFFX4311: defineDiagnostic(
    entry(
      "EFFX4311",
      titles.EFFX4311,
      "warning",
      "A calculated transition or expiry lacks a supported clock-bound guard, so its time condition is modelled nondeterministically.",
      examples.EFFX4311,
    ),
    Params,
    render(titles.EFFX4311),
  ),
  EFFX4312: defineDiagnostic(
    entry(
      "EFFX4312",
      titles.EFFX4312,
      "error",
      "The domain clock moves backward in a model trace.",
      examples.EFFX4312,
    ),
    Params,
    render(titles.EFFX4312),
  ),
  EFFX4313: defineDiagnostic(
    entry(
      "EFFX4313",
      titles.EFFX4313,
      "warning",
      "A declared stored-field write is modelled as any value in the field order, not as the command's precise effect.",
      examples.EFFX4313,
    ),
    Params,
    render(titles.EFFX4313),
  ),
} as const;

export const domainEntries: ReadonlyArray<DiagnosticEntry> = Object.values(DomainDiagnostics).map(
  (definition) => definition.entry,
);
