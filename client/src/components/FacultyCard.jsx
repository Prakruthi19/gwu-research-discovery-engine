// Renders one search result as a "faculty index card".
//
// `matchedInterests` (lowercased into a Set) tells us which research-interest
// tags to render as accent-stamped "matched" tags vs. plain ones.
export default function FacultyCard({ faculty, matchedInterests = [] }) {
  const matched = new Set(matchedInterests.map((m) => m.toLowerCase()));
  const interests = faculty.researchInterests ?? [];

  return (
    <article className="faculty-card">
      <div className="faculty-card__header">
        {faculty.imageUrl ? (
          <img
            className="faculty-card__photo"
            src={faculty.imageUrl}
            alt=""
            loading="lazy"
          />
        ) : (
          <div className="faculty-card__photo faculty-card__photo--placeholder" aria-hidden="true">
            {faculty.name?.[0] ?? "?"}
          </div>
        )}
        <div className="faculty-card__heading">
          <h2 className="faculty-card__name">{faculty.name}</h2>
          {faculty.title && <p className="faculty-card__title">{faculty.title}</p>}
          <p className="faculty-card__meta">
            {faculty.department && <span>{faculty.department}</span>}
            {faculty.department && faculty.school && <span aria-hidden="true"> · </span>}
            {faculty.school && <span className="faculty-card__school">{faculty.school}</span>}
          </p>
        </div>
      </div>

      {faculty.bio && <p className="faculty-card__bio">{faculty.bio}</p>}

      {interests.length > 0 && (
        <ul className="tag-list" aria-label="Research interests">
          {interests.map((interest) => {
            const isMatched = matched.has(interest.name.toLowerCase());
            return (
              <li
                key={interest.id}
                className={`tag${isMatched ? " tag--matched" : ""}`}
              >
                {interest.name}
              </li>
            );
          })}
        </ul>
      )}

      <div className="faculty-card__footer">
        {faculty.email && (
          <a className="faculty-card__link" href={`mailto:${faculty.email}`}>
            {faculty.email}
          </a>
        )}
        {faculty.profileUrl && (
          <a
            className="faculty-card__link faculty-card__link--profile"
            href={faculty.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View profile ↗
          </a>
        )}
      </div>
    </article>
  );
}
