// A single shared PrismaClient for the whole process.
//
// Teaching note: do NOT `new PrismaClient()` per request — each instance
// opens its own connection pool and you'll exhaust Postgres connections.
// One instance, imported everywhere.
//
// Tip while learning the N+1 lesson: temporarily set `log: ["query"]` below
// and watch the SQL Prisma emits when you run a GraphQL query that asks for
// nested researchInterests. With the shared `include` (see resolvers.js) you
// should see ONE query per table, not one per faculty row.
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  // log: ["query"],
});
