import { Predicate, Context, Effect, Layer } from "effect";
import { canonicalJsonBytes, sha256Hex } from "../shared-kernel/index.js";
import type { ReceiptOutboxRequest } from "./effects.js";
import {
  ReceiptFileEffectConflict,
  ReceiptFileIdentityConflict,
  ReceiptFileInjectedFailure,
  ReceiptFileNotStaged,
  type ReceiptFileFailure,
} from "./file-errors.js";
import type { ReceiptFile } from "./schema.js";

export type ReceiptFileRequest = Extract<
  ReceiptOutboxRequest,
  { readonly _tag: "PromoteReceiptFile" | "DeleteReceiptFile" }
>;

export interface ReceiptFileServiceOperations {
  readonly stage: (file: ReceiptFile) => Effect.Effect<void, ReceiptFileFailure>;
  readonly apply: (request: ReceiptFileRequest) => Effect.Effect<void, ReceiptFileFailure>;
}

export class ReceiptFileService extends Context.Service<
  ReceiptFileService,
  ReceiptFileServiceOperations
>()("@vektorprogrammet/domain/ReceiptFileService") {}

export interface ReceiptFileEvent {
  readonly effectId: string;
  readonly action: "Promoted" | "Deleted" | "DeleteNoop";
  readonly objectKey: string;
  readonly sha256: string;
}

export interface ReceiptFileRecordingSnapshot {
  readonly staged: ReadonlyArray<ReceiptFile>;
  readonly current: ReadonlyArray<ReceiptFile>;
  readonly deleted: ReadonlyArray<ReceiptFile>;
  readonly events: ReadonlyArray<ReceiptFileEvent>;
  readonly appliedEffectIds: ReadonlyArray<string>;
  readonly conflictedIdentities: ReadonlyArray<string>;
}

interface RecordingState {
  staged: ReceiptFile[];
  current: ReceiptFile[];
  deleted: ReceiptFile[];
  events: ReceiptFileEvent[];
  conflicts: string[];
  applied: Map<string, string>;
  failOnce: Set<string>;
}

const sameIdentity = (left: ReceiptFile, right: ReceiptFile): boolean =>
  left.fileRef === right.fileRef &&
  left.objectKey === right.objectKey &&
  left.contentType === right.contentType &&
  left.byteLength === right.byteLength &&
  left.sha256 === right.sha256;

const sortedFiles = (files: ReadonlyArray<ReceiptFile>): ReadonlyArray<ReceiptFile> =>
  files.toSorted((left, right) => left.objectKey.localeCompare(right.objectKey));

export interface ReceiptFileRecordingControl {
  readonly layer: Layer.Layer<ReceiptFileService>;
  readonly failNext: (effectId: string) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ReceiptFileRecordingSnapshot>;
}

export const makeReceiptFileRecording = (): ReceiptFileRecordingControl => {
  const state: RecordingState = {
    staged: [],
    current: [],
    deleted: [],
    events: [],
    conflicts: [],
    applied: new Map(),
    failOnce: new Set(),
  };

  const service: ReceiptFileServiceOperations = {
    stage: (file) =>
      Effect.gen(function* () {
        const occupiedStaged = state.staged.find(
          (candidate) =>
            candidate.fileRef === file.fileRef || candidate.objectKey === file.objectKey,
        );

        const occupiedCurrent = state.current.find(
          (candidate) =>
            candidate.fileRef === file.fileRef || candidate.objectKey === file.objectKey,
        );

        if (
          (occupiedStaged !== undefined && !sameIdentity(occupiedStaged, file)) ||
          occupiedCurrent !== undefined
        ) {
          state.conflicts.push(`stage:${file.fileRef}:${file.objectKey}`);

          return yield* new ReceiptFileIdentityConflict({
            effectId: "stage",
            objectKey: file.objectKey,
          });
        }

        if (occupiedStaged === undefined) state.staged.push(file);
      }),
    apply: (request) =>
      Effect.gen(function* () {
        const digest = sha256Hex(canonicalJsonBytes(request));
        const appliedDigest = state.applied.get(request.effectId);

        if (appliedDigest !== undefined) {
          if (appliedDigest !== digest) {
            state.conflicts.push(`effect:${request.effectId}`);

            return yield* new ReceiptFileEffectConflict({ effectId: request.effectId });
          }

          return;
        }

        if (state.failOnce.delete(request.effectId)) {
          return yield* new ReceiptFileInjectedFailure({ effectId: request.effectId });
        }

        if (Predicate.isTagged(request, "PromoteReceiptFile")) {
          const staged = state.staged.find(
            (candidate) => candidate.fileRef === request.file.fileRef,
          );

          if (staged === undefined || !sameIdentity(staged, request.file)) {
            return yield* new ReceiptFileNotStaged({
              effectId: request.effectId,
              fileRef: request.file.fileRef,
            });
          }

          const current = state.current.find(
            (candidate) => candidate.objectKey === request.file.objectKey,
          );

          if (current !== undefined && !sameIdentity(current, request.file)) {
            state.conflicts.push(`identity:${request.effectId}:${request.file.objectKey}`);

            return yield* new ReceiptFileIdentityConflict({
              effectId: request.effectId,
              objectKey: request.file.objectKey,
            });
          }

          state.staged = state.staged.filter(
            (candidate) => candidate.fileRef !== request.file.fileRef,
          );

          if (current === undefined) state.current.push(request.file);
          state.events.push({
            effectId: request.effectId,
            action: "Promoted",
            objectKey: request.file.objectKey,
            sha256: request.file.sha256,
          });
        } else {
          const current = state.current.find(
            (candidate) => candidate.objectKey === request.file.objectKey,
          );

          if (current !== undefined && !sameIdentity(current, request.file)) {
            state.conflicts.push(`identity:${request.effectId}:${request.file.objectKey}`);

            return yield* new ReceiptFileIdentityConflict({
              effectId: request.effectId,
              objectKey: request.file.objectKey,
            });
          }

          if (current === undefined) {
            state.events.push({
              effectId: request.effectId,
              action: "DeleteNoop",
              objectKey: request.file.objectKey,
              sha256: request.file.sha256,
            });
          } else {
            state.current = state.current.filter(
              (candidate) => candidate.objectKey !== request.file.objectKey,
            );
            state.deleted.push(request.file);
            state.events.push({
              effectId: request.effectId,
              action: "Deleted",
              objectKey: request.file.objectKey,
              sha256: request.file.sha256,
            });
          }
        }

        state.applied.set(request.effectId, digest);
      }),
  };

  return {
    layer: Layer.succeed(ReceiptFileService)(service),
    failNext: (effectId) => Effect.sync(() => void state.failOnce.add(effectId)),
    snapshot: Effect.sync(() => ({
      staged: sortedFiles(state.staged),
      current: sortedFiles(state.current),
      deleted: sortedFiles(state.deleted),
      events: [...state.events],
      appliedEffectIds: [...state.applied.keys()].toSorted(),
      conflictedIdentities: [...state.conflicts].toSorted(),
    })),
  };
};
