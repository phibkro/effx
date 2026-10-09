import { Schema } from "effect";
import { admissionPeriodCommandDigest } from "./digest.js";
import {
  AdmissionPeriodCommandId,
  AdmissionPeriodEffectId,
  AdmissionPeriodId,
  AdmissionPeriodSchema,
} from "./schema.js";

const AdmissionPeriodEffectBase = {
  effectId: AdmissionPeriodEffectId,
  commandId: AdmissionPeriodCommandId,
  admissionPeriodId: AdmissionPeriodId,
  revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  period: AdmissionPeriodSchema,
};

export const AdmissionPeriodOutboxRequestSchema = Schema.TaggedUnion({
  PublishAdmissionPeriodChanged: AdmissionPeriodEffectBase,
});

export type AdmissionPeriodOutboxRequest = typeof AdmissionPeriodOutboxRequestSchema.Type;

export const admissionPeriodOutboxRequest = (
  commandId: AdmissionPeriodCommandId,
  period: typeof AdmissionPeriodSchema.Type,
): AdmissionPeriodOutboxRequest =>
  AdmissionPeriodOutboxRequestSchema.cases.PublishAdmissionPeriodChanged.make({
    effectId: AdmissionPeriodEffectId.make(
      `admission-period:${admissionPeriodCommandDigest({ commandId, periodId: period.id, revision: period.revision })}`,
    ),
    commandId,
    admissionPeriodId: period.id,
    revision: period.revision,
    period,
  });
