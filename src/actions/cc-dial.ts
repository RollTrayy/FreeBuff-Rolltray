import {
	action,
	SingletonAction,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DidReceiveSettingsEvent,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { midiBridge } from "../midi/bridge";
import { clamp } from "../midi/util";
import { resolveCcDialSettings, type CcDialSettings } from "../settings";

const DIAL_LAYOUT = "layouts/cc-dial.json";

/** Stream Deck + dial acting as a CC potentiometer. */
@action({ UUID: "com.rolltray.midideck.cc-dial" })
export class CcDialAction extends SingletonAction<CcDialSettings> {
	readonly #values = new Map<string, number>();

	override async onWillAppear(ev: WillAppearEvent<CcDialSettings>): Promise<void> {
		const settings = resolveCcDialSettings(ev.payload.settings);
		const value = clamp(settings.defaultValue, settings.min, settings.max);
		this.#values.set(ev.action.id, value);

		if (!ev.action.isDial()) return;
		try {
			await ev.action.setFeedbackLayout(DIAL_LAYOUT);
		} catch {
			/* layout is also declared in the manifest */
		}
		await this.#render(ev.action, settings, value);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CcDialSettings>): Promise<void> {
		const settings = resolveCcDialSettings(ev.payload.settings);
		const value = clamp(this.#values.get(ev.action.id) ?? settings.defaultValue, settings.min, settings.max);
		this.#values.set(ev.action.id, value);
		if (ev.action.isDial()) await this.#render(ev.action, settings, value);
	}

	override async onDialRotate(ev: DialRotateEvent<CcDialSettings>): Promise<void> {
		const settings = resolveCcDialSettings(ev.payload.settings);
		const current = this.#values.get(ev.action.id) ?? settings.defaultValue;
		const direction = settings.invert ? -1 : 1;
		const next = clamp(current + ev.payload.ticks * settings.step * direction, settings.min, settings.max);

		if (next !== current) {
			this.#values.set(ev.action.id, next);
			midiBridge.send({
				cmd: "cc",
				channel: settings.channel,
				controller: settings.controller,
				value: next,
			});
		}
		await this.#render(ev.action, settings, next);
	}

	override async onDialDown(ev: DialDownEvent<CcDialSettings>): Promise<void> {
		await this.#handlePress(ev.action, ev.payload.settings);
	}

	override async onTouchTap(ev: TouchTapEvent<CcDialSettings>): Promise<void> {
		await this.#handlePress(ev.action, ev.payload.settings);
	}

	override async onWillDisappear(ev: WillDisappearEvent<CcDialSettings>): Promise<void> {
		this.#values.delete(ev.action.id);
	}

	/** Re-sends the current value (helps DAWs that missed it), or resets it. */
	async #handlePress(action: DialAction<CcDialSettings>, settings: CcDialSettings | undefined): Promise<void> {
		const resolved = resolveCcDialSettings(settings);
		if (resolved.pressMode === "none") return;

		const value =
			resolved.pressMode === "reset"
				? clamp(resolved.defaultValue, resolved.min, resolved.max)
				: (this.#values.get(action.id) ?? resolved.defaultValue);

		this.#values.set(action.id, value);
		midiBridge.send({
			cmd: "cc",
			channel: resolved.channel,
			controller: resolved.controller,
			value,
		});
		await this.#render(action, resolved, value);
	}

	async #render(action: DialAction<CcDialSettings>, settings: ReturnType<typeof resolveCcDialSettings>, value: number): Promise<void> {
		try {
			await action.setFeedback({
				label: `CC ${settings.controller} · Ch ${settings.channel}`,
				value: String(value),
				indicator: { value, range: { min: settings.min, max: settings.max } },
			});
		} catch {
			/* the action may already be gone */
		}
	}
}
