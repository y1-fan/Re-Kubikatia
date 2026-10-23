/*
 * Map a structured Kubikat record to a Zotero item plan.
 *
 * No Zotero APIs are used here: the plan contains item type, field values,
 * creators, tags, an optional child note and URL attachments.  The importer
 * applies the plan through Zotero.Item after checking which fields are valid
 * for the chosen item type.  Keeping this pure makes the mapping testable in
 * a normal browser.
 */

"use strict";

var Mapper = (function () {
	// Creator types that Zotero accepts for each item type.  Author is the
	// primary creator for most types; artwork/video/audio have their own.
	const VALID_CREATOR_TYPES = {
		book: ["author", "contributor", "editor", "illustrator", "seriesEditor", "translator"],
		bookSection: ["author", "bookAuthor", "contributor", "editor", "seriesEditor", "translator"],
		journalArticle: ["author", "contributor", "editor", "translator"],
		conferencePaper: ["author", "contributor", "editor", "translator"],
		thesis: ["author", "contributor"],
		manuscript: ["author", "contributor", "editor", "translator"],
		report: ["author", "contributor", "editor", "seriesEditor", "translator"],
		map: ["cartographer", "contributor", "editor", "seriesEditor"],
		artwork: ["artist", "contributor"],
		audioRecording: ["composer", "contributor", "performer", "wordsBy"],
		videoRecording: ["contributor", "director", "producer", "scriptwriter"],
		webpage: ["author", "contributor", "editor", "translator"],
		document: ["author", "contributor", "editor", "translator"],
		preprint: ["author", "contributor"],
		dataset: ["author", "contributor"],
		standard: ["author", "contributor", "editor"],
		patent: ["inventor", "contributor", "editor"],
	};

	const ROLE_TO_CREATOR = {
		aut: "author",
		author: "author",
		edt: "editor",
		editor: "editor",
		trl: "translator",
		translator: "translator",
		ill: "illustrator",
		illustrator: "illustrator",
		pht: "photographer",
		photographer: "photographer",
		cmp: "composer",
		composer: "composer",
		prf: "performer",
		performer: "performer",
		drt: "director",
		director: "director",
		pro: "producer",
		producer: "producer",
		ctb: "contributor",
		contributor: "contributor",
		oth: "contributor",
		pbl: "contributor",
	};

	const CONTAINER_FIELDS = {
		bookSection: "bookTitle",
		journalArticle: "publicationTitle",
		magazineArticle: "publicationTitle",
		newspaperArticle: "publicationTitle",
		conferencePaper: "proceedingsTitle",
		webpage: "websiteTitle",
		blogPost: "blogTitle",
		forumPost: "forumTitle",
		encyclopediaArticle: "encyclopediaTitle",
		dictionaryEntry: "dictionaryTitle",
	};

	function unique(values) {
		const result = [];
		const seen = new Set();
		for (const value of values || []) {
			const text = String(value === undefined || value === null ? "" : value).trim();
			if (text && !seen.has(text)) {
				seen.add(text);
				result.push(text);
			}
		}
		return result;
	}

	function esc(value) {
		return String(value === undefined || value === null ? "" : value).replace(/[&<>"']/g, function (char) {
			switch (char) {
				case "&": return "&amp;";
				case "<": return "&lt;";
				case ">": return "&gt;";
				case '"': return "&quot;";
				default: return "&#39;";
			}
		});
	}

	function isHttpUrl(value) {
		return /^https?:\/\//i.test(String(value || ""));
	}

	function identifierValue(value) {
		// Zotero's ISBN/ISSN fields should contain the number itself, not
		// cataloguer qualifiers such as " (pbk.)"; the full value stays in Extra.
		return String(value || "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
	}

	function mapRole(role, primary, itemType) {
		const code = String(role || "").toLowerCase().split(/\s+/)[0];
		if (primary) {
			if (itemType === "artwork") {
				return "artist";
			}
			if (itemType === "videoRecording") {
				return "director";
			}
			if (itemType === "audioRecording") {
				return "performer";
			}
			if (itemType === "map") {
				return "cartographer";
			}
			return "author";
		}
		return ROLE_TO_CREATOR[code] || "contributor";
	}

	function resolveCreatorType(itemType, desired) {
		const valid = VALID_CREATOR_TYPES[itemType] || ["author", "contributor"];
		if (valid.includes(desired)) {
			return desired;
		}
		if (valid.includes("contributor")) {
			return "contributor";
		}
		return valid[0];
	}

	/**
	 * Split a name into Zotero creator fields.
	 * Corporate/institutional names use fieldMode 1 (single field).
	 */
	function splitName(name, corporate) {
		let text = String(name || "").replace(/\s+/g, " ").trim();
		if (!text) {
			return null;
		}
		// Trailing life dates are common in MARC but are not part of a name.
		text = text.replace(/,\s*\d{3,4}(?:\s*-\s*\d{0,4})?\s*\.?$/, "").trim();
		if (!text) {
			return null;
		}
		if (corporate) {
			return { lastName: text, fieldMode: 1 };
		}
		const comma = text.indexOf(",");
		if (comma !== -1) {
			const last = text.slice(0, comma).trim();
			const first = text.slice(comma + 1).trim();
			if (last && first) {
				return { lastName: last, firstName: first };
			}
			return { lastName: text, fieldMode: 1 };
		}
		const parts = text.split(/\s+/);
		if (parts.length === 1) {
			return { lastName: text, fieldMode: 1 };
		}
		const last = parts.pop();
		return { lastName: last, firstName: parts.join(" ") };
	}

	function noteHtml(record) {
		const sections = [];

		if (record.notes && record.notes.length) {
			const items = record.notes.map(function (note) {
				return "<li>" + esc(note) + "</li>";
			}).join("");
			sections.push("<h2>Notes</h2><ul>" + items + "</ul>");
		}

		if (record.holdings && record.holdings.length) {
			const items = record.holdings.map(function (holding) {
				const details = [holding.library_name, holding.collection, holding.coverage]
					.filter(Boolean)
					.join(" ; ");
				const suffix = details ? " — " + esc(details) : "";
				const state = holding.available ? "available" : "unavailable";
				return "<li><strong>" + esc(holding.label) + "</strong>" + suffix
					+ " <em>(" + state + ")</em></li>";
			}).join("");
			sections.push("<h2>Holdings</h2><ul>" + items + "</ul>");
		}

		const byUrl = new Map();
		for (const detail of record.linkDetails || []) {
			if (detail && detail.url) {
				byUrl.set(detail.url, detail.label || "");
			}
		}
		for (const url of record.links || []) {
			if (!byUrl.has(url)) {
				byUrl.set(url, "");
			}
		}
		if (byUrl.size) {
			const items = [];
			for (const entry of byUrl) {
				const url = entry[0];
				const label = entry[1] || url;
				if (isHttpUrl(url)) {
					items.push('<li><a href="' + esc(url) + '">' + esc(label) + "</a></li>");
				}
				else {
					items.push("<li>" + esc(label) + "</li>");
				}
			}
			sections.push("<h2>Links</h2><ul>" + items.join("") + "</ul>");
		}

		return sections.length ? sections.join("\n") : "";
	}

	function attachmentList(record) {
		const labels = new Map();
		for (const detail of record.linkDetails || []) {
			if (detail && detail.url) {
				labels.set(detail.url, detail.label || "");
			}
		}
		const attachments = [];
		const seen = new Set();
		for (const url of record.links || []) {
			if (!isHttpUrl(url) || url === record.url || seen.has(url)) {
				continue;
			}
			seen.add(url);
			attachments.push({ url: url, title: labels.get(url) || url });
			if (attachments.length >= 20) {
				break;
			}
		}
		return attachments;
	}

	/**
	 * Build the Zotero item plan for one record.
	 *
	 * @param {object} record - Output of Primo.buildRecord().
	 * @param {object} [options] - { tags: boolean, attachments: boolean }
	 * @returns {object} { itemType, fields, creators, tags, noteHtml, attachments }
	 */
	function buildItemPlan(record, options) {
		options = options || {};
		const itemType = record.itemType || "document";
		const fields = {};
		const extras = (record.extras || []).slice();

		function set(field, value) {
			if (value === undefined || value === null || value === "") {
				return;
			}
			fields[field] = String(value);
		}

		set("title", record.title || "(Untitled)");
		set("abstractNote", record.abstract);
		set("date", record.year);
		set("publisher", record.publisher);
		set("place", record.place);
		set("edition", record.edition);
		set("volume", record.volume);
		set("issue", record.issue);
		set("pages", [record.spage, record.epage].filter(Boolean).join("-"));
		set("numPages", record.numPages);
		set("language", (record.languages || []).join(" ; "));
		set("url", record.url);
		set("libraryCatalog", "Kubikat");
		set("callNumber", (record.callNumbers || [])[0]);
		set("genre", (record.genres || [])[0]);
		set("ISBN", identifierValue((record.isbns || [])[0]));
		set("ISSN", identifierValue((record.issns || [])[0]));
		set("DOI", record.doi);

		const containerField = CONTAINER_FIELDS[itemType];
		if (containerField && record.container) {
			set(containerField, record.container);
		}

		// Series: the first one becomes the native series fields; extras are
		// preserved in Extra so nothing is lost.
		const series = (record.series || []).filter(function (entry) {
			return entry && entry.title;
		});
		if (series.length) {
			set("series", series[0].title);
			set("seriesTitle", series[0].title);
			set("seriesNumber", series[0].volume);
			if (series.length > 1) {
				extras.push("Kubikat Other Series: " + series.slice(1).map(function (entry) {
					return entry.volume ? entry.title + " " + entry.volume : entry.title;
				}).join(" ; "));
			}
		}

		if (record.doi) {
			extras.push("Kubikat DOI: " + record.doi);
		}
		if (record.isbns && record.isbns.length > 1) {
			extras.push("Kubikat Other ISBNs: " + record.isbns.slice(1).join(" ; "));
		}
		if (record.issns && record.issns.length > 1) {
			extras.push("Kubikat Other ISSNs: " + record.issns.slice(1).join(" ; "));
		}
		if (record.callNumbers && record.callNumbers.length > 1) {
			extras.push("Kubikat Other Call Numbers: " + record.callNumbers.slice(1).join(" ; "));
		}

		if (itemType === "thesis") {
			set("thesisType", record.thesisType || "Dissertation");
			set("university", record.university);
		}
		if (itemType === "report") {
			set("reportType", record.reportType);
			set("reportNumber", record.reportNumber);
			set("institution", record.institution || record.publisher);
		}
		if (itemType === "conferencePaper") {
			set("conferenceName", record.conferenceName);
		}
		if (itemType === "artwork") {
			set("artworkMedium", record.physical);
		}
		if (itemType === "audioRecording") {
			set("audioRecordingFormat", record.physical);
			set("label", record.publisher);
		}
		if (itemType === "videoRecording") {
			set("videoRecordingFormat", record.physical);
			set("studio", record.publisher);
		}
		if (itemType === "webpage") {
			set("websiteTitle", record.container || record.publisher);
		}

		const creators = (record.creators || []).map(function (creator) {
			return {
				name: creator.name,
				role: mapRole(creator.role, creator.primary, itemType),
				corporate: !!creator.corporate,
			};
		});

		const tags = options.tags === false
			? []
			: unique(record.subjects || []);

		const attachmentItems = options.attachments === false
			? []
			: attachmentList(record);

		const extra = unique(extras).join("\n");
		set("extra", extra);

		return {
			itemType: itemType,
			fields: fields,
			creators: creators,
			tags: tags,
			noteHtml: noteHtml(record),
			attachments: attachmentItems,
		};
	}

	return {
		buildItemPlan: buildItemPlan,
		mapRole: mapRole,
		resolveCreatorType: resolveCreatorType,
		splitName: splitName,
		VALID_CREATOR_TYPES: VALID_CREATOR_TYPES,
	};
})();
