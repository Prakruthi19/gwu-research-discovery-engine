// Apollo Server bootstrap (standalone mode).
//
// Teaching note: the server only knows about `typeDefs` (the contract) and
// `resolvers` (how to fulfill it). Prisma/Postgres live entirely inside the
// resolvers — Apollo never sees them.
import "dotenv/config";
import { startStandaloneServer } from "@apollo/server/standalone";

import { createApolloServer, mutationsAllowed } from "./server.js";

const server = createApolloServer();

const port = Number(process.env.PORT) || 4000;
const allowMutations = mutationsAllowed();

const { url } = await startStandaloneServer(server, {
  listen: { port },
  // Per-request context, available to every resolver as its 3rd argument.
  context: async () => ({ allowMutations }),
});

console.log(`🚀 GWU Research Discovery GraphQL ready at ${url}`);
console.log(`   mutations ${allowMutations ? "ENABLED" : "disabled (read-only)"}`);
