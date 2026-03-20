import './App.css'

type PullRequest = {
  id: number
  title: string
  repository: string
  author: string
  updatedAt: string
  stateLabel: string
  reason: string
  isDraft?: boolean
}

const needsAttention: PullRequest[] = [
  {
    id: 418,
    title: 'feat: add SLA status chips to pull request cards',
    repository: 'acme/review-radar',
    author: 'laura-dev',
    updatedAt: '12 minutes ago',
    stateLabel: 'Changes requested',
    reason: 'You are a required reviewer',
  },
  {
    id: 401,
    title: 'refactor: simplify org repository sync pipeline',
    repository: 'acme/review-radar',
    author: 'mike-api',
    updatedAt: '1 hour ago',
    stateLabel: 'Updated since review',
    reason: 'New commits were pushed after your last review',
  },
]

const relatedToYou: PullRequest[] = [
  {
    id: 387,
    title: 'fix: reduce noise in notification digest',
    repository: 'acme/notification-hub',
    author: 'nora-ui',
    updatedAt: '25 minutes ago',
    stateLabel: 'Team review',
    reason: 'Requested from @acme/reviewers-platform',
  },
  {
    id: 372,
    title: 'chore: add lazy caching to label endpoint',
    repository: 'acme/review-radar',
    author: 'ben-ops',
    updatedAt: '3 hours ago',
    stateLabel: 'Updated',
    reason: 'You viewed this PR without submitting a review',
    isDraft: true,
  },
]

function PullRequestRow({ pr }: { pr: PullRequest }) {
  const statusClass = pr.stateLabel.toLowerCase().replace(/\s+/g, '-')

  return (
    <article className="pr-row">
      <div className="title-group">
        <div>
          <a href="#" className="pr-title">
            {pr.isDraft ? '[Draft] ' : ''}
            {pr.title}
          </a>
          <p className="pr-meta">
            #{pr.id} opened by {pr.author} in {pr.repository}
          </p>
        </div>
      </div>
      <div className="status-group">
        <span className={`pill ${statusClass}`}>{pr.stateLabel}</span>
        <span className="updated-at">{pr.updatedAt}</span>
      </div>
      <p className="reason">{pr.reason}</p>
    </article>
  )
}

function App() {
  return (
    <main className="app-shell">
      <header className="page-header">
        <h1>ReviewRadar</h1>
        <p>Pull requests ranked by what needs your attention first.</p>
      </header>

      <section className="section-card">
        <div className="section-header">
          <h2>Needs your attention</h2>
          <span>{needsAttention.length}</span>
        </div>
        <div>
          {needsAttention.map((pr) => (
            <PullRequestRow key={pr.id} pr={pr} />
          ))}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <h2>Related to you</h2>
          <span>{relatedToYou.length}</span>
        </div>
        <div>
          {relatedToYou.map((pr) => (
            <PullRequestRow key={pr.id} pr={pr} />
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
