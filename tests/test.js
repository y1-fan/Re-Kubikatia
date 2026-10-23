/* Pure-logic and client tests for the Kubikat plugin.  Open test.html in a browser. */

(function () {
	"use strict";

	const results = [];
	const tests = [];
	const fixtures = window.PRIMO_FIXTURES;
	const list = document.getElementById("results");

	function fail(message) {
		throw new Error(message);
	}

	function assert(condition, message) {
		if (!condition) {
			fail(message || "assertion failed");
		}
	}

	function eq(actual, expected, message) {
		if (actual !== expected) {
			fail((message || "value") + ": expected " + JSON.stringify(expected)
				+ ", got " + JSON.stringify(actual));
		}
	}

	function includes(array, value, message) {
		if (!Array.isArray(array) || !array.includes(value)) {
			fail((message || "array") + " should include " + JSON.stringify(value)
				+ ", got " + JSON.stringify(array));
		}
	}

	function contains(text, value, message) {
		if (String(text).indexOf(value) === -1) {
			fail((message || "text") + " should contain " + JSON.stringify(value)
				+ ", got " + JSON.stringify(text).slice(0, 300));
		}
	}

	function test(name, fn) {
		tests.push({ name: name, fn: fn });
	}

	const searchUrl = fixtures.search_url;
	const twoQueryUrl = "https://www.kubikat.org/discovery/search"
		+ "?query=any,contains,Michelangelo,AND"
		+ "&query=title,contains,Zeichnung,AND"
		+ "&tab=LibraryCatalog&search_scope=MyInstitution"
		+ "&vid=49MPG_KUBIKAT:VU1&mode=advanced&offset=20&limit=10";
	const first = fixtures.records[0];
	const firstMarc = Primo.parseMarcXml(first.marc_xml);

	test("parseInput: search URL with repeated query params", function () {
		const parsed = Primo.parseInput("# comment\n" + searchUrl);
		eq(parsed.searchUrl, searchUrl);
		eq(parsed.docids.length, 0);
		eq(parsed.errors.length, 0);
	});

	test("parseInput: item links, docids and duplicate handling", function () {
		const text = [
			"https://www.kubikat.org/discovery/fulldisplay?docid=alma990003239662009152&context=L",
			"990235370982009152",
			"alma990003239662009152",
			"https://example.com/not-kubikat",
		].join("\n");
		const parsed = Primo.parseInput(text);
		assert(!parsed.searchUrl, "should not be a search");
		eq(parsed.docids.length, 2);
		includes(parsed.docids, "alma990003239662009152");
		includes(parsed.docids, "alma990235370982009152");
		eq(parsed.errors.length, 1);
	});

	test("parseInput: search URL wins over item links", function () {
		const parsed = Primo.parseInput(searchUrl + "\n"
			+ "https://www.kubikat.org/discovery/fulldisplay?docid=alma990003239662009152");
		eq(parsed.docids.length, 0);
		assert(parsed.notes.length >= 1, "should note the precedence");
	});

	test("cqlForSearch: maps query terms to CQL and ignores paging", function () {
		eq(
			Primo.cqlForSearch(twoQueryUrl),
			'(alma.all_for_ui all "Michelangelo") AND (alma.title all "Zeichnung")',
		);
		const url = new URL(Primo.sruSearchUrl(twoQueryUrl, 51, 25));
		eq(url.searchParams.get("operation"), "searchRetrieve");
		eq(url.searchParams.get("version"), "1.2");
		eq(url.searchParams.get("recordSchema"), "marcxml");
		eq(url.searchParams.get("startRecord"), "51");
		eq(url.searchParams.get("maximumRecords"), "25");
		assert(url.searchParams.get("query").indexOf("alma.title") !== -1, "CQL query expected");
	});

	test("parseSruResponse: reads MARC records from an SRU response", function () {
		const parsed = Primo.parseSruResponse(first.marc_xml);
		eq(parsed.total, 1);
		eq(parsed.records.length, 1);
		eq(parsed.records[0].docid, first.docid);
		includes(Object.keys(parsed.records[0].marc), "245");
		eq(parsed.records[0].marc.LDR[0]._.charAt(6), "a");
	});

	test("queryTerms: extracts search terms", function () {
		const terms = Primo.queryTerms(twoQueryUrl);
		includes(terms, "Michelangelo");
		includes(terms, "Zeichnung");
	});

	test("clean: strips tags, highlight markers and entities", function () {
		eq(
			Primo.clean("<b>Michelangelo</b> &amp; <<Zeichnung>>"),
			"Michelangelo & Zeichnung",
		);
		eq(Primo.clean("  A\n\tB  "), "A B");
		eq(Primo.clean("überw. Ill."), "überw. Ill.");
	});

	test("parseMarcXml: reads control fields and subfields", function () {
		includes(Object.keys(firstMarc), "245");
		includes(Object.keys(firstMarc), "AVA");
		eq(firstMarc["245"][0].a, "Michelangelo");
		eq(firstMarc["264"][0].b, "Belser");
		assert(firstMarc.AVA.length === 2, "two AVA holdings expected");
	});

	test("buildRecord: maps the real book fixture", function () {
		const record = Primo.buildRecord(first.pnx, first.docid, {
			marc: firstMarc,
			enriched: true,
		});
		eq(record.itemType, "book");
		eq(record.title, "Michelangelo : Leben und Werk");
		eq(record.year, "1989");
		eq(record.publisher, "Belser");
		eq(record.primaryId, "BV021909858");
		includes(record.isbns, "3763019820");
		eq(record.callNumbers.length, 2);
		eq(record.callNumbers[0], "KHI: J 5668 o");
		eq(record.numPages, "192");
		eq(record.holdings.length, 2);
		assert(record.holdings.every(function (h) { return h.available; }), "holdings available");
		eq(record.subjects.length, 8);
		eq(record.creators.length, 2);
		eq(record.creators[0].name, "Lamarche-Vadel, Bernard");
		eq(record.creators[0].role, "oth");
		contains(record.extras.join("\n"), "Kubikat ID: BV021909858");
		contains(record.extras.join("\n"), "Kubikat Doc ID: " + first.docid);
		contains(record.extras.join("\n"), "Kubikat Classification: LI 59405 (rvk)");
		contains(record.notes.join("\n"), "Physical: 192 S. ; überw. Ill.");
	});

	test("buildRecord: repeated values ignore non-alphanumeric differences", function () {
		const pnx = {
			display: {
				type: ["books"],
				title: ["Austin moderne"],
			},
			addata: {
				cop: ["Austin, Tex", "New Haven [u.a"],
				pub: ["University of Texas Press"],
				edition: ["2. Aufl."],
			},
		};
		const marc = {
			"250": [{ a: "3. Aufl." }],
			"264": [
				{ a: "Austin, Tex.", b: "University of Texas Press." },
				{ a: "New Haven [u.a.]" },
			],
		};
		const record = Primo.buildRecord(pnx, "alma990000000000000001", { marc: marc });
		// The complete (longer) spelling wins.
		eq(record.place, "Austin, Tex. ; New Haven [u.a.]");
		eq(record.publisher, "University of Texas Press.");
		// Digits remain significant, so different editions are not merged.
		eq(record.edition, "2. Aufl. ; 3. Aufl.");
	});

	test("pnxFromMarc: MARC-only mapping matches the pnx fixture", function () {
		const pnx = Primo.pnxFromMarc(firstMarc, first.docid);
		const record = Primo.buildRecord(pnx, first.docid, {
			marc: firstMarc,
			enriched: true,
		});
		eq(record.itemType, "book");
		eq(record.title, "Michelangelo : Leben und Werk");
		eq(record.publisher, "Belser");
		eq(record.year, "1989");
		eq(record.primaryId, "BV021909858");
		includes(record.isbns, "3763019820");
		eq(record.callNumbers[0], "KHI: J 5668 o");
		eq(record.subjects.length, 8);
		eq(record.creators.length, 2);
		eq(record.creators[0].name, "Lamarche-Vadel, Bernard");
		contains(record.extras.join("\n"), "Kubikat ID: BV021909858");
	});

	test("typeFromMarc: leader types and 773 hosts", function () {
		eq(Primo.typeFromMarc({ LDR: [{ _: "00000nam a2200000 a 4500" }] }), "books");
		eq(Primo.typeFromMarc({ LDR: [{ _: "00000nas a2200000 a 4500" }] }), "journal");
		eq(Primo.typeFromMarc({ LDR: [{ _: "00000nem a2200000 a 4500" }] }), "map");
		eq(Primo.typeFromMarc({ LDR: [{ _: "00000ncm a2200000 a 4500" }] }), "score");
		eq(Primo.typeFromMarc({ LDR: [{ _: "00000nam a2200000 a 4500" }], "502": [{}] }), "dissertations");
		eq(Primo.typeFromMarc({ LDR: [{ _: "00000nam a2200000 a 4500" }], "773": [{ t: "Host" }] }), "book_chapter");
		eq(Primo.typeFromMarc({ LDR: [{ _: "00000nam a2200000 a 4500" }], "773": [{ t: "Journal", x: "1234-5678" }] }), "article");
	});

	test("Mapper.buildItemPlan: fields, tags and note", function () {
		const record = Primo.buildRecord(first.pnx, first.docid, {
			marc: firstMarc,
			enriched: true,
		});
		const plan = Mapper.buildItemPlan(record, { tags: true, attachments: true });
		eq(plan.itemType, "book");
		eq(plan.fields.title, "Michelangelo : Leben und Werk");
		eq(plan.fields.callNumber, "KHI: J 5668 o");
		eq(plan.fields.ISBN, "3763019820");
		eq(plan.fields.libraryCatalog, "Kubikat");
		eq(plan.fields.date, "1989");
		eq(plan.tags.length, 8);
		contains(plan.fields.extra, "Kubikat Other Call Numbers: HERTZ: Ca-MIC 24-5860/a");
		contains(plan.noteHtml, "<h2>Holdings</h2>");
		contains(plan.noteHtml, "Open stacks via Giusti");
		eq(plan.attachments.length, 0);
		assert(plan.creators.every(function (c) { return c.role === "contributor"; }), "oth -> contributor");
	});

	test("Mapper: creator type resolution and name splitting", function () {
		eq(Mapper.resolveCreatorType("book", "illustrator"), "illustrator");
		eq(Mapper.resolveCreatorType("artwork", "illustrator"), "contributor");
		eq(Mapper.resolveCreatorType("artwork", "artist"), "artist");
		eq(Mapper.mapRole("aut", false, "book"), "author");
		eq(Mapper.mapRole("", true, "artwork"), "artist");

		const comma = Mapper.splitName("Lamarche-Vadel, Bernard", false);
		eq(comma.lastName, "Lamarche-Vadel");
		eq(comma.firstName, "Bernard");
		const simple = Mapper.splitName("Michelangelo Buonarroti", false);
		eq(simple.lastName, "Buonarroti");
		eq(simple.firstName, "Michelangelo");
		const corporate = Mapper.splitName("Fabbriceria di San Petronio", true);
		eq(corporate.fieldMode, 1);
		eq(corporate.lastName, "Fabbriceria di San Petronio");
		eq(Mapper.splitName("Michelangelo Buonarroti, 1475-1564", false).lastName, "Buonarroti");
	});

	test("Mapper: strips identifier qualifiers", function () {
		const record = Primo.buildRecord(first.pnx, first.docid, { marc: firstMarc });
		record.isbns = ["3763019820 (pbk.)"];
		const plan = Mapper.buildItemPlan(record);
		eq(plan.fields.ISBN, "3763019820");
	});

	test("buildRecord: book chapter of a journal becomes journalArticle", function () {
		const chapter = {
			display: {
				type: ["book_chapter"],
				title: ["Ein Aufsatz"],
				ispartof: ["$$Z1234567890"],
				mms: ["1234567890"],
			},
			addata: { spage: ["10"], epage: ["20"] },
		};
		const parent = {
			display: { type: ["journal"], title: ["Zeitschrift für Kunstgeschichte"] },
			addata: {},
		};
		const record = Primo.buildRecord(chapter, "alma1234567890", { parentPnx: parent });
		eq(record.itemType, "journalArticle");
		eq(record.container, "Zeitschrift für Kunstgeschichte");
		eq(record.spage, "10");
		eq(record.epage, "20");
	});

	test("buildRecord: MARC 773 supplies volume, pages and ISSN", function () {
		const chapter = {
			display: {
				type: ["book_chapter"],
				title: ["Ein Aufsatz"],
				ispartof: ["$$Z1234567890"],
				mms: ["1234567890"],
			},
			addata: {},
		};
		const parent = {
			display: { type: ["journal"], title: ["Zeitschrift für Kunstgeschichte"] },
			addata: {},
		};
		const marc = {
			"773": [{
				t: "Zeitschrift für Kunstgeschichte",
				g: "Jg. 5 (1999), S. 10-20",
				w: "(DE-600)123",
				x: "0340-1234",
			}],
		};
		const record = Primo.buildRecord(chapter, "alma1234567890", {
			marc: marc,
			parentPnx: parent,
		});
		eq(record.itemType, "journalArticle");
		eq(record.container, "Zeitschrift für Kunstgeschichte");
		eq(record.volume, "5");
		eq(record.spage, "10");
		eq(record.epage, "20");
		eq(record.year, "1999");
		includes(record.issns, "0340-1234");
	});

	test("buildRecord: book chapter of a book becomes bookSection", function () {
		const chapter = {
			display: { type: ["book_chapter"], title: ["Kapitel"], mms: ["42"] },
			addata: {},
		};
		const parent = {
			display: { type: ["books"], title: ["Sammelband über Michelangelo"] },
			addata: { pub: ["München"], date: ["2005"] },
		};
		const record = Primo.buildRecord(chapter, "alma42", { parentPnx: parent });
		eq(record.itemType, "bookSection");
		eq(record.container, "Sammelband über Michelangelo");
		eq(record.year, "2005");
	});

	test("displayUrl: points at the fulldisplay page", function () {
		const url = new URL(Primo.displayUrl(first.docid));
		eq(url.searchParams.get("docid"), first.docid);
		eq(url.searchParams.get("vid"), "49MPG_KUBIKAT:VU1");
	});

	test("PrimoSruClient: SRU search, pnx synthesis and record fetching", async function () {
		const calls = [];
		const client = new Primo.PrimoSruClient({
			delayMs: 0,
			retries: 0,
			request: async function (url) {
				calls.push(url);
				if (url.indexOf("alma.mms_id=") !== -1) {
					return first.marc_xml;
				}
				const start = Number(new URL(url).searchParams.get("startRecord"));
				const withTotal = function (xml) {
					return xml.replace(
						"<numberOfRecords>1</numberOfRecords>",
						"<numberOfRecords>2</numberOfRecords>",
					);
				};
				if (start === 1) {
					return withTotal(fixtures.records[0].marc_xml);
				}
				if (start === 2) {
					return withTotal(fixtures.records[1].marc_xml);
				}
				throw new Error("unexpected startRecord: " + start);
			},
		});

		const records = await client.searchRecords(searchUrl, { pageSize: 1, max: 2 });
		eq(records.length, 2);
		eq(records[0].docid, first.docid);
		assert(records[0].marc && records[0].marc["245"], "search should return MARC");
		eq(records[0].pnx.display.type[0], "books");
		eq(calls.length, 2);
		assert(calls.every(function (url) { return url.indexOf("/view/sru/") !== -1; }),
			"plugin may only call the SRU endpoint");

		const pnx = await client.fetchRecord(first.docid);
		eq(pnx.display.title[0], "Michelangelo : Leben und Werk");

		const bundle = await client.fetchBundle(first.docid);
		includes(Object.keys(bundle.marc), "245");
		eq(bundle.marc.LDR[0]._.charAt(6), "a");
	});

	test("PrimoSruClient: serializes requests and enforces the delay", async function () {
		const times = [];
		const client = new Primo.PrimoSruClient({
			delayMs: 60,
			retries: 0,
			request: async function () {
				times.push(Date.now());
				return first.marc_xml;
			},
		});
		await Promise.all([
			client.fetchRecord(first.docid),
			client.fetchRecord(first.docid),
		]);
		eq(times.length, 2);
		assert(times[1] - times[0] >= 50, "second request should wait for the delay");
	});

	test("KubikatPlugin: preview and automatic collection name", function () {
		const plugin = new KubikatPlugin({ id: "test", version: "1.0", rootURI: "" });
		const preview = plugin.previewInput(twoQueryUrl);
		assert(preview.ok, "preview should be ok");
		eq(preview.kind, "search");
		contains(preview.suggestedName, "Michelangelo");
		contains(preview.suggestedName, "Zeichnung");
		const items = plugin.previewInput("alma990003239662009152");
		assert(items.ok, "docid preview should be ok");
		eq(items.kind, "items");
		eq(items.count, 1);
	});

	test("KubikatPlugin: end-to-end job with a mock Zotero", async function () {
		const created = [];
		const collections = [];
		let nextID = 1;

		class MockItem {
			constructor(itemType) {
				this.id = nextID++;
				this.itemType = itemType;
				this.itemTypeID = 1;
				this.libraryID = null;
				this.fields = {};
				this.creators = undefined;
				this.collections = [];
				this.tags = [];
				this.note = null;
				this.parentItemID = null;
			}
			setField(field, value) {
				this.fields[field] = value;
			}
			setTags(tags) {
				this.tags = tags;
			}
			setCollections(collections) {
				this.collections = collections;
			}
			setCreators(creators) {
				this.creators = creators;
			}
			setNote(html) {
				this.note = html;
			}
			async saveTx() {
				created.push(this);
				return this.id;
			}
		}

		class MockCollection {
			constructor() {
				this.id = 900 + collections.length;
				this.libraryID = null;
				this.parentID = false;
				this.name = "";
				this.itemIDs = [];
				this.erased = false;
			}
			async saveTx() {
				collections.push(this);
				return this.id;
			}
			async addItems(ids) {
				this.itemIDs.push.apply(this.itemIDs, ids);
			}
			async eraseTx() {
				this.erased = true;
			}
		}

		class MockProgressWindow {
			constructor() {
				this.ItemProgress = class {
					setProgress() {}
					setText() {}
					setError() {}
				};
			}
			changeHeadline() {}
			show() {}
			startCloseTimer() {}
			close() {}
		}

		const FIELD_NAMES = new Set([
			"title", "abstractNote", "date", "publisher", "place", "edition",
			"volume", "issue", "pages", "numPages", "language", "url",
			"libraryCatalog", "callNumber", "genre", "ISBN", "ISSN", "DOI",
			"extra", "series", "seriesTitle", "seriesNumber", "thesisType",
			"university", "reportType", "reportNumber", "institution",
			"conferenceName", "artworkMedium", "audioRecordingFormat",
			"videoRecordingFormat", "label", "studio", "websiteTitle",
		]);

		window.Zotero = {
			debug: function () {},
			Item: MockItem,
			Collection: MockCollection,
			ItemFields: {
				getID: function (field) { return FIELD_NAMES.has(field) ? field : false; },
				isValidForType: function () { return true; },
			},
			CreatorTypes: {
				getTypesForItemType: function () {
					return ["author", "contributor", "editor", "translator", "illustrator"]
						.map(function (name) { return { name: name }; });
				},
			},
			Collections: {
				getByLibrary: function () { return collections.slice(); },
			},
			Attachments: {
				linkFromURL: async function () { throw new Error("no links in this fixture"); },
			},
			ProgressWindow: MockProgressWindow,
			Prefs: {
				get: function (key, fallback) { return fallback; },
				set: function () {},
			},
			Libraries: {
				userLibraryID: 1,
				get: function () { return { name: "My Library", editable: true }; },
			},
			getMainWindow: function () {
				return { document: { getElementById: function () { return null; } } };
			},
			getActiveZoteroPane: function () {
				return { getSelectedLibraryID: function () { return 1; } };
			},
		};

		try {
			const plugin = new KubikatPlugin({ id: "test", version: "1.0", rootURI: "" });
			plugin._client = {
				searchRecords: async function () {
					return [{ docid: first.docid, pnx: first.pnx }];
				},
				fetchMarcXml: async function () { return first.marc_xml; },
				fetchRecord: async function () { return first.pnx; },
			};

			const jobID = plugin.startImport({
				source: searchUrl,
				collectionName: "Test collection",
				max: 10,
				enrich: true,
				tags: true,
				attachments: false,
				acknowledged: true,
			});

			const deadline = Date.now() + 5000;
			let state = plugin.getJobState(jobID);
			while (state && state.status === "running" && Date.now() < deadline) {
				await new Promise(function (resolve) { setTimeout(resolve, 20); });
				state = plugin.getJobState(jobID);
			}
			assert(state && state.status === "done", "job should finish: " + JSON.stringify(state));
			eq(state.created, 1);

			const item = created.find(function (entry) { return entry.itemType === "book"; });
			assert(item, "book item should be created");
			eq(item.fields.title, "Michelangelo : Leben und Werk");
			eq(item.fields.callNumber, "KHI: J 5668 o");
			eq(item.tags.length, 8);
			eq(item.creators.length, 2);
			eq(item.creators[0].creatorType, "contributor");

			const note = created.find(function (entry) { return entry.itemType === "note"; });
			assert(note, "child note should be created");
			eq(note.parentItemID, item.id);
			contains(note.note, "<h2>Holdings</h2>");

			eq(collections.length, 1);
			eq(collections[0].name, "Test collection");
			includes(item.collections, collections[0].id);
			eq(state.collectionID, collections[0].id);
		}
		finally {
			delete window.Zotero;
		}
	});

	test("KubikatPlugin: Zotero 10 plural library selection", function () {
		const plugin = new KubikatPlugin({ id: "test", version: "1.0", rootURI: "" });
		const originalZotero = window.Zotero;
		try {
			window.Zotero = {
				Libraries: {
					userLibraryID: 1,
					get: function (id) {
						return { name: "Library " + id, editable: id !== 7 };
					},
				},
				getActiveZoteroPane: function () {
					return { getSelectedLibraryIDs: function () { return [7, 5]; } };
				},
			};
			eq(plugin.getTargetLibraryID(), 5);
			window.Zotero.getActiveZoteroPane = function () {
				return { getSelectedLibraryID: function () { return 6; } };
			};
			eq(plugin.getTargetLibraryID(), 6);
		}
		finally {
			if (originalZotero === undefined) {
				delete window.Zotero;
			}
			else {
				window.Zotero = originalZotero;
			}
		}
	});

	test("manifest and all plugin scripts are syntactically valid", async function () {
		const manifestResponse = await fetch("../manifest.json", { cache: "no-store" });
		assert(manifestResponse.ok, "manifest.json could not be fetched");
		const manifest = await manifestResponse.json();
		eq(manifest.applications.zotero.id, "re-kubikatia@re-kubikatia.local");
		assert(manifest.applications.zotero.strict_min_version, "strict_min_version missing");

		for (const path of ["../content/kubikat.js", "../content/dialog.js", "../bootstrap.js"]) {
			const response = await fetch(path, { cache: "no-store" });
			assert(response.ok, path + " could not be fetched");
			const source = await response.text();
			// Compile only, never execute.
			new Function(source);
		}
	});

	async function finish() {
		const passed = results.filter(function (r) { return r.ok; }).length;
		const failed = results.length - passed;
		const summary = document.getElementById("summary");
		summary.textContent = passed + " passed, " + failed + " failed";
		summary.className = failed ? "fail" : "pass";
		for (const result of results) {
			const item = document.createElement("li");
			item.className = result.ok ? "pass" : "fail";
			item.textContent = (result.ok ? "PASS " : "FAIL ") + result.name
				+ (result.error ? " — " + result.error : "");
			list.appendChild(item);
		}
		window.__KUBIKAT_TEST_RESULTS__ = {
			passed: passed,
			failed: failed,
			results: results,
		};
	}

	(async function run() {
		for (const entry of tests) {
			try {
				await entry.fn();
				results.push({ name: entry.name, ok: true });
			}
			catch (error) {
				results.push({ name: entry.name, ok: false, error: error.message });
			}
		}
		await finish();
	})();
})();
