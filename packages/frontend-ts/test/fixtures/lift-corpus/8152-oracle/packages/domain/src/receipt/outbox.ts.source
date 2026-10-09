import { Data } from "effect";
import type { ReceiptOutboxRequest } from "./effects.js";

export interface ClaimedReceiptOutbox {
  readonly effectId: string;
  readonly commandId: string;
  readonly ordinal: number;
  readonly attempts: number;
  readonly claimId: string;
  readonly request: ReceiptOutboxRequest;
}

export type ReceiptOutboxDeliveryResult =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Delivered"; readonly claim: ClaimedReceiptOutbox }
  | {
      readonly _tag: "Failed";
      readonly claim: ClaimedReceiptOutbox;
      readonly failureTag: string;
    }
  /** The claim was recovered or replaced first, so its outcome was not recorded. */
  | { readonly _tag: "ClaimLost"; readonly effectId: string };

export const ReceiptOutboxDeliveryResult = Data.taggedEnum<ReceiptOutboxDeliveryResult>();
