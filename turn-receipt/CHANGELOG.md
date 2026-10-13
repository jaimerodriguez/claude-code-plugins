# Changelog

All notable changes to this plugin are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0] - 2026-10-13

### Added

- A `renderReceiptAs` option (`userConfig`, one of `ui`, `text`, `none`; default `ui`) that picks how the receipt reaches you:
  - `ui`: a `ui.render` hook on the `TurnDuration` row, the line that closes each turn, draws the duration line and then the receipt as markdown, one list item per line shown (receipt, agents, session, as `showSessionTotals` and `showSubAgentDetails` allow), the numbers in bold. Terminal only.
  - `text`: the receipt is one plain line, its sections joined by ` // `, returned as the `turn.complete` text, as in 0.3.0.
  - `none`: the receipt is not shown each turn. The turns are still tallied, saved and banked, and the tally is available from `/receipt`, `/receipt-total` and `/receipt-month` or from the store files. Only the `ui.render` hook is left unregistered.

### Changed

- **Breaking for SDK harnesses:** the default receipt is drawn by `ui.render`, which a headless or SDK session has no surface for, so with `ui` such a session gets no receipt message. Set `renderReceiptAs` to `text` to keep the one `informational` message, or read the tally with the commands. The README's SDK section says so.
- With `text`, the sections are joined by ` // `, not `\n`. The engine replaces every line break in a hook's returned text with `U+FFFD` (checked on 2.1.296, in the terminal and headless, for `\n`, `\r\n`, `\r`, U+2028, U+2029, U+0085, VT and FF), so a stray character sat between them.
- Token counts read `in:1.2k | out:348 | cache read:98.3k | cache write:12.1k` in `text` and in `/receipt`, `/receipt-total` and `/receipt-month`, with a colon and no space after the label; in the markdown they read `in **1.2k** · out **348**`.
- The field separator is ` | ` (one space either side), where it was `  | `; the markdown uses ` · `.
- The model is shown without its `claude-` prefix, as a field of its own after the cost: `| sonnet-5-5` for `claude-sonnet-5-5`. Before, it trailed the cost in parentheses with no separator. Any date suffix is kept.

## [0.3.0] - 2026-10-12

### Added

- A `LICENSE` file in this folder with the Apache License 2.0 text, which the sources' headers refer to. The rest of the repository is MIT.

### Changed

- The four `userConfig` options are renamed for clarity: `session` is now `showSessionTotals`, `agents` is `showSubAgentDetails`, `saveEvery` is `saveEveryNNTurns` and `keepDays` is `keepSessionDetailsNNDays`. Their `/config` titles are reworded to match. `allowEmptyReceipts` is unchanged.
- The plugin's description in the manifest and in the marketplace now lists the four commands. The author is Jaime Rodriguez.

## [0.2.3] - 2026-10-09

### Added

- An `allowEmptyReceipts` option (`userConfig`, default `false`): also print a receipt, and count the turn, when the turn reported no usage and moved no ledger (an interrupt before any response, an API error). Its token counts read `0`, so the line keeps its shape for parsers. Off, the default, such a turn gets no receipt and is not counted, as before. On, every turn has a receipt, for matching against other logs.

### Changed

- A session with nothing in it (no turns, no subagent runs, no tokens, and a ledger at zero or none) is no longer saved. Before, a session opened and closed without a prompt left an empty `session:<id>` record in the store at `session.end`, and `/receipt-total` counted it as a session. `/receipt` on such a session now ends "Not saved: nothing to save yet." The first turn makes it worth keeping; every save after is as before.
- A receipt for a turn with no usage but a ledger movement now shows `in 0  | out 0` where the token counts would be, instead of leaving the gap.

## [0.2.2] - 2026-10-07

### Changed

- The hooks module now says why it banks, not only what banking does: a "Why bank" block in the header (session records are short-lived, so a month must be written while they are here, and in increments at every save, so a killed, resumed, reloaded or month-straddling session is counted once), with matching notes on `banked`, `unbanked()`, `bank()` and `emptyBanked()`, including why `banked.usd` is a ledger reading rather than a count. Comments only; no behavior changed.

## [0.2.1] - 2026-10-07

### Added

- A trace printed to the console at `session.start`: the host's process id (read from a child's `$PPID`, since a hooks module has no `process` of its own; so a debugger can be attached), what this session's saved record had banked, and one line per month record kept in the store. Where the console is missing the lines go to the debug log. It never fails the start; a store that cannot be read is noted on the line instead.

### Fixed

- The tests and the README's sample output expected the `  ·  ` separator the plugin used before this copy switched to `  | `; nine of fourteen tests failed on it. Both now match the source, and the two checks that an agents line is absent look for the separator the plugin actually prints.

## [0.2.0] - 2026-10-07

### Added

- A monthly tally, one record per calendar month under `month:<YYYY-MM>` in the plugin's store, kept apart from the session records. At every save, what the session added since its last save (turns, subagent runs, tokens, dollars) is banked into the month of the save; the session record notes what is banked, so nothing is counted twice across saves, resumes or reloads. A session that banked nothing is not counted. Months older than 12 are pruned at session start.
- `/receipt-month [YYYY-MM]`, which shows a month's tally (this month by default, with one line per earlier month kept).
- `/receipt-clear`, which saves this session and drops every other session record. The months stay.
- A `keepDays` option (`userConfig`, default 14): how long session records are kept before they are dropped at session start. This session's record is never dropped.

### Changed

- Session records are kept for `keepDays` days (default 14) instead of a fixed 90, since the monthly tally now carries the history. `/receipt-total` with no argument sums the kept days instead of 30.
- A session record saved by 0.1.x (no `banked` field) banks its whole total into the month of its next save.
- README updated for the monthly tally: the new commands and option, how banking works, and the limitations that come with it.
- `register` reads the `saveEvery` and `keepDays` fallbacks from the module's named default constants (10 and 14) instead of repeating the literals.

## [0.1.1] - 2026-10-07

### Changed

- Moved out of `anthropics/claude-code-playground` into this repository as a stand-alone plugin. The repository root now carries a `.claude-plugin/marketplace.json` listing it, so it installs with `/plugin install turn-receipt --marketplace jaimerodriguez/claude-code-plugins`.
- README rewritten for the new home: install from this marketplace, build (validate, test, type-check), run from the folder with hot reload, debug, and release steps.

## [0.1.0] - 2026-10-06

### Added

- First version. A `turn.complete` hook that prints a receipt beneath each main-loop answer: the turn's token counts, its cost in US dollars, and the session's running total.
- A `session` option (`userConfig`, on by default) that adds or drops the session line.
- An `agents` line for the subagent runs a turn made (runs, tokens, dollars and the turn's total), with the dollars split between the main loop and its subagents by ledger readings at each spawn and at each run's end. The `agents` option (on by default) drops the line and folds the subagents' dollars into the turn's figure. The session line counts subagent runs and tokens too.
- Persistence of the session's running total as one record in the plugin's store, written every `saveEvery` turns (option, default 10), at session end, and on the commands; read back at session start so resumes and reloads continue the count; records older than 90 days pruned.
- `/receipt`, which shows and saves this session's totals, and `/receipt-total [days]`, which sums the sessions saved in the last N days (30 by default).
- Tests under `hooks/turn-receipt.test.ts`, run with `claude plugin test`.
