/**
 * Event-flow tests: drive the extension factory's real event handlers through
 * a fake ExtensionAPI and assert on the notification calls and UI feedback.
 * Zero test dependencies: node:test + Node's native TS type stripping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import factory from "../index.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fakePi, withEnv, withPlatform } from "./support.ts";
import type { ExecCall } from "./support.ts";

type Handler = (event: any, ctx: ExtensionContext) => unknown;

interface Harness {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	execLog: ExecCall[];
	uiMessages: Array<{ message: string; level: string }>;
	fire: (event: string, payload?: Record<string, unknown>) => Promise<void>;
	notifySends: () => ExecCall[];
	runCommand: (input: string) => Promise<void>;
}

function createHarness(
	options: { execCode?: number; execThrows?: boolean; isIdle?: boolean } = {},
): Harness {
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, Handler>();
	const execLog: ExecCall[] = [];
	const uiMessages: Array<{ message: string; level: string }> = [];

	const fake = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand(name: string, def: { handler: Handler }) {
			commands.set(name, def.handler);
		},
		async exec(cmd: string, args: string[], opts?: unknown) {
			execLog.push({ cmd, args, opts });
			if (options.execThrows) throw new Error("spawn failed");
			return {
				code: options.execCode ?? 0,
				stdout: "/usr/bin/fake",
				stderr: "",
				killed: false,
			};
		},
	};

	const ctxBase = {
		cwd: "/home/me/my-proj",
		isIdle: () => options.isIdle ?? true,
		ui: {
			notify: (message: string, level?: string) => {
				uiMessages.push({ message, level: level ?? "info" });
			},
		},
	};

	const harness: Harness = {
		pi: fake as unknown as ExtensionAPI,
		ctx: ctxBase as unknown as ExtensionContext,
		execLog,
		uiMessages,
		async fire(event, payload = {}) {
			for (const handler of handlers.get(event) ?? []) {
				await handler(payload, ctxBase as unknown as ExtensionContext);
			}
		},
		notifySends: () => execLog.filter((call) => call.cmd !== "which"),
		async runCommand(input) {
			const handler = commands.get("notify");
			assert.ok(handler, "/notify command must be registered");
			await handler(input, ctxBase as unknown as ExtensionContext);
		},
	};
	return harness;
}

/** Drive the full settle sequence the way pi would fire it. */
async function settle(
	harness: Harness,
	opts: { messages?: unknown[]; outcome?: string } = {},
) {
	await harness.fire("before_agent_start");
	if (opts.messages) {
		await harness.fire("agent_end", { messages: opts.messages });
	}
	await harness.fire("agent_before_settle", { outcome: opts.outcome ?? "completed" });
	await harness.fire("agent_settled");
}

// ---------------------------------------------------------------------------
// agent_settled behavior
// ---------------------------------------------------------------------------

test("completed settle notifies with project title and assistant snippet", async () => {
	await withPlatform("darwin", async () => {
		await withEnv({}, async () => {
			const h = createHarness();
			factory(h.pi);
			await settle(h, { messages: [{ role: "assistant", content: "All tests pass" }] });

			const sends = h.notifySends();
			assert.equal(sends.length, 1);
			assert.equal(sends[0]?.cmd, "terminal-notifier");
			assert.deepEqual(sends[0]?.args.slice(0, 4), [
				"-title",
				"Pi · my-proj",
				"-message",
				"✅ All tests pass",
			]);
		});
	});
});

test("completed settle without assistant text falls back to 'Task complete'", async () => {
	await withEnv({}, async () => {
		const h = createHarness();
		factory(h.pi);
		await settle(h);

		assert.equal(h.notifySends()[0]?.args[3], "✅ Task complete");
	});
});

test("error settle notifies with the error body", async () => {
	await withEnv({}, async () => {
		const h = createHarness();
		factory(h.pi);
		await settle(h, { outcome: "error" });

		const sends = h.notifySends();
		assert.equal(sends.length, 1);
		assert.match(String(sends[0]?.args[3]), /❌/);
	});
});

test("aborted settle is silent by default", async () => {
	await withEnv({}, async () => {
		const h = createHarness();
		factory(h.pi);
		await settle(h, { outcome: "aborted" });

		assert.equal(h.notifySends().length, 0);
	});
});

test("aborted settle notifies when PI_NOTIFY_ABORT=1", async () => {
	await withEnv({ PI_NOTIFY_ABORT: "1" }, async () => {
		const h = createHarness();
		factory(h.pi);
		await settle(h, { outcome: "aborted" });

		const sends = h.notifySends();
		assert.equal(sends.length, 1);
		assert.match(String(sends[0]?.args[3]), /⏹/);
	});
});

test("notifications are disabled entirely by PI_NOTIFY=0", async () => {
	await withEnv({ PI_NOTIFY: "0" }, async () => {
		const h = createHarness();
		factory(h.pi);
		await settle(h, { messages: [{ role: "assistant", content: "done" }] });

		assert.equal(h.notifySends().length, 0);
	});
});

test("duplicate settles within the cooldown window are suppressed", async () => {
	await withEnv({ PI_NOTIFY_MIN_INTERVAL: "60000" }, async () => {
		const h = createHarness();
		factory(h.pi);
		await settle(h, { messages: [{ role: "assistant", content: "first" }] });
		await settle(h, { messages: [{ role: "assistant", content: "second" }] });

		assert.equal(h.notifySends().length, 1);
	});
});

// ---------------------------------------------------------------------------
// ui_prompt_start behavior
// ---------------------------------------------------------------------------

test("blocking prompt mid-run notifies with the kind label and title", async () => {
	await withEnv({}, async () => {
		const h = createHarness();
		factory(h.pi);
		await h.fire("before_agent_start");
		await h.fire("ui_prompt_start", { kind: "confirm", title: "Delete everything?" });

		const sends = h.notifySends();
		assert.equal(sends.length, 1);
		assert.deepEqual(sends[0]?.args.slice(0, 4), [
			"-title",
			"Pi needs your input · my-proj",
			"-message",
			"💬 a confirmation: Delete everything?",
		]);
	});
});

test("prompt notifications are skipped when the agent is not running", async () => {
	await withEnv({}, async () => {
		const h = createHarness();
		factory(h.pi);
		// no before_agent_start: the user typed the command interactively
		await h.fire("ui_prompt_start", { kind: "input", title: "Type something" });

		assert.equal(h.notifySends().length, 0);
	});
});

test("prompt notifications respect PI_NOTIFY_PROMPT=0", async () => {
	await withEnv({ PI_NOTIFY_PROMPT: "0" }, async () => {
		const h = createHarness();
		factory(h.pi);
		await h.fire("before_agent_start");
		await h.fire("ui_prompt_start", { kind: "select", title: "Pick one" });

		assert.equal(h.notifySends().length, 0);
	});
});

test("unknown prompt kinds fall back to the raw kind", async () => {
	await withEnv({}, async () => {
		const h = createHarness();
		factory(h.pi);
		await h.fire("before_agent_start");
		await h.fire("ui_prompt_start", { kind: "future-kind" });

		assert.equal(h.notifySends()[0]?.args[3], "💬 Pi is waiting for future-kind");
	});
});

// ---------------------------------------------------------------------------
// state resets and failure surfacing
// ---------------------------------------------------------------------------

test("session_start resets run state: prompts stay silent until a new run", async () => {
	await withEnv({}, async () => {
		const h = createHarness();
		factory(h.pi);
		await settle(h);
		await h.fire("session_start");
		await h.fire("ui_prompt_start", { kind: "confirm", title: "Continue?" });

		assert.equal(h.notifySends().length, 1);
	});
});

test("backend failure with idle agent surfaces a warning via ui", async () => {
	// linux stub: darwin probes are cached true by earlier tests, so switch
	// platforms to exercise the no-native-notifier fallback deterministically
	await withPlatform("linux", async () => {
		await withEnv({}, async () => {
			const h = createHarness({ execCode: 1, isIdle: true });
			factory(h.pi);
			await settle(h);

			assert.equal(h.notifySends().length, 0);
			assert.equal(h.uiMessages.length, 1);
			assert.match(h.uiMessages[0]?.message ?? "", /Desktop notification failed/);
		});
	});
});

test("backend failure while the agent is busy stays silent (never disturbs the run)", async () => {
	await withPlatform("linux", async () => {
		await withEnv({}, async () => {
			const h = createHarness({ execCode: 1, isIdle: false });
			factory(h.pi);
			await settle(h);

			assert.equal(h.notifySends().length, 0);
			assert.equal(h.uiMessages.length, 0);
		});
	});
});

test("exec throwing never rejects the event handler", async () => {
	await withPlatform("linux", async () => {
		await withEnv({}, async () => {
			const h = createHarness({ execThrows: true, isIdle: false });
			factory(h.pi);
			await settle(h, { messages: [{ role: "assistant", content: "done" }] });

			assert.equal(h.notifySends().length, 0);
			assert.equal(h.uiMessages.length, 0);
		});
	});
});

// ---------------------------------------------------------------------------
// /notify command
// ---------------------------------------------------------------------------

test("/notify off then settle: no notification; /notify on restores it", async () => {
	await withEnv({}, async () => {
		const h = createHarness();
		factory(h.pi);

		await h.runCommand("off");
		await settle(h);
		assert.equal(h.notifySends().length, 0);

		await h.runCommand("on");
		await settle(h, { messages: [{ role: "assistant", content: "again" }] });
		assert.equal(h.notifySends().length, 1);
	});
});

test("/notify status reports the on state and detected backends", async () => {
	await withPlatform("darwin", async () => {
		await withEnv({}, async () => {
			const h = createHarness();
			factory(h.pi);

			await h.runCommand("status");
			const message = h.uiMessages.at(-1)?.message ?? "";
			assert.match(message, /Desktop notifications: on/);
			assert.match(message, /backend: terminal-notifier/);
		});
	});
});

test("/notify test sends a message and reports the backend", async () => {
	await withPlatform("darwin", async () => {
		await withEnv({}, async () => {
			const h = createHarness();
			factory(h.pi);

			await h.runCommand("test hello from the test");
			const sends = h.notifySends().filter((call) => call.cmd === "terminal-notifier");
			assert.equal(sends.length, 1);
			assert.equal(sends[0]?.args[3], "hello from the test");
			assert.match(h.uiMessages.at(-1)?.message ?? "", /Test notification sent via/);
		});
	});
});

test("/notify test reports an error when no backend works", async () => {
	await withEnv({}, async () => {
		const h = createHarness({ execThrows: true });
		factory(h.pi);

		await h.runCommand("test");
		assert.equal(
			h.uiMessages.some((m) => m.level === "error" && m.message.startsWith("Test failed")),
			true,
		);
	});
});
