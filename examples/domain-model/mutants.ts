import type { DomainDescription } from "@effx/domain-model";
import { domain } from "./domain.ts";

const review = domain.machines[0];

/** Each mutation changes declaration data, never the generated Alloy. */
export const mutants = {
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

const { adminList: omittedAdminList, clock: omittedClock, ...withoutOptionalDeclarations } = domain;

const { clockPath: omittedClockPath, ...unboundContext } = review.context;

void omittedAdminList;

void omittedClock;

void omittedClockPath;

/** Neither absent feature can be reported as a passed assertion. */
export const withoutAdminListOrClock = {
  ...withoutOptionalDeclarations,
  machines: [{ ...review, context: unboundContext }],
} satisfies DomainDescription;
