// Apollo Server bootstrap (standalone mode).
//
// Teaching note: the server only knows about `typeDefs` (the contract) and
// `resolvers` (how to fulfill it). Prisma/Postgres live entirely inside the
// resolvers — Apollo never sees them.
import "dotenv/config";
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";

import { typeDefs } from "./schema.js";
import { resolvers } from "./resolvers.js";

const server = new ApolloServer({ typeDefs, resolvers });

const port = Number(process.env.PORT) || 4000;

const { url } = await startStandaloneServer(server, {
  listen: { port },
});

console.log(`🚀 GWU Research Discovery GraphQL ready at ${url}`);
