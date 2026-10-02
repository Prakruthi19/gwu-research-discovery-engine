import { useState } from "react";

import SearchBar from "./components/SearchBar.jsx";
import ResultsList from "./components/ResultsList.jsx";
import "./App.css";

export default function App() {
  // The *submitted* query. SearchBar holds the in-progress text; this only
  // updates on submit, so ResultsList fetches once per search, not per keypress.
  const [query, setQuery] = useState("");

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
        <SearchBar onSearch={setQuery} />
        <ResultsList query={query} />
      </main>

      <footer className="app__footer">
        <p>
          Data scraped from GW Faculty Profiles · Built with GraphQL, Apollo,
          Prisma &amp; PostgreSQL
        </p>
      </footer>
    </div>
  );
}
