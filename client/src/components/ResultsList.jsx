import { useQuery } from "@apollo/client/react";

import { SEARCH_FACULTY } from "../queries.js";
import FacultyCard from "./FacultyCard.jsx";

// Owns the actual data fetch. `skip: !query` means no network request happens
// until the user has actually searched for something.
export default function ResultsList({ query }) {
  const { data, loading, error } = useQuery(SEARCH_FACULTY, {
    variables: { query },
    skip: !query,
  });

  if (!query) {
    return (
      <section className="results results--idle">
        <p className="results__placeholder">
          Start by searching a research field above.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="results">
        <p className="results__status" role="status">
          Searching the catalog…
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="results">
        <p className="results__status results__status--error" role="alert">
          Something went wrong: {error.message}
        </p>
      </section>
    );
  }

  const results = data?.facultyBySearch ?? [];

  if (results.length === 0) {
    return (
      <section className="results">
        <p className="results__status">
          No matches for <strong>“{query}”</strong>. Try a broader term —
          the catalog is organized by research field (e.g. “economics”,
          “public health”, “computational biology”).
        </p>
      </section>
    );
  }

  return (
    <section className="results" aria-label="Search results">
      <p className="results__count">
        {results.length} {results.length === 1 ? "match" : "matches"} for{" "}
        <strong>“{query}”</strong>
      </p>
      <div className="results__list">
        {results.map((result) => (
          <FacultyCard
            key={result.faculty.id}
            faculty={result.faculty}
            matchedInterests={result.matchedInterests}
          />
        ))}
      </div>
    </section>
  );
}
