/**
 * Unit tests for the pure helpers exported by index.ts.
 * Zero test dependencies: node:test + Node's native TS type stripping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	appleScriptEscape,
	backendCandidates,
	extractLastAssistantText,
	projectName,
	readConfig,
	sendOsc,
	sendWithBackend,
	toSnippet,
} from "../index.ts";
import type { NotifyConfig } from "../index.ts";
import { fakePi, withCapturedStdout, withEnv, withPlatform } from "./support.ts";

// ---------------------------------------------------------------------------
// readConfig — env var parsing
// ---------------------------------------------------------------------------

test("readConfig: defaults with no PI_NOTIFY_* vars set", () => {
	withEnv({}, () => {
		assert.deepEqual(readConfig(), {
			enabled: true,
			sound: "",
			urgency: "normal",
			notifyOnPrompt: true,
			notifyOnAbort: false,
			minIntervalMs: 1500,
		});
	});
});

test("readConfig: PI_NOTIFY=0 is the only way to disable", () => {
	withEnv({ PI_NOTIFY: "0" }, () => {
		assert.equal(readConfig().enabled, false);
	});
	withEnv({ PI_NOTIFY: "1" }, () => {
		assert.equal(readConfig().enabled, true);
	});
	withEnv({ PI_NOTIFY: "false" }, () => {
		assert.equal(readConfig().enabled, true);
	});
});

test("readConfig: sound passthrough and 'none'/empty disabling", () => {
	withEnv({ PI_NOTIFY_SOUND: "Glass" }, () => {
		assert.equal(readConfig().sound, "Glass");
	});
	withEnv({ PI_NOTIFY_SOUND: "none" }, () => {
		assert.equal(readConfig().sound, "");
	});
	withEnv({ PI_NOTIFY_SOUND: "" }, () => {
		assert.equal(readConfig().sound, "");
	});
	withEnv({ PI_NOTIFY_SOUND: "NONE" }, () => {
		assert.equal(readConfig().sound, "");
	});
});

test("readConfig: urgency validation is case-insensitive with fallback", () => {
	withEnv({ PI_NOTIFY_URGENCY: "critical" }, () => {
		assert.equal(readConfig().urgency, "critical");
	});
	withEnv({ PI_NOTIFY_URGENCY: "LOW" }, () => {
		assert.equal(readConfig().urgency, "low");
	});
	withEnv({ PI_NOTIFY_URGENCY: "bogus" }, () => {
		assert.equal(readConfig().urgency, "normal");
	});
});

test("readConfig: prompt and abort toggles", () => {
	withEnv({ PI_NOTIFY_PROMPT: "0" }, () => {
		assert.equal(readConfig().notifyOnPrompt, false);
	});
	withEnv({ PI_NOTIFY_ABORT: "1" }, () => {
		assert.equal(readConfig().notifyOnAbort, true);
	});
	withEnv({ PI_NOTIFY_ABORT: "true" }, () => {
		// 1/true accepted case-insensitively (fixes #8; used to be exact "1" only)
		assert.equal(readConfig().notifyOnAbort, true);
	});
	withEnv({ PI_NOTIFY_ABORT: "TRUE" }, () => {
		assert.equal(readConfig().notifyOnAbort, true);
	});
	withEnv({ PI_NOTIFY_ABORT: "yes" }, () => {
		// anything else stays off
		assert.equal(readConfig().notifyOnAbort, false);
	});
});

test("readConfig: min interval parsing", () => {
	withEnv({ PI_NOTIFY_MIN_INTERVAL: "5000" }, () => {
		assert.equal(readConfig().minIntervalMs, 5000);
	});
	withEnv({ PI_NOTIFY_MIN_INTERVAL: "abc" }, () => {
		assert.equal(readConfig().minIntervalMs, 1500);
	});
	withEnv({ PI_NOTIFY_MIN_INTERVAL: "" }, () => {
		// empty string is treated as unset
		assert.equal(readConfig().minIntervalMs, 1500);
	});

	withEnv({ PI_NOTIFY_MIN_INTERVAL: "-5" }, () => {
		// negative values clamp to 0, effectively disabling the throttle
		assert.equal(readConfig().minIntervalMs, 0);
	});
	withEnv({ PI_NOTIFY_MIN_INTERVAL: "0" }, () => {
		// 0 disables the throttle entirely (fixes #7; used to fall back to the
		// default because parseInt("0") is falsy and || 1500 kicked in)
		assert.equal(readConfig().minIntervalMs, 0);
	});
});

// ---------------------------------------------------------------------------
// projectName / toSnippet / appleScriptEscape — small pure helpers
// ---------------------------------------------------------------------------

test("projectName: last path segment, tolerant of trailing slash and root", () => {
	assert.equal(projectName("/home/alice/my-proj"), "my-proj");
	assert.equal(projectName("/home/alice/my-proj/"), "my-proj");
	assert.equal(projectName("/"), "/");
	assert.equal(projectName("relative-dir"), "relative-dir");
});

test("toSnippet: collapses whitespace and trims", () => {
	assert.equal(toSnippet("  a\n\n b\t c  "), "a b c");
});

test("toSnippet: empty input", () => {
	assert.equal(toSnippet(""), "");
	assert.equal(toSnippet("   \n\t "), "");
});

test("toSnippet: strings at or under the limit are untouched", () => {
	const text = "x".repeat(140);
	assert.equal(toSnippet(text), text);
	assert.equal(toSnippet("hello"), "hello");
});

test("toSnippet: strings over the limit are truncated with ellipsis", () => {
	const snippet = toSnippet("x".repeat(141));
	assert.equal(snippet.length, 140);
	assert.equal(snippet.endsWith("…"), true);
	assert.equal(snippet, `${"x".repeat(139)}…`);
});

test("toSnippet: custom max", () => {
	assert.equal(toSnippet("abcdef", 5), "abcd…");
});

test("appleScriptEscape: escapes quotes and backslashes", () => {
	assert.equal(appleScriptEscape('say "hi"'), 'say \\"hi\\"');
	assert.equal(appleScriptEscape("back\\slash"), "back\\\\slash");
	assert.equal(appleScriptEscape('\\broken"'), '\\\\broken\\"');
	assert.equal(appleScriptEscape("plain"), "plain");
});

// ---------------------------------------------------------------------------
// extractLastAssistantText — message walking
// ---------------------------------------------------------------------------

test("extractLastAssistantText: string content of the last assistant message", () => {
	const messages = [
		{ role: "user", content: "question" },
		{ role: "assistant", content: "final answer" },
	];
	assert.equal(extractLastAssistantText(messages), "final answer");
});

test("extractLastAssistantText: skips non-assistant messages after it", () => {
	const messages = [
		{ role: "assistant", content: "earlier" },
		{ role: "user", content: "later" },
		{ role: "toolResult", content: "result" },
	];
	assert.equal(extractLastAssistantText(messages), "earlier");
});

test("extractLastAssistantText: joins text blocks and skips empty blocks", () => {
	const messages = [
		{
			role: "assistant",
			content: [
				{ type: "text", text: "Hello" },
				{ type: "other" },
				{ type: "text", text: "world" },
			],
		},
	];
	assert.equal(extractLastAssistantText(messages), "Hello world");
});

test("extractLastAssistantText: empty assistant content falls back to earlier assistant", () => {
	const messages = [
		{ role: "assistant", content: "the real one" },
		{ role: "assistant", content: "" },
	];
	assert.equal(extractLastAssistantText(messages), "the real one");
});

test("extractLastAssistantText: no assistant messages", () => {
	assert.equal(extractLastAssistantText([]), "");
	assert.equal(extractLastAssistantText([{ role: "user", content: "hi" }]), "");
	assert.equal(extractLastAssistantText(null as unknown as unknown[]), "");
});

// ---------------------------------------------------------------------------
// sendOsc — terminal escape fallback
// ---------------------------------------------------------------------------

test("sendOsc: does nothing when stdout is not a TTY", () => {
	const captured = withCapturedStdout(false, () => {
		assert.equal(sendOsc("Title", "Body"), false);
	});
	assert.equal(captured, "");
});

test("sendOsc: writes OSC 777 for generic terminals", () => {
	delete process.env.KITTY_WINDOW_ID;
	const captured = withCapturedStdout(true, () => {
		assert.equal(sendOsc("Title", "Body"), true);
	});
	assert.equal(captured, "\x1b]777;notify;Title;Body\x07");
});

test("sendOsc: writes OSC 99 title/body split for Kitty", () => {
	process.env.KITTY_WINDOW_ID = "1";
	try {
		const captured = withCapturedStdout(true, () => {
			assert.equal(sendOsc("Title", "Body"), true);
		});
		assert.equal(captured, "\x1b]99;i=1:d=0;Title\x1b\\\x1b]99;i=1:p=body;Body\x1b\\");
	} finally {
		delete process.env.KITTY_WINDOW_ID;
	}
});

// ---------------------------------------------------------------------------
// backendCandidates — platform ordering with OSC always last
// ---------------------------------------------------------------------------

test("backendCandidates: darwin probes terminal-notifier then osascript", async () => {
	await withPlatform("darwin", async () => {
		const { pi, execLog } = fakePi();
		assert.deepEqual(await backendCandidates(pi, true), [
			"terminal-notifier",
			"osascript",
			"osc",
		]);
		assert.deepEqual(
			execLog.map((call) => [call.cmd, call.args]),
			[
				["which", ["terminal-notifier"]],
				["which", ["osascript"]],
			],
		);
	});
});

test("backendCandidates: linux probes notify-send then dunstify", async () => {
	await withPlatform("linux", async () => {
		const { pi } = fakePi();
		assert.deepEqual(await backendCandidates(pi, true), [
			"notify-send",
			"dunstify",
			"osc",
		]);
	});
});

test("backendCandidates: no native notifier means OSC only", async () => {
	await withPlatform("linux", async () => {
		const { pi } = fakePi({ code: 1, stdout: "" });
		assert.deepEqual(await backendCandidates(pi, true), ["osc"]);
	});
});

test("backendCandidates: unsupported platforms get OSC only", async () => {
	await withPlatform("freebsd", async () => {
		const { pi } = fakePi();
		assert.deepEqual(await backendCandidates(pi, true), ["osc"]);
	});
});

// ---------------------------------------------------------------------------
// sendWithBackend — per-backend argument construction
// ---------------------------------------------------------------------------

const baseConfig: NotifyConfig = {
	enabled: true,
	sound: "",
	urgency: "normal",
	notifyOnPrompt: true,
	notifyOnAbort: false,
	minIntervalMs: 1500,
};

test("sendWithBackend: notify-send args carry app, urgency, icon, title, body", async () => {
	const { pi, execLog } = fakePi();
	const ok = await sendWithBackend(pi, "notify-send", "Title", "Body", baseConfig);
	assert.equal(ok, true);
	assert.deepEqual(execLog[0], {
		cmd: "notify-send",
		args: ["-a", "Pi", "-u", "normal", "-i", "dialog-information", "Title", "Body"],
		opts: { timeout: 5000 },
	});
});

test("sendWithBackend: notify-send urgency comes from config", async () => {
	const { pi, execLog } = fakePi();
	await sendWithBackend(pi, "notify-send", "T", "B", {
		...baseConfig,
		urgency: "critical",
	});
	assert.deepEqual(execLog[0]?.args, [
		"-a",
		"Pi",
		"-u",
		"critical",
		"-i",
		"dialog-information",
		"T",
		"B",
	]);
});

test("sendWithBackend: dunstify args carry app, urgency, title, body", async () => {
	const { pi, execLog } = fakePi();
	await sendWithBackend(pi, "dunstify", "T", "B", { ...baseConfig, urgency: "low" });
	assert.deepEqual(execLog[0]?.args, ["-a", "Pi", "-u", "low", "T", "B"]);
});

test("sendWithBackend: terminal-notifier includes sound only when set", async () => {
	const { pi, execLog } = fakePi();
	await sendWithBackend(pi, "terminal-notifier", "T", "B", {
		...baseConfig,
		sound: "Glass",
	});
	assert.deepEqual(execLog[0]?.args, [
		"-title",
		"T",
		"-message",
		"B",
		"-group",
		"pi-desktop-notifications",
		"-sound",
		"Glass",
	]);

	const silent = fakePi();
	await sendWithBackend(silent.pi, "terminal-notifier", "T", "B", baseConfig);
	assert.equal(silent.execLog[0]?.args.includes("-sound"), false);
});

test("sendWithBackend: osascript script embeds escaped title/body", async () => {
	const { pi, execLog } = fakePi();
	await sendWithBackend(pi, "osascript", 'He said "hi"', "B", baseConfig);
	assert.deepEqual(execLog[0]?.args, [
		"-e",
		'display notification "B" with title "He said \\"hi\\""',
	]);
});

test("sendWithBackend: returns false when the backend exits non-zero", async () => {
	const { pi } = fakePi({ code: 1, stdout: "" });
	const ok = await sendWithBackend(pi, "notify-send", "T", "B", baseConfig);
	assert.equal(ok, false);
});
