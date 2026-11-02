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
import { resolveCcSettings, type CcSettings } from "../settings";
import { setActionTitle } from "../ui/title";

/** Sends a CC message: single trigger, A/B toggle or momentary. */
@action({ UUID: "com.rolltray.midideck.cc" })
export class SendCcAction extends SingletonAction<CcSettings> {
	readonly #toggled = new Map<string, boolean>();

	override async onWillAppear(ev: WillAppearEvent<CcSettings>): Promise<void> {
		await this.#render(ev.action, ev.payload.settings);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CcSettings>): Promise<void> {
		await this.#render(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<CcSettings>): Promise<void> {
		const settings = resolveCcSettings(ev.payload.settings);
		let value: number;

		switch (settings.mode) {
			case "toggle": {
				const second = this.#toggled.get(ev.action.id) ?? false;
				value = second ? settings.valueB : settings.valueA;
				this.#toggled.set(ev.action.id, !second);
				break;
			}
			case "momentary":
			case "trigger":
			default:
				value = settings.valueA;
				break;
		}

		this.#send(settings, value);
		await this.#render(ev.action, ev.payload.settings);
	}

	override async onKeyUp(ev: KeyUpEvent<CcSettings>): Promise<void> {
		const settings = resolveCcSettings(ev.payload.settings);
		if (settings.mode !== "momentary") return;
		this.#send(settings, settings.valueB);
		await this.#render(ev.action, ev.payload.settings);
	}

	override async onWillDisappear(ev: WillDisappearEvent<CcSettings>): Promise<void> {
		this.#toggled.delete(ev.action.id);
	}

	#send(settings: ReturnType<typeof resolveCcSettings>, value: number): void {
		midiBridge.send({
			cmd: "cc",
			channel: settings.channel,
			controller: settings.controller,
			value,
		});
	}

	async #render(target: unknown, settings: CcSettings | undefined): Promise<void> {
		const resolved = resolveCcSettings(settings);
		await setActionTitle(target, `CC ${resolved.controller}\n${resolved.channel}`);
	}
}
