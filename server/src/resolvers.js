import { prisma } from "./prismaClient.js";

// --- The N+1 problem, and how this file avoids it ---------------------------
//
// A Faculty has many ResearchInterests through a join table. The NAIVE way to
// resolve `faculty { researchInterests { name } }` is: fetch N faculty, then
// fire one extra query per faculty to load its interests => 1 + N queries.
// That's the classic GraphQL "N+1 problem".
//
// We avoid it the simplest way Prisma allows: a shared `include` shape that
// eager-loads the join rows (and the interest on each) in the SAME round of
// queries. Prisma turns this into a small constant number of SQL statements
// regardless of how many faculty come back.
//
// The "next level" solution — when this app grows or fields get resolved at
// different times — is a DataLoader that batches + caches per request. We're
// deliberately NOT reaching for that yet; this include is enough to learn the
// shape of the problem first.
const FACULTY_WITH_INTERESTS = {
  include: {
    researchInterests: {
      include: { researchInterest: true },
    },
  },
};

// Prisma returns the join table verbatim:
//   faculty.researchInterests = [{ researchInterest: { id, name } }, ...]
// The GraphQL schema promises a flat [ResearchInterest!]!, so reshape it.
function flattenInterests(faculty) {
  if (!faculty) return faculty;
  return {
    ...faculty,
    researchInterests: faculty.researchInterests.map(
      (link) => link.researchInterest
    ),
  };
}

export const resolvers = {
  Query: {
    allFaculty: async (_parent, { department }) => {
      const faculty = await prisma.faculty.findMany({
        where: department ? { department } : undefined,
        orderBy: { name: "asc" },
        ...FACULTY_WITH_INTERESTS,
      });
      return faculty.map(flattenInterests);
    },

    facultyById: async (_parent, { id }) => {
      const faculty = await prisma.faculty.findUnique({
        where: { id: Number(id) },
        ...FACULTY_WITH_INTERESTS,
      });
      return flattenInterests(faculty);
    },

    // Core feature. Intentionally simple: case-insensitive `contains` across
    // a few text columns + interest names (Postgres ILIKE via Prisma's
    // `mode: "insensitive"`). NOT full-text search / embeddings — that's a
    // good v2 once the GraphQL plumbing is solid.
    facultyBySearch: async (_parent, { query }) => {
      const q = query.trim();
      if (!q) return [];

      const insensitive = { contains: q, mode: "insensitive" };
      const faculty = await prisma.faculty.findMany({
        where: {
          OR: [
            { department: insensitive },
            { title: insensitive },
            { bio: insensitive },
            { school: insensitive },
            { name: insensitive },
            {
              researchInterests: {
                some: { researchInterest: { name: insensitive } },
              },
            },
          ],
        },
        orderBy: { name: "asc" },
        ...FACULTY_WITH_INTERESTS,
      });

      const needle = q.toLowerCase();
      return faculty.map((f) => {
        const flat = flattenInterests(f);
        // Tell the UI which interests actually matched, so it can highlight
        // them as "rubber-stamped" tags.
        const matchedInterests = flat.researchInterests
          .map((i) => i.name)
          .filter((name) => name.toLowerCase().includes(needle));
        return { faculty: flat, matchedInterests };
      });
    },

    allResearchInterests: () =>
      prisma.researchInterest.findMany({ orderBy: { name: "asc" } }),

    allDepartments: async () => {
      const rows = await prisma.faculty.findMany({
        where: { department: { not: null } },
        distinct: ["department"],
        select: { department: true },
        orderBy: { department: "asc" },
      });
      return rows.map((r) => r.department);
    },
  },

  Mutation: {
    createFaculty: async (_parent, args) => {
      const { researchInterests = [], ...data } = args;
      const faculty = await prisma.faculty.create({
        data: {
          ...data,
          researchInterests: {
            // connectOrCreate dedupes interests by their unique `name`:
            // reuse the existing ResearchInterest row if present, else make it.
            create: researchInterests.map((name) => ({
              researchInterest: {
                connectOrCreate: {
                  where: { name },
                  create: { name },
                },
              },
            })),
          },
        },
        ...FACULTY_WITH_INTERESTS,
      });
      return flattenInterests(faculty);
    },

    updateFaculty: async (_parent, { id, ...data }) => {
      // Strip undefined so we only update fields the client actually sent.
      const clean = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined)
      );
      const faculty = await prisma.faculty.update({
        where: { id: Number(id) },
        data: clean,
        ...FACULTY_WITH_INTERESTS,
      });
      return flattenInterests(faculty);
    },

    deleteFaculty: async (_parent, { id }) => {
      // Join rows cascade-delete (onDelete: Cascade in schema.prisma).
      const faculty = await prisma.faculty.delete({
        where: { id: Number(id) },
        ...FACULTY_WITH_INTERESTS,
      });
      return flattenInterests(faculty);
    },

    addResearchInterest: async (_parent, { facultyId, name }) => {
      const fid = Number(facultyId);
      // 1) Ensure the interest exists (dedupe by unique name).
      const interest = await prisma.researchInterest.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      // 2) Ensure the join row exists (idempotent on the compound key).
      await prisma.facultyResearchInterest.upsert({
        where: {
          facultyId_researchInterestId: {
            facultyId: fid,
            researchInterestId: interest.id,
          },
        },
        update: {},
        create: { facultyId: fid, researchInterestId: interest.id },
      });
      const faculty = await prisma.faculty.findUnique({
        where: { id: fid },
        ...FACULTY_WITH_INTERESTS,
      });
      return flattenInterests(faculty);
    },

    removeResearchInterest: async (_parent, { facultyId, name }) => {
      const interest = await prisma.researchInterest.findUnique({
        where: { name },
      });
      if (interest) {
        await prisma.facultyResearchInterest.deleteMany({
          where: {
            facultyId: Number(facultyId),
            researchInterestId: interest.id,
          },
        });
      }
      const faculty = await prisma.faculty.findUnique({
        where: { id: Number(facultyId) },
        ...FACULTY_WITH_INTERESTS,
      });
      return flattenInterests(faculty);
    },
  },
};
