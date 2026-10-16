# Turn Receipt

Turn receipt is a Claude Code mod that prints a receipt beneath each response from an LLM. The receipt shows last turn's cost in tokens and US dollars, what its subagents cost, and the cumulative session cost. It also saves each session's total and keeps a usage + cost tally per calendar month.

Sample receipt in the CLI:

```text
- receipt · in 4 · out 26 · cache read 109.5k · cache write 1.3k · $0.054 · fable-5-1
- agents · 2 runs · in 292 · out 3.1k · cache read 314.7k · cache write 76.3k · $0.269 · turn total $0.323 · fable-5-1
- session · 4 turns · 3 agent runs · 1.5M tokens · $4.88
```

You can configure the receipt to not render on every turn, and it will keep your monthly and session tallies. You can retrieve these via the `/receipt-*` commands explained below.

## Contents
- [Turn Receipt](#turn-receipt)
  - [What it shows](#what-it-shows)
  - [Commands](#commands)
  - [Configuration Options](#configuration-options)
  - [Install](#install)
  - [Layout](#layout)
  - [Build and test](#build-and-test)
  - [Run it from the folder while developing](#run-it-from-the-folder-while-developing)
  - [Debug](#debug)
  - [Release a new version](#release-a-new-version)
  - [How it works](#how-it-works)
  - [Known limitations](#known-limitations)
  - [Using turn-receipt with the Agent SDK](#using-turn-receipt-with-the-agent-sdk)
    - [Agent SDK Requirements](#agent-sdk-requirements)
    - [Different Identities based on how the plugin is loaded](#different-identities-based-on-how-the-plugin-is-loaded)
    - [The receipt in the SDK](#the-receipt-in-the-sdk)
  - [Origin and license](#origin-and-license)

## What it shows

The receipt shows:

- **receipt:** the main loop's four token counts as the API reported them: uncached input, output, cache reads and cache writes, the turn's cost in US dollars, and the model that answered.
- **agents:** present when the turn ran subagents: how many runs, token counts, the cost, the whole turn's cost, and the model of the last run.
- **session:** the running totals for the session: total turns, total subagent runs, all four token kinds summed (cache reads included), and the ledger's total.

The token counts come from the `turn.complete` event's `usage`. The dollars come from `$.session.usage().cost.usd`, the same ledger `/cost` reports.

## Commands

| Command | What it does |
|---------|--------------|
| `/receipt` | Shows this session's turns, subagent runs, tokens and dollars, and saves them. |
| `/receipt-total [days]` | Sums every session record saved in the last N days. N is passed as a parameter; when omitted, it will use the `keepSessionDetailsNNDays` configuration setting (14 by default). The total receipt includes sessions, turns, subagent runs, tokens and dollars. The current session is saved first, so it is counted. |
| `/receipt-month [YYYY-MM]` | Shows a month's tally: sessions, turns, subagent runs, tokens and dollars. This month when not given, followed by one line per earlier month kept. The current session is saved first, so its latest turns are in. |
| `/receipt-clear` | Saves this session, then drops every other session record. The monthly tallies stay. |

```text
/receipt-total 2
Last 2 days: 9 sessions
  turns 61 | agent runs 9 | $13.40
  tokens 12.1M: in:390.2k | out:131.7k | cache read:11.0M | cache write:602.4k
```

```text
/receipt-month
2026-10: 12 sessions
  turns 184 | agent runs 31 | $42.17
  tokens 38.6M: in:1.2M | out:410.5k | cache read:35.1M | cache write:1.9M
```

## Configuration Options

Six options, declared in the manifest's `userConfig`. Each is a row in `/config` under the plugin's name. Changing the value of an option reloads the module with the new value.

| Option | `/config` row | Type | Default | What it does |
|--------|---------------|------|---------|--------------|
| `renderReceiptAs` | Render the receipt as | `ui` \| `text` \| `none` | `ui` | `ui`: a markdown receipt after every turn. In the terminal a `ui.render` hook on the `TurnDuration` row draws it beneath the turn's duration; in the desktop app the latest receipt is drawn in the band above the prompt. <br />`text`: one plain line, `receipt \| in:200 \| … // session \| …`, returned as the `turn.complete` text, which the engine shows beneath the answer. Less intrusive than `ui`, and the mode to use with the Agent SDK. <br />`none`: no receipt after each turn. The tally is still computed and saved; read it with `/receipt`, `/receipt-total` and `/receipt-month`. |
| `showSessionTotals` | Show Session Totals | boolean | `true` | Adds the session tally to each receipt. |
| `showSubAgentDetails` | Show Subagent Details | boolean | `true` | Adds the agents line when the turn ran subagents. When it is set to `false`, the subagents' dollars are folded into the receipt line's figure, so you still see the whole turn's cost. |
| `saveEveryNNTurns` | Save every NN turns | number | `10` | Saves the session's record every NN main-loop turns. A turn is one prompt through to Claude's final answer. By saving every NN turns, we prevent losing data if the session crashes or is force-terminated and the `session.end` hook never runs: at most NN turns are lost. `0` saves only at session end and on the commands, so it loses more. |
| `keepSessionDetailsNNDays` | Keep detailed session records for NN days | number | `14` | Determines how long session records are kept. Mod data is saved in a json file, so we trim session data to prevent bloating the file and slowing the turns. <br />The monthly tallies are kept apart, clearing session data does not affect monthly tallies. |
| `allowEmptyReceipts` | Allow empty receipts | boolean | `false` | Also prints a receipt, and counts the turn, when the turn reported no usage and moved no ledger. An interrupt before any response or an API error causes one. Off, such a turn gets no receipt and is not counted. On, every turn has a receipt, which keeps the stream regular for an Agent SDK harness. |

## Install

Requires Claude Code 2.1.287 or later. Built and tested on 2.1.299.

This repository is a plugin marketplace (see `.claude-plugin/marketplace.json` at its root), so one line at the prompt of a Claude Code session installs the plugin:

```text
/plugin install turn-receipt --marketplace jaimerodriguez/claude-code-plugins
```

Answer `y` to add the marketplace, pick a scope (user is first), and set the options or keep their defaults.

From the shell:
```bash
claude plugin marketplace add jaimerodriguez/claude-code-plugins
claude plugin install turn-receipt@jaime-rodriguez-claude-code-plugins --scope user
```

To update later:

```bash
claude plugin update turn-receipt
```

then `/reload-plugins` in a running session, or start a new one.

## Layout

```text
turn-receipt/
├── .claude-plugin/
│   ├── plugin.json            manifest: name, version, userConfig options
│   └── types/                 written by Claude Code when the plugin loads; gitignored
├── hooks/
│   ├── hooks.json             names the hooks module: { "modules": ["./turn-receipt.mjs"] }
│   ├── turn-receipt.mjs       the hooks module (all the logic)
│   └── turn-receipt.test.ts   tests, run by `claude plugin test`
├── .gitignore
├── CHANGELOG.md               dated entries, Keep a Changelog format
├── LICENSE                    Apache-2.0
├── tsconfig.json              extends the generated .claude-plugin/types/tsconfig.json
└── README.md
```

There is no package.json, no dependencies and no bundling step. The hooks module is plain JavaScript that Claude Code loads directly. "Build" here means validate, type-check and test.

## Build and test

Run these from the repository root. All three must pass before a commit.

1. **Validate.** Reads the manifest and the module's source the way the engine will, and lists what the module hooks and calls. It also reports anything the engine would refuse, such as a gating hook without a `.catch` handler or a `userConfig` field without a `title`.

   ```bash
   claude plugin validate ./turn-receipt
   claude plugin validate .            # the marketplace manifest at the repo root
   ```

   Add `--strict` to fail on warnings, `--json` for a machine-readable report.

2. **Test.** Runs every `*.test.ts` under the folder against the real engine. The test's own hooks sit beneath the plugin's and stand in for the engine: they answer `session.usage` from a ledger the test moves, `agent.spawn` with a model and an id, `turn.complete` with the answer, and the four `store.*` events from a `Map` the test can inspect.

   ```bash
   claude plugin test ./turn-receipt
   ```

   Exits 1 when a test fails. To test an option value, pass it to the test: `test(name, { options: { showSessionTotals: false } }, body)`. Left out, the plugin gets its manifest's defaults.

3. **Type-check.** Claude Code writes the plugin's TypeScript types to `.claude-plugin/types/` each time it loads the plugin (interactive or headless). Nothing generates them otherwise, so run the plugin once first (see the next section), then:

   ```bash
   tsc -p turn-receipt
   ```

   No output means it passed. The generated `claude-code/index.d.ts` is also the API reference: grep it for an event or noun (`'turn.complete'`, `session.usage`, `store.keys`) and read the declaration it lands on.

A quick smoke test that proves the module loads and settles on a real turn, without an interactive session:

```bash
claude -p "Reply with the single word OK." --plugin-dir ./turn-receipt --max-turns 1 \
  --debug-file /tmp/turn-receipt-debug.log
grep turn-receipt /tmp/turn-receipt-debug.log
```

## Run it from the folder while developing

`--plugin-dir` loads the plugin from disk for one session, whatever is installed:

```bash
claude --plugin-dir ./turn-receipt
```

In an interactive session that folder is watched. Saving a file reloads the hooks module: `register` runs again, `session.start` fires again, and the module's own variables start over. The session's counters are read back from the saved record on reload, so at most `saveEveryNNTurns` turns of the count are lost. Values in `$.store` are the host's and survive a reload.

Where no flag can be given (a session the desktop app starts), set `CLAUDE_CODE_PLUGIN_DIRS` to the folder's absolute path in the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/your/plugin-or-mod"
  }
}
```

If the plugin is installed from this repository's folder as a local marketplace (`claude plugin marketplace add /path/to/claude-code-plugins`), the installed plugin is read from the folder itself, not from a copy. Edit, then `/reload-plugins` in the session, with no new version and no reinstall. `claude plugin list` shows which folder a plugin is read from.

## Debug

- **Run with `claude --debug`** (or `--debug-file <path>`) during development. The debug log has a line for every hook that was skipped and every result the engine refused, prefixed `turn-receipt:`. By default the log goes to `~/.claude/debug/<session-id>.txt`, with `~/.claude/debug/latest` pointing at the newest. Filter categories with `--debug "hooks"` to cut the noise.
- **A failing hook is skipped, not fatal.** The chain continues without it, so a plugin that seems to do nothing has usually been told why in the log. While a `--plugin-dir` folder is watched, the transcript also shows one dim line naming the plugin, the event and the reason. The `agent.spawn` hook is a gating hook, so it has a `.catch` that passes the spawn on; keep that if you change it.
- **No receipt beneath an answer?** Check that `renderReceiptAs` is not `none`. If the turn may have counted nothing (an interrupt, an API error), set `allowEmptyReceipts` to `true` to receipt those too. With `ui`, a surface that draws neither the `TurnDuration` row nor the band above the prompt (`vscode`, `mobile`) shows nothing; use `text` there. Another plugin's `ui.render` hook on the same row, or its own `turn.complete` text, can also take the place.
- **`cost n/a` in the receipt** means the host keeps no cost ledger. The CLI always has one.
- **Check the saved records.** The store is the file `~/.claude/plugins/store/turn-receipt_<marketplace>-<hash>.json`, plain JSON keyed `session:<id>` and `month:<YYYY-MM>`.
- **Options not taking effect?** Plugin options are read from user settings, `--settings`, or managed settings, never a project's `.claude/settings.json`.
- **Reproduce in a test before fixing.** `hooks/turn-receipt.test.ts` already drives every event the module hooks. Copy the closest test, move the fake ledger or usage to match the case, and assert on the text or on the `Map` behind the store.
- **Debugging in Claude Desktop.** Use the `/debug` command, then `/reload-plugins`, and check the logs.

## Release a new version

1. Bump `version` in `.claude-plugin/plugin.json` and add a dated entry to `CHANGELOG.md`.
2. Run validate, test and type-check (above).
3. Commit and push to `main`.
4. People who installed from this marketplace get it with `claude plugin update turn-receipt` followed by `/reload-plugins`.

## How it works

| Hook | What it does |
|------|--------------|
| `session.start` | Registers the four commands, reads the ledger once (so a resumed session's earlier spend is not billed to its first turn), loads this session's saved record, and prunes session records older than `keepSessionDetailsNNDays` and months older than 12. |
| `agent.spawn` | Reads the ledger and credits the movement to the main loop, then lets the spawn go on. |
| `turn.complete` | A subagent's run (`agentId` set): credits the ledger's movement and the run's tokens to the agents. The main loop's turn: credits the movement to the main loop, keeps the receipt as markdown for the turn's closing row (`renderReceiptAs` `ui`) or returns it as the hook's one-line text (`text`), starts the next turn's count, and saves every N turns. |
| `ui.render` (`TurnDuration`) | Registered only with `renderReceiptAs` `ui`. Claims the receipt the turn left and draws it, the duration line first, then the markdown. A redraw of the same row gets the same receipt; a row with none is the engine's own. Terminal only. |
| `ui.render` (`AbovePrompt`) | Registered only with `renderReceiptAs` `ui`. Draws the latest receipt in the band above the prompt on a surface that is not the terminal (the desktop app); on the terminal it stands down, and it yields while a survey holds the band. |
| `session.end` | Banks into the month and saves the record one last time. |
| `command.run` | Answers `/receipt`, `/receipt-total`, `/receipt-month` and `/receipt-clear`. |

The plugin never rewrites the answer: it passes it through, and the receipt is drawn on the turn's closing row (`ui`) or is the hook's text beneath it (`text`).

**Splitting dollars between loops.** The ledger is one figure for the whole session, so the plugin reads it at each spawn and at each turn's end, and credits each movement to the loop whose event ended the window:

| Reading taken at | Credited to |
|------------------|-------------|
| `agent.spawn`, before the subagent starts | the main loop |
| a subagent run's `turn.complete` | the agents |
| the main loop's `turn.complete` | the main loop |

A foreground subagent blocks the main loop while it runs, so for those the split is exact.

**Persistence.** The plugin stores a tally for every session, and a cumulative tally for the month.

Each individual **session record**, under `session:<id>`, is the session's running total: the session id, when it began, when it was saved, turns, subagent runs, the token counts, the ledger's dollars, and how much of all that is already in a month's tally. It is written at chosen moments, never on every event:

- every `saveEveryNNTurns` turns (10 by default; 0 turns this off),
- at `session.end`, which shares one short time bound with everything else that runs at exit, and
- on any `/receipt-*` command.

A session with nothing in it (no turns, no subagent runs, no tokens, and a ledger at zero) is not written at any of these moments, so a session opened and closed without a prompt leaves no record. At `session.start` the plugin reads the record back, so a resumed session or a hot-reloaded module continues its count instead of starting at zero.

The **month record**, under `month:<YYYY-MM>`, is the tally of every session that saved in that calendar month (local time): sessions, turns, subagent runs, tokens and dollars. At every save, the plugin takes what the session has added since its last save and adds it to the month of the save, then notes in the session record that it is banked. The next save adds only what came after, so a session saved ten times is counted once, and a save that adds nothing leaves the month alone. A session is counted among the month's sessions the first time it banks something into it; a session that straddles midnight on the last day of a month puts what it saved before into one month and the rest into the next. A record saved by 0.1.x, with no banked figure, banks its whole total at its next save.

The two records have different lives, which is the point. Session records are dropped at `session.start` once older than `keepSessionDetailsNNDays` (14 by default; this session's is never dropped), or all at once by `/receipt-clear`, so the store stays small whatever the number of sessions. Month records are kept for 12 months. Clearing the sessions loses nothing from the months, since everything saved was banked first.

## Known limitations

- **The dollar figure is the host's ledger**, what `/cost` reports: list price unless the host is configured with its own pricing. On a subscription it is shown, but it is not what you are billed.
- **A turn's cost is a delta.** Anything else that moves the ledger during a window (a compaction's own request, a plugin's own model call) is credited to whichever loop's event ended that window.
- **Background subagents run beside the main loop.** What the main loop spends while one runs is credited to the agents. A background subagent that finishes after the turn ends is counted on the next turn's agents line.
- **A subagent's tokens are its own loop's.** The receipt line does not include them; the agents line and the session line do.
- **The session's dollars count from its first launch.** A resumed session's ledger includes what it spent before the resume, as `/cost` does.
- **Cents are rounded.** Under one dollar the receipt shows three decimals; under one cent it shows `<$0.01`.
- **Subagent runs are counted, not named.**
- **A crash or forced termination loses at most `saveEveryNNTurns` turns** of the session's record and of the month. The session's dollars are not lost: the next save carries the whole session's figure.
- **`/receipt-total` is of the session records still kept.** With the default `keepSessionDetailsNNDays` of 14 it cannot look back further than two weeks; `/receipt-month` is the long view. A session that ended before the plugin was installed is in neither. The window is by the record's save time, not its start.
- **A month's dollars are what this plugin watched.** They are the ledger's movement between saves, so a resumed session's spend from before the plugin was installed is in its session record (the whole ledger) but not in the month. A month is the local calendar month at the time of each save.
- **A crash between the two writes of a save can count once more.** The month is written first, then the session record; a kill between them leaves the record saying less is banked than is, and the next save banks that part again. The window is two small writes.
- **Session records are per plugin store.** Installing under a different plugin name or from a different folder starts a separate store.
- **The store is capped at 4 MiB** by the host. A record is a few hundred bytes, session records are dropped after `keepSessionDetailsNNDays`. Month records last 12 months, one record per month. Ordinary use should stay far below the limit.
- **The desktop app shows only the latest receipt**, in the band above the prompt, since it does not render `TurnDuration`. If the band is too intrusive, set `renderReceiptAs` to `none` or to `text`. `vscode` and `mobile` raise neither component; use `text` there.

## Using turn-receipt with the Agent SDK
The plugin works in a headless session driven by the Agent SDK. Two details matter:
- The plugin's identity depends on how it is loaded.
- The SDK renders no UI, so the receipt has to come as text and be handled by the harness.

### Agent SDK Requirements
- `claude-agent-sdk` 0.2.165 or later. The SDK runs the Claude Code binary it bundles, not the one on your PATH, and 0.2.165 is the first release whose bundled binary (2.1.294) loads mods.

### Different identities based on how the plugin is loaded

1. An Agent SDK session that uses the user's settings loads the installed plugin with a `turn-receipt@<marketplace>` identity.

2. A sealed SDK session, one with `setting_sources=[]`, will not load the plugin unless the harness explicitly asks for it. If the harness loads the plugin using a direct, local path, the identity becomes `turn-receipt@inline`.

Since the plugin keeps its ledger in a file that includes the identity, the two ways of loading give two separate stores:

| | Installed plugin | Directory (`--plugin-dir`) |
|---|---|---|
| SDK option | `extra_args={"settings": ...}` with the plugin's key | `plugins=[{"type": "local", "path": ...}]` |
| Identity | `turn-receipt@<marketplace>` | `turn-receipt@inline` |
| Store file | `turn-receipt_<marketplace>-<hash>.json`, the one your own sessions write | `turn-receipt_inline-<hash>.json`, a second file |
| Shows up in `/receipt-total` in your terminal | yes | no |
| How to read it headlessly | `claude -p "/receipt-total"` | `claude -p "/receipt-total" --plugin-dir /path/to/turn-receipt` |
| Updated by `claude plugin update` | yes | no, it is whatever the checkout holds |
| Pick it when | you want the harness's spend in the same totals as your own sessions | 1. you are developing the plugin, or <br> 2. you want the harness's spend kept apart |

Sample code for each route:

**Route 1: load the installed plugin.** Pass a settings fragment holding only the plugin's key. The CLI honors `--settings` even with the settings files off, and loads the plugin exactly as installed: same identity, same store, same version as your own sessions.

```python
import json
from claude_agent_sdk import ClaudeAgentOptions

options = ClaudeAgentOptions(
    setting_sources=[],
    extra_args={"settings": json.dumps(
        {"enabledPlugins": {"turn-receipt@<marketplace>": True}})},
    ...
)
```

The key is the plugin's name @ marketplace as `claude plugin list` prints it, or as the key reads in `~/.claude/plugins/installed_plugins.json`. This route gives one tally across the SDK and your own Claude Code sessions.

**Route 2: load a directory.** The SDK's `plugins` option becomes `--plugin-dir`:

```python
options = ClaudeAgentOptions(
    plugins=[{"type": "local", "path": "/path/to/turn-receipt"}],
    setting_sources=[],
    ...
)
```

A plugin loaded this way is `turn-receipt@inline`, and the CLI gives it a store of its own. Nothing the SDK harness spends appears in your terminal's `/receipt-total`. To read the harness's ledger, start a session with the same `--plugin-dir`:

```bash
claude -p "/receipt-total" --plugin-dir /path/to/turn-receipt
```

### The receipt in the SDK

The default, `ui`, draws with `ui.render` hooks, and a headless session has no surface for them. Set `renderReceiptAs` to `text` and the receipt arrives as an `informational` system message.

With `text` or `none` the tally still accumulates and is saved at the usual points, so a harness can read it back with `/receipt`, `/receipt-total` or `/receipt-month`.

## Origin and license

This plugin began as an example mod in [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground) (`claude-code/mods/turn-receipt`), built with Claude Fable 5.1 in Claude Code. The source files keep their Apache-2.0 headers, and this folder carries its own [LICENSE](LICENSE) with the Apache License 2.0 text; the rest of the repository is MIT. It is now maintained here as a stand-alone plugin, shared as-is, with no support or maintenance implied.
