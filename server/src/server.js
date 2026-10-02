// Builds the ApolloServer instance without starting an HTTP listener, so the
// same server can be booted by index.js (real traffic) or driven directly by
// the test suite via `server.executeOperation(...)`.
import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";

import { typeDefs } from "./schema.js";
import { resolvers } from "./resolvers.js";

export function createApolloServer() {
  return new ApolloServer({
    typeDefs,
    resolvers,
    // This is a public, read-only portfolio API, so keep the schema
    // explorable in production: introspection on + embedded Apollo Sandbox
    // as the landing page (Apollo disables both by default when
    // NODE_ENV=production).
    introspection: true,
    plugins: [ApolloServerPluginLandingPageLocalDefault({ embed: true })],
  });
}

// Mutations are open in local development (so you can play with useMutation
// and cache updates) but closed in production unless explicitly enabled.
// There is no auth layer in this version, so a deployed API with open
// mutations would let anyone delete the catalog.
export function mutationsAllowed(env = process.env) {
  if (env.ALLOW_MUTATIONS !== undefined) return env.ALLOW_MUTATIONS === "true";
  return env.NODE_ENV !== "production";
}
