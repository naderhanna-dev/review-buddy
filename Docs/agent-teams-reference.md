# Agent Teams — Master Reference Guide

> Coordinate multiple Claude Code instances working together as a team, with shared tasks, inter-agent messaging, and centralized management.

**Status**: Experimental — disabled by default. Requires Claude Code v2.1.32+.

---

## Table of Contents

1. [Enabling Agent Teams](#1-enabling-agent-teams)
2. [Architecture](#2-architecture)
3. [When to Use Agent Teams](#3-when-to-use-agent-teams)
4. [Subagents vs Agent Teams](#4-subagents-vs-agent-teams)
5. [Starting a Team](#5-starting-a-team)
6. [Display Modes](#6-display-modes)
7. [Controlling the Team](#7-controlling-the-team)
8. [Task System](#8-task-system)
9. [Communication](#9-communication)
10. [Permissions](#10-permissions)
11. [Hooks for Agent Teams](#11-hooks-for-agent-teams)
12. [Token Costs](#12-token-costs)
13. [Best Practices](#13-best-practices)
14. [Use Case Patterns](#14-use-case-patterns)
15. [Troubleshooting](#15-troubleshooting)
16. [Known Limitations](#16-known-limitations)

---

## 1. Enabling Agent Teams

Set in `.claude/settings.local.json` (project-local, not committed):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Or set it in the shell environment: `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

---

## 2. Architecture

An agent team has four components:

| Component     | Role                                                                                          |
| :------------ | :-------------------------------------------------------------------------------------------- |
| **Team lead** | The main Claude Code session. Creates the team, spawns teammates, coordinates work.           |
| **Teammates** | Separate Claude Code instances. Each has its own context window and works on assigned tasks.  |
| **Task list** | Shared list of work items. Teammates claim and complete tasks. Supports dependency ordering.  |
| **Mailbox**   | Messaging system for direct agent-to-agent communication.                                     |

**Storage locations:**
- Team config: `~/.claude/teams/{team-name}/config.json`
  - Contains a `members` array with each teammate's name, agent ID, and agent type.
  - Teammates can read this file to discover other team members.
- Task list: `~/.claude/tasks/{team-name}/`

**Key constraint**: Each teammate's context window is completely separate. The lead's conversation history does NOT carry over to teammates.

---

## 3. When to Use Agent Teams

**Strong use cases (parallel exploration adds real value):**
- Research and review where multiple perspectives investigate simultaneously then challenge findings
- New independent modules/features where teammates each own a separate piece
- Debugging with competing hypotheses — test different theories in parallel
- Cross-layer changes spanning frontend, backend, and tests, each owned by a different teammate

**Poor use cases (use a single session or subagents instead):**
- Sequential tasks where step B depends on step A
- Same-file edits (risk of overwrites)
- Work with many interdependencies
- Simple, focused tasks where only the result matters

Agent teams add coordination overhead and use significantly more tokens than a single session.

---

## 4. Subagents vs Agent Teams

| Property          | Subagents                                             | Agent Teams                                            |
| :---------------- | :---------------------------------------------------- | :----------------------------------------------------- |
| **Context**       | Own context window; results return to the caller      | Own context window; fully independent                  |
| **Communication** | Report results back to the main agent only            | Teammates message each other directly                  |
| **Coordination**  | Main agent manages all work                           | Shared task list with self-coordination                |
| **Best for**      | Focused tasks where only the result matters           | Complex work requiring discussion and collaboration    |
| **Token cost**    | Lower — results summarized back to main context       | Higher — each teammate is a separate Claude instance   |

**Rule of thumb**: Use subagents when workers only need to report back. Use agent teams when teammates need to share findings, challenge each other, and coordinate on their own.

---

## 5. Starting a Team

After enabling, describe the task and desired team structure in natural language. Claude decides whether to spawn a team, or you can request one explicitly:

```
I'm designing a CLI tool that helps developers track TODO comments across
their codebase. Create an agent team to explore this from different angles:
one teammate on UX, one on technical architecture, one playing devil's advocate.
```

Claude will:
1. Create the team with a shared task list
2. Spawn teammates for each role
3. Have them explore the problem
4. Synthesize findings
5. Attempt to clean up the team when finished

**Claude won't create a team without your approval.** It may proactively suggest a team if it determines the task benefits from parallel work.

Specify model or teammate count explicitly:
```
Create a team with 4 teammates to refactor these modules in parallel.
Use Sonnet for each teammate.
```

---

## 6. Display Modes

### In-process (default fallback)
- All teammates run inside the main terminal
- `Shift+Down` to cycle through teammates
- Type to message the active teammate
- Works in any terminal — no extra setup
- `Ctrl+T` to toggle the task list
- `Escape` to interrupt a teammate's current turn

### Split panes (tmux / iTerm2)
- Each teammate gets its own pane
- See all output simultaneously
- Click a pane to interact directly
- Requires tmux or iTerm2 with `it2` CLI

### Configuration

**Global config** (`~/.claude.json`):
```json
{
  "teammateMode": "in-process"
}
```

Valid values: `"in-process"`, `"tmux"`, `"auto"` (default — uses split panes inside tmux, in-process otherwise)

**Per-session flag:**
```bash
claude --teammate-mode in-process
```

**tmux notes**: Known limitations on some OSes. Works best on macOS. Use `tmux -CC` in iTerm2 as the recommended entry point.

**Split-pane requirements:**
- tmux: install via package manager
- iTerm2: install `it2` CLI + enable Python API in iTerm2 → Settings → General → Magic → Enable Python API

Split-pane mode is NOT supported in VS Code integrated terminal, Windows Terminal, or Ghostty.

---

## 7. Controlling the Team

All control is via natural language to the lead. The lead handles coordination, task assignment, and delegation.

### Require plan approval before a teammate implements
```
Spawn an architect teammate to refactor the authentication module.
Require plan approval before they make any changes.
```
The teammate works in read-only plan mode → submits plan to lead → lead approves or rejects with feedback → cycle repeats until approved → teammate exits plan mode and implements.

Influence lead approval criteria in the prompt:
```
Only approve plans that include test coverage.
Reject plans that modify the database schema.
```

### Talk to a teammate directly
- In-process: `Shift+Down` to reach them, then type
- Split-pane: click into their pane

### Shut down a specific teammate
```
Ask the researcher teammate to shut down
```
The lead sends a shutdown request. Teammate can approve (exits gracefully) or reject with explanation.

### Clean up the entire team
```
Clean up the team
```
Removes shared team resources. Fails if any teammates are still running (shut them down first).

**Always use the lead to clean up.** Teammates should not run cleanup — their team context may not resolve correctly.

---

## 8. Task System

### Task states
- **Pending**: available to claim
- **In progress**: claimed by a teammate
- **Completed**: done

### Task dependencies
Tasks can depend on other tasks. A pending task with unresolved dependencies cannot be claimed until those dependencies complete. The system unblocks dependent tasks automatically when prerequisites complete — no manual intervention needed.

### Task claiming
- **Lead assigns**: tell the lead which task to give which teammate
- **Self-claim**: after finishing a task, a teammate picks up the next unassigned, unblocked task automatically

Task claiming uses **file locking** to prevent race conditions when multiple teammates try to claim the same task simultaneously.

### Sizing tasks correctly
| Size      | Problem                                                    |
| :-------- | :--------------------------------------------------------- |
| Too small | Coordination overhead exceeds the benefit                  |
| Too large | Teammates run too long without check-ins; risk of wasted effort |
| Just right | Self-contained unit with a clear deliverable (a function, a test file, a review) |

Target **5-6 tasks per teammate**. If the lead isn't creating enough tasks, tell it to split the work into smaller pieces.

---

## 9. Communication

### Context at spawn
Each teammate receives at spawn:
- Project CLAUDE.md files (same as a regular session)
- MCP servers configured for the project
- Skills
- The spawn prompt from the lead
- **NOT** the lead's conversation history

Put all task-specific details in the spawn prompt:
```
Spawn a security reviewer teammate with the prompt: "Review the authentication
module at src/auth/ for security vulnerabilities. Focus on token handling,
session management, and input validation. The app uses JWT tokens stored in
httpOnly cookies. Report any issues with severity ratings."
```

### Messaging mechanics
- **Message**: send to one specific teammate
- **Broadcast**: send to all teammates simultaneously — use sparingly, cost scales with team size
- **Automatic delivery**: messages are delivered automatically; the lead doesn't need to poll
- **Idle notifications**: when a teammate finishes, it automatically notifies the lead

---

## 10. Permissions

- Teammates inherit the lead's permission settings at spawn time
- If the lead uses `--dangerously-skip-permissions`, all teammates do too
- After spawning, you can change individual teammate modes
- **You cannot set per-teammate permission modes at spawn time**

Pre-approve common operations in permission settings before spawning to reduce interruption from permission prompts bubbling up to the lead.

---

## 11. Hooks for Agent Teams

### TeammateIdle
Fires when a teammate is about to go idle (finished its turn). Use to enforce quality gates.

**Input schema:**
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../<session>.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "TeammateIdle",
  "teammate_name": "researcher",
  "team_name": "my-project"
}
```

**Control:**
- Exit `2` → teammate receives stderr as feedback and continues working instead of going idle
- JSON `{"continue": false, "stopReason": "..."}` → stops the teammate entirely

**Example — validate build artifact exists:**
```bash
#!/bin/bash
if [ ! -f "./dist/output.js" ]; then
  echo "Build artifact missing. Run the build before stopping." >&2
  exit 2
fi
exit 0
```

**Configuration:**
```json
{
  "hooks": {
    "TeammateIdle": [
      {
        "hooks": [{ "type": "command", "command": "/path/to/validate-build.sh" }]
      }
    ]
  }
}
```

Note: TeammateIdle does not support matchers — fires on every occurrence.

---

### TaskCreated
Fires when a task is being created via the `TaskCreate` tool. Use to enforce naming conventions, require descriptions, or block certain tasks.

**Input schema:**
```json
{
  "session_id": "abc123",
  "transcript_path": "...",
  "cwd": "...",
  "permission_mode": "default",
  "hook_event_name": "TaskCreated",
  "task_id": "task-001",
  "task_subject": "Implement user authentication",
  "task_description": "Add login and signup endpoints",
  "teammate_name": "implementer",
  "team_name": "my-project"
}
```

Note: `task_description` and `teammate_name` may be absent.

**Control:**
- Exit `2` → task is not created; stderr fed back to the model as feedback
- JSON `{"continue": false, "stopReason": "..."}` → stops the teammate

**Example — enforce ticket number prefix:**
```bash
#!/bin/bash
INPUT=$(cat)
TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject')

if [[ ! "$TASK_SUBJECT" =~ ^\[TICKET-[0-9]+\] ]]; then
  echo "Task subject must start with a ticket number, e.g. '[TICKET-123] Add feature'" >&2
  exit 2
fi
exit 0
```

---

### TaskCompleted
Fires when a task is being marked complete. Triggers in two situations:
1. Any agent explicitly marks a task completed via `TaskUpdate`
2. An agent team teammate finishes its turn with in-progress tasks

**Input schema:**
```json
{
  "session_id": "abc123",
  "transcript_path": "...",
  "cwd": "...",
  "permission_mode": "default",
  "hook_event_name": "TaskCompleted",
  "task_id": "task-001",
  "task_subject": "Implement user authentication",
  "task_description": "Add login and signup endpoints",
  "teammate_name": "implementer",
  "team_name": "my-project"
}
```

Note: `task_description` and `teammate_name` may be absent.

**Control:**
- Exit `2` → task not marked complete; stderr fed back as feedback
- JSON `{"continue": false, "stopReason": "..."}` → stops the teammate

**Example — require tests to pass before completion:**
```bash
#!/bin/bash
INPUT=$(cat)
TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject')

if ! npm test 2>&1; then
  echo "Tests not passing. Fix failing tests before completing: $TASK_SUBJECT" >&2
  exit 2
fi
exit 0
```

---

### Hook exit code summary

| Hook            | Exit 0              | Exit 2                                        |
| :-------------- | :------------------ | :-------------------------------------------- |
| `TeammateIdle`  | Allow idle          | Teammate receives feedback and continues      |
| `TaskCreated`   | Task created        | Task not created; feedback sent to model      |
| `TaskCompleted` | Task marked done    | Task not completed; feedback sent to model    |

---

### Other relevant hooks

**SubagentStart** — fires when a subagent is spawned. Can inject additional context:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "Follow security guidelines for this task"
  }
}
```

**SubagentStop** — fires when a subagent finishes. Use like `Stop` hooks to prevent premature stopping.

**Stop** — fires when the main agent finishes responding. Can block and force continuation:
```json
{ "decision": "block", "reason": "Must continue processing remaining tasks" }
```

---

## 12. Token Costs

Agent teams are significantly more expensive than single sessions. Each teammate has its own context window and consumes tokens independently.

**Approximate multiplier**: ~7x more tokens than a standard session when teammates run in plan mode.

**Average baseline costs (single session):**
- ~$6/developer/day average
- 90% of users stay below $12/day
- ~$100-200/developer/month with Sonnet 4.6

### Cost optimization for agent teams

| Strategy | Detail |
| :------- | :----- |
| Use Sonnet for teammates | Balances capability and cost for coordination tasks |
| Keep teams small | Token usage is roughly proportional to team size |
| Keep spawn prompts focused | Everything in the spawn prompt adds to teammate context from the start |
| Clean up teams when done | Active teammates continue consuming tokens even if idle |
| Size tasks appropriately | Small self-contained units; don't leave teammates idle or running unnecessarily long |
| Limit broadcasts | Broadcast cost scales linearly with team size |

### Rate limit recommendations (API users, team size)

| Team size     | TPM per user  | RPM per user  |
| :------------ | :------------ | :------------ |
| 1-5 users     | 200k-300k     | 5-7           |
| 5-20 users    | 100k-150k     | 2.5-3.5       |
| 20-50 users   | 50k-75k       | 1.25-1.75     |
| 50-100 users  | 25k-35k       | 0.62-0.87     |
| 100-500 users | 15k-20k       | 0.37-0.47     |
| 500+ users    | 10k-15k       | 0.25-0.35     |

---

## 13. Best Practices

### Team size
- Start with **3-5 teammates** for most workflows
- 5-6 tasks per teammate keeps everyone productive without excessive context switching
- Scale up only when work genuinely benefits from simultaneous parallel effort
- Three focused teammates often outperform five scattered ones

### Give teammates enough context in the spawn prompt
Teammates do NOT inherit the lead's conversation history. Include all task-specific details in the spawn prompt. Don't assume they know the conversation context.

### Avoid file conflicts
Two teammates editing the same file leads to overwrites. Structure tasks so each teammate owns a distinct set of files.

### Start with research and review tasks
If new to agent teams, start with tasks that have clear boundaries and don't require writing code — reviewing a PR, researching a library, investigating a bug. These show parallel exploration value without coordination challenges.

### Monitor and steer actively
Check in on teammates' progress, redirect approaches that aren't working, and synthesize findings as they arrive. Don't leave a team running unattended for long — wasted effort compounds.

### Force delegation when the lead drifts
If the lead starts implementing tasks itself instead of waiting for teammates:
```
Wait for your teammates to complete their tasks before proceeding
```

### Use `CLAUDE.md` for shared guidance
`CLAUDE.md` works normally for agent teams — all teammates read it from their working directory. Use it to provide project-specific guidance that all teammates should follow.

### Move workflow-specific instructions to skills
Skills load on-demand; `CLAUDE.md` loads for every session. Put specialized instructions (PR review, database migrations, etc.) in skills to keep base context small and avoid paying for instructions that aren't relevant to the current task.

---

## 14. Use Case Patterns

### Parallel code review
Assign each teammate a distinct review lens so they don't overlap:
```
Create an agent team to review PR #142. Spawn three reviewers:
- One focused on security implications
- One checking performance impact
- One validating test coverage
Have them each review and report findings.
```

### Competing hypothesis debugging
Make teammates explicitly adversarial — each one's job is to investigate its own theory AND challenge the others':
```
Users report the app exits after one message instead of staying connected.
Spawn 5 agent teammates to investigate different hypotheses. Have them talk to
each other to try to disprove each other's theories, like a scientific
debate. Update the findings doc with whatever consensus emerges.
```
The debate structure fights anchoring bias. The theory that survives active adversarial challenge is much more likely to be the actual root cause.

### Multi-perspective design exploration
```
I'm designing a CLI tool that helps developers track TODO comments across
their codebase. Create an agent team to explore this from different angles:
one teammate on UX, one on technical architecture, one playing devil's advocate.
```

### Parallel module implementation
```
Create a team with 4 teammates to refactor these modules in parallel.
Use Sonnet for each teammate.
```
Break tasks so each teammate owns completely separate files — no shared file edits.

---

## 15. Troubleshooting

### Teammates not appearing
- In in-process mode, they may already be running but not visible — press `Shift+Down` to cycle
- Check the task complexity; Claude decides whether to spawn based on the task
- For split panes: verify tmux is in PATH (`which tmux`) or iTerm2 Python API is enabled

### Too many permission prompts
Pre-approve common operations in permission settings before spawning teammates. Teammate permission requests bubble up to the lead and create friction.

### Teammate stops on error instead of recovering
Use `Shift+Down` (in-process) or click the pane (split) to view their output, then either:
- Give them additional instructions directly
- Spawn a replacement teammate to continue the work

### Lead shuts down before all work is done
Tell it to keep going. Tell it to wait for teammates before proceeding if it starts doing work instead of delegating.

### Orphaned tmux sessions after team ends
```bash
tmux ls
tmux kill-session -t <session-name>
```

### Task status lagging (stuck tasks)
Teammates sometimes fail to mark tasks as completed, blocking dependent tasks. Check if the work is actually done, then manually tell the lead to update the task status or nudge the teammate.

---

## 16. Known Limitations

| Limitation | Detail |
| :--------- | :----- |
| No session resumption with in-process teammates | `/resume` and `/rewind` do not restore in-process teammates. The lead may try to message teammates that no longer exist — tell it to spawn new ones. |
| Task status can lag | Teammates sometimes fail to mark tasks completed, blocking dependent tasks. May need manual nudge. |
| Slow shutdown | Teammates finish their current request/tool call before shutting down. |
| One team per session | A lead can only manage one team at a time. Clean up before starting a new one. |
| No nested teams | Teammates cannot spawn their own teams or teammates. Only the lead can manage the team. |
| Lead is fixed | The session that creates the team is the lead for its lifetime. Cannot promote a teammate to lead. |
| Permissions set at spawn | All teammates start with the lead's permission mode. Cannot set per-teammate modes at spawn time (can change individually after spawning). |
| Split panes require tmux or iTerm2 | Not supported in VS Code integrated terminal, Windows Terminal, or Ghostty. |
| tmux limitations | Known limitations on some OSes; works best on macOS. |

---

## Quick Reference Card

```
Enable:      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in settings.json
Requires:    Claude Code v2.1.32+
Navigate:    Shift+Down — cycle through teammates (in-process)
             Ctrl+T — toggle task list
             Escape — interrupt teammate's current turn
Clean up:    "Clean up the team" (always via the lead)
Storage:     ~/.claude/teams/{name}/config.json
             ~/.claude/tasks/{name}/
Hooks:       TeammateIdle, TaskCreated, TaskCompleted
             Exit 2 = block + send feedback to model
Cost tip:    Use Sonnet for teammates; keep teams small; clean up when done
Best size:   3-5 teammates, 5-6 tasks per teammate
```
