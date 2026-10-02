import { useEffect, useState } from "react";
import { useQuery } from "@apollo/client/react";

import { SEARCH_FACULTY } from "../queries.js";
import FacultyCard from "./FacultyCard.jsx";

const SUGGESTIONS = [
  "Machine learning",
  "Public health",
  "Economics",
  "Computational biology",
  "Cryptography",
];

// The API runs on a free host that sleeps when idle; the first request after
// a nap can take ~30-60s. After this long, explain the wait instead of
// leaving the visitor staring at a spinner.
const SLOW_MS = 4000;

function useIsSlow(active) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!active) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [active]);
  return slow;
}

// Owns the actual data fetch. `skip: !query` means no network request happens
// until the user has actually searched for something.
export default function ResultsList({ query, onSearch }) {
  const { data, loading, error } = useQuery(SEARCH_FACULTY, {
    variables: { query },
    skip: !query,
  });
  const slow = useIsSlow(Boolean(query) && loading);

  if (!query) {
    return (
      <section className="results results--idle">
        <p className="results__placeholder">
          Start by searching a research field above, or try one of these:
        </p>
        <ul className="suggestions" aria-label="Suggested searches">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="suggestions__item"
                onClick={() => onSearch(s)}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="results">
        <p className="results__status" role="status">
          Searching the catalog…
          {slow && (
            <span className="results__note">
              The API sleeps when nobody is using it, so the first search can
              take up to a minute while it wakes up. Thanks for waiting.
            </span>
          )}
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
