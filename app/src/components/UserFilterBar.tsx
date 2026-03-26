const MAX_VISIBLE = 7;

type FilterUser = {
  login: string;
  avatarUrl: string;
};

export function UserFilterBar({
  users,
  selectedLogin,
  onSelect,
}: {
  users: FilterUser[];
  selectedLogin: string | null;
  onSelect: (login: string | null) => void;
}) {
  if (users.length === 0) {
    return null;
  }

  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - MAX_VISIBLE;

  return (
    <div className="user-filter-bar" role="toolbar" aria-label="Filter by user">
      {visible.map((user) => {
        const isSelected = selectedLogin === user.login;
        return (
          <button
            key={user.login}
            type="button"
            className={`user-filter-avatar-btn${isSelected ? " user-filter-avatar--selected" : ""}`}
            title={isSelected ? `Clear filter (${user.login})` : `Filter by ${user.login}`}
            aria-pressed={isSelected}
            onClick={() => onSelect(isSelected ? null : user.login)}
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
