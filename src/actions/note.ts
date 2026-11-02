import {
	action,
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { midiBridge } from "../midi/bridge";
import { noteName } from "../midi/util";
import { resolveNoteSettings, type NoteSettings } from "../settings";
import { setActionTitle } from "../ui/title";

type ActiveNote = {
	note: number;
	channel: number;
	timer?: NodeJS.Timeout;
};

/** Sends one MIDI note, either for a fixed duration or while the key is held. */
@action({ UUID: "com.rolltray.midideck.note" })
export class SendNoteAction extends SingletonAction<NoteSettings> {
	readonly #active = new Map<string, ActiveNote>();

	override async onWillAppear(ev: WillAppearEvent<NoteSettings>): Promise<void> {
		await this.#render(ev.action, ev.payload.settings);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<NoteSettings>): Promise<void> {
		await this.#render(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<NoteSettings>): Promise<void> {
		const settings = resolveNoteSettings(ev.payload.settings);

		// Retrigger cleanly if the key is pressed again before the note ended.
		this.#release(ev.action.id);

		midiBridge.send({
			cmd: "noteOn",
			channel: settings.channel,
			note: settings.note,
			velocity: settings.velocity,
		});

		const active: ActiveNote = { note: settings.note, channel: settings.channel };
		if (settings.mode === "timed") {
			active.timer = setTimeout(() => this.#release(ev.action.id), settings.durationMs);
		}
		this.#active.set(ev.action.id, active);
	}

	override async onKeyUp(ev: KeyUpEvent<NoteSettings>): Promise<void> {
		const settings = resolveNoteSettings(ev.payload.settings);
		if (settings.mode === "gate") this.#release(ev.action.id);
	}

	override async onWillDisappear(ev: WillDisappearEvent<NoteSettings>): Promise<void> {
		this.#release(ev.action.id);
	}

	async #render(target: unknown, settings: NoteSettings | undefined): Promise<void> {
		const resolved = resolveNoteSettings(settings);
		await setActionTitle(target, `${noteName(resolved.note)}\n${resolved.channel}`);
	}

	#release(actionId: string): void {
		const active = this.#active.get(actionId);
		if (!active) return;
		if (active.timer) clearTimeout(active.timer);
		this.#active.delete(actionId);
		midiBridge.send({
			cmd: "noteOff",
			channel: active.channel,
			note: active.note,
			velocity: 0,
		});
	}
}
