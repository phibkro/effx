import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { run } from "../.effx/generated/cli.ts";
import { Users } from "./services.ts";

run("0.0.0").pipe(
  Effect.provide(Layer.mergeAll(Users.layer, BunServices.layer)),
  BunRuntime.runMain,
);
