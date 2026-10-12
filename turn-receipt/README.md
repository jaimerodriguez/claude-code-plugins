# Turn Receipt

Turn receipt is a Claude Code mod that prints a receipt beneath each response from an LLM. It prints: what the turn cost in tokens and US dollars, what its subagents cost, and what the session has cost so far. It also saves each session's total, keeps a tally per calendar month that outlives the session records, and sums either on demand.

```text
receipt  | in 200  | out 50  | cache read 13.9k  | $0.030  (claude-sonnet-4-5-20250929)
agents  | 2 runs  | in 1k  | out 200  | cache read 40.2k  | $0.050  | turn total $0.080  (claude-haiku-4-5-20251001)
session  | 3 turns  | 2 agent runs  | 1.5M tokens  | $0.52
```

## Contents

- [Turn Receipt](#turn-receipt)
  - [Contents](#contents)
  - [What it shows](#what-it-shows)
  - [Commands](#commands)
  - [Options](#options)
  - [Install](#install)
  - [Layout](#layout)
  - [Build and test](#build-and-test)
  - [Run it from the folder while developing](#run-it-from-the-folder-while-developing)
  - [Debug](#debug)
  - [Release a new version](#release-a-new-version)
  - [How it works](#how-it-works)
  - [Limitations](#limitations)
  - [Using turn-receipt with the Agent SDK](#using-turn-receipt-with-the-agent-sdk)
    - [Requirements](#requirements)
    - [Two ways to load it, and where the receipts go](#two-ways-to-load-it-and-where-the-receipts-go)
    - [The receipt message (in the SDK)](#the-receipt-message-in-the-sdk)
    - [Catching the receipt (sample)](#catching-the-receipt-sample)
  - [Origin and license](#origin-and-license)

## What it shows

After each main-loop turn, the receipt shows:

- **receipt:** the main loop's four token counts as the API reported them (uncached input, output, cache reads and cache writes; a zero cache count is left out), its cost in US dollars, and the model that answered;
- **agents:** present when the turn ran subagents: how many runs, their token counts, their dollars, the whole turn's dollars, and the model the last run answered with;
- **session:** the running total: turns receipted, subagent runs, every token summed, and the ledger's total.

The numbers are real, not estimated. The token counts come from the `turn.complete` event's `usage`. The dollars come from `$.session.usage().cost.usd`, the same ledger `/cost` reports, so the plugin carries no pricing table and stays right when prices or models change.

## Commands

| Command | What it does |
|---------|--------------|
| `/receipt` | Shows this session's turns, subagent runs, tokens and dollars, and saves them. |
| `/receipt-total [days]` | Sums every session record saved in the last N days, the kept days (`keepDays`, 14 by default) when not given: sessions, turns, subagent runs, tokens and dollars. The current session is saved first, so it is counted. |
| `/receipt-month [YYYY-MM]` | Shows a month's tally: sessions, turns, subagent runs, tokens and dollars. This month when not given, followed by one line per earlier month kept. The current session is saved first, so its latest turns are in. |
| `/receipt-clear` | Saves this session, then drops every other session record. The monthly tallies stay. |

```text
/receipt-total
Last 14 days: 9 sessions
  turns 61  | agent runs 9  | $13.40
  tokens 12.1M: in 390.2k  | out 131.7k  | cache read 11.0M  | cache write 602.4k
```

```text
/receipt-month 
2026-10: 12 sessions
  turns 184  | agent runs 31  | $42.17
  tokens 38.6M: in 1.2M  | out 410.5k  | cache read 35.1M  | cache write 1.9M
Earlier months:
  2026-09  | 40 sessions  | 612 turns  | $131.08
```

## Options

Five options, declared in the manifest's `userConfig`. Each is a row in `/config` under the plugin's name. Changing one there reloads the module with the new value.

| Option | `/config` row | Type | Default | What it does |
|--------|---------------|------|---------|--------------|
| `session` | Session total | boolean | `true` | Adds the session line to each receipt. |
| `agents` | Subagent line | boolean | `true` | Adds the agents line when the turn ran subagents. Off, the subagents' dollars are folded into the receipt line's figure, so it is the whole turn's. |
| `saveEvery` | Save every N turns | number | `10` | Main-loop turns between saves of the session's record. A turn is one prompt through to Claude's final answer, whatever it ran inside; subagent runs do not count. `0` saves only at session end and on the commands. |
| `keepDays` | Keep session records for N days | number | `14` | How long session records are kept before `session.start` drops them. The monthly tallies are kept apart, for 12 months, so a short window loses nothing from them. |
| `allowEmptyReceipts` | Allow empty receipts | boolean | `false` | Also prints a receipt, and counts the turn, when the turn reported no usage and moved no ledger: an interrupt before any response, an API error. Its token counts read `0`, so the line keeps its shape for anything parsing it. Off, such a turn gets no receipt and is not counted. On, every turn has a receipt, which helps when matching them against other logs. |

With `session` and `agents` off, the receipt is one line, the turn alone:

```text
receipt  | in 200  | out 50  | cache read 13.9k  | $0.080  (claude-sonnet-4-5-20250929)
```

The same four in `~/.claude/settings.json` (project settings are not read for plugin options):

```json
"pluginConfigs": {
  "turn-receipt": {
    "options": { "session": true, "agents": true, "saveEvery": 10, "keepDays": 14, "allowEmptyReceipts": false }
  }
}
```

From a shell, `claude plugin configure turn-receipt` shows the options and which are unset.

## Install

Requires Claude Code 2.1.287 or later, where mods load by default. Built and tested on 2.1.293.

This repository is a plugin marketplace (see `.claude-plugin/marketplace.json` at its root), so one line at the prompt of a Claude Code session installs the plugin:

```text
/plugin install turn-receipt --marketplace jaimerodriguez/claude-code-plugins
```

Answer `y` to add the marketplace, pick a scope (user is first), and set the options or keep their defaults. The hooks run in that session from then on, and in every later session under the chosen scope.

From a shell instead:

```bash
claude plugin marketplace add jaimerodriguez/claude-code-plugins
claude plugin install turn-receipt@jaime-claude-code-plugins --scope user
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

   Exits 1 when a test fails. To test an option value, pass it to the test: `test(name, { options: { session: false } }, body)`. Left out, the plugin gets its manifest's defaults.

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

Point `--debug-file` outside the repository: Claude Code also writes a `latest` symlink beside the log. Expect lines like `hooks module turn-receipt@inline loaded` and `$.command.register (turn-receipt): /receipt listed`. Headless runs print only the answer; the receipt is drawn beneath it only in an interactive transcript.

## Run it from the folder while developing

`--plugin-dir` loads the plugin from disk for one session, whatever is installed:

```bash
claude --plugin-dir ./turn-receipt
```

In an interactive session that folder is watched. Saving a file reloads the hooks module: `register` runs again, `session.start` fires again, and the module's own variables start over. The session's counters are read back from the saved record on reload, so at most `saveEvery` turns of the count are lost. Values in `$.store` are the host's and survive a reload.

Where no flag can be given (a session the desktop app starts), set `CLAUDE_CODE_PLUGIN_DIRS` to the folder's absolute path in the `env` block of `~/.claude/settings.json`.

If the plugin is installed from this repository's folder as a local marketplace (`claude plugin marketplace add /path/to/claude-code-plugins`), the installed plugin is read from the folder itself, not from a copy. Edit, then `/reload-plugins` in the session, with no new version and no reinstall. `claude plugin list` shows which folder a plugin is read from.

## Debug

- **Run with `claude --debug`** (or `--debug-file <path>`) during development. The debug log has a line for every hook that was skipped and every result the engine refused, prefixed `turn-receipt:`. By default the log goes to `~/.claude/debug/<session-id>.txt`, with `~/.claude/debug/latest` pointing at the newest. Filter categories with `--debug "hooks"` to cut the noise.
- **A failing hook is skipped, not fatal.** The chain continues without it, so a plugin that seems to do nothing has usually been told why in the log. While a `--plugin-dir` folder is watched, the transcript also shows one dim line naming the plugin, the event and the reason. The `agent.spawn` hook is a gating hook, so it has a `.catch` that passes the spawn on; keep that if you change it.
- **No receipt beneath an answer?** The turn counted nothing (an interrupt before any response, an API error; turn `allowEmptyReceipts` on to receipt those too), or another plugin answered `turn.complete` with its own text and took the one place beneath the answer.
- **`cost n/a` in the receipt** means the host keeps no cost ledger. The CLI always has one.
- **Read the start trace.** At `session.start` the module prints to the console the host's process id (so you can attach a debugger to it; a hooks module has no `process` global, so the id is a child's `$PPID`), what this session's record had banked, and one line per month record kept. Where there is no console the lines go to the debug log instead.
- **Check the saved records.** `/receipt` prints and saves this session's record; `/receipt-total` reads the session records back and `/receipt-month` the month records. The store is a file of the plugin's own under the Claude Code configuration directory, keyed `session:<id>` and `month:<YYYY-MM>`. `claude plugin list --json --data-size turn-receipt` reports its size; `/receipt-clear` drops every session record but this one and keeps the months.
- **Options not taking effect?** Plugin options are read from user settings, `--settings`, or managed settings, never a project's `.claude/settings.json`. The debug log says so on load: `no pluginConfigs["turn-receipt" or "turn-receipt@inline"].options ...; every option is its default`.
- **Reproduce in a test before fixing.** `hooks/turn-receipt.test.ts` already drives every event the module hooks. Copy the closest test, move the fake ledger or usage to match the case, and assert on the text or on the `Map` behind the store.

## Release a new version

1. Bump `version` in `.claude-plugin/plugin.json` and add a dated entry to `CHANGELOG.md`.
2. Run validate, test and type-check (above).
3. Commit and push to `main`. Nothing publishes automatically.
4. People who installed from this marketplace get it with `claude plugin update turn-receipt` followed by `/reload-plugins`.

## How it works

| Hook | What it does |
|------|--------------|
| `session.start` | Registers the four commands, reads the ledger once (so a resumed session's earlier spend is not billed to its first turn), loads this session's saved record, and prunes session records older than `keepDays` and months older than 12. |
| `agent.spawn` | Reads the ledger and credits the movement to the main loop, then lets the spawn go on. |
| `turn.complete` | A subagent's run (`agentId` set): credits the ledger's movement and the run's tokens to the agents. The main loop's turn: credits the movement to the main loop, returns the receipt as the hook's text, which the engine shows beneath the answer, starts the next turn's count, and saves every N turns. |
| `session.end` | Banks into the month and saves the record one last time. |
| `command.run` | Answers `/receipt`, `/receipt-total`, `/receipt-month` and `/receipt-clear`. |

The plugin never rewrites the answer: a `turn.complete` hook's text is shown beneath the answer, and the transcript's record is unchanged.

**Splitting dollars between loops.** The ledger is one figure for the whole session, so the plugin reads it at each spawn and at each turn's end, and credits each movement to the loop whose event ended the window:

| Reading taken at | Credited to |
|------------------|-------------|
| `agent.spawn`, before the subagent starts | the main loop |
| a subagent run's `turn.complete` | the agents |
| the main loop's `turn.complete` | the main loop |

A foreground subagent blocks the main loop while it runs, so for those the split is exact.

**Persistence.** Two kinds of small JSON record live in the plugin's own store (`$.store`, a file under the Claude Code configuration directory). No per-turn history is kept.

The **session record**, under `session:<id>`, is the session's running total: the session id, when it began, when it was saved, turns, subagent runs, the token counts, the ledger's dollars, and how much of all that is already in a month's tally. It is written at chosen moments, never on every event:

- every `saveEvery` turns (10 by default; 0 turns this off),
- at `session.end`, which shares one short time bound with everything else that runs at exit, and
- by each of the commands.

A session with nothing in it (no turns, no subagent runs, no tokens, and a ledger at zero) is not written at any of these moments, so a session opened and closed without a prompt leaves no record. At `session.start` the plugin reads the record back, so a resumed session or a hot-reloaded module continues its count instead of starting at zero.

The **month record**, under `month:<YYYY-MM>`, is the tally of every session that saved in that calendar month (local time): sessions, turns, subagent runs, tokens and dollars. At every save, the plugin takes what the session has added since its last save and adds it to the month of the save, then notes in the session record that it is banked. The next save adds only what came after, so a session saved ten times is counted once, and a save that adds nothing leaves the month alone. A session is counted among the month's sessions the first time it banks something into it; a session that straddles midnight on the last day of a month puts what it saved before into one month and the rest into the next. A record saved by 0.1.x, with no banked figure, banks its whole total at its next save.

The two records have different lives, which is the point. Session records are dropped at `session.start` once older than `keepDays` (14 by default; this session's is never dropped), or all at once by `/receipt-clear`, so the store stays small whatever the number of sessions. Month records are kept for 12 months. Clearing the sessions loses nothing from the months, since everything saved was banked first.

## Limitations

- **The dollar figure is the host's ledger**, what `/cost` reports: list price unless the host is configured with its own pricing. On a subscription it is shown, but it is not what you are billed.
- **A turn's cost is a delta.** Anything else that moves the ledger during a window (a compaction's own request, a plugin's own model call) is credited to whichever loop's event ended that window.
- **Background subagents run beside the main loop.** What the main loop spends while one runs is credited to the agents. A background subagent that finishes after the turn ends is counted on the next turn's agents line.
- **A subagent's tokens are its own loop's.** The receipt line does not include them; the agents line and the session line do.
- **Turns that counted nothing** get no receipt.
- **The session's dollars count from its first launch.** A resumed session's ledger includes what it spent before the resume, as `/cost` does.
- **Cents are rounded.** Under one dollar the receipt shows three decimals; under one cent it shows `<$0.01`.
- **One text per turn.** Another plugin that answers `turn.complete` with its own text competes for the same place.
- **Subagent runs are counted, not named.**
- **A crash loses at most `saveEvery` turns** of the session's record and of the month. The session's dollars are not lost: the next save carries the whole session's figure.
- **`/receipt-total` is of the session records still kept.** With the default `keepDays` of 14 it cannot look back further than two weeks; `/receipt-month` is the long view. A session that ended before the plugin was installed is in neither. The window is by the record's save time, not its start.
- **A month's dollars are what this plugin watched.** They are the ledger's movement between saves, so a resumed session's spend from before the plugin was installed is in its session record (the whole ledger) but not in the month. A month is the local calendar month at the time of each save.
- **A crash between the two writes of a save can count once more.** The month is written first, then the session record; a kill between them leaves the record saying less is banked than is, and the next save banks that part again. The window is two small writes.
- **Session records are per plugin store.** Installing under a different plugin name or from a different folder starts a separate store.
- **The store is capped at 4 MiB** by the host. A record is a few hundred bytes, session records are dropped after `keepDays` and months after 12, so ordinary use stays far below it.
- **The terminal only.** The receipt has not been checked on the desktop app's Code tab.



## Using turn-receipt with the Agent SDK
The plugin works in a headless session driven by the Agent SDK.

### Requirements
- `claude-agent-sdk` 0.2.165 or later. The SDK runs the Claude Code binary it
  bundles, not the one on your PATH, and 0.2.165 is the first release whose
  bundled binary (2.1.294) loads mods.  


### Two ways to load it, and where the receipts go
A session that reads your user settings (the SDK's default) loads the
installed plugin on its own, and there is nothing to do. A sealed session,
`setting_sources=[]`, never reads those settings, so nothing installed loads
unless the harness asks for it. The two ways of asking differ in where the
receipts end up.

The plugin keeps its ledger in a store file under `~/.claude/plugins/store/`.
The file is named after the plugin's **identity**, and the identity depends
on how the session loaded the plugin.

| | Installed plugin | Directory (`--plugin-dir`) |
|---|---|---|
| SDK option | `extra_args={"settings": ...}` with the plugin's key | `plugins=[{"type": "local", "path": ...}]` |
| Identity | `turn-receipt@<marketplace>` | `turn-receipt@inline` |
| Store file | `turn-receipt_<marketplace>-<hash>.json`, the one your own sessions write | `turn-receipt_inline-<hash>.json`, a second file |
| Shows up in `/receipt-total` in your terminal | yes | no |
| How to read it headlessly | `claude -p "/receipt-total"` | `claude -p "/receipt-total" --plugin-dir /path/to/turn-receipt` |
| Updated by `claude plugin update` | yes | no, it is whatever the checkout holds |
| Pick it when | you want the harness's spend in the same totals as your own sessions | 1. you are developing the plugin, or <br> 2. you want the harness's spend kept apart |

Here is sample code for each option: 

**Route 1: load the installed plugin.** Pass a settings fragment holding
only the plugin's key. The CLI honours `--settings` even with the settings
files off, and loads the plugin exactly as installed: same identity, same
store, same version as your own sessions.

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

The key is the plugin's name and marketplace as `claude plugin list` prints
it, or as the key reads in `~/.claude/plugins/installed_plugins.json`. Keep
the fragment to that one key: anything else in it is a setting the sealed
session was built to exclude.

Every session the harness runs then accrues under your name. `/receipt-total`
and `/receipt-month` in your ordinary Claude Code session report the harness's
sessions and your own interactive ones together, one line per session in the
store. If you need to tell them apart afterwards, the session ids in the
store match the `session_id` on the SDK's `ResultMessage`; your own
interactive sessions are the ones that are not in the harness's logs.

**Route 2: load a directory.** The SDK's `plugins` option becomes
`--plugin-dir`:

```python
options = ClaudeAgentOptions(
    plugins=[{"type": "local", "path": "/path/to/turn-receipt"}],
    setting_sources=[],
    ...
)
```

A plugin loaded this way is `turn-receipt@inline`, and the CLI gives it a
store of its own. Nothing the harness spends appears in your terminal's
`/receipt-total`, and nothing you spend appears in the harness's file. To
read the harness's ledger, start a session with the same `--plugin-dir`;
headless is enough:

```bash
claude -p "/receipt-total" --plugin-dir /path/to/turn-receipt
```

The inline file exists only while something loads the plugin that way. If
you switch a harness from route 2 to route 1, the sessions already in the
inline file stay there and are not merged; the file can be deleted once you
no longer need those totals.
 

### The receipt message (in the SDK)

The receipt is the `turn.complete` hook's text. In a headless session the
CLI sends it as a system message of subtype `informational`:

- it arrives **after** the turn's `ResultMessage`, usually within
  milliseconds;
- `content` is prefixed with the hook chain's names
  (`turn-receipt+cc-plugin-agents-md: `);
- the newline between the receipt's lines comes through as U+FFFD
  (observed on 2.1.294). Replace it before splitting lines;
- the SDK's per-turn reader, `receive_response()`, stops at the
  `ResultMessage`. Read that way and the receipt is still in the queue when
  the turn ends: it surfaces at the head of the next turn's stream, or the last one can be lost if you disconnect from `ResultMessage`. 
  See a sample below for how I wait for them.  You can implement something similar. 
- a subagent run fires `turn.complete` too, but the plugin returns text only
for the main loop's turn. One receipt per main turn; the subagents' share is
the `agents` line inside it.


### Catching the receipt (sample)

Because the receipt follows the result, a harness needs three small things:
one reader task that observes every message, a short wait after a turn so
the receipt has landed, and a stamp that says which result each receipt
followed. This covers all three:

```python
import asyncio, time
from claude_agent_sdk import ClaudeSDKClient, ResultMessage, SystemMessage


class Receipts:
    def __init__(self):
        self.results_seen = 0
        self.notices: list[tuple[int, str]] = []

    def observe(self, message):
        """Feed every message through here, from the one reader task."""
        if isinstance(message, ResultMessage):
            self.results_seen += 1
        elif isinstance(message, SystemMessage) and message.subtype == "informational":
            text = message.data.get("content", "").replace("\ufffd", "\n")
            self.notices.append((self.results_seen, text))
            print(text)        # live, if you want it on the console

    async def settle(self, timeout: float = 1.0):
        """Wait for the latest result's receipt. The timeout is a safety net:
        a receipt lands within milliseconds of its result."""
        if self.results_seen == 0:
            return
        deadline = time.monotonic() + timeout
        while self.for_turn(self.results_seen) is None and time.monotonic() < deadline:
            await asyncio.sleep(0.02)

    def for_turn(self, n: int) -> str | None:
        # A receipt stamped n followed the n-th result, so it belongs to the
        # n-th turn. Joining that to your own prompts or rows is your harness's job.
        return next((text for k, text in reversed(self.notices) if k == n), None)


async with ClaudeSDKClient(options) as client:
    receipts = Receipts()

    async def reader():
        async for message in client.receive_messages():
            receipts.observe(message)
            ...                # your own handling of the stream

    task = asyncio.create_task(reader())
    ...                        # drive the session as usual
    task.cancel()
```

`settle()` goes:
- after a turn, before you read that turn's receipt with `for_turn(n)`;
- once more before disconnecting, or the last receipt is cut off.


## Origin and license
This plugin began as an example mod in [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground) (`claude-code/mods/turn-receipt`), built with Claude Fable 5.1 in Claude Code. The source files keep their Apache-2.0 headers. It is now maintained here as a stand-alone plugin, shared as-is, with no support or maintenance implied.
