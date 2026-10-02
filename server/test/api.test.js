// API integration tests: real GraphQL operations, real resolvers, real
// Postgres. Requires DATABASE_URL pointing at a migrated + seeded database
// (`npx prisma migrate deploy && npm run seed` with no scraped data, so the
// built-in sample faculty are loaded). CI does exactly that.
//
// `executeOperation` runs a request through the full Apollo pipeline
// (parsing, validation, resolvers) without opening an HTTP port.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { createApolloServer, mutationsAllowed } from "../src/server.js";
import { prisma } from "../src/prismaClient.js";

const server = createApolloServer();

before(() => server.start());
after(async () => {
  await server.stop();
  await prisma.$disconnect();
});

async function run(query, variables = {}, { allowMutations = false } = {}) {
  const res = await server.executeOperation(
    { query, variables },
    { contextValue: { allowMutations } }
  );
  assert.equal(res.body.kind, "single");
  return res.body.singleResult;
}

const SEARCH = /* GraphQL */ `
  query ($query: String!) {
    facultyBySearch(query: $query) {
      matchedInterests
      faculty { name researchInterests { name } }
    }
  }
`;

test("search matches research interests case-insensitively", async () => {
  const { data, errors } = await run(SEARCH, { query: "MACHINE learning" });
  assert.equal(errors, undefined);
  const names = data.facultyBySearch.map((r) => r.faculty.name);
  assert.ok(names.includes("Tian Lan"));
  assert.ok(names.includes("Claire Monteleoni"));
  for (const r of data.facultyBySearch) {
    assert.deepEqual(r.matchedInterests, ["Machine learning"]);
  }
});

test("search also matches non-interest fields, with no stamped tags", async () => {
  const { data } = await run(SEARCH, { query: "Chair" });
  assert.equal(data.facultyBySearch.length, 1);
  assert.equal(data.facultyBySearch[0].faculty.name, "Robert Pless");
  assert.deepEqual(data.facultyBySearch[0].matchedInterests, []);
});

test("blank search returns nothing instead of the whole catalog", async () => {
  const { data } = await run(SEARCH, { query: "   " });
  assert.deepEqual(data.facultyBySearch, []);
});

test("over-long search is rejected as bad input", async () => {
  const { errors } = await run(SEARCH, { query: "x".repeat(101) });
  assert.equal(errors[0].extensions.code, "BAD_USER_INPUT");
});

test("allDepartments returns distinct sorted departments", async () => {
  const { data } = await run(`{ allDepartments }`);
  assert.deepEqual(data.allDepartments, [
    "Computer Science",
    "Electrical and Computer Engineering",
  ]);
});

test("mutations are refused when the context is read-only", async () => {
  const { id } = await prisma.faculty.findFirstOrThrow();
  const { data, errors } = await run(
    `mutation ($id: ID!) { deleteFaculty(id: $id) { id } }`,
    { id }
  );
  assert.equal(data, null);
  assert.equal(errors[0].extensions.code, "FORBIDDEN");
  assert.equal(await prisma.faculty.count({ where: { id } }), 1);
});

test("create → add interest → delete round trip when mutations are allowed", async () => {
  const opts = { allowMutations: true };
  const created = await run(
    `mutation ($url: String!) {
       createFaculty(name: "Test Person", profileUrl: $url, researchInterests: ["Machine learning"]) {
         id researchInterests { name }
       }
     }`,
    { url: `https://example.test/${Date.now()}` },
    opts
  );
  assert.equal(created.errors, undefined);
  const { id } = created.data.createFaculty;

  const added = await run(
    `mutation ($id: ID!) { addResearchInterest(facultyId: $id, name: "Testing") { researchInterests { name } } }`,
    { id },
    opts
  );
  const interests = added.data.addResearchInterest.researchInterests.map((i) => i.name);
  assert.deepEqual(interests.sort(), ["Machine learning", "Testing"]);

  const deleted = await run(
    `mutation ($id: ID!) { deleteFaculty(id: $id) { id } }`,
    { id },
    opts
  );
  assert.equal(deleted.data.deleteFaculty.id, id);
  // "Machine learning" must be reused (connectOrCreate), not duplicated.
  assert.equal(
    await prisma.researchInterest.count({ where: { name: "Machine learning" } }),
    1
  );
  await prisma.researchInterest.deleteMany({ where: { name: "Testing" } });
});

test("mutationsAllowed: open in dev, closed in production, explicit flag wins", () => {
  assert.equal(mutationsAllowed({}), true);
  assert.equal(mutationsAllowed({ NODE_ENV: "production" }), false);
  assert.equal(mutationsAllowed({ NODE_ENV: "production", ALLOW_MUTATIONS: "true" }), true);
  assert.equal(mutationsAllowed({ ALLOW_MUTATIONS: "false" }), false);
});
