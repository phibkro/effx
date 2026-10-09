import { canonicalJsonBytes, sha256Hex } from "../shared-kernel/index.js";

export { canonicalJson } from "../shared-kernel/index.js";

import {
  ApplicantIdSchema,
  PublicApplicationCommandIdSchema,
  PublicApplicationIdSchema,
  type ApplicantId,
  type PublicApplicationSubmitInput,
  type SubmitPublicApplicationCommand,
} from "./schema.js";
import { DepartmentId } from "../organization/schema.js";
import { AdmissionFieldOfStudyId } from "../admission-period/schema.js";

export type PublicApplicationCommandPayload = PublicApplicationSubmitInput;

export const publicApplicationCommandPayload = (
  command: PublicApplicationSubmitInput | SubmitPublicApplicationCommand,
): PublicApplicationCommandPayload => ({
  commandId: PublicApplicationCommandIdSchema.make(command.commandId.trim()),
  departmentId: DepartmentId.make(command.departmentId.trim()),
  firstName: command.firstName.trim(),
  lastName: command.lastName.trim(),
  phone: command.phone.trim(),
  email: command.email.trim().toLowerCase(),
  gender: command.gender,
  fieldOfStudyId: AdmissionFieldOfStudyId.make(command.fieldOfStudyId.trim()),
  yearOfStudy: command.yearOfStudy,
  availability: command.availability,
});

export const publicApplicationCommandBytes = (
  command: PublicApplicationSubmitInput | SubmitPublicApplicationCommand,
): Uint8Array => canonicalJsonBytes(publicApplicationCommandPayload(command));

export const publicApplicationCommandDigest = (
  command: PublicApplicationSubmitInput | SubmitPublicApplicationCommand,
): string => sha256Hex(publicApplicationCommandBytes(command));

export const publicApplicationActivationDigest = (activationToken: string): string =>
  sha256Hex(new TextEncoder().encode(activationToken));

export const publicApplicationIdForCommand = (
  command: PublicApplicationSubmitInput | SubmitPublicApplicationCommand,
): typeof PublicApplicationIdSchema.Type =>
  PublicApplicationIdSchema.make(
    `application-${publicApplicationCommandDigest(command).slice(0, 32)}`,
  );

export const publicApplicantIdForCommand = (
  command: PublicApplicationSubmitInput | SubmitPublicApplicationCommand,
): ApplicantId =>
  ApplicantIdSchema.make(`applicant-${publicApplicationCommandDigest(command).slice(0, 32)}`);
