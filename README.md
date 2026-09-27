# pi-desktop-notifications

A [Pi](https://github.com/earendil-works/pi) coding agent extension that sends
**native desktop notifications** on **macOS** and **Linux** when:

- ✅ **A run finishes** — the agent completed what was in progress and is ready
  for next steps. The notification shows the outcome (completed / error /
  aborted) and a snippet of the agent's final message, so you can see at a
  glance what happened without switching back to the terminal.
- 💬 **The agent needs your input** — Pi is blocked mid-run waiting on a
  dialog (confirmation, choice, text input, editor) raised by an extension.

Zero runtime dependencies. Works in every Pi mode (TUI, RPC, print/JSON) —
native notifiers don't need a terminal, so `pi -p "long task"` from a script
notifies too.

## Install

### Option A — install as a Pi package (recommended)

```bash
pi install npm:pi-desktop-notifications
```

Installs from npm and registers the package in your personal Pi settings
(`~/.pi/agent/settings.json`). Restart Pi or run `/reload`, then start Pi
normally. Pin a version with `pi install npm:pi-desktop-notifications@<version>`
and stay current with `pi update --extensions`.

### Option B — try it in a single session

```bash
pi -e npm:pi-desktop-notifications
```

`-e` (`--extension`) loads the package for one invocation without adding it to
your settings — nothing is installed or persisted. Swap `pi` for your usual
invocation (e.g. `pi -e npm:pi-desktop-notifications -p "long task"`) to get
notified in scripted runs too.
## Verify

Start Pi and run:

```
/notify test
```

You should see a desktop notification and a confirmation of which backend
delivered it.

## The `/notify` command

| Command | Effect |
|---|---|
| `/notify` or `/notify status` | Show enabled state and detected backend |
| `/notify on` / `/notify off` | Enable/disable for this session |
| `/notify test [message]` | Send a test notification (re-probes for notifiers) |

## How it works

Pi fires `agent_settled` only after a run has fully settled — no automatic
retry, compaction, or queued continuation will follow — which is exactly the
"ready for next steps" moment. The run outcome comes from
`agent_before_settle`, and the notification body shows the last assistant
message. Blocking extension dialogs are covered by `ui_prompt_start` while a
run is active.

Notifications are throttled (default 1.5 s minimum between two) to avoid
storms, and a failed backend falls through to the next one — a notification
problem can never break the agent.

## Notification backends

The first available backend is used; on failure the chain falls through:

| Platform | Order |
|---|---|
| macOS | `terminal-notifier` → `osascript` → OSC 777/99 terminal escape |
| Linux | `notify-send` → `dunstify` → OSC 777/99 terminal escape |

- **macOS**: `osascript` is built in. Notifications may be attributed to
  *Script Editor* and your terminal app must have notification permission
  (System Settings → Notifications). For nicer attribution, install
  [`terminal-notifier`](https://github.com/julienXX/terminal-notifier)
  (`brew install terminal-notifier`) — it is picked up automatically.
- **Linux**: needs `libnotify` (`notify-send`) and a notification daemon —
  GNOME and KDE ship one; wlroots/Hyprland users typically run
  [`mako`](https://github.com/emersion/mako) or
  [`dunst`](https://dunst-project.org/). Without a daemon, `notify-send`
  silently drops the notification; `dunstify` is used when only dunst is
  present. If no native backend exists, OSC 777/99 sequences are emitted for
  supporting terminals (Ghostty, iTerm2, WezTerm, Kitty, rxvt-unicode).

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `PI_NOTIFY` | `1` | Master switch; `0` starts disabled |
| `PI_NOTIFY_SOUND` | `Glass` | macOS sound name (`none` or empty to disable) |
| `PI_NOTIFY_URGENCY` | `normal` | Linux urgency: `low`, `normal`, `critical` |
| `PI_NOTIFY_PROMPT` | `1` | Notify when blocked on an extension dialog; `0` disables |
| `PI_NOTIFY_ABORT` | `0` | Also notify when a run is aborted; set to `1` or `true` (case-insensitive) to enable |
| `PI_NOTIFY_MIN_INTERVAL` | `1500` | Minimum milliseconds between two notifications; `0` disables the throttle |

Example:

```bash
PI_NOTIFY_SOUND=Pop PI_NOTIFY_URGENCY=critical pi
```

## Development

```bash
pnpm install
pnpm run check   # typecheck with the real Pi extension types
pnpm test        # dependency-free node:test suite (helpers + event flow)
```

Or use the Nix dev shell, which provides Node (≥ 22.19, as Pi requires), git, pnpm,
and the notification tools for your platform (`terminal-notifier` on macOS,
`libnotify` + `dunst` on Linux), and runs `pnpm install` on first entry:

```bash
nix develop
```


If you use [direnv](https://direnv.net/), `direnv allow` once in the repo root loads the
same shell automatically whenever you `cd` in — no `nix develop` wrapper needed.
Supports `x86_64-linux`, `aarch64-linux`, and `aarch64-darwin` (Apple Silicon;
nixpkgs 26.11 dropped Intel Mac support).

Then load it directly while iterating:

```bash
pi --extension ./index.ts
```

## License

[MIT](./LICENSE)
