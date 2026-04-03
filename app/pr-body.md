Add per-section "Group by repo" toggle with visual dividers

# What was done:
- Added a per-section "Group by repo" toggle button in each section header (between filter and sort icons)
- When active, PRs are grouped alphabetically by repository with lightweight divider headers featuring a subtle background tint and border
- Within-group ordering follows the user's current sort preference
- Removed the "Repository (A-Z)" sort option from the sort menu (subsumed by grouping)
- Added migration logic: sections previously sorted by "repo-az" auto-enable grouping and fall back to default sort
- Preference persisted per-section in localStorage

# What was tested:

- Unit tests for `groupPrsByRepo` utility (alphabetical ordering, empty input)
- Unit tests for `readSectionGroupByRepoPreferences` storage reader (fresh state, stored prefs, migration from repo-az)
- Updated existing sort tests to reflect removal of `repo-az`
- TypeScript compiles clean (`tsc --noEmit`)
- All 144 unit tests pass

**Local QA**
- Verified grouped view renders repo headers with background tint between groups
- Verified ungrouped view shows flat PR list with no dividers
- Verified toggle button highlights blue when active
- Verified grouping persists across page reloads via localStorage

# Evidence

| Grouped (active) | Ungrouped (inactive) |
|---|---|
| ![grouped](https://raw.githubusercontent.com/maintainx-labs/ReviewRadar/b8c86d4/app/screenshots/group-by-repo-enabled.png) | ![ungrouped](https://raw.githubusercontent.com/maintainx-labs/ReviewRadar/b8c86d4/app/screenshots/group-by-repo-disabled.png) |
