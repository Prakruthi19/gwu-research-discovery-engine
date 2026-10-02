// GraphQL SDL — the API contract.
//
// Teaching note: this schema is the ONLY thing clients see. It says nothing
// about Postgres, Prisma, tables, or joins. The resolvers (resolvers.js) are
// where this contract gets fulfilled by actually talking to the database.

export const typeDefs = /* GraphQL */ `
  type Faculty {
    id: ID!
    name: String!
    school: String
    department: String
    title: String
    email: String
    bio: String
    profileUrl: String!
    imageUrl: String
    researchInterests: [ResearchInterest!]!
  }

  type ResearchInterest {
    id: ID!
    name: String!
  }

  # Wraps a Faculty together with WHICH of their interests matched the search
  # query, so the UI can show *why* a result came back (the "matched" tags).
  type FacultySearchResult {
    faculty: Faculty!
    matchedInterests: [String!]!
  }

  type Query {
    allFaculty(department: String): [Faculty!]!
    facultyById(id: ID!): Faculty
    # The core feature: case-insensitive match across department/title/bio
    # and research-interest names.
    facultyBySearch(query: String!): [FacultySearchResult!]!
    allResearchInterests: [ResearchInterest!]!
    allDepartments: [String!]!
  }

  type Mutation {
    createFaculty(
      name: String!
      school: String
      department: String
      title: String
      email: String
      bio: String
      profileUrl: String!
      imageUrl: String
      researchInterests: [String!]
    ): Faculty!

    updateFaculty(
      id: ID!
      name: String
      school: String
      department: String
      title: String
      email: String
      bio: String
      imageUrl: String
    ): Faculty!

    deleteFaculty(id: ID!): Faculty!

    addResearchInterest(facultyId: ID!, name: String!): Faculty!
    removeResearchInterest(facultyId: ID!, name: String!): Faculty!
  }
`;
