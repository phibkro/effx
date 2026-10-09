import type {
  AdmissionPeriod,
  AdmissionPeriodActor,
  AdmissionPeriodId,
  AdmissionPeriodObservation,
} from "./schema.js";

export interface AdmissionPeriodCommandContext {
  readonly actor: AdmissionPeriodActor;
  readonly now: string;
  /** A caller-generated identity may be supplied by the transport adapter. */
  readonly admissionPeriodId?: AdmissionPeriodId;
}

export interface AdmissionPeriodManagementContext {
  readonly actor: AdmissionPeriodActor;
  readonly now: string;
}

export interface AdmissionPeriodTransactionResult {
  readonly period: AdmissionPeriod;
  readonly observation: AdmissionPeriodObservation;
  readonly replayed: boolean;
  readonly outboxCount: number;
}
