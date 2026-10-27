import type { DomainDescription } from "@effx/domain-model";
import { domain } from "./domain.ts";

const review = domain.machines[0];

/** Each mutation changes declaration data, never the generated Alloy. */
export const mutants = {
  withParameter: {
    ...domain,
    machines: [
      {
        ...review,
        context: {
          ...review.context,
          fields: [
            ...review.context.fields,
            { path: ["requested"], order: "ReviewTime", kind: "parameter" },
          ],
        },
        transitions: [
          {
            ...review.transitions[0],
            guard: {
              context: "ReviewContext",
              representation: {
                id: "effx/order/same",
                payload: { left: ["requested"], right: ["current"] },
              },
            },
          },
          {
            ...review.transitions[1],
            when: {
              context: "ReviewContext",
              representation: {
                id: "effx/order/same",
                payload: { left: ["requested"], right: ["review", "end"] },
              },
            },
          },
          review.transitions[2],
        ],
      },
    ],
  },
  withWrite: {
    ...domain,
    commands: domain.commands.map((command) =>
      command.name === "AdvanceReview"
        ? { ...command, writes: [{ machine: "Review", path: ["review", "end"] }] }
        : command,
    ),
  },
  withUnboundWrite: {
    ...domain,
    commands: domain.commands.map((command) =>
      command.name === "RefreshDirectory"
        ? { ...command, writes: [{ machine: "Review", path: ["review", "end"] }] }
        : command,
    ),
  },
  withUnknownGuard: {
    ...domain,
    machines: [
      {
        ...review,
        transitions: [
          {
            ...review.transitions[0],
            guard: {
              context: "ReviewContext",
              representation: { id: "example/unregistered", payload: null },
            },
          },
          ...review.transitions.slice(1),
        ],
      },
    ],
  },
  withRemoval: {
    ...domain,
    machines: [
      {
        ...review,
        transitions: [
          review.transitions[0],
          review.transitions[1],
          { ...review.transitions[2], to: "[*]" },
        ],
      },
    ],
  },
  unreachable: {
    ...domain,
    machines: [
      {
        ...review,
        states: [...review.states, "Lost"],
        terminal: [...review.terminal, "Lost"],
      },
    ],
  },
  timeTravel: {
    ...domain,
    machines: [
      {
        ...review,
        transitions: [
          {
            ...review.transitions[0],
            guard: {
              context: "ReviewContext",
              representation: {
                _tag: "FilterGroup",
                checks: [
                  {
                    id: "effx/order/after",
                    payload: { left: ["review", "start"], right: ["review", "end"] },
                  },
                  {
                    id: "effx/order/same",
                    payload: { left: ["current"], right: ["review", "start"] },
                  },
                ],
              },
            },
          },
          {
            ...review.transitions[1],
            guard: {
              context: "ReviewContext",
              representation: {
                id: "effx/order/same",
                payload: { left: ["current"], right: ["review", "end"] },
              },
            },
          },
          review.transitions[2],
        ],
      },
    ],
  },
  deadEnd: {
    ...domain,
    machines: [
      {
        ...review,
        states: [...review.states, "Stuck"],
        transitions: [
          ...review.transitions,
          { command: "AdvanceReview", from: ["Draft"], to: "Stuck" },
        ],
      },
    ],
  },
  ungranted: {
    ...domain,
    commands: [...domain.commands, { name: "Unassigned", kind: "Command" }],
  },
  adminSelf: {
    ...domain,
    grants: [...domain.grants, { subject: "Self", permits: ["GrantAdmin"], scope: "own" }],
  },
  endedMembership: {
    ...domain,
    subjectSets: domain.subjectSets.map((subject) =>
      subject.name === "Recruiter"
        ? { ...subject, expression: { ...subject.expression, term: "any" as const } }
        : subject,
    ),
  },
  otherJob: {
    ...domain,
    principals: {
      ...domain.principals,
      System: { jobs: [...domain.principals.System.jobs, "cleanup"] },
    },
    commands: [
      ...domain.commands,
      { name: "CleanDirectory", kind: "Command", runBy: { job: "cleanup" } },
    ],
    grants: [
      ...domain.grants,
      { subject: "DirectoryJob", permits: ["CleanDirectory"], scope: "all" },
    ],
  },
} as const satisfies Readonly<Record<string, DomainDescription>>;

/** Remove exactly the directory grant for the vectors negative control. */
export const withoutDirectoryGrant = {
  ...domain,
  grants: domain.grants.filter((grant) => grant.subject !== "DirectoryJob"),
} satisfies DomainDescription;

const {
  adminList: omittedAdminList,
  clock: omittedClock,
  memberships: omittedMemberships,
  ...withoutOptionalDeclarations
} = domain;

const { clockPath: omittedClockPath, ...unboundContext } = review.context;

void omittedAdminList;

void omittedClock;

void omittedClockPath;

void omittedMemberships;

/** Absent features cannot be reported as passed assertions. */
export const withoutOptionalBindings = {
  ...withoutOptionalDeclarations,
  machines: [
    {
      ...review,
      context: {
        ...unboundContext,
        fields: unboundContext.fields.map((field) =>
          field.kind === "clock" ? { ...field, kind: "parameter" as const } : field,
        ),
      },
    },
  ],
} satisfies DomainDescription;
