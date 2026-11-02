/**
 * Settings shapes shared by the plugin and mirrored in the property inspectors.
 * Every value is optional: Stream Deck only stores what the user changed.
 */

export type NoteMode = "timed" | "gate";

export type NoteSettings = {
	channel?: number;
	note?: number;
	velocity?: number;
	mode?: NoteMode;
	durationMs?: number;
};

export type CcMode = "trigger" | "toggle" | "momentary";

export type CcSettings = {
	channel?: number;
	controller?: number;
	mode?: CcMode;
	valueA?: number;
	valueB?: number;
};

export type DialPressMode = "resync" | "reset" | "none";

export type CcDialSettings = {
	channel?: number;
	controller?: number;
	step?: number;
	min?: number;
	max?: number;
	defaultValue?: number;
	invert?: boolean;
	pressMode?: DialPressMode;
};

export type ResolvedNoteSettings = {
	channel: number;
	note: number;
	velocity: number;
	mode: NoteMode;
	durationMs: number;
};

export type ResolvedCcSettings = {
	channel: number;
	controller: number;
	mode: CcMode;
	valueA: number;
	valueB: number;
};

export type ResolvedCcDialSettings = {
	channel: number;
	controller: number;
	step: number;
	min: number;
	max: number;
	defaultValue: number;
	invert: boolean;
	pressMode: DialPressMode;
};

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(Math.round(parsed), min), max);
}

function asBoolean(value: unknown): boolean {
	return value === true || value === "true" || value === 1;
}

export function resolveNoteSettings(settings: NoteSettings = {}): ResolvedNoteSettings {
	return {
		channel: asNumber(settings.channel, 1, 1, 16),
		note: asNumber(settings.note, 60, 0, 127),
		velocity: asNumber(settings.velocity, 100, 1, 127),
		mode: settings.mode === "gate" ? "gate" : "timed",
		durationMs: asNumber(settings.durationMs, 150, 10, 10_000),
	};
}

export function resolveCcSettings(settings: CcSettings = {}): ResolvedCcSettings {
	const mode: CcMode =
		settings.mode === "toggle" || settings.mode === "momentary" ? settings.mode : "trigger";
	return {
		channel: asNumber(settings.channel, 1, 1, 16),
		controller: asNumber(settings.controller, 1, 0, 127),
		mode,
		valueA: asNumber(settings.valueA, 127, 0, 127),
		valueB: asNumber(settings.valueB, 0, 0, 127),
	};
}

export function resolveCcDialSettings(settings: CcDialSettings = {}): ResolvedCcDialSettings {
	const min = asNumber(settings.min, 0, 0, 127);
	const max = asNumber(settings.max, 127, 0, 127);
	const low = Math.min(min, max);
	const high = Math.max(min, max);
	const pressMode: DialPressMode =
		settings.pressMode === "reset" || settings.pressMode === "none" ? settings.pressMode : "resync";
	return {
		channel: asNumber(settings.channel, 1, 1, 16),
		controller: asNumber(settings.controller, 74, 0, 127),
		step: asNumber(settings.step, 1, 1, 64),
		min: low,
		max: high,
		defaultValue: asNumber(settings.defaultValue, 64, low, high),
		invert: asBoolean(settings.invert),
		pressMode,
	};
}
