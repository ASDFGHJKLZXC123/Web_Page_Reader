# AI Assistant Across Websites Agent Rules

## Code Implementation Order

Claude Code owns every code implementation pass for this repository.

Workflow:

1. Claude Code implements the assigned milestone, bug fix, or work step.
2. If Claude Code fails or returns incomplete work, retry with clearer instructions for up to five total implementation attempts.
3. After each Claude Code implementation attempt that changes code, the Lead/Integrator calls a new independent verification subagent to review the completed work.
4. The verification subagent must not implement new feature work while verifying. It may only inspect, run tests, identify defects, and recommend fixes unless explicitly reassigned.
5. No work step is considered complete until both logs exist:
   - the implementation log from the Claude Code implementer, and
   - the independent verification log from the verification subagent.
6. The Lead/Integrator reads both logs before accepting or merging the work.

## Planning Review

When making a build or implementation plan, call Claude Code to verify or review the planning work before execution. The review should look for missed requirements, better solutions, major risks, unnecessary complexity, and alternative approaches. The Lead/Integrator must incorporate the feedback into the plan or explicitly document why it was not adopted.

## Required Logs

Implementation logs:

```text
docs/implementation-logs/<milestone>/YYYY-MM-DD-claude-code-<task>.md
```

Independent verification logs:

```text
docs/implementation-logs/<milestone>/YYYY-MM-DD-verifier-<task>.md
```

Each log must state:

- what was done or reviewed,
- files changed or inspected,
- verification commands run,
- successful checks,
- failed checks,
- suspected causes for failures,
- known risks,
- final status.

## Scope Discipline

Do not implement future milestones early. Each implementation pass must stay inside the milestone scope that the Lead/Integrator assigned.

Keep implementations as small as the problem allows: if a coding task can be done in 200 lines, do not turn it into 300 lines.

Do not edit code outside the requested scope, even if you notice a bug. Report the bug first and wait for approval before modifying it.

When confusion comes up, do not make assumptions. Ask for clarification before proceeding.
