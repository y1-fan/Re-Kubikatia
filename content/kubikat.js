/*
 * Kubikat importer plugin.
 *
 * Flow:
 *   menu item -> dialog -> PrimoSruClient (SRU/MARC only) -> Primo.buildRecord
 *   -> Mapper.buildItemPlan -> Zotero.Item + child note + URL attachments
 *   -> newly created Zotero collection.
 *
 * The plugin never requests /primaws or /discovery/search.  It sends
 * one SRU request at a time, waits 10 seconds between requests and imports at
 * most 50 items per job.
 */

"use strict";

var KubikatPlugin = class KubikatPlugin {
	constructor(options) {
		this.id = options.id;
		this.version = options.version;
		this.rootURI = options.rootURI;

		this.menuID = null;
		this._dialog = null;
		this._jobs = new Map();
		this._jobSeq = 0;
		this._client = new Primo.PrimoSruClient({
			timeout: 45000,
			retries: 2,
			delayMs: Primo.REQUEST_DELAY_MS,
			maxRequests: Primo.MAX_REQUESTS,
		});
		this._needsMenuInjection = false;
	}

	// ------------------------------------------------------------ lifecycle

	async startup() {
		if (Zotero.uiReadyPromise) {
			try {
				await Zotero.uiReadyPromise;
			}
			catch (error) {
				Zotero.debug("[Re-Kubikatia] uiReadyPromise rejected: " + error);
			}
		}
		this._registerMenu();
		Zotero.debug("[Re-Kubikatia] started " + this.version);
	}

	shutdown() {
		for (const job of this._jobs.values()) {
			job.cancelled = true;
			try {
				job.progressWindow?.close();
			}
			catch (error) {
				// ignore
			}
		}
		this._jobs.clear();

		if (this.menuID && Zotero.MenuManager?.unregisterMenu) {
			try {
				Zotero.MenuManager.unregisterMenu(this.menuID);
			}
			catch (error) {
				Zotero.debug("[Re-Kubikatia] menu unregister failed: " + error);
			}
			this.menuID = null;
		}

		for (const win of Zotero.getMainWindows()) {
			this._removeInjectedMenu(win);
		}

		if (this._dialog && !this._dialog.closed) {
			try {
				this._dialog.close();
			}
			catch (error) {
				// ignore
			}
		}
		this._dialog = null;
	}

	onMainWindowLoad(win) {
		if (this._needsMenuInjection) {
			this._injectMenu(win);
		}
	}

	onMainWindowUnload(win) {
		this._removeInjectedMenu(win);
	}

	// ------------------------------------------------------------ menu

	_registerMenu() {
		if (Zotero.MenuManager && typeof Zotero.MenuManager.registerMenu === "function") {
			try {
				this.menuID = Zotero.MenuManager.registerMenu({
					menuID: "rekubikatia-import",
					pluginID: this.id,
					target: "main/menubar/tools",
					menus: [
						{
							menuType: "menuitem",
							icon: this.rootURI + "content/icons/kubikat-icon.svg",
							darkIcon: this.rootURI + "content/icons/kubikat-icon.svg",
							// Set a literal label: Fluent-based menu labels have
							// been unreliable for plugin menu items in Zotero 10.
							onShowing: (event, context) => {
								if (context && context.menuElem) {
									context.menuElem.setAttribute("label", "Re-Kubikatia");
								}
							},
							onCommand: () => this.openDialog(),
						},
					],
				});
			}
			catch (error) {
				Zotero.debug("[Re-Kubikatia] MenuManager registration threw: " + error);
				this.menuID = null;
			}
			if (!this.menuID) {
				Zotero.debug("[Re-Kubikatia] MenuManager registration failed; using fallback");
				this._needsMenuInjection = true;
				for (const win of Zotero.getMainWindows()) {
					this._injectMenu(win);
				}
			}
			return;
		}

		// Zotero 7.0 has no MenuManager; insert a Tools menu item manually.
		this._needsMenuInjection = true;
		for (const win of Zotero.getMainWindows()) {
			this._injectMenu(win);
		}
	}

	_injectMenu(win) {
		if (!win || win.closed) {
			return;
		}
		const doc = win.document;
		if (!doc || doc.getElementById("rekubikatia-tools-menuitem")) {
			return;
		}
		const popup = doc.getElementById("menu_ToolsPopup")
			|| doc.querySelector("menupopup#menu_ToolsPopup");
		if (!popup) {
			return;
		}
		try {
			if (win.MozXULElement && win.MozXULElement.insertFTLIfNeeded) {
				win.MozXULElement.insertFTLIfNeeded("kubikat.ftl");
			}
		}
		catch (error) {
			// Localisation is best-effort.
		}
		const item = doc.createXULElement("menuitem");
		item.id = "rekubikatia-tools-menuitem";
		item.setAttribute("class", "menuitem-iconic");
		item.setAttribute("image", this.rootURI + "content/icons/kubikat-32.png");
		item.setAttribute("label", "Re-Kubikatia");
		item.addEventListener("command", () => this.openDialog());
		popup.appendChild(item);
	}

	_removeInjectedMenu(win) {
		if (!win || win.closed) {
			return;
		}
		try {
			win.document.getElementById("rekubikatia-tools-menuitem")?.remove();
		}
		catch (error) {
			// ignore
		}
	}

	// ------------------------------------------------------------ dialog

	openDialog() {
		const win = Zotero.getMainWindow();
		if (!win) {
			return;
		}
		if (this._dialog && !this._dialog.closed) {
			this._dialog.focus();
			return;
		}
		this._dialog = win.openDialog(
			"chrome://rekubikatia/content/dialog.xhtml",
			"rekubikatia-import-dialog",
			"chrome,centerscreen,resizable=yes,width=820,height=740",
			{ plugin: this },
		);
		const dialog = this._dialog;
		if (dialog) {
			dialog.addEventListener("unload", () => {
				if (this._dialog === dialog) {
					this._dialog = null;
				}
			}, { once: true });
		}
	}

	// ------------------------------------------------------------ preferences

	getDefaults() {
		const libraryID = this.getTargetLibraryID();
		let libraryName = "My Library";
		try {
			libraryName = Zotero.Libraries.get(libraryID)?.name || libraryName;
		}
		catch (error) {
			// ignore
		}
		return {
			libraryID: libraryID,
			libraryName: libraryName,
			max: Number(this._getPref("max", 25)) || 25,
			tags: this._getPref("tags", true) !== false,
			attachments: this._getPref("attachments", true) !== false,
			acknowledged: this._getPref("acknowledged", false) === true,
			delayMs: Primo.REQUEST_DELAY_MS,
			maxItems: Primo.MAX_ITEMS,
		};
	}

	saveDefaults(options) {
		try {
			const max = Math.max(1, Math.min(Primo.MAX_ITEMS, Number(options.max) || 25));
			Zotero.Prefs.set("extensions.zotero.rekubikatia.max", max, true);
			Zotero.Prefs.set("extensions.zotero.rekubikatia.tags", !!options.tags, true);
			Zotero.Prefs.set("extensions.zotero.rekubikatia.attachments", !!options.attachments, true);
			Zotero.Prefs.set("extensions.zotero.rekubikatia.acknowledged", !!options.acknowledged, true);
		}
		catch (error) {
			Zotero.debug("[Re-Kubikatia] could not save preferences: " + error);
		}
	}

	_getPref(name, fallback) {
		try {
			const value = Zotero.Prefs.get("extensions.zotero.rekubikatia." + name, true);
			return value === undefined ? fallback : value;
		}
		catch (error) {
			return fallback;
		}
	}

	getTargetLibraryID() {
		try {
			const pane = Zotero.getActiveZoteroPane();
			let ids = [];
			if (pane && typeof pane.getSelectedLibraryIDs === "function") {
				// Zotero 10: multiple libraries/collections can be selected.
				ids = Array.from(pane.getSelectedLibraryIDs() || []);
			}
			else if (pane && typeof pane.getSelectedLibraryID === "function") {
				// Zotero 7-9.
				ids = [pane.getSelectedLibraryID()];
			}
			for (const id of ids) {
				if (!id) {
					continue;
				}
				const library = Zotero.Libraries.get(id);
				if (!library || library.editable !== false) {
					return id;
				}
			}
		}
		catch (error) {
			// Fall through to My Library.
		}
		return Zotero.Libraries.userLibraryID;
	}

	// ------------------------------------------------------------ preview

	previewInput(text) {
		const parsed = Primo.parseInput(text);
		const now = new Date();
		const ymd = now.getFullYear() + "-"
			+ String(now.getMonth() + 1).padStart(2, "0") + "-"
			+ String(now.getDate()).padStart(2, "0");
		let base = "Kubikat";
		if (parsed.searchUrl) {
			const terms = Primo.queryTerms(parsed.searchUrl);
			if (terms.length) {
				base = terms.slice(0, 6).join(" ");
			}
		}
		let suggestedName = base + " (" + ymd + ")";
		if (suggestedName.length > 120) {
			suggestedName = suggestedName.slice(0, 119) + "…";
		}
		return {
			ok: !(parsed.searchUrl === null && parsed.docids.length === 0),
			kind: parsed.searchUrl ? "search" : "items",
			count: parsed.docids.length,
			errors: parsed.errors,
			notes: parsed.notes,
			suggestedName: suggestedName,
		};
	}

	// ------------------------------------------------------------ jobs

	startImport(options) {
		options = options || {};
		const parsed = Primo.parseInput(options.source || "");
		if (!parsed.searchUrl && !parsed.docids.length) {
			throw new Error(parsed.errors[0] || "No Kubikat search URL or item links were found");
		}
		if (!options.acknowledged) {
			throw new Error("Please confirm the usage notice before importing.");
		}
		for (const existing of this._jobs.values()) {
			if (existing.status === "running") {
				throw new Error("An import is already running. Wait for it to finish or cancel it.");
			}
		}

		const libraryID = this.getTargetLibraryID();
		let libraryName = "My Library";
		try {
			libraryName = Zotero.Libraries.get(libraryID)?.name || libraryName;
		}
		catch (error) {
			// ignore
		}

		const max = Math.max(1, Math.min(Primo.MAX_ITEMS, Number(options.max) || 25));
		if (this._client && typeof this._client.resetBudget === "function") {
			this._client.resetBudget();
		}
		const job = {
			id: "job-" + (++this._jobSeq) + "-" + Date.now().toString(36),
			status: "running",
			phase: "starting",
			message: "Preparing…",
			percent: 0,
			started: Date.now(),
			ended: null,
			source: options.source || "",
			parsed: parsed,
			options: {
				collectionName: String(options.collectionName || "").trim(),
				max: max,
				tags: options.tags !== false,
				attachments: options.attachments !== false,
			},
			libraryID: libraryID,
			libraryName: libraryName,
			totalHits: null,
			fetched: 0,
			total: 0,
			current: 0,
			enriched: 0,
			enrichTotal: 0,
			created: 0,
			failed: 0,
			marcFailed: 0,
			errors: [],
			logs: [],
			collection: null,
			collectionID: null,
			collectionName: "",
			cancelled: false,
			progressWindow: null,
			progressItem: null,
		};

		this._jobs.set(job.id, job);
		this._gcJobs();
		this._log(job, "Job started");
		this._log(job, "Rate limits: SRU only · 1 request at a time · "
			+ Math.round(Primo.REQUEST_DELAY_MS / 1000) + " s between requests · max "
			+ Primo.MAX_ITEMS + " items");
		this._runJob(job).catch((error) => {
			if (job.status === "running") {
				job.status = "error";
				job.phase = "done";
				job.errors.push(this._errorText(error));
				this._endProgressWindow(job);
			}
			Zotero.debug("[Re-Kubikatia] job crashed: " + this._errorText(error));
		});
		return job.id;
	}

	getJobState(id) {
		const job = this._jobs.get(id);
		if (!job) {
			return null;
		}
		return {
			id: job.id,
			status: job.status,
			phase: job.phase,
			message: job.message,
			percent: job.percent,
			current: job.current,
			total: job.total,
			fetched: job.fetched,
			totalHits: job.totalHits,
			enriched: job.enriched,
			enrichTotal: job.enrichTotal,
			created: job.created,
			failed: job.failed,
			marcFailed: job.marcFailed,
			collectionID: job.collectionID,
			collectionName: job.collectionName,
			libraryName: job.libraryName,
			errors: job.errors.slice(-10),
			logs: job.logs.slice(-12).map((entry) => entry.message),
			started: job.started,
			ended: job.ended,
		};
	}

	cancelJob(id) {
		const job = this._jobs.get(id);
		if (!job || job.status !== "running") {
			return;
		}
		job.cancelled = true;
		job.message = "Cancelling…";
		this._log(job, "Cancellation requested");
		this._setProgress(job, job.percent, "Cancelling…");
	}

	async showCollection(collectionID) {
		if (!collectionID) {
			return;
		}
		try {
			const win = Zotero.getMainWindow();
			const pane = win && win.ZoteroPane;
			if (!pane) {
				return;
			}
			// Zotero 10 removed ZoteroPane.selectCollection(); the collection
			// tree owns selection now, and its method is asynchronous.
			if (pane.collectionsView && typeof pane.collectionsView.selectCollection === "function") {
				await pane.collectionsView.selectCollection(collectionID);
			}
			else if (typeof pane.selectCollection === "function") {
				await pane.selectCollection(collectionID);
			}
			win.focus();
		}
		catch (error) {
			Zotero.debug("[Re-Kubikatia] could not select collection: " + error);
		}
	}

	// ------------------------------------------------------------ pipeline

	async _runJob(job) {
		this._beginProgressWindow(job);
		try {
			job.phase = "search";
			this._setProgress(job, 0, "Searching Kubikat…");
			let records;
			if (job.parsed.searchUrl) {
				records = await this._search(job);
			}
			else {
				records = await this._fetchDocids(job);
			}
			if (job.cancelled) {
				throw new Error("Cancelled");
			}
			if (!records.length) {
				throw new Error("No records were returned by Kubikat");
			}

			job.collection = await this._createCollection(job);
			job.collectionID = job.collection.id;
			job.collectionName = job.collection.name;
			this._log(job, "Created collection: " + job.collection.name);

			await this._enrich(job, records);
			if (job.cancelled) {
				throw new Error("Cancelled");
			}

			await this._writeItems(job, records);
			if (job.cancelled) {
				throw new Error("Cancelled");
			}

			job.status = "done";
			job.phase = "done";
			job.message = "Imported " + job.created + " item(s)";
			this._log(job, job.message);
		}
		catch (error) {
			if (job.cancelled) {
				job.status = "cancelled";
				job.phase = "done";
				job.message = "Cancelled after " + job.created + " item(s)";
				this._log(job, job.message);
			}
			else {
				job.status = "error";
				job.phase = "done";
				job.message = this._errorText(error);
				job.errors.push(job.message);
				this._log(job, "Failed: " + job.message);
			}
		}
		finally {
			if (job.collection && job.created === 0) {
				try {
					await job.collection.eraseTx();
					job.collectionID = null;
					job.collection = null;
					this._log(job, "Removed empty collection");
				}
				catch (error) {
					Zotero.debug("[Re-Kubikatia] could not remove empty collection: " + error);
				}
			}
			job.ended = Date.now();
			this._endProgressWindow(job);
		}
	}

	async _search(job) {
		const records = await this._client.searchRecords(job.parsed.searchUrl, {
			pageSize: Primo.SRU_PAGE_SIZE,
			max: job.options.max || null,
			onPage: (newRecords, total, fetched) => {
				job.totalHits = total || null;
				job.fetched = fetched;
				job.total = total || fetched;
				const percent = total ? Math.min(30, (30 * fetched) / total) : 10;
				this._setProgress(job, percent, "Searching: " + fetched + (total ? " / " + total : ""));
			},
			shouldStop: () => job.cancelled,
		});
		this._log(job, "Fetched " + records.length + " record(s) via SRU");
		return records;
	}

	async _fetchDocids(job) {
		const allDocids = job.parsed.docids;
		const docids = job.options.max ? allDocids.slice(0, job.options.max) : allDocids;
		job.total = docids.length;
		let done = 0;
		const results = await this._mapConcurrent(docids, 1, async (docid) => {
			if (job.cancelled) {
				return null;
			}
			try {
				const bundle = await this._client.fetchBundle(docid);
				return { docid: docid, pnx: bundle.pnx, marc: bundle.marc };
			}
			catch (error) {
				job.failed++;
				job.errors.push(docid + ": " + this._errorText(error));
				this._log(job, "Record failed: " + docid + " (" + this._errorText(error) + ")");
				return null;
			}
			finally {
				done++;
				job.fetched = done;
				this._setProgress(job, 30 * done / Math.max(1, docids.length), "Fetching records: " + done + " / " + docids.length);
			}
		}, () => job.cancelled);
		return results.filter(Boolean);
	}

	async _enrich(job, records) {
		job.phase = "enrich";
		job.enrichTotal = records.length;
		const parentCache = new Map();

		await this._mapConcurrent(records, 1, async (entry) => {
			if (job.cancelled) {
				return;
			}
			let marc = entry.marc || {};
			let marcXml = entry.marc ? "sru" : "";
			let parent = null;
			if (!entry.marc) {
				try {
					marcXml = await this._client.fetchMarcXml(entry.docid);
					marc = Primo.parseMarcXml(marcXml);
				}
				catch (error) {
					job.marcFailed++;
					this._log(job, "MARC failed for " + entry.docid + " (" + this._errorText(error) + ")");
				}
			}
			if (Primo.needsParent(entry.pnx)) {
				parent = await this._getParent(entry.pnx, parentCache);
			}
			try {
				entry.record = Primo.buildRecord(entry.pnx, entry.docid, {
					marc: marc,
					parentPnx: parent,
					enriched: !!marcXml,
				});
			}
			catch (error) {
				job.errors.push(entry.docid + ": mapping failed: " + this._errorText(error));
				entry.record = Primo.buildRecord(entry.pnx, entry.docid, {});
			}
			job.enriched++;
			this._setProgress(
				job,
				30 + (40 * job.enriched) / Math.max(1, job.enrichTotal),
				"Mapping records: " + job.enriched + " / " + job.enrichTotal,
			);
		}, () => job.cancelled);
	}

	async _getParent(pnx, cache) {
		const parentId = Primo.parentDocid(pnx);
		if (!parentId) {
			return null;
		}
		if (cache.has(parentId)) {
			return await cache.get(parentId);
		}
		const promise = this._client.fetchRecord(parentId).catch((error) => {
			Zotero.debug("[Re-Kubikatia] parent record " + parentId + " failed: " + error);
			return null;
		});
		cache.set(parentId, promise);
		return await promise;
	}

	async _writeItems(job, records) {
		job.phase = "write";
		job.total = records.length;
		for (let index = 0; index < records.length; index++) {
			if (job.cancelled) {
				break;
			}
			const entry = records[index];
			const record = entry.record
				|| Primo.buildRecord(entry.pnx, entry.docid, {});
			try {
				await this._createItem(job, record);
				job.created++;
			}
			catch (error) {
				job.failed++;
				job.errors.push(record.docid + ": could not create item: " + this._errorText(error));
				this._log(job, "Item failed: " + record.docid + " (" + this._errorText(error) + ")");
			}
			job.current = index + 1;
			this._setProgress(
				job,
				70 + (30 * (index + 1)) / Math.max(1, records.length),
				"Creating items: " + (index + 1) + " / " + records.length,
			);
		}
	}

	async _createItem(job, record) {
		const plan = Mapper.buildItemPlan(record, {
			tags: job.options.tags,
			attachments: job.options.attachments,
		});
		const item = new Zotero.Item(plan.itemType);
		item.libraryID = job.libraryID;
		// Assign the collection before saving. Zotero 10 requires collection
		// membership changes to happen inside a transaction; saving the item
		// with setCollections() handles that atomically for every version.
		item.setCollections([job.collectionID]);

		for (const field of Object.keys(plan.fields)) {
			const value = plan.fields[field];
			if (value === undefined || value === null || value === "") {
				continue;
			}
			let fieldID;
			try {
				fieldID = Zotero.ItemFields.getID(field);
			}
			catch (error) {
				continue;
			}
			if (!fieldID || !Zotero.ItemFields.isValidForType(fieldID, item.itemTypeID)) {
				continue;
			}
			try {
				item.setField(fieldID, value);
			}
			catch (error) {
				Zotero.debug("[Re-Kubikatia] field " + field + " failed for " + record.docid + ": " + error);
			}
		}

		if (plan.tags.length) {
			item.setTags(plan.tags);
		}

		const creatorData = [];
		for (const creator of plan.creators) {
			const creatorType = this._resolveCreatorType(item, plan.itemType, creator.role);
			const name = Mapper.splitName(creator.name, creator.corporate);
			if (!name) {
				continue;
			}
			creatorData.push({
				firstName: name.firstName || "",
				lastName: name.lastName,
				fieldMode: name.fieldMode || 0,
				creatorType: creatorType,
			});
		}
		if (creatorData.length) {
			// Zotero 10 stores creators privately; Zotero 7/8 also provide
			// setCreators(), so this works across all supported versions.
			if (typeof item.setCreators === "function") {
				item.setCreators(creatorData);
			}
			else {
				item.creators.push.apply(item.creators, creatorData);
			}
		}

		await item.saveTx();

		if (plan.noteHtml) {
			try {
				const note = new Zotero.Item("note");
				note.libraryID = job.libraryID;
				note.parentItemID = item.id;
				note.setNote(plan.noteHtml);
				await note.saveTx();
			}
			catch (error) {
				this._log(job, "Note failed for " + record.docid + " (" + this._errorText(error) + ")");
			}
		}

		if (job.options.attachments) {
			for (const attachment of plan.attachments) {
				try {
					await Zotero.Attachments.linkFromURL({
						url: attachment.url,
						parentItemID: item.id,
						title: attachment.title,
					});
				}
				catch (error) {
					this._log(job, "Link attachment failed for " + record.docid + " (" + this._errorText(error) + ")");
				}
			}
		}
		return item;
	}

	async _createCollection(job) {
		const base = job.options.collectionName || this._autoCollectionName(job);
		const name = this._uniqueCollectionName(job.libraryID, base);
		const collection = new Zotero.Collection();
		collection.libraryID = job.libraryID;
		collection.parentID = false;
		collection.name = name;
		await collection.saveTx();
		return collection;
	}

	/**
	 * Ask Zotero's live schema which creator types the item actually accepts.
	 * The static map in mapper.js is only a fallback for older versions.
	 */
	_resolveCreatorType(item, itemType, desired) {
		try {
			const types = Zotero.CreatorTypes.getTypesForItemType(item.itemTypeID)
				.map((type) => type.name);
			if (types.includes(desired)) {
				return desired;
			}
			if (types.includes("contributor")) {
				return "contributor";
			}
			if (types.length) {
				return types[0];
			}
		}
		catch (error) {
			// Fall through to the static map.
		}
		return Mapper.resolveCreatorType(itemType, desired);
	}

	_autoCollectionName(job) {
		const now = new Date();
		const ymd = now.getFullYear() + "-"
			+ String(now.getMonth() + 1).padStart(2, "0") + "-"
			+ String(now.getDate()).padStart(2, "0");
		let base = "Kubikat";
		if (job.parsed.searchUrl) {
			const terms = Primo.queryTerms(job.parsed.searchUrl);
			if (terms.length) {
				base = terms.slice(0, 6).join(" ");
			}
		}
		return base + " (" + ymd + ")";
	}

	_uniqueCollectionName(libraryID, base) {
		base = String(base || "Kubikat").trim() || "Kubikat";
		if (base.length > 190) {
			base = base.slice(0, 189) + "…";
		}
		const names = new Set();
		try {
			for (const collection of Zotero.Collections.getByLibrary(libraryID)) {
				names.add(collection.name);
			}
		}
		catch (error) {
			// ignore
		}
		let name = base;
		let index = 2;
		while (names.has(name)) {
			name = base + " (" + index + ")";
			index++;
		}
		return name;
	}

	// ------------------------------------------------------------ progress

	_beginProgressWindow(job) {
		try {
			const win = Zotero.getMainWindow();
			const progressWindow = new Zotero.ProgressWindow({ window: win, closeOnClick: false });
			progressWindow.changeHeadline("Re-Kubikatia");
			const progressItem = new progressWindow.ItemProgress("book", "Preparing…");
			progressItem.setProgress(0);
			progressWindow.show();
			job.progressWindow = progressWindow;
			job.progressItem = progressItem;
		}
		catch (error) {
			Zotero.debug("[Re-Kubikatia] progress window failed: " + error);
		}
	}

	_setProgress(job, percent, message) {
		job.percent = Math.max(0, Math.min(100, Math.round(percent || 0)));
		if (message) {
			job.message = message;
		}
		if (job.progressItem) {
			try {
				job.progressItem.setProgress(job.percent);
				job.progressItem.setText(message || job.message);
			}
			catch (error) {
				// The window may have been closed by the user.
			}
		}
	}

	_endProgressWindow(job) {
		const progressWindow = job.progressWindow;
		const progressItem = job.progressItem;
		if (!progressWindow) {
			return;
		}
		try {
			if (job.status === "done") {
				progressWindow.changeHeadline("Re-Kubikatia import complete");
				progressItem?.setProgress(100);
				progressItem?.setText(
					"Created " + job.created + " item(s) in “" + job.collectionName + "”"
					+ (job.failed ? " · " + job.failed + " failed" : ""),
				);
				progressWindow.startCloseTimer(9000);
			}
			else if (job.status === "cancelled") {
				progressWindow.changeHeadline("Re-Kubikatia import cancelled");
				progressItem?.setText("Added " + job.created + " item(s) before cancelling");
				progressWindow.startCloseTimer(7000);
			}
			else {
				progressWindow.changeHeadline("Re-Kubikatia import failed");
				progressItem?.setProgress(0);
				progressItem?.setText(job.message || "Unknown error");
				progressItem?.setError();
				progressWindow.startCloseTimer(15000);
			}
		}
		catch (error) {
			Zotero.debug("[Re-Kubikatia] progress window update failed: " + error);
		}
		job.progressWindow = null;
		job.progressItem = null;
	}

	// ------------------------------------------------------------ helpers

	_log(job, message) {
		const text = String(message || "").trim();
		if (!text) {
			return;
		}
		job.logs.push({ time: Date.now(), message: text });
		if (job.logs.length > 200) {
			job.logs.splice(0, job.logs.length - 200);
		}
		Zotero.debug("[Re-Kubikatia] " + text);
	}

	_errorText(error) {
		const text = error && error.message ? error.message : String(error);
		return text.length > 240 ? text.slice(0, 239) + "…" : text;
	}

	async _mapConcurrent(items, limit, worker, shouldStop) {
		const results = new Array(items.length);
		let index = 0;
		const runners = [];
		const count = Math.max(1, Math.min(limit, items.length));
		for (let i = 0; i < count; i++) {
			runners.push((async () => {
				while (true) {
					if (shouldStop && shouldStop()) {
						return;
					}
					const current = index++;
					if (current >= items.length) {
						return;
					}
					results[current] = await worker(items[current], current);
				}
			})());
		}
		await Promise.all(runners);
		return results;
	}

	_gcJobs() {
		if (this._jobs.size <= 20) {
			return;
		}
		const finished = Array.from(this._jobs.values())
			.filter((job) => job.status !== "running")
			.sort((a, b) => a.started - b.started);
		for (const job of finished.slice(0, this._jobs.size - 20)) {
			this._jobs.delete(job.id);
		}
	}
};
