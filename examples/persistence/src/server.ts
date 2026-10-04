import { Layer } from "effect";
import { AppRoutes } from "../.effx/generated/http.ts";
import { database, seedUsers } from "./database.ts";
import { usersFromPort } from "./services.ts";
import { UsersDrizzle } from "./UsersDrizzle.ts";
import { UsersSql } from "./UsersSql.ts";

export const persistenceLayer = (adapter: "sql" | "drizzle") => {
  const store = Layer.effectDiscard(seedUsers).pipe(Layer.provideMerge(database));
  const port = (adapter === "sql" ? UsersSql : UsersDrizzle).pipe(Layer.provideMerge(store));

  return usersFromPort.pipe(Layer.provideMerge(port));
};

export const routes = (adapter: "sql" | "drizzle") =>
  AppRoutes.pipe(Layer.provide(persistenceLayer(adapter)));
