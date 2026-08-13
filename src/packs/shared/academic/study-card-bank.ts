import type { JsonValue } from "../../../core/types.js";

export interface StudyCard extends Record<string, JsonValue> {
	id: string;
	kind: string;
	title: string;
	summary: string;
	details: string;
	tags: string[];
}

export type StudyCardInput = Pick<StudyCard, "kind" | "title" | "summary"> &
	Partial<Pick<StudyCard, "id" | "details" | "tags">>;

function normalizeId(id: string): string {
	const normalized = id.trim().toLowerCase().replace(/\s+/g, "-");
	if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
		throw new Error("卡片 id 需由 1~64 个小写字母、数字、下划线或连字符组成");
	}
	return normalized;
}

function required(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${field} 不能为空`);
	return normalized;
}

export class StudyCardBank {
	private cards = new Map<string, StudyCard>();
	private sequence = 0;

	add(input: StudyCardInput): StudyCard {
		const id = input.id ? normalizeId(input.id) : this.nextId();
		const card: StudyCard = {
			id,
			kind: required(input.kind, "kind"),
			title: required(input.title, "title"),
			summary: required(input.summary, "summary"),
			details: input.details?.trim() ?? "",
			tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
		};
		this.cards.set(id, card);
		return card;
	}

	get(id: string): StudyCard | undefined {
		return this.cards.get(normalizeId(id));
	}

	remove(id: string): boolean {
		return this.cards.delete(normalizeId(id));
	}

	list(): StudyCard[] {
		return [...this.cards.values()].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
	}

	count(): number {
		return this.cards.size;
	}

	clear(): void {
		this.cards.clear();
		this.sequence = 0;
	}

	toRecord(): Record<string, StudyCard> {
		return Object.fromEntries(this.cards);
	}

	restore(entries: Record<string, StudyCard>): void {
		this.clear();
		for (const [id, card] of Object.entries(entries)) {
			const normalized = normalizeId(id);
			this.cards.set(normalized, {
				id: normalized,
				kind: card.kind,
				title: card.title,
				summary: card.summary,
				details: card.details ?? "",
				tags: [...(card.tags ?? [])],
			});
			const generated = normalized.match(/^card-(\d+)$/);
			if (generated) this.sequence = Math.max(this.sequence, Number(generated[1]));
		}
	}

	private nextId(): string {
		let id: string;
		do id = `card-${++this.sequence}`; while (this.cards.has(id));
		return id;
	}
}
