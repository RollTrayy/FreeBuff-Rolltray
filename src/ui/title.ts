/** Title helper that stays a no-op for actions without a key face (dials). */

type TitleSettable = { setTitle(title?: string): Promise<void> };

export async function setActionTitle(action: unknown, title: string): Promise<void> {
	const candidate = action as Partial<TitleSettable> | undefined;
	if (typeof candidate?.setTitle !== "function") return;
	try {
		await candidate.setTitle(title);
	} catch {
		/* the action may already be gone */
	}
}
