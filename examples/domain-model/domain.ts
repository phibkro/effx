import type { DomainDescription } from "@effx/domain-model";

const ordered = {
  context: "ReviewContext",
  representation: {
    id: "effx/order/after",
    payload: { left: ["review", "end"], right: ["review", "start"] },
  },
} as const;

const expired = {
  context: "ReviewContext",
  representation: {
    id: "effx/guard/not",
    payload: { id: "effx/order/after", payload: { left: ["review", "end"], right: ["current"] } },
  },
} as const;

/** An invented community-team domain; it has no dependency on an application repository. */
export const domain = {
  name: "community",
  commands: [
    { name: "StartReview", kind: "Command" },
    { name: "AdvanceReview", kind: "Command" },
    { name: "CloseReview", kind: "Command" },
    { name: "GrantAdmin", kind: "Command" },
    { name: "RevokeAdmin", kind: "Command" },
    { name: "RefreshDirectory", kind: "Command", runBy: { job: "directory" } },
  ],
  reads: [{ name: "ReadReview" }],
  principals: { Anonymous: {}, Person: {}, System: { jobs: ["directory"] } },
  subjectSets: [
    {
      name: "BoardLeader",
      expression: {
        _tag: "Membership",
        function: "board",
        position: "leader",
        department: "target",
        term: "active",
      },
    },
    {
      name: "Recruiter",
      expression: {
        _tag: "Membership",
        function: "recruitment",
        position: "member",
        department: "any",
        term: "active",
      },
    },
    { name: "Self", expression: { _tag: "Self" } },
    { name: "Admin", expression: { _tag: "Admin" } },
    { name: "DirectoryJob", expression: { _tag: "System", job: "directory" } },
    { name: "Readers", expression: { _tag: "Union", sets: ["BoardLeader", "Recruiter", "Self"] } },
  ],
  grants: [
    { subject: "BoardLeader", permits: ["StartReview", "AdvanceReview"], scope: "department" },
    { subject: "Recruiter", permits: ["AdvanceReview"], scope: "all" },
    { subject: "Self", permits: ["CloseReview"], scope: "own" },
    { subject: "Admin", permits: ["GrantAdmin", "RevokeAdmin"], scope: "all" },
    { subject: "DirectoryJob", permits: ["RefreshDirectory"], scope: "all" },
    { subject: "Readers", permits: ["ReadReview"], scope: "all" },
  ],
  orders: [{ name: "ReviewTime" }],
  clock: { order: "ReviewTime" },
  adminList: { grant: "GrantAdmin", revoke: "RevokeAdmin", expiry: expired },
  machines: [
    {
      name: "Review",
      states: ["Draft", "Open", "Closed"],
      terminal: ["Closed"],
      context: {
        name: "ReviewContext",
        fields: [
          { path: ["review", "start"], order: "ReviewTime" },
          { path: ["review", "end"], order: "ReviewTime" },
          { path: ["current"], order: "ReviewTime" },
        ],
        clockPath: ["current"],
      },
      transitions: [
        { command: "StartReview", from: ["[*]"], to: "Draft" },
        { command: "AdvanceReview", from: ["Draft"], to: "Open", guard: ordered },
        { command: "CloseReview", from: ["Open"], to: "Closed" },
      ],
      calculated: [{ from: "Draft", to: "Closed", when: expired }],
    },
  ],
} as const satisfies DomainDescription;
