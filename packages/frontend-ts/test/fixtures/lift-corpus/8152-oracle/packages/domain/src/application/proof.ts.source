import { Effect } from "effect";
import {
  recordPublicApplicationEffects,
  type PublicApplicationEffectEvidence,
  type PublicApplicationEffectDeliveryError,
  type PublicApplicationOutboxRequest,
} from "./effects.js";

export interface PublicApplicationProofEvidence {
  readonly specId: "0039";
  readonly effectIds: ReadonlyArray<string>;
  readonly effectKinds: ReadonlyArray<PublicApplicationEffectEvidence["kind"]>;
  readonly ordered: boolean;
  readonly noPrivatePayload: true;
}

export const runPublicApplicationProof = (
  requests: ReadonlyArray<PublicApplicationOutboxRequest>,
): Effect.Effect<PublicApplicationProofEvidence, PublicApplicationEffectDeliveryError> =>
  recordPublicApplicationEffects(requests).pipe(
    Effect.map((effects) => ({
      specId: "0039" as const,
      effectIds: effects.map((effect) => effect.effectId),
      effectKinds: effects.map((effect) => effect.kind),
      ordered: effects.every((effect, index) => effect.ordinal === index),
      noPrivatePayload: true as const,
    })),
  );
