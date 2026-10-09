import { flow, Effect, Schema } from "effect";
import { PublicApplicationDecodeError } from "./errors.js";
import {
  SubmitPublicApplicationCommandSchema,
  PublicApplicationCommandIdSchema,
  PublicApplicationEmailSchema,
  PublicApplicationNameSchema,
  PublicApplicationPhoneSchema,
  isPublicApplicationInstant,
  PublicApplicationSubmitInputSchema,
  type PublicApplicationSubmitInput,
} from "./schema.js";
import { DepartmentId } from "../organization/schema.js";
import { AdmissionFieldOfStudyId } from "../admission-period/schema.js";

const invalidInput = new PublicApplicationDecodeError({
  message: "invalid public application input",
});

const normalizeSubmitInput = (
  input: PublicApplicationSubmitInput,
): Effect.Effect<PublicApplicationSubmitInput, PublicApplicationDecodeError> => {
  const commandId = PublicApplicationCommandIdSchema.make(input.commandId.trim());
  const departmentId = DepartmentId.make(input.departmentId.trim());
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const phone = input.phone.trim();
  const email = input.email.trim();
  const fieldOfStudyId = AdmissionFieldOfStudyId.make(input.fieldOfStudyId.trim());

  if (
    commandId.length === 0 ||
    departmentId.length === 0 ||
    fieldOfStudyId.length === 0 ||
    !Schema.is(PublicApplicationNameSchema)(firstName) ||
    !Schema.is(PublicApplicationNameSchema)(lastName) ||
    !Schema.is(PublicApplicationPhoneSchema)(phone) ||
    !Schema.is(PublicApplicationEmailSchema)(email)
  ) {
    return Effect.fail(invalidInput);
  }

  return Effect.succeed({
    commandId,
    departmentId,
    firstName,
    lastName,
    phone,
    email: email.toLowerCase(),
    gender: input.gender,
    fieldOfStudyId,
    yearOfStudy: input.yearOfStudy,
    availability: input.availability,
  });
};

export const decodePublicApplicationSubmitInput = flow(
  Schema.decodeUnknownEffect(PublicApplicationSubmitInputSchema, {
    onExcessProperty: "error",
  }),
  Effect.flatMap(normalizeSubmitInput),
  Effect.mapError(() => invalidInput),
);

export const decodeSubmitPublicApplicationInput = decodePublicApplicationSubmitInput;

export const decodeSubmitPublicApplicationCommand = flow(
  decodePublicApplicationSubmitInput,
  Effect.map((input) =>
    SubmitPublicApplicationCommandSchema.cases.SubmitPublicApplication.make(input),
  ),
);

export const decodePublicApplicationNow = flow(
  Schema.decodeUnknownEffect(
    Schema.String.pipe(Schema.check(Schema.makeFilter(isPublicApplicationInstant))),
  ),
  Effect.mapError(
    () => new PublicApplicationDecodeError({ message: "invalid public application time" }),
  ),
);
