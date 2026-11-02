/** Small pure helpers shared by the actions. */

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** MIDI note number to scientific pitch name, with middle C (60) shown as C4. */
export function noteName(note: number): string {
	const index = ((note % 12) + 12) % 12;
	const octave = Math.floor(note / 12) - 1;
	return `${NOTE_NAMES[index]}${octave}`;
}
