@AGENTS.md

## hirecute web product (`web/`)

Working on the hirecute app — scenarios, worker steps, screens, landing, resume
parsing, evals, deploy — follows `.claude/rules/hirecute-web.md`:

@.claude/rules/hirecute-web.md

Skills for the common tasks: `.claude/skills/hirecute-scenario` (scenarios,
steps, screens, landing blocks) and `.claude/skills/hirecute-parse` (resume
parsing and the parse evals in `web/evals/parse`).

Running the app locally: `./up.sh [scenario]` and `./down.sh` (Windows `up.cmd` /
`down.cmd`), explained for non-technical users in `LOCAL-RUN.md`. When someone asks
how to run or try the app, point them there rather than at raw docker commands.

<!-- Add Claude Code-specific guidance here only when it has no AGENTS.md counterpart. -->
