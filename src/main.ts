import {
	App,
	Modal,
	normalizePath,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	stringifyYaml,
	TFile,
	TFolder,
} from "obsidian";
import { DEFAULT_CATEGORIES_EN, DEFAULT_CATEGORIES_ZH, isZh, t } from "./i18n";

interface Settings {
	folder: string;
	categories: string;
	sortByUse: boolean;
	propDate: string;
	propCategory: string;
	propAmount: string;
	propLocation: string;
	locationAsList: boolean;
	askBackfill: boolean;
	current: string;
}

const defaults = (): Settings => ({
	folder: isZh() ? "消费" : "Expenses",
	categories: isZh() ? DEFAULT_CATEGORIES_ZH : DEFAULT_CATEGORIES_EN,
	sortByUse: true,
	propDate: "date",
	propCategory: "category",
	propAmount: "amount",
	propLocation: "location",
	locationAsList: true,
	askBackfill: true,
	current: "",
});

interface Category {
	value: string;
	label: string;
}

const today = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function asList(v: unknown): string[] {
	if (v === null || v === undefined || v === "") return [];
	const arr: unknown[] = Array.isArray(v) ? v : [v];
	return arr.map((x) => String(x).trim()).filter(Boolean);
}

const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");

function safeName(s: string): string {
	return s
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}

type Frontmatter = Record<string, unknown>;

export default class QuickExpensePlugin extends Plugin {
	settings!: Settings;

	async onload(): Promise<void> {
		this.settings = Object.assign(defaults(), (await this.loadData()) as Partial<Settings> | null);
		this.addCommand({ id: "add", name: t().commandAdd, icon: "wallet", callback: () => this.openModal() });
		this.addRibbonIcon("wallet", t().ribbon, () => this.openModal());
		this.addSettingTab(new QuickExpenseSettingTab(this.app, this));
	}

	openModal(): void {
		new ExpenseModal(this.app, this).open();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	categories(): Category[] {
		return this.settings.categories
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [value, label] = line.split("|").map((s) => s.trim());
				return { value, label: label || value };
			})
			.filter((c) => c.value);
	}

	folderPath(): string {
		return normalizePath(this.settings.folder || "/");
	}

	expenseFiles(): TFile[] {
		const folder = this.folderPath();
		const prefix = folder === "/" ? "" : folder + "/";
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(prefix) && !f.basename.startsWith("_"));
	}

	fm(f: TFile): Frontmatter {
		return this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
	}

	/** Categories sorted by use, locations sorted by most recent use. */
	stats(): { cats: Category[]; locs: string[] } {
		const s = this.settings;
		const catCount: Record<string, number> = {};
		const locLast: Record<string, string> = {};
		const now = today();
		for (const f of this.expenseFiles()) {
			const fm = this.fm(f);
			const cat = fm[s.propCategory];
			if (typeof cat === "string") catCount[cat] = (catCount[cat] ?? 0) + 1;
			const date = str(fm[s.propDate]);
			if (date > now) continue; // expenses logged ahead of time don't count as "recent"
			const key = `${date}|${String(f.stat.ctime).padStart(15, "0")}`;
			for (const l of asList(fm[s.propLocation])) {
				if (!locLast[l] || key > locLast[l]) locLast[l] = key;
			}
		}
		const cats = this.categories();
		if (s.sortByUse) cats.sort((a, b) => (catCount[b.value] ?? 0) - (catCount[a.value] ?? 0));
		const locs = Object.keys(locLast).sort((a, b) => (locLast[b] > locLast[a] ? 1 : -1));
		return { cats, locs };
	}

	filesOn(date: string): TFile[] {
		return this.expenseFiles().filter((f) => str(this.fm(f)[this.settings.propDate]) === date);
	}

	locationValue(loc: string): string | string[] | null {
		if (!loc) return this.settings.locationAsList ? [] : null;
		return this.settings.locationAsList ? [loc] : loc;
	}

	async ensureFolder(path: string): Promise<void> {
		if (path === "/" || this.app.vault.getAbstractFileByPath(path) instanceof TFolder) return;
		const parts = path.split("/");
		for (let i = 1; i <= parts.length; i++) {
			const p = parts.slice(0, i).join("/");
			if (!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.createFolder(p);
		}
	}

	async create(e: { title: string; amount: number; category: string; loc: string; date: string }): Promise<TFile> {
		const s = this.settings;
		const folder = this.folderPath();
		await this.ensureFolder(folder);
		const base = normalizePath(`${folder === "/" ? "" : folder + "/"}${safeName(e.title)}`);
		let path = `${base}.md`;
		for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = `${base} ${i}.md`;
		const fm: Frontmatter = {
			[s.propDate]: e.date,
			[s.propCategory]: e.category,
			[s.propAmount]: e.amount,
			[s.propLocation]: this.locationValue(e.loc),
		};
		// Write the frontmatter in one go so folder-template plugins don't see an empty note.
		return this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n`);
	}

	async setLocation(files: TFile[], loc: string): Promise<void> {
		for (const f of files) {
			await this.app.fileManager.processFrontMatter(f, (fm: Frontmatter) => {
				fm[this.settings.propLocation] = this.locationValue(loc);
			});
		}
	}
}

class ExpenseModal extends Modal {
	private cats: Category[];
	private locs: string[];
	private loc: string;
	private makeCurrent = true;
	private saving = false;
	private locBtn!: HTMLButtonElement;
	private picker!: HTMLDivElement;
	private dateEl!: HTMLInputElement;
	private titleIn!: HTMLInputElement;
	private amountIn!: HTMLInputElement;
	private grid!: HTMLDivElement;

	constructor(app: App, private plugin: QuickExpensePlugin) {
		super(app);
		const { cats, locs } = plugin.stats();
		this.cats = cats;
		this.locs = locs;
		this.loc = plugin.settings.current || locs[0] || "";
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("quick-expense-modal");
		this.setTitle(t().modalTitle);

		const top = contentEl.createDiv({ cls: "qe-top" });
		this.locBtn = top.createEl("button", { cls: "qe-loc" });
		this.locBtn.addEventListener("click", () => this.togglePicker());
		this.dateEl = top.createEl("input", { type: "date", cls: "qe-date" });
		this.dateEl.value = today();

		this.picker = contentEl.createDiv({ cls: "qe-picker" });
		this.picker.hide();
		this.renderLocation();

		this.titleIn = contentEl.createEl("input", {
			type: "text",
			cls: "qe-in",
			attr: { placeholder: t().whatPlaceholder },
		});
		this.amountIn = contentEl.createEl("input", {
			type: "number",
			cls: "qe-in",
			attr: { placeholder: t().amountPlaceholder, step: "any", min: "0", inputmode: "decimal" },
		});
		this.titleIn.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				this.amountIn.focus();
			}
		});
		this.amountIn.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.grid.querySelector("button")?.focus();
			}
		});

		contentEl.createDiv({ cls: "qe-hint", text: t().hint });
		this.grid = contentEl.createDiv({ cls: "qe-grid" });
		for (const c of this.cats) {
			const b = this.grid.createEl("button", { text: c.label });
			b.addEventListener("click", () => void this.save(c.value, c.label));
		}
		window.setTimeout(() => this.titleIn.focus(), 0);
	}

	private renderLocation(): void {
		this.locBtn.setText(`📍 ${this.loc || t().pickLocation} ▾`);
		const p = this.picker;
		p.empty();
		const chips = p.createDiv({ cls: "qe-chips" });
		const none = chips.createEl("button", { text: t().noLocation, cls: this.loc ? "" : "is-on" });
		none.addEventListener("click", () => this.pick(""));
		for (const l of this.locs.slice(0, 18)) {
			const b = chips.createEl("button", { text: l, cls: l === this.loc ? "is-on" : "" });
			b.addEventListener("click", () => this.pick(l));
		}
		const inp = p.createDiv({ cls: "qe-newloc" }).createEl("input", {
			type: "text",
			attr: { placeholder: t().newLocationPlaceholder },
		});
		inp.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.isComposing && inp.value.trim()) {
				e.preventDefault();
				this.pick(inp.value.trim());
			}
		});
		const lab = p.createEl("label", { cls: "qe-cur" });
		const cb = lab.createEl("input", { type: "checkbox" });
		cb.checked = this.makeCurrent;
		cb.addEventListener("change", () => (this.makeCurrent = cb.checked));
		lab.appendText(" " + t().makeCurrent);
	}

	private togglePicker(): void {
		if (this.picker.isShown()) {
			this.picker.hide();
		} else {
			this.picker.show();
			this.picker.querySelector<HTMLInputElement>(".qe-newloc input")?.focus();
		}
	}

	private pick(l: string): void {
		this.loc = l;
		this.renderLocation();
		this.picker.hide();
		(this.titleIn.value ? this.amountIn : this.titleIn).focus();
	}

	private async save(category: string, label: string): Promise<void> {
		if (this.saving) return;
		const title = this.titleIn.value.trim();
		const amount = Number(this.amountIn.value);
		if (!title) {
			new Notice(t().needWhat);
			this.titleIn.focus();
			return;
		}
		if (this.amountIn.value === "" || !isFinite(amount)) {
			new Notice(t().needAmount);
			this.amountIn.focus();
			return;
		}
		const date = this.dateEl.value || today();
		const plugin = this.plugin;
		const s = plugin.settings;
		this.saving = true;
		try {
			const locChanged = this.makeCurrent && !!this.loc && this.loc !== s.current;
			// Collect the day's other expenses before creating the new one.
			const others =
				locChanged && s.askBackfill
					? plugin.filesOn(date).filter((f) => {
							const ls = asList(plugin.fm(f)[s.propLocation]);
							return !(ls.length === 1 && ls[0] === this.loc);
						})
					: [];
			await plugin.create({ title, amount, category, loc: this.loc, date });
			if (locChanged) {
				s.current = this.loc;
				await plugin.saveSettings();
			}
			new Notice(t().saved(`${title}  ${amount} · ${label}${this.loc ? " · " + this.loc : ""}`));
			this.close();
			if (others.length) new BackfillModal(this.app, plugin, date, this.loc, others).open();
		} catch (e) {
			console.error(e);
			new Notice(t().saveFailed(e instanceof Error ? e.message : String(e)));
			this.saving = false;
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class BackfillModal extends Modal {
	constructor(
		app: App,
		private plugin: QuickExpensePlugin,
		private date: string,
		private loc: string,
		private files: TFile[],
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, plugin } = this;
		const prop = plugin.settings.propLocation;
		const empty = this.files.filter((f) => asList(plugin.fm(f)[prop]).length === 0);
		const differ = this.files.length - empty.length;
		this.setTitle(t().backfillTitle(this.date, this.loc));
		const ul = contentEl.createEl("ul", { cls: "qe-list" });
		for (const f of this.files) {
			const ls = asList(plugin.fm(f)[prop]);
			ul.createEl("li", { text: `${f.basename}  ${ls.length ? "📍" + ls.join(", ") : t().noLocationSet}` });
		}
		const row = contentEl.createDiv({ cls: "qe-actions" });
		const go = async (files: TFile[]): Promise<void> => {
			await plugin.setLocation(files, this.loc);
			new Notice(t().changed(files.length, this.loc));
			this.close();
		};
		row.createEl("button", { text: t().changeAll(this.files.length), cls: "mod-cta" }).addEventListener(
			"click",
			() => void go(this.files),
		);
		if (empty.length && differ) {
			row.createEl("button", { text: t().changeEmpty(empty.length) }).addEventListener(
				"click",
				() => void go(empty),
			);
		}
		row.createEl("button", { text: t().dontChange }).addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class QuickExpenseSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: QuickExpensePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		new Setting(containerEl)
			.setName(t().sFolder)
			.setDesc(t().sFolderDesc)
			.addText((x) =>
				x.setValue(s.folder).onChange(async (v) => {
					s.folder = v.trim();
					await save();
				}),
			);

		new Setting(containerEl)
			.setName(t().sCurrent)
			.setDesc(t().sCurrentDesc)
			.addText((x) =>
				x.setValue(s.current).onChange(async (v) => {
					s.current = v.trim();
					await save();
				}),
			);

		new Setting(containerEl)
			.setName(t().sCategories)
			.setDesc(t().sCategoriesDesc)
			.addTextArea((x) => {
				x.setValue(s.categories).onChange(async (v) => {
					s.categories = v;
					await save();
				});
				x.inputEl.rows = 12;
				x.inputEl.addClass("qe-categories");
			});

		new Setting(containerEl)
			.setName(t().sSortByUse)
			.setDesc(t().sSortByUseDesc)
			.addToggle((x) =>
				x.setValue(s.sortByUse).onChange(async (v) => {
					s.sortByUse = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName(t().sAskBackfill)
			.setDesc(t().sAskBackfillDesc)
			.addToggle((x) =>
				x.setValue(s.askBackfill).onChange(async (v) => {
					s.askBackfill = v;
					await save();
				}),
			);

		new Setting(containerEl).setName(t().sProps).setDesc(t().sPropsDesc).setHeading();
		const prop = (name: string, key: "propDate" | "propCategory" | "propAmount" | "propLocation") =>
			new Setting(containerEl).setName(name).addText((x) =>
				x.setValue(s[key]).onChange(async (v) => {
					if (v.trim()) s[key] = v.trim();
					await save();
				}),
			);
		prop(t().sPropDate, "propDate");
		prop(t().sPropCategory, "propCategory");
		prop(t().sPropAmount, "propAmount");
		prop(t().sPropLocation, "propLocation");

		new Setting(containerEl)
			.setName(t().sLocationList)
			.setDesc(t().sLocationListDesc)
			.addToggle((x) =>
				x.setValue(s.locationAsList).onChange(async (v) => {
					s.locationAsList = v;
					await save();
				}),
			);
	}
}
