import { useEffect, useState } from "react";

import { apolloClient } from "./apolloClient.js";
import { PING } from "./queries.js";
import SearchBar from "./components/SearchBar.jsx";
import ResultsList from "./components/ResultsList.jsx";
import "./App.css";

// The submitted query lives in the URL (?q=...) so a search can be shared
// or bookmarked, and the browser back button steps through past searches.
function readQueryFromUrl() {
  return new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
}

export default function App() {
  // The *submitted* query. SearchBar holds the in-progress text; this only
  // updates on submit, so ResultsList fetches once per search, not per keypress.
  const [query, setQuery] = useState(readQueryFromUrl);

  useEffect(() => {
    // The free-tier API host sleeps when idle. Fire a trivial query on page
    // load so it starts waking up while the visitor is still typing.
    apolloClient.query({ query: PING, fetchPolicy: "no-cache" }).catch(() => {});

    const onPopState = () => setQuery(readQueryFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function search(next) {
    if (next === query) return;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("q", next);
    else url.searchParams.delete("q");
    window.history.pushState(null, "", url);
    setQuery(next);
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__inner">
          <p className="masthead__eyebrow">George Washington University</p>
          <h1 className="masthead__title">Research Discovery Engine</h1>
          <p className="masthead__subtitle">
            A catalog of GW faculty, searchable by research interest.
          </p>
        </div>
      </header>

      <main className="app__main">
        {/* key remounts the bar when the query changes from outside it
            (a suggestion click or back/forward), so its text stays in sync. */}
        <SearchBar key={query} onSearch={search} initialValue={query} />
        <ResultsList query={query} onSearch={search} />
      </main>

      <footer className="app__footer">
        <p>
          Data scraped from GW Faculty Profiles · Built with GraphQL, Apollo,
          Prisma &amp; PostgreSQL ·{" "}
          <a href="https://github.com/Prakruthi19/gwu-research-discovery-engine">
            Source on GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
