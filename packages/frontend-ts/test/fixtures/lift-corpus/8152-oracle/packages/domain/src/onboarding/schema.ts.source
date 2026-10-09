import { Schema } from "effect";
import { DepartmentId, PersonId } from "../organization/schema.js";
import { PublicApplicationIdSchema } from "../application/schema.js";

export const OnboardingScope = Schema.Struct({ departmentId: DepartmentId });

export const OnboardingCommand = Schema.Struct({
  applicationId: PublicApplicationIdSchema,
  action: Schema.Literals(["Issue", "Revoke", "RetryDelivery"]),
});

export const OnboardingToken = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^onboard_[a-f0-9]{64}$/)),
);

export const OnboardingClaim = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("NewAccount"),
    token: OnboardingToken,
    password: Schema.String.pipe(Schema.check(Schema.isMinLength(12), Schema.isMaxLength(128))),
  }),
  Schema.Struct({ mode: Schema.Literal("ExistingAccount"), token: OnboardingToken }),
]);

export const OnboardingItem = Schema.Struct({
  applicationId: PublicApplicationIdSchema,
  firstName: Schema.String,
  lastName: Schema.String,
  invitationId: Schema.NullOr(Schema.String),
  state: Schema.Literals(["Absent", "Open", "Revoked", "Claimed", "Expired", "Linked"]),
  delivery: Schema.Literals(["Absent", "Pending", "Claimed", "Delivered", "Cancelled"]),
  expiresAt: Schema.NullOr(Schema.String),
});

export const OnboardingBoard = Schema.Struct({
  ...OnboardingScope.fields,
  items: Schema.Array(OnboardingItem),
});

export const OnboardingClaimResult = Schema.Struct({
  state: Schema.Literal("Claimed"),
  departmentId: DepartmentId,
});

export type OnboardingCommand = typeof OnboardingCommand.Type;

export type AccountProvisionInput = {
  readonly personId: PersonId;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly passwordHash: string;
  readonly now: string;
};
