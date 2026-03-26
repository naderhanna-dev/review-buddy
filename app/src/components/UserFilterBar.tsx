const MAX_VISIBLE = 7;

type FilterUser = {
  login: string;
  avatarUrl: string;
};

export function UserFilterBar({
  users,
  selectedLogins,
  onToggle,
}: {
  users: FilterUser[];
  selectedLogins: ReadonlySet<string>;
  onToggle: (login: string) => void;
}) {
  if (users.length === 0) {
    return null;
  }

  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - MAX_VISIBLE;
  const hasSelection = selectedLogins.size > 0;

  return (
    <div
      className={`user-filter-bar${hasSelection ? " user-filter-bar--active" : ""}`}
      role="toolbar"
      aria-label="Filter by user"
    >
      {visible.map((user) => {
        const isSelected = selectedLogins.has(user.login);
        return (
          <button
            key={user.login}
            type="button"
            className={`user-filter-avatar-btn${isSelected ? " user-filter-avatar--selected" : ""}`}
            title={isSelected ? `Remove ${user.login} from filter` : `Filter by ${user.login}`}
            aria-pressed={isSelected}
            onClick={() => onToggle(user.login)}
          >
            <img
              src={user.avatarUrl}
              className="avatar user-filter-avatar"
              alt={`${user.login} avatar`}
            />
          </button>
        );
      })}
      {overflow > 0 ? (
        <span className="user-filter-overflow" aria-label={`${overflow} more users`}>
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
