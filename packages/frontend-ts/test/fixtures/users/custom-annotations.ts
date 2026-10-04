import { Annotate as RuntimeAnnotate, Operation as RuntimeOperation, Query } from "@effx/runtime";
import { Effect } from "effect";

// This module is compiler input, never imported or evaluated by the source frontend.
const rejectEvaluation = (): void => {
  throw new Error("application source was evaluated");
};

rejectEvaluation();

export class Decorated {
  @Query({ name: "Example.Read" })
  @RuntimeAnnotate("example.deprecated", { reason: "Use replacement", details: [1, true] })
  static read() {
    return Effect.succeed("read");
  }
}

export const Built = RuntimeOperation.query({ name: "Example.Read" })
  .annotate("example.deprecated", { reason: "Use replacement", details: [1, true] })
  .handler(() => Effect.succeed("read"));

const name = "example.deprecated";

const reason = () => "not a static argument";

export class Invalid {
  @Query({ name: "Example.BadName" })
  @RuntimeAnnotate(name, { reason: "not a literal name" })
  static nonliteral() {
    return Effect.succeed("read");
  }

  @Query({ name: "Example.BadArg" })
  @RuntimeAnnotate("example.deprecated", { reason: reason() })
  static argument() {
    return Effect.succeed("read");
  }

  @Query({ name: "Example.MissingName" })
  @RuntimeAnnotate()
  static missingName() {
    return Effect.succeed("read");
  }
}

export const InvalidBuilder = RuntimeOperation.query({ name: "Example.Invalid" })
  .annotate(name, { reason: "not a literal name" })
  .annotate("example.deprecated", { reason: reason() })
  .declare();

// Name and shape alone cannot make application-owned symbols into runtime syntax.
const Annotate: typeof RuntimeAnnotate = () => () => undefined;

const Operation = { query: RuntimeOperation.query };

export class Lookalike {
  @Annotate("example.fake", { reason: "ignored" })
  static read() {
    return Effect.succeed("read");
  }
}

export const FakeBuilder = Operation.query({ name: "Example.Fake" })
  .annotate("example.fake", { reason: "ignored" })
  .declare();
