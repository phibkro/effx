export const capabilityNames = [
  "Database",
  "Identity",
  "Organization",
  "Profile",
  "Admissions",
  "Schools",
  "Recruitment",
  "Economy",
  "Content",
  "ContentManagement",
  "PrivateFileStore",
  "SocialEvents",
  "NotificationGateway",
] as const;

export type CapabilityName = (typeof capabilityNames)[number];

export type CapabilityAuthorityDependencyGraph = {
  readonly [Capability in CapabilityName]: ReadonlyArray<CapabilityName>;
};

/** Compile-time checked logical authority dependencies from design spec 0040.1. */
export const capabilityAuthorityDependencies = {
  Database: [],
  Identity: ["Database"],
  Organization: ["Database"],
  Profile: ["Organization"],
  Schools: ["Database", "Organization"],
  Admissions: ["Database", "Organization"],
  Recruitment: ["Database", "Admissions", "Organization", "Profile"],
  Economy: ["Database", "Identity", "PrivateFileStore", "NotificationGateway"],
  Content: ["ContentManagement"],
  ContentManagement: [],
  SocialEvents: ["Database", "Organization"],
  PrivateFileStore: [],
  NotificationGateway: [],
} as const satisfies CapabilityAuthorityDependencyGraph;
