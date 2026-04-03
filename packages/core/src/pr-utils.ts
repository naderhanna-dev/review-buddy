import type { PullRequest } from "./classification";
import type { SectionFilterState, SortPreference } from "./types";
import { sortByCreatedAt, sortByAuthor, sortByRepository, sortByLineChanges } from "./classification";

export function applySectionSort(
  prs: PullRequest[],
  preference: SortPreference,
): PullRequest[] {
  if (preference === "oldest-first") {
    return sortByCreatedAt(prs, "asc");
  }
  if (preference === "newest-first") {
    return sortByCreatedAt(prs, "desc");
  }
  if (preference === "author-az") {
    return sortByAuthor(prs);
  }
  if (preference === "repo-az") {
    return sortByRepository(prs);
  }
  if (preference === "line-changes-desc") {
    return sortByLineChanges(prs);
  }
  return prs;
}

export function applyDraftFilter(
  pullRequests: PullRequest[],
  hideDrafts: boolean,
): PullRequest[] {
  if (!hideDrafts) {
    return pullRequests;
  }
  return pullRequests.filter((pullRequest) => !pullRequest.isDraft);
}

export function applySectionFilter(
  prs: PullRequest[],
  filter: SectionFilterState,
): PullRequest[] {
  const { repository, checkStatus, labels, author } = filter;
  if (
    repository.size === 0 &&
    checkStatus.size === 0 &&
    labels.size === 0 &&
    author.size === 0
  ) {
    return prs;
  }
  return prs.filter((pr) => {
    if (repository.size > 0 && !repository.has(pr.repository)) return false;
    if (checkStatus.size > 0 && !checkStatus.has(pr.checkState)) return false;
    if (labels.size > 0) {
      const prLabels = pr.labels ?? [];
      if (!prLabels.some((l) => labels.has(l.name))) return false;
    }
    if (author.size > 0 && !author.has(pr.author)) return false;
    return true;
  });
}

export function formatRefreshAge(timestampMs: number, nowMs: number): string {
  const diffSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));

  if (diffSeconds < 5) {
    return "just now";
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours}h ago`;
}

export function sortByPriorityAndUpdated(
  prs: PullRequest[],
  priority: Record<string, number>,
): PullRequest[] {
  return [...prs].sort((a, b) => {
    const priorityDiff =
      (priority[a.stateClass] ?? 99) - (priority[b.stateClass] ?? 99);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return (
      new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime()
    );
  });
}
