import { Schema } from "effect";

export class ReceiptFileNotStaged extends Schema.TaggedError<ReceiptFileNotStaged>()(
  "ReceiptFileNotStaged",
  { effectId: Schema.String, fileRef: Schema.String },
) {}

export class ReceiptFileIdentityConflict extends Schema.TaggedError<ReceiptFileIdentityConflict>()(
  "ReceiptFileIdentityConflict",
  { effectId: Schema.String, objectKey: Schema.String },
) {}

export class ReceiptFileEffectConflict extends Schema.TaggedError<ReceiptFileEffectConflict>()(
  "ReceiptFileEffectConflict",
  { effectId: Schema.String },
) {}

export class ReceiptFileInjectedFailure extends Schema.TaggedError<ReceiptFileInjectedFailure>()(
  "ReceiptFileInjectedFailure",
  { effectId: Schema.String },
) {}

export type ReceiptFileFailure =
  | ReceiptFileNotStaged
  | ReceiptFileIdentityConflict
  | ReceiptFileEffectConflict
  | ReceiptFileInjectedFailure;
