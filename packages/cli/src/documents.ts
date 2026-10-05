import { Effect, FileSystem, Option, Path, Predicate, Result, Schema } from "effect";

export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface TextRange {
  readonly start: Position;
  readonly end: Position;
}

export interface TextChange {
  readonly text: string;
  readonly range?: TextRange;
}

export interface OpenDocument {
  readonly uri: string;
  /** Logical absolute filename used by the compiler. */
  readonly file: string;
  /** Caller-resolved physical identity, including the existing parent for a new file. */
  readonly identity: string;
  readonly version: number;
  readonly text: string;
  readonly instance: number;
}

export class DocumentError extends Schema.TaggedError<DocumentError>()("DocumentError", {
  reason: Schema.Literals([
    "Closed",
    "AlreadyOpen",
    "Alias",
    "NotOpen",
    "Version",
    "Range",
    "Limit",
    "URI",
  ]),
  uri: Schema.String,
  message: Schema.String,
}) {}

const invalidRange = (uri: string, message: string): DocumentError =>
  new DocumentError({ reason: "Range", uri, message });

/** LSP offsets count UTF-16 units; CRLF is one line break. No clamping of invalid edits. */
export const offsetAt = (
  text: string,
  position: Position,
  uri: string,
): Result.Result<number, DocumentError> => {
  if (
    !Number.isInteger(position.line) ||
    !Number.isInteger(position.character) ||
    position.line < 0 ||
    position.character < 0
  ) {
    return Result.fail(invalidRange(uri, "Edit positions must be nonnegative integers"));
  }

  let line = 0;
  let start = 0;

  while (line < position.line) {
    let end = start;

    while (end < text.length && text.charCodeAt(end) !== 10 && text.charCodeAt(end) !== 13) end++;

    if (end === text.length)
      return Result.fail(invalidRange(uri, "Edit line is outside the document"));
    start = end + (text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? 2 : 1);
    line++;
  }

  let end = start;

  while (end < text.length && text.charCodeAt(end) !== 10 && text.charCodeAt(end) !== 13) end++;

  if (position.character > end - start) {
    return Result.fail(invalidRange(uri, "Edit character is outside the line"));
  }

  const offset = start + position.character;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);

  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
    return Result.fail(invalidRange(uri, "Edit position splits a UTF-16 surrogate pair"));
  }

  return Result.succeed(offset);
};

/** Changes in one notification apply sequentially to the previous change's text. */
export const applyChanges = (
  original: string,
  changes: ReadonlyArray<TextChange>,
  uri: string,
): Result.Result<string, DocumentError> => {
  let text = original;

  for (const change of changes) {
    if (change.range === undefined) {
      text = change.text;
      continue;
    }

    const start = offsetAt(text, change.range.start, uri);

    if (Result.isFailure(start)) return Result.fail(start.failure);
    const end = offsetAt(text, change.range.end, uri);

    if (Result.isFailure(end)) return Result.fail(end.failure);

    if (end.success < start.success) {
      return Result.fail(invalidRange(uri, "Edit range ends before it starts"));
    }

    text = text.slice(0, start.success) + change.text + text.slice(end.success);
  }

  return Result.succeed(text);
};

export interface Documents {
  readonly open: (
    document: Omit<OpenDocument, "instance">,
  ) => Effect.Effect<OpenDocument, DocumentError>;
  readonly change: (
    uri: string,
    version: number,
    changes: ReadonlyArray<TextChange>,
  ) => Effect.Effect<OpenDocument, DocumentError>;
  readonly close: (uri: string) => Effect.Effect<Option.Option<OpenDocument>, DocumentError>;
  readonly get: (uri: string) => Effect.Effect<Option.Option<OpenDocument>>;
  readonly snapshot: Effect.Effect<ReadonlyMap<string, OpenDocument>>;
  readonly clear: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
}

/** The caller owns identity resolution; this scope owns current text and open-instance versions. */
export const makeDocuments = (
  limits: {
    readonly count?: number;
    readonly textUnits?: number;
    /** Runs in the atomic mutation turn, before any analysis can publish. */
    readonly onMutation?: () => void;
  } = {},
) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const documents = new Map<string, OpenDocument>();
      const identities = new Map<string, string>();
      const maxCount = limits.count ?? 128;
      const maxTextUnits = limits.textUnits ?? 16 * 1024 * 1024;
      let textUnits = 0;
      let instance = 0;
      let closed = false;

      const clear = Effect.sync(() => {
        documents.clear();
        identities.clear();
        textUnits = 0;
        limits.onMutation?.();
      });

      const shutdown = Effect.sync(() => {
        if (closed) return;
        closed = true;
        documents.clear();
        identities.clear();
        textUnits = 0;
        limits.onMutation?.();
      });

      const ensureOpen = (uri: string): Result.Result<void, DocumentError> =>
        closed
          ? Result.fail(
              new DocumentError({ reason: "Closed", uri, message: "Document owner is closed" }),
            )
          : Result.succeed(undefined);

      const open = (input: Omit<OpenDocument, "instance">) =>
        Effect.suspend(() => {
          const available = ensureOpen(input.uri);

          if (Result.isFailure(available)) return Effect.fail(available.failure);

          if (documents.has(input.uri)) {
            return Effect.fail(
              new DocumentError({
                reason: "AlreadyOpen",
                uri: input.uri,
                message: "Document is already open",
              }),
            );
          }

          if (identities.has(input.identity)) {
            return Effect.fail(
              new DocumentError({
                reason: "Alias",
                uri: input.uri,
                message: "Another open URI owns this file identity",
              }),
            );
          }

          if (!Number.isInteger(input.version)) {
            return Effect.fail(
              new DocumentError({
                reason: "Version",
                uri: input.uri,
                message: "Document version must be an integer",
              }),
            );
          }

          if (documents.size >= maxCount || textUnits + input.text.length > maxTextUnits) {
            return Effect.fail(
              new DocumentError({
                reason: "Limit",
                uri: input.uri,
                message: "Open document admission limit exceeded",
              }),
            );
          }

          const document: OpenDocument = { ...input, instance: ++instance };
          documents.set(input.uri, document);
          identities.set(input.identity, input.uri);
          textUnits += input.text.length;
          limits.onMutation?.();

          return Effect.succeed(document);
        });

      const change = (uri: string, version: number, changes: ReadonlyArray<TextChange>) =>
        Effect.suspend(() => {
          const available = ensureOpen(uri);

          if (Result.isFailure(available)) return Effect.fail(available.failure);
          const previous = documents.get(uri);

          if (previous === undefined) {
            return Effect.fail(
              new DocumentError({ reason: "NotOpen", uri, message: "Document is not open" }),
            );
          }

          if (!Number.isInteger(version) || version <= previous.version) {
            return Effect.fail(
              new DocumentError({
                reason: "Version",
                uri,
                message: "Document version must increase",
              }),
            );
          }

          const updated = applyChanges(previous.text, changes, uri);

          if (Result.isFailure(updated)) return Effect.fail(updated.failure);
          const nextUnits = textUnits - previous.text.length + updated.success.length;

          if (nextUnits > maxTextUnits) {
            return Effect.fail(
              new DocumentError({
                reason: "Limit",
                uri,
                message: "Open document admission limit exceeded",
              }),
            );
          }

          const document: OpenDocument = { ...previous, version, text: updated.success };
          documents.set(uri, document);
          textUnits = nextUnits;
          limits.onMutation?.();

          return Effect.succeed(document);
        });

      const close = (uri: string) =>
        Effect.suspend(() => {
          const available = ensureOpen(uri);

          if (Result.isFailure(available)) return Effect.fail(available.failure);
          const document = documents.get(uri);

          if (document === undefined) return Effect.succeedNone;
          documents.delete(uri);
          identities.delete(document.identity);
          textUnits -= document.text.length;
          limits.onMutation?.();

          return Effect.succeedSome(document);
        });

      const value: Documents = {
        open,
        change,
        close,
        get: (uri) => Effect.sync(() => Option.fromNullishOr(documents.get(uri))),
        snapshot: Effect.sync(() => new Map(documents)),
        clear,
        shutdown,
      };

      return { value, release: shutdown };
    }),
    (owner) => owner.release,
  ).pipe(Effect.map((owner) => owner.value));

/** Keep the client URI/logical filename; resolve only the ownership identity. */
export const canonicalDocument = Effect.fnUntraced(function* (uri: string) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const url = yield* Effect.try({
    try: () => new URL(uri),
    catch: () => new DocumentError({ reason: "URI", uri, message: "Document URI is invalid" }),
  });

  const file = path.resolve(
    yield* path.fromFileUrl(url).pipe(
      Effect.mapError(
        () =>
          new DocumentError({
            reason: "URI",
            uri,
            message: "Document URI must name a local file",
          }),
      ),
    ),
  );

  let candidate = file;
  const suffix: Array<string> = [];

  for (;;) {
    const physical = yield* fs
      .realPath(candidate)
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));

    if (Predicate.isString(physical))
      return { uri, file, identity: path.join(physical, ...suffix.reverse()) };
    const parent = path.dirname(candidate);

    if (parent === candidate)
      return yield* new DocumentError({
        reason: "URI",
        uri,
        message: "Document has no existing file identity parent",
      });
    suffix.push(path.basename(candidate));
    candidate = parent;
  }
});
