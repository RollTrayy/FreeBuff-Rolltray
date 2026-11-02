import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bridge between the plugin (Node.js) and the CoreMIDI helper (Swift).
 *
 * The helper publishes a virtual MIDI source named "Stream Deck MIDI" and reads
 * one JSON command per line on stdin. Stream Deck starts the plugin at login and
 * restarts it when it crashes, so the port exists whenever Stream Deck runs and
 * needs no configuration in Audio MIDI Setup.
 */

const BINARY_NAME = "midi-bridge";
const RESTART_MIN_MS = 500;
const RESTART_MAX_MS = 10_000;
const MAX_QUEUED_COMMANDS = 16;

export type MidiCommand =
	| { cmd: "noteOn"; channel: number; note: number; velocity: number }
	| { cmd: "noteOff"; channel: number; note: number; velocity?: number }
	| { cmd: "cc"; channel: number; controller: number; value: number }
	| { cmd: "allNotesOff"; channel?: number }
	| { cmd: "panic" };

class MidiBridge {
	#child?: ChildProcess;
	#ready = false;
	#stopped = false;
	#restartDelay = RESTART_MIN_MS;
	#restartTimer?: NodeJS.Timeout;
	#queue: MidiCommand[] = [];
	#stdoutBuffer = "";
	#missingReported = false;
	#waitWarnedAt = 0;

	get isReady(): boolean {
		return this.#ready;
	}

	start(): void {
		if (this.#child || this.#stopped) return;

		const binaryPath = this.#resolveBinary();
		if (!binaryPath) {
			if (!this.#missingReported) {
				this.#missingReported = true;
				console.error(
					`[midi] the CoreMIDI helper is missing (${BINARY_NAME}). ` +
						"Build it on this Mac with: npm run native",
				);
			}
			return;
		}

		let child: ChildProcess;
		try {
			child = spawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
		} catch (error) {
			console.error("[midi] could not start the CoreMIDI helper:", error);
			this.#scheduleRestart();
			return;
		}

		this.#child = child;
		this.#stdoutBuffer = "";

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => this.#onStdout(chunk));

		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			const message = chunk.trim();
			if (message) console.log(`[midi-bridge] ${message}`);
		});

		child.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				console.error(`[midi] helper not executable: ${binaryPath}`);
			} else {
				console.error("[midi] helper error:", error.message);
			}
			this.#handleExit();
		});

		child.on("exit", (code, signal) => {
			if (!this.#stopped) {
				console.log(`[midi] helper exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
			}
			this.#handleExit();
		});
	}

	/** Queues the command until the helper reports a live virtual port. */
	send(command: MidiCommand): void {
		if (!this.#child || !this.#ready) {
			if (this.#queue.length >= MAX_QUEUED_COMMANDS) this.#queue.shift();
			this.#queue.push(command);
			this.#warnIfWaiting();
			return;
		}
		this.#write(command);
	}

	stop(): void {
		this.#stopped = true;
		if (this.#restartTimer) clearTimeout(this.#restartTimer);
		this.#restartTimer = undefined;
		this.#child?.kill();
		this.#child = undefined;
		this.#ready = false;
	}

	#resolveBinary(): string | undefined {
		let baseDirectory: string;
		try {
			baseDirectory = dirname(fileURLToPath(import.meta.url));
		} catch {
			baseDirectory = process.cwd();
		}

		const candidate = join(baseDirectory, BINARY_NAME);
		if (!existsSync(candidate)) return undefined;

		// Zips do not always keep the executable bit.
		try {
			chmodSync(candidate, 0o755);
		} catch {
			/* already executable, or read-only install */
		}
		return candidate;
	}

	#onStdout(chunk: string): void {
		this.#stdoutBuffer += chunk;
		let newlineIndex = this.#stdoutBuffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = this.#stdoutBuffer.slice(0, newlineIndex).trim();
			this.#stdoutBuffer = this.#stdoutBuffer.slice(newlineIndex + 1);
			if (line) this.#onBridgeMessage(line);
			newlineIndex = this.#stdoutBuffer.indexOf("\n");
		}
	}

	#onBridgeMessage(line: string): void {
		let message: { event?: string; name?: string; message?: string };
		try {
			message = JSON.parse(line) as typeof message;
		} catch {
			console.log(`[midi-bridge] ${line}`);
			return;
		}

		switch (message.event) {
			case "ready":
				this.#ready = true;
				this.#restartDelay = RESTART_MIN_MS;
				console.log(`[midi] virtual MIDI port ready: ${message.name ?? BINARY_NAME}`);
				this.#flushQueue();
				break;
			case "reconnected":
				this.#ready = true;
				console.log(`[midi] virtual MIDI port recreated: ${message.name ?? BINARY_NAME}`);
				break;
			case "error":
				console.error("[midi] helper reported:", message.message ?? "unknown error");
				break;
			default:
				console.log(`[midi-bridge] ${line}`);
		}
	}

	#flushQueue(): void {
		const pending = this.#queue;
		this.#queue = [];
		for (const command of pending) this.#write(command);
	}

	#write(command: MidiCommand): void {
		if (!this.#child?.stdin?.writable) return;
		try {
			this.#child.stdin.write(`${JSON.stringify(command)}\n`);
		} catch (error) {
			console.error("[midi] could not write to the helper:", error);
		}
	}

	#warnIfWaiting(): void {
		const now = Date.now();
		if (now - this.#waitWarnedAt < 5000) return;
		this.#waitWarnedAt = now;
		console.log("[midi] waiting for the virtual MIDI port…");
	}

	#handleExit(): void {
		this.#child = undefined;
		this.#ready = false;
		this.#scheduleRestart();
	}

	#scheduleRestart(): void {
		if (this.#stopped || this.#restartTimer) return;
		const delay = this.#restartDelay;
		this.#restartDelay = Math.min(this.#restartDelay * 2, RESTART_MAX_MS);
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = undefined;
			this.start();
		}, delay);
	}
}

export const midiBridge = new MidiBridge();

process.on("exit", () => midiBridge.stop());
