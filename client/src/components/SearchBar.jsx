import { useState } from "react";

// Controlled input styled like a card-catalog lookup. Submits on Enter (or the
// button); the parent owns the "submitted query" so results only fetch on
// submit, not on every keystroke.
export default function SearchBar({ onSearch, initialValue = "" }) {
  const [value, setValue] = useState(initialValue);

  function handleSubmit(e) {
    e.preventDefault();
    onSearch(value.trim());
  }

  return (
    <form className="search-bar" onSubmit={handleSubmit} role="search">
      <label className="search-bar__label" htmlFor="faculty-search">
        Search the faculty catalog
      </label>
      <div className="search-bar__row">
        <input
          id="faculty-search"
          className="search-bar__input"
          type="search"
          name="query"
          autoComplete="off"
          placeholder="e.g. economics, computational biology, public health…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="search-bar__button" type="submit">
          Search
        </button>
      </div>
      <p className="search-bar__hint">
        Search across departments, titles, bios, and research interests.
      </p>
    </form>
  );
}
