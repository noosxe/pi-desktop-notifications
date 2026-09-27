/**
 * pi-desktop-notifications
 *
 * A Pi coding agent extension that fires native desktop notifications on
 * macOS and Linux when:
 *   - the agent finishes a run and is ready for next steps (with the
 *     outcome: completed / error / aborted, plus a snippet of the agent's
 *     final message), or
 *   - the agent is blocked mid-run waiting for user input (extension
 *     dialogs: confirm / select / input / editor).
 *
 * Backend chain (first available wins, falls through on failure):
 *   macOS: terminal-notifier -> osascript -> OSC 777/99 terminal sequences
 *   Linux: notify-send       -> dunstify   -> OSC 777/99 terminal sequences
 *
 * No runtime dependencies. Configuration via environment variables, see README.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface NotifyConfig {
	/** Master switch (PI_NOTIFY, default on). */
	enabled: boolean;
	/** macOS notification sound; "" or "none" disables (PI_NOTIFY_SOUND). */
	sound: string;
	/** Linux urgency: low | normal | critical (PI_NOTIFY_URGENCY). */
	urgency: "low" | "normal" | "critical";
	/** Notify when blocked on an extension UI prompt (PI_NOTIFY_PROMPT). */
	notifyOnPrompt: boolean;
	/** Notify when a run is aborted — usually user-initiated, so off (PI_NOTIFY_ABORT). */
	notifyOnAbort: boolean;
	/** Min milliseconds between two notifications, anti-spam; 0 disables (PI_NOTIFY_MIN_INTERVAL). */
	minIntervalMs: number;
}

export function readConfig(): NotifyConfig {
	const env = process.env;
	const urgency = (env.PI_NOTIFY_URGENCY ?? "normal").toLowerCase();
	const minInterval = env.PI_NOTIFY_MIN_INTERVAL
		? Number.parseInt(env.PI_NOTIFY_MIN_INTERVAL, 10)
		: Number.NaN;
	return {
		enabled: env.PI_NOTIFY !== "0",
		sound:
			!env.PI_NOTIFY_SOUND || env.PI_NOTIFY_SOUND.toLowerCase() === "none"
				? ""
				: env.PI_NOTIFY_SOUND,
		urgency:
			urgency === "low" || urgency === "critical" ? urgency : "normal",
		notifyOnPrompt: env.PI_NOTIFY_PROMPT !== "0",
		notifyOnAbort: env.PI_NOTIFY_ABORT === "1",
		minIntervalMs: Number.isNaN(minInterval)
			? 1500
			: Math.max(0, minInterval),
	};
}

// ---------------------------------------------------------------------------
// Notification backends
// ---------------------------------------------------------------------------

type Backend =
	| "terminal-notifier"
	| "osascript"
	| "notify-send"
	| "dunstify"
	| "osc";

const BACKEND_LABELS: Record<Backend, string> = {
	"terminal-notifier": "terminal-notifier (macOS)",
	osascript: "osascript (macOS)",
	"notify-send": "notify-send (Linux)",
	dunstify: "dunstify (Linux)",
	osc: "terminal OSC 777/99",
};

/** Cached `which` probes per binary; force=true clears the cache. */
const binProbeCache = new Map<string, boolean>();

async function hasBinary(
	pi: ExtensionAPI,
	bin: string,
	force = false,
): Promise<boolean> {
	if (!force && binProbeCache.has(bin)) return binProbeCache.get(bin)!;
	let found = false;
	try {
		const res = await pi.exec("which", [bin], { timeout: 3000 });
		found = res.code === 0 && res.stdout.trim().length > 0;
	} catch {
		found = false;
	}
	binProbeCache.set(bin, found);
	return found;
}

/** Ordered backend candidates for the current platform. */
export async function backendCandidates(
	pi: ExtensionAPI,
	force = false,
): Promise<Backend[]> {
	const out: Backend[] = [];
	if (process.platform === "darwin") {
		if (await hasBinary(pi, "terminal-notifier", force))
			out.push("terminal-notifier");
		if (await hasBinary(pi, "osascript", force)) out.push("osascript");
	} else if (process.platform === "linux") {
		if (await hasBinary(pi, "notify-send", force)) out.push("notify-send");
		if (await hasBinary(pi, "dunstify", force)) out.push("dunstify");
	}
	out.push("osc");
	return out;
}

export function appleScriptEscape(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * OSC fallback: Ghostty/iTerm2/WezTerm/rxvt understand 777, Kitty uses 99.
 * Only written when stdout is a TTY so print/JSON mode output stays clean.
 */
export function sendOsc(title: string, body: string): boolean {
	if (!process.stdout.isTTY) return false;
	try {
		if (process.env.KITTY_WINDOW_ID) {
			process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
			process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
		} else {
			process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
		}
		return true;
	} catch {
		return false;
	}
}

interface SendOptions {
	/** Treat as an error notification (used for potential urgency mapping). */
	isError?: boolean;
}

export async function sendWithBackend(
	pi: ExtensionAPI,
	backend: Backend,
	title: string,
	body: string,
	config: NotifyConfig,
	options: SendOptions = {},
): Promise<boolean> {
	switch (backend) {
		case "terminal-notifier": {
			const args = [
				"-title",
				title,
				"-message",
				body,
				"-group",
				"pi-desktop-notifications",
			];
			if (config.sound) args.push("-sound", config.sound);
			const res = await pi.exec("terminal-notifier", args, {
				timeout: 5000,
			});
			return res.code === 0;
		}
		case "osascript": {
			const sound = config.sound
				? ` sound name "${appleScriptEscape(config.sound)}"`
				: "";
			const script =
				`display notification "${appleScriptEscape(body)}" ` +
				`with title "${appleScriptEscape(title)}"${sound}`;
			const res = await pi.exec("osascript", ["-e", script], {
				timeout: 5000,
			});
			return res.code === 0;
		}
		case "notify-send": {
			const args = [
				"-a",
				"Pi",
				"-u",
				config.urgency,
				"-i",
				"dialog-information",
				title,
				body,
			];
			const res = await pi.exec("notify-send", args, { timeout: 5000 });
			return res.code === 0;
		}
		case "dunstify": {
			const args = ["-a", "Pi", "-u", config.urgency, title, body];
			const res = await pi.exec("dunstify", args, { timeout: 5000 });
			return res.code === 0;
		}
		case "osc":
			return sendOsc(title, body);
	}
}

/**
 * Send a desktop notification trying each backend in order.
 * Never throws — notification failures must not disturb the agent.
 */
async function sendNotification(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: NotifyConfig,
	title: string,
	body: string,
	options: SendOptions = {},
): Promise<{ delivered: boolean; backend?: Backend; error?: string }> {
	const candidates = await backendCandidates(pi);
	let lastError: string | undefined;
	for (const backend of candidates) {
		try {
			if (await sendWithBackend(pi, backend, title, body, config, options)) {
				return { delivered: true, backend };
			}
			lastError = `${BACKEND_LABELS[backend]} exited non-zero`;
		} catch (err) {
			lastError = `${BACKEND_LABELS[backend]}: ${err instanceof Error ? err.message : String(err)}`;
		}
	}
	// Surface problems non-intrusively in the terminal (not during streaming).
	if (!ctx.isIdle()) return { delivered: false, error: lastError };
	try {
		ctx.ui.notify(`Desktop notification failed: ${lastError}`, "warning");
	} catch {
		// No UI in this mode; nothing else to do.
	}
	return { delivered: false, error: lastError };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function projectName(cwd: string): string {
	const parts = cwd.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? cwd;
}

/** Flatten a message down to a single-line snippet for notification bodies. */
export function toSnippet(text: string, max = 140): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (!flat) return "";
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

interface AssistantMessageLike {
	role?: string;
	content?: unknown;
}

/** Extract the text of the last assistant message in the run. */
export function extractLastAssistantText(messages: unknown[]): string {
	if (!Array.isArray(messages)) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as AssistantMessageLike | undefined;
		if (m?.role !== "assistant") continue;
		const content = m.content;
		if (typeof content === "string") {
			const snippet = toSnippet(content);
			if (snippet) return snippet;
		}
		if (Array.isArray(content)) {
			const text = content
				.map((block) =>
					block && typeof block === "object" && "text" in block
						? String((block as { text?: unknown }).text ?? "")
						: "",
				)
				.filter(Boolean)
				.join(" ");
			const snippet = toSnippet(text);
			if (snippet) return snippet;
		}
	}
	return "";
}

const PROMPT_KIND_LABELS: Record<string, string> = {
	select: "a choice",
	confirm: "a confirmation",
	input: "input",
	editor: "an editor",
	custom: "a prompt",
};

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	const config = readConfig();

	let enabled = config.enabled;
	let agentRunning = false;
	let lastOutcome: "completed" | "aborted" | "error" | undefined;
	let lastAssistantText = "";
	let lastNotifiedAt = 0;

	/** Suppress duplicate notifications fired within the cooldown window. */
	function throttled(): boolean {
		const now = Date.now();
		if (now - lastNotifiedAt < config.minIntervalMs) return true;
		lastNotifiedAt = now;
		return false;
	}

	pi.on("session_start", () => {
		agentRunning = false;
		lastOutcome = undefined;
		lastAssistantText = "";
	});

	pi.on("before_agent_start", () => {
		agentRunning = true;
		lastAssistantText = "";
	});

	// `agent_end` fires per low-level run; capture the final assistant text
	// of the last run so the settle notification can show it.
	pi.on("agent_end", (event) => {
		const text = extractLastAssistantText(event.messages);
		if (text) lastAssistantText = text;
	});

	// `agent_before_settle` is the final actionable boundary and carries the
	// run outcome; `agent_settled` then fires only when no retry, compaction,
	// or queued continuation will run — the true "ready for next steps" moment.
	pi.on("agent_before_settle", (event) => {
		lastOutcome = event.outcome;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		agentRunning = false;
		if (!enabled || throttled()) return;

		const project = projectName(ctx.cwd);
		const title = `Pi · ${project}`;
		let body: string;
		let isError = false;

		if (lastOutcome === "error") {
			isError = true;
			body = "❌ Run ended with an error — ready for next steps";
		} else if (lastOutcome === "aborted") {
			if (!config.notifyOnAbort) return;
			body = "⏹ Run aborted — ready for next steps";
		} else {
			const snippet = lastAssistantText || "Task complete";
			body = `✅ ${snippet}`;
		}

		await sendNotification(pi, ctx, config, title, body, { isError });
	});

	// Blocking extension dialogs (confirm/select/input/editor) shown mid-run
	// mean the agent cannot continue until the user answers.
	pi.on("ui_prompt_start", async (event, ctx) => {
		if (!enabled || !config.notifyOnPrompt) return;
		if (!agentRunning) return; // user typed the command interactively; they're present
		if (throttled()) return;

		const project = projectName(ctx.cwd);
		const title = `Pi needs your input · ${project}`;
		const kind = PROMPT_KIND_LABELS[event.kind] ?? event.kind;
		const body = event.title
			? `💬 ${kind}: ${toSnippet(event.title, 100)}`
			: `💬 Pi is waiting for ${kind}`;

		await sendNotification(pi, ctx, config, title, body);
	});

	// -----------------------------------------------------------------------
	// /notify command: status | on | off | test [message]
	// -----------------------------------------------------------------------

	pi.registerCommand("notify", {
		description:
			"Desktop notifications: /notify [status|on|off|test [message]]",
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const arg = rest.join(" ");

			switch (sub ?? "status") {
				case "on": {
					enabled = true;
					ctx.ui.notify("Desktop notifications enabled", "info");
					break;
				}
				case "off": {
					enabled = false;
					ctx.ui.notify("Desktop notifications disabled", "info");
					break;
				}
				case "test": {
					// Re-probe so a freshly installed notifier is picked up.
					binProbeCache.clear();
					const candidates = await backendCandidates(pi, true);
					const title = `Pi · ${projectName(ctx.cwd)}`;
					const body = arg || "Test notification — it works!";
					const result = await sendNotification(
						pi,
						ctx,
						config,
						title,
						body,
					);
					if (result.delivered && result.backend && result.backend !== "osc") {
						ctx.ui.notify(
							`Test notification sent via ${BACKEND_LABELS[result.backend]}`,
							"info",
						);
					} else if (result.delivered) {
						ctx.ui.notify(
							"No native notifier found; sent via terminal escape sequence (OSC)",
							"warning",
						);
					} else {
						ctx.ui.notify(
							`Test failed: ${result.error ?? "no backend available"}`,
							"error",
						);
					}
					break;
				}
				case "status": {
					const candidates = await backendCandidates(pi);
					const backendList = candidates
						.filter((b) => b !== "osc")
						.map((b) => BACKEND_LABELS[b])
						.join(", ");
					ctx.ui.notify(
						`Desktop notifications: ${enabled ? "on" : "off"}` +
							` · backend: ${backendList || "terminal OSC fallback only"}` +
							` (test with /notify test)`,
						"info",
					);
					break;
				}
				default:
					ctx.ui.notify(
						"Usage: /notify [status|on|off|test [message]]",
						"warning",
					);
			}
		},
	});
}
