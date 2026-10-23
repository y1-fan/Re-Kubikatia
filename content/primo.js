/*
 * Kubikat / Primo data layer.
 *
 * This is a direct JavaScript port of the reference implementation in
 * kubikat/primo_ris.py, minus the RIS serialisation.  It turns a Kubikat
 * search URL (or individual item links) into MARC records through the SRU
 * interface, optionally fetches parent records, and finally produces one
 * structured record per item that the Zotero mapper can consume.
 *
 * The module is deliberately independent of Zotero's item APIs so that it
 * can be exercised in a normal browser (see tests/test.html).  Only
 * PrimoSruClient touches the network, through an injectable transport.
 */

"use strict";

var Primo = (function () {
	const HOST = "https://www.kubikat.org";
	const VID = "49MPG_KUBIKAT:VU1";
	const INST = "49MPG_KUBIKAT";
	const SRU_URL = "https://eu06.alma.exlibrisgroup.com/view/sru/" + INST;
	const MARC_NS = "http://www.loc.gov/MARC21/slim";
	const SRU_NS = "http://www.loc.gov/zing/srw/";
	const SRU_PAGE_SIZE = 50;
	const MAX_ITEMS = 50;
	const REQUEST_DELAY_MS = 10000;
	const MAX_REQUESTS = 200;

	const TYPE_MAP = {
		books: "book",
		book: "book",
		exhibitioncatalog: "book",
		auctioncatalog: "book",
		serie: "book",
		book_chapter: "bookSection",
		book_chapters: "bookSection",
		article: "journalArticle",
		articles: "journalArticle",
		conference_proceeding: "conferencePaper",
		dissertations: "thesis",
		dissertation: "thesis",
		review: "journalArticle",
		journal: "journalArticle",
		journals: "journalArticle",
		videos: "videoRecording",
		video: "videoRecording",
		audio: "audioRecording",
		sound_recording: "audioRecording",
		image: "artwork",
		images: "artwork",
		score: "book",
		scores: "book",
		manuscripts: "manuscript",
		manuscript: "manuscript",
		web_resources: "webpage",
		web_resource: "webpage",
		database: "webpage",
		databases: "webpage",
		report: "report",
		reports: "report",
		map: "map",
		maps: "map",
		other: "document",
	};

	const TAG_RE = /<[^>]+>/g;
	const YEAR_RE = /(1[0-9]{3}|20[0-9]{2})/;
	const DOCID_RE = /^(alma)?\d{10,}$/;
	const ROLE_TAIL = /\s+(?:Sonstige|Verfasser(?:in)?|Herausgeber(?:in)?|Übersetzer(?:in)?|Mitwirkender|Bearbeiter(?:in)?|Autor(?:in)?|Beiträger(?:in)?|publisher|author|editor|contributor|translator)\.?$/i;
	const LIFE_DATES_RE = /,\s*\d{3,4}(?:\s*-\s*\d{0,4})?\s*\.?$/;
	const CORPORATE_RE = /\b(?:Bibliothek|Institut|Museum|Universität|Università|Accademia|Akademie|Stiftung|Gesellschaft|Archiv|Galerie|Gallery|Society|Association|Council|Department|Ministero|Soprintendenza|Fabbriceria|Verlag|Kunsthalle|Kunstmuseum|Foundation|Fondazione|Centro|Istituto)\b/i;

	const PAGE_RE = /(\d+)\s*[-–]\s*(\d+)/;
	const VOLUME_RE = /(?:Jg\.|Jahrg\.|Bd\.|Vol\.|Bdch\.)\s*([0-9]+)/;
	const VOLUME_COLON_RE = /(?:volume|vol\.?|band|bd\.?|jg\.?|jahrg\.?)\s*:?\s*([0-9]+)/i;
	const ISSUE_RE = /(?:H\.|Heft|Nr\.|Issue)\s*([0-9]+)/;
	const NO_RE = /(?:no\.?|nr\.?)\s*:?\s*([0-9]+)/i;
	const YEAR_VOLUME_RE = /(?<!\d)(\d{1,4})\.((?:1[5-9]|20)\d{2})(?!\d)/;
	const YEAR_COLON_RE = /(?:yr\.?|year|jahr)\s*:?\s*((?:1[5-9]|20)\d{2})/i;
	const SERIES_VOLUME_RE = /^(.*?)\s*(?:;|,)?\s*(?:Bd\.|Vol\.|Jg\.|Jahrg\.|No\.|Nr\.)?\s*(\d{1,4})$/i;

	const ROLE_WORDS = {
		sonstige: "oth",
		verfasser: "aut",
		verfasserin: "aut",
		herausgeber: "edt",
		herausgeberin: "edt",
		übersetzer: "trl",
		übersetzerin: "trl",
		mitwirkender: "ctb",
		bearbeiter: "edt",
		bearbeiterin: "edt",
		autor: "aut",
		autorin: "aut",
		beiträger: "ctb",
		beiträgerin: "ctb",
		illustrator: "ill",
		illustratorin: "ill",
		publisher: "pbl",
	};

	// ---------------------------------------------------------------- generic

	function asList(values) {
		if (values === undefined || values === null || values === "") {
			return [];
		}
		return Array.isArray(values) ? values.slice() : [values];
	}

	function decodeHtml(text) {
		if (!text || text.indexOf("&") === -1) {
			return text || "";
		}
		const named = {
			amp: "&", AMP: "&",
			lt: "<", LT: "<",
			gt: ">", GT: ">",
			quot: '"', QUOT: '"',
			apos: "'", APOS: "'",
			nbsp: " ", NBSP: " ",
			shy: "", SHY: "",
			ndash: "–", mdash: "—", hellip: "…",
			lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
			laquo: "«", raquo: "»", bdquo: "„", lsaquo: "‹", rsaquo: "›",
			szlig: "ß", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü",
			agrave: "à", aacute: "á", acirc: "â", atilde: "ã", aelig: "æ", ccedil: "ç",
			egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
			igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
			ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", oslash: "ø",
			ugrave: "ù", uacute: "ú", ucirc: "û",
			ntilde: "ñ", thorn: "þ", eth: "ð", deg: "°", pound: "£", euro: "€",
		};
		return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, function (match, entity) {
			if (entity[0] === "#") {
				let code;
				if (entity[1].toLowerCase() === "x") {
					code = parseInt(entity.slice(2), 16);
				}
				else {
					code = parseInt(entity.slice(1), 10);
				}
				if (Number.isFinite(code)) {
					try {
						return String.fromCodePoint(code);
					}
					catch (e) {
						return match;
					}
				}
				return match;
			}
			if (Object.prototype.hasOwnProperty.call(named, entity)) {
				return named[entity];
			}
			const lower = entity.toLowerCase();
			if (Object.prototype.hasOwnProperty.call(named, lower)) {
				return named[lower];
			}
			return match;
		});
	}

	function clean(value) {
		if (value === undefined || value === null) {
			return "";
		}
		// Aleph/Primo marks search hits with <<...>>; strip those before
		// removing tags so that a highlighted word is not half-eaten.
		let text = String(value).replace(/<</g, "").replace(/>>/g, "");
		text = text.replace(TAG_RE, "");
		text = decodeHtml(text);
		return text.replace(/\s+/g, " ").trim();
	}

	function first(values) {
		const list = asList(values);
		return list.length ? clean(list[0]) : "";
	}

	/**
	 * Comparison key for repeated values (place, publisher, edition, series…).
	 * Primo and MARC describe the same value slightly differently: one source
	 * writes "New Haven [u.a.", the other "New Haven [u.a.]".  Compare only
	 * letters and digits so punctuation, brackets and spacing do not matter.
	 * Digits stay significant: "Bd. 1" and "Bd. 2" are different values.
	 */
	function valueKey(value) {
		return clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
	}

	function uniqueCi(values) {
		return uniqueNormalized(values);
	}

	/**
	 * Deduplicate values by valueKey().  When the same value appears in several
	 * spellings, keep the longest one: truncated variants such as
	 * "New Haven [u.a." lose against the complete "New Haven [u.a.]".
	 */
	function uniqueNormalized(values) {
		const result = [];
		const positions = new Map();
		for (const value of asList(values)) {
			const text = clean(value);
			const key = valueKey(text);
			if (!text || !key) {
				continue;
			}
			if (!positions.has(key)) {
				positions.set(key, result.length);
				result.push(text);
				continue;
			}
			const index = positions.get(key);
			if (text.length > result[index].length) {
				result[index] = text;
			}
		}
		return result;
	}

	function joinUnique(values, separator) {
		return uniqueNormalized(values).join(separator || " ; ");
	}

	function splitMarc(value) {
		return clean(String(value || "").split("$$")[0]);
	}

	function person(value) {
		let text = splitMarc(value || "");
		text = text.replace(ROLE_TAIL, "");
		text = text.replace(/^[\s,;:.]+|[\s,;:.]+$/g, "");
		text = text.replace(LIFE_DATES_RE, "");
		return text.replace(/\s+/g, " ").trim();
	}

	function identifierKey(value) {
		const text = clean(value).replace(/\([^)]*\)/g, "");
		return text.replace(/[^0-9Xx]/g, "").toUpperCase();
	}

	function nameKey(value) {
		let text = clean(value).toLowerCase();
		text = text.replace(/\([^)]*\)/g, " ");
		text = text.replace(/[\W_]+/g, " ");
		return text.split(/\s+/).filter(Boolean).join(" ");
	}

	function namesMatch(left, right) {
		const a = nameKey(left);
		const b = nameKey(right);
		if (!a || !b) {
			return false;
		}
		return a === b || a.indexOf(b + " ") === 0 || b.indexOf(a + " ") === 0;
	}

	function subjectKey(value) {
		let text = clean(value).toLowerCase();
		text = text.replace(/\([^)]*\)/g, " ");
		text = text.replace(/[\W_]+/g, " ");
		return text.split(/\s+/).filter(Boolean).join(" ");
	}

	function seriesKey(value) {
		const text = clean(value).toLowerCase();
		return text.replace(/[\W_]+/g, " ").split(/\s+/).filter(Boolean).join(" ");
	}

	function authorityKey(value) {
		const text = clean(value).toLowerCase().replace(/\([^)]*\)/g, "");
		return text.split(/\s+/).filter(Boolean).join(" ");
	}

	function yearOf(values) {
		for (const value of asList(values)) {
			const match = YEAR_RE.exec(value || "");
			if (match) {
				return match[1];
			}
		}
		return "";
	}

	function splitSeriesText(value) {
		const text = clean(value);
		const match = SERIES_VOLUME_RE.exec(text);
		if (match) {
			const title = match[1].replace(/^[\s;,]+|[\s;,]+$/g, "");
			if (title) {
				return [title, match[2]];
			}
		}
		return [text, ""];
	}

	function isKubikatHost(host) {
		host = String(host || "").toLowerCase().replace(/\.$/, "");
		return host === "kubikat.org" || host.endsWith(".kubikat.org");
	}

	function makeURL(input, base) {
		if (typeof URL !== "undefined") {
			return base ? new URL(input, base) : new URL(input);
		}
		const win = Zotero.getMainWindow();
		return base ? new win.URL(input, base) : new win.URL(input);
	}

	function makeSearchParams(init) {
		if (typeof URLSearchParams !== "undefined") {
			return new URLSearchParams(init);
		}
		const win = Zotero.getMainWindow();
		return new win.URLSearchParams(init);
	}

	function makeDomParser() {
		if (typeof DOMParser !== "undefined") {
			return new DOMParser();
		}
		const win = Zotero.getMainWindow();
		return new win.DOMParser();
	}

	function delay(ms) {
		if (typeof Zotero !== "undefined" && Zotero.Promise && Zotero.Promise.delay) {
			return Zotero.Promise.delay(ms);
		}
		return new Promise(function (resolve) { setTimeout(resolve, ms); });
	}

	// ---------------------------------------------------------------- URLs

	function displayUrl(docid) {
		const params = makeSearchParams({
			docid: docid,
			context: "L",
			vid: VID,
			lang: "de",
			search_scope: "MyInstitution",
			adaptor: "Local Search Engine",
			tab: "LibraryCatalog",
		});
		return HOST + "/discovery/fulldisplay?" + params.toString();
	}

	function sruUrlForQuery(query, startRecord, maximumRecords) {
		const params = makeSearchParams({
			operation: "searchRetrieve",
			version: "1.2",
			recordSchema: "marcxml",
			maximumRecords: String(Math.max(1, Math.min(SRU_PAGE_SIZE, maximumRecords || SRU_PAGE_SIZE))),
			startRecord: String(Math.max(1, startRecord || 1)),
			query: query,
		});
		return SRU_URL + "?" + params.toString();
	}

	function sruRecordUrl(docid) {
		const number = String(docid || "").replace(/\D/g, "");
		if (!number) {
			throw new Error("No MMS ID in " + docid);
		}
		return sruUrlForQuery("alma.mms_id=" + number, 1, 2);
	}

	const CQL_FIELDS = {
		any: "alma.all_for_ui",
		all: "alma.all_for_ui",
		title: "alma.title",
		creator: "alma.creator",
		author: "alma.creator",
		subject: "alma.subjects",
		subjects: "alma.subjects",
		isbn: "alma.isbn",
		issn: "alma.issn",
		publisher: "alma.publisher",
		date: "alma.date",
		year: "alma.date",
		language: "alma.language",
		doi: "alma.digital_object_identifier",
		series: "alma.series",
	};

	const CQL_BOOLEANS = {
		AND: "AND", OR: "OR", NOT: "NOT",
		UND: "AND", ODER: "OR", NICHT: "NOT",
	};

	function cqlTerm(condition) {
		const parts = String(condition || "").split(",");
		if (parts.length < 3) {
			return null;
		}
		let bool = "AND";
		const last = parts[parts.length - 1].trim().toUpperCase();
		if (CQL_BOOLEANS[last]) {
			bool = CQL_BOOLEANS[last];
			parts.pop();
		}
		const field = (parts.shift() || "").trim().toLowerCase();
		const relation = (parts.shift() || "").trim().toLowerCase();
		const term = parts.join(",").trim();
		if (!term) {
			return null;
		}
		const index = CQL_FIELDS[field] || "alma.all_for_ui";
		let operator = "all";
		if (relation === "is" || relation === "exact" || relation === "equals") {
			operator = "=";
		}
		const value = '"' + term.replace(/"/g, " ").replace(/\\/g, " ") + '"';
		return { clause: index + " " + operator + " " + value, bool: bool };
	}

	/**
	 * Translate the UI search URL into a CQL query for the SRU endpoint.
	 * Primo facets and sorting are not part of the query string we can map,
	 * so this plugin intentionally supports the query terms only.
	 */
	function cqlForSearch(searchUrl) {
		const url = makeURL(searchUrl);
		if (!isKubikatHost(url.hostname)) {
			throw new Error("Only kubikat.org search URLs are supported");
		}
		const raw = [];
		for (const value of url.searchParams.getAll("query")) {
			raw.push.apply(raw, String(value).split(";"));
		}
		const q = url.searchParams.get("q");
		if (q) {
			raw.push.apply(raw, String(q).split(";"));
		}
		const clauses = [];
		for (const condition of raw) {
			const parsed = cqlTerm(condition);
			if (parsed) {
				clauses.push(parsed);
			}
		}
		if (!clauses.length) {
			throw new Error("The search URL has no query/q parameter");
		}
		let cql = "(" + clauses[0].clause + ")";
		for (let i = 1; i < clauses.length; i++) {
			cql += " " + (clauses[i - 1].bool || "AND") + " (" + clauses[i].clause + ")";
		}
		return cql;
	}

	function sruSearchUrl(searchUrl, startRecord, maximumRecords) {
		return sruUrlForQuery(cqlForSearch(searchUrl), startRecord, maximumRecords);
	}

	function queryTerms(searchUrl) {
		let url;
		try {
			url = makeURL(searchUrl);
		}
		catch (e) {
			return [];
		}
		const conditions = [];
		for (const value of url.searchParams.getAll("query")) {
			conditions.push.apply(conditions, String(value).split(";"));
		}
		const q = url.searchParams.get("q");
		if (q) {
			conditions.push.apply(conditions, q.split(";"));
		}
		const terms = [];
		for (const condition of conditions) {
			const parts = String(condition).split(",");
			if (parts.length < 3) {
				continue;
			}
			let end = parts.length;
			const last = parts[parts.length - 1].trim().toUpperCase();
			if (["AND", "OR", "NOT", "UND", "ODER", "NICHT"].includes(last)) {
				end = parts.length - 1;
			}
			const term = clean(parts.slice(2, end).join(","));
			if (term && !terms.includes(term)) {
				terms.push(term);
			}
		}
		return terms;
	}

	function docidFrom(text) {
		const value = String(text || "").trim();
		if (!value || value.indexOf("#") === 0) {
			return null;
		}
		if (DOCID_RE.test(value)) {
			return value.indexOf("alma") === 0 ? value : "alma" + value;
		}
		return null;
	}

	function docidFromUrl(url) {
		const values = url.searchParams.getAll("docid");
		if (!values.length) {
			return null;
		}
		const value = values[0].trim();
		if (/^\d{10,}$/.test(value)) {
			return "alma" + value;
		}
		return value || null;
	}

	/**
	 * Parse a multi-line input: search-results URL, fulldisplay links, or
	 * bare docids.  Mirrors parse_input() from the reference implementation.
	 */
	function parseInput(text) {
		const result = {
			searchUrl: null,
			docids: [],
			notes: [],
			errors: [],
		};
		const seen = new Set();

		for (const raw of String(text || "").split(/\r?\n/)) {
			const line = raw.trim();
			if (!line || line.indexOf("#") === 0) {
				continue;
			}

			let docid = null;
			if (/^https?:\/\//i.test(line)) {
				let url;
				try {
					url = makeURL(line);
				}
				catch (e) {
					result.errors.push("Invalid URL: " + shortText(line));
					continue;
				}
				if (!isKubikatHost(url.hostname)) {
					result.errors.push("Not a kubikat.org link: " + shortText(line));
					continue;
				}
				const isSearch = url.pathname.indexOf("/discovery/search") !== -1
					|| ((url.searchParams.has("query") || url.searchParams.has("q"))
						&& url.pathname.indexOf("/discovery/fulldisplay") === -1);
				if (isSearch) {
					if (!url.searchParams.has("query") && !url.searchParams.has("q")) {
						result.errors.push("Search URL has no query parameter: " + shortText(line));
						continue;
					}
					if (result.searchUrl) {
						result.notes.push("Only one search URL is processed at a time; extra search links were ignored.");
						continue;
					}
					result.searchUrl = line;
					continue;
				}
				docid = docidFromUrl(url);
				if (!docid) {
					result.errors.push("The link contains no docid: " + shortText(line));
					continue;
				}
			}
			else {
				docid = docidFrom(line);
				if (!docid) {
					result.errors.push("Unrecognised input: " + shortText(line));
					continue;
				}
			}

			if (docid && !seen.has(docid)) {
				seen.add(docid);
				result.docids.push(docid);
			}
		}

		if (result.searchUrl && result.docids.length) {
			result.notes.push("Both a search URL and item links were given; the search URL takes precedence.");
			result.docids = [];
		}
		return result;
	}

	function shortText(text, limit) {
		limit = limit || 90;
		text = String(text || "").trim();
		return text.length <= limit ? text : text.slice(0, limit - 1) + "…";
	}

	// ---------------------------------------------------------------- pnx helpers

	function hostTitle(pnx) {
		const display = (pnx && pnx.display) || {};
		for (const key of ["ispartof", "series", "relation"]) {
			for (const value of asList(display[key])) {
				const title = splitMarc(value);
				if (title) {
					return title;
				}
			}
		}
		return "";
	}

	function parentDocid(pnx) {
		const display = (pnx && pnx.display) || {};
		for (const value of asList(display.ispartof)) {
			const match = /\$\$Z(\d+)/.exec(value || "");
			if (match) {
				return "alma" + match[1];
			}
		}
		return null;
	}

	function needsParent(pnx) {
		const rtype = (first(((pnx && pnx.display) || {}).type) || "").toLowerCase();
		return (rtype === "book_chapter" || rtype === "book_chapters") && !!parentDocid(pnx);
	}

	function pnxTag(value, code) {
		const match = new RegExp("\\$\\$" + code + "([^$]*)").exec(value || "");
		return match ? clean(match[1]) : "";
	}

	function pnxContributor(value) {
		const roles = [];
		const re = /\$\$T([^$]*)/g;
		let match;
		while ((match = re.exec(value || "")) !== null) {
			const role = clean(match[1]);
			if (role && !roles.includes(role)) {
				roles.push(role);
			}
		}
		const name = splitMarc(value || "").replace(/^[\s,;]+|[\s,;]+$/g, "");
		return [name, roles.join(" ")];
	}

	function normalizeRole(role) {
		const text = clean(role).toLowerCase();
		if (!text) {
			return "";
		}
		if (ROLE_WORDS[text]) {
			return ROLE_WORDS[text];
		}
		const firstToken = text.split(/\s+/)[0];
		if (ROLE_WORDS[firstToken]) {
			return ROLE_WORDS[firstToken];
		}
		return firstToken;
	}

	function isAuthorRole(role) {
		if (!role) {
			return true;
		}
		const tokens = String(role).split(/\s+/);
		return tokens.includes("aut") || tokens.includes("author");
	}

	function isCorporateName(name) {
		return CORPORATE_RE.test(name || "");
	}

	// ---------------------------------------------------------------- MARCXML

	function parseMarcRecord(record) {
		const fields = {};
		if (!record) {
			return fields;
		}
		const leader = Array.from(record.children || []).find(function (child) {
			return (child.localName || String(child.nodeName || "").split(":").pop()) === "leader";
		});
		if (leader) {
			fields.LDR = [{ _: leader.textContent || "" }];
		}
		for (const field of Array.from(record.children || [])) {
			const tag = field.getAttribute("tag");
			if (!tag) {
				continue;
			}
			const localName = field.localName || String(field.nodeName || "").split(":").pop();
			if (localName === "controlfield") {
				(fields[tag] = fields[tag] || []).push({ _: field.textContent || "" });
				continue;
			}
			const subs = {};
			for (const sub of Array.from(field.children || [])) {
				const subName = sub.localName || String(sub.nodeName || "").split(":").pop();
				if (subName !== "subfield") {
					continue;
				}
				const code = sub.getAttribute("code") || "";
				// The reference parser keeps the first occurrence only.
				if (!(code in subs)) {
					subs[code] = sub.textContent || "";
				}
			}
			(fields[tag] = fields[tag] || []).push(subs);
		}
		return fields;
	}

	function parseMarcXml(raw) {
		const text = String(raw === undefined || raw === null ? "" : raw);
		if (!text.trim()) {
			return {};
		}
		let doc;
		try {
			doc = makeDomParser().parseFromString(text, "application/xml");
		}
		catch (e) {
			throw new Error("MARCXML could not be parsed: " + (e && e.message ? e.message : e));
		}
		if (doc.getElementsByTagName("parsererror").length) {
			throw new Error("MARCXML could not be parsed");
		}
		let records = doc.getElementsByTagNameNS(MARC_NS, "record");
		let record = records.length ? records[0] : null;
		if (!record) {
			records = doc.getElementsByTagName("record");
			record = records.length ? records[0] : null;
		}
		return parseMarcRecord(record);
	}

	/**
	 * Parse a searchRetrieveResponse from the SRU endpoint.  Each MARC record
	 * lives inside <recordData>; the wrapper <record> elements are SRU
	 * bookkeeping and must not be treated as bibliographic records.
	 */
	function parseSruResponse(raw) {
		const text = String(raw === undefined || raw === null ? "" : raw);
		if (!text.trim()) {
			return { total: 0, records: [] };
		}
		let doc;
		try {
			doc = makeDomParser().parseFromString(text, "application/xml");
		}
		catch (e) {
			throw new Error("SRU response could not be parsed: " + (e && e.message ? e.message : e));
		}
		if (doc.getElementsByTagName("parsererror").length) {
			throw new Error("SRU response could not be parsed");
		}
		const totalNode = doc.getElementsByTagNameNS(SRU_NS, "numberOfRecords")[0]
			|| doc.getElementsByTagName("numberOfRecords")[0];
		const total = totalNode ? Number(totalNode.textContent) || 0 : 0;

		let containers = doc.getElementsByTagNameNS(SRU_NS, "recordData");
		if (!containers.length) {
			containers = doc.getElementsByTagName("recordData");
		}
		let marcNodes = [];
		if (containers.length) {
			for (const container of Array.from(containers)) {
				const node = Array.from(container.children || []).find(function (child) {
					return (child.localName || String(child.nodeName || "").split(":").pop()) === "record";
				});
				if (node) {
					marcNodes.push(node);
				}
			}
		}
		if (!marcNodes.length) {
			let nodes = doc.getElementsByTagNameNS(MARC_NS, "record");
			if (!nodes.length) {
				nodes = doc.getElementsByTagName("record");
			}
			marcNodes = Array.from(nodes).filter(function (node) {
				return node.getAttribute("tag") === null
					&& (node.getElementsByTagName("controlfield").length
						|| node.getElementsByTagName("datafield").length);
			});
		}

		const records = [];
		for (const node of marcNodes) {
			const marc = parseMarcRecord(node);
			const docid = marcId(marc);
			if (docid) {
				records.push({ docid: docid, marc: marc });
			}
		}

		if (!records.length) {
			const message = doc.getElementsByTagName("message")[0];
			if (message && message.textContent) {
				throw new Error("Kubikat SRU: " + clean(message.textContent));
			}
		}
		return { total: total, records: records };
	}

	function marcId(marc) {
		const field = asList((marc || {})["001"])[0];
		const raw = field && (field._ !== undefined ? field._ : field.a);
		const digits = String(raw || "").replace(/\D/g, "");
		return digits ? "alma" + digits : "";
	}


	function parseHostG(value) {
		const text = clean(value);
		const result = { sp: "", ep: "", vl: "", is: "", year: "" };

		const pages = PAGE_RE.exec(text);
		if (pages) {
			result.sp = pages[1];
			result.ep = pages[2];
		}

		const volume = VOLUME_RE.exec(text) || VOLUME_COLON_RE.exec(text);
		if (volume) {
			result.vl = volume[1];
		}

		const yearVolume = YEAR_VOLUME_RE.exec(text);
		if (yearVolume) {
			result.vl = result.vl || yearVolume[1];
			result.year = yearVolume[2];
		}
		if (!result.year) {
			const year = YEAR_COLON_RE.exec(text);
			if (year) {
				result.year = year[1];
			}
		}
		if (!result.year) {
			const year = YEAR_RE.exec(text);
			if (year) {
				result.year = year[1];
			}
		}

		const issue = ISSUE_RE.exec(text) || NO_RE.exec(text);
		if (issue) {
			result.is = issue[1];
		}
		return result;
	}

	function bestHost(marc) {
		const groups = {};
		for (const field of asList(marc["773"])) {
			const key = clean(field.w) || clean(field.t) || "__single__";
			(groups[key] = groups[key] || []).push(field);
		}

		let best = null;
		for (const key of Object.keys(groups)) {
			const data = {
				title: "",
				year: "",
				sp: "",
				ep: "",
				vl: "",
				is: "",
				issn: "",
				system: "",
				g: "",
			};
			for (const field of groups[key]) {
				data.title = data.title || clean(field.t);
				data.issn = data.issn || clean(field.x);
				data.system = data.system || clean(field.w);
				data.year = data.year || yearOf([field.d || ""]);
				const g = clean(field.g);
				if (!g) {
					continue;
				}
				const parsed = parseHostG(g);
				data.year = data.year || parsed.year;
				data.vl = data.vl || parsed.vl;
				data.is = data.is || parsed.is;
				if (parsed.sp && !data.sp) {
					data.sp = parsed.sp;
					data.ep = parsed.ep;
					data.g = g;
				}
				else if (!data.g) {
					data.g = g;
				}
			}
			data.score = (data.title ? 4 : 0)
				+ (data.sp ? 3 : 0)
				+ (data.vl ? 2 : 0)
				+ (data.is ? 1 : 0)
				+ (data.year ? 1 : 0)
				+ (data.issn ? 2 : 0)
				+ (data.system ? 1 : 0);
			if (!best || data.score > best.score) {
				best = data;
			}
		}
		return best || {};
	}

	function subjectHeading(field) {
		let text = clean(field.a);
		const extras = [clean(field.c), clean(field.d)].filter(Boolean);
		if (extras.length) {
			text = [text].concat(extras).filter(Boolean).join(", ");
		}
		const work = clean(field.t);
		if (work) {
			text = text ? text + ". " + work : work;
		}
		for (const code of ["x", "y", "z", "v"]) {
			const sub = clean(field[code]);
			if (sub) {
				text = text ? text + " -- " + sub : sub;
			}
		}
		return text;
	}

	function marcContributor(field, tag) {
		const a = clean(field.a);
		const b = clean(field.b);
		const c = clean(field.c);
		const d = clean(field.d);
		const q = clean(field.q);
		const corporate = ["110", "710", "810", "811", "111", "711"].includes(tag);
		let name;
		if (tag === "110" || tag === "710" || tag === "810" || tag === "811") {
			name = [a, b].filter(Boolean).join(" ");
		}
		else {
			name = [a, c, q].filter(Boolean).join(" ");
			if (d) {
				name = name ? name + ", " + d : d;
			}
		}
		return {
			name: person(name),
			role: clean(field["4"]) || clean(field.e),
			tag: tag,
			corporate: corporate,
			primary: ["100", "110", "111"].includes(tag),
		};
	}

	function seriesText(field, tag) {
		const a = clean(field.a);
		const b = clean(field.b);
		const t = clean(field.t);
		const v = clean(field.v);
		let parts;
		if (tag === "800") {
			parts = [a, t];
		}
		else if (tag === "810" || tag === "811") {
			parts = [a, b, t];
		}
		else {
			parts = [a, t];
		}
		let text = parts.filter(Boolean).join(" ");
		if (v) {
			text = (text + " " + v).trim();
		}
		return text;
	}

	function otherEditionText(field) {
		const parts = ["i", "n", "t", "z", "w"]
			.map(function (code) { return clean(field[code]); })
			.filter(Boolean);
		return parts.join(" — ");
	}

	function contentTypeText(field, label) {
		let text = clean(field.a) || clean(field.b);
		const source = clean(field["2"]);
		if (text && source) {
			text = text + " (" + source + ")";
		}
		return text ? label + ": " + text : "";
	}

	/**
	 * Everything in MARC that pnx does not expose: notes, holdings, links,
	 * genres, volume/issue/pages from 773, series, identifiers, publishers,
	 * original language, authority IDs and the primary record ID.
	 */
	function marcParts(marc) {
		if (!marc || !Object.keys(marc).length) {
			return {};
		}

		const notes = [];
		const noteSeen = new Set();
		function addNote(text) {
			text = clean(text);
			if (text && !/^\d+$/.test(text) && !noteSeen.has(text)) {
				noteSeen.add(text);
				notes.push(text);
			}
		}
		for (const tag of [
			"500", "501", "502", "504", "505", "510", "511", "513", "515", "516",
			"518", "521", "530", "533", "534", "535", "538", "540", "544", "545",
			"546", "547", "550", "555", "561", "563", "565", "580", "583", "585",
			"586", "590",
		]) {
			for (const field of asList(marc[tag])) {
				addNote(field.a);
			}
		}

		const keywords = [];
		const authorityIds = [];
		for (const tag of ["600", "610", "611", "630", "648", "650", "651", "653"]) {
			for (const field of asList(marc[tag])) {
				const text = subjectHeading(field);
				if (text && !keywords.includes(text)) {
					keywords.push(text);
				}
				const auth = clean(field["0"]);
				const source = clean(field["2"]);
				if (auth) {
					const authText = source ? auth + " (" + source + ")" : auth;
					if (!authorityIds.includes(authText)) {
						authorityIds.push(authText);
					}
				}
			}
		}
		for (const tag of ["688", "689"]) {
			for (const field of asList(marc[tag])) {
				const text = subjectHeading(field);
				if (text && !keywords.includes(text)) {
					keywords.push(text);
				}
			}
		}

		const holdings = [];
		const holdingSeen = new Set();
		for (const field of asList(marc.AVA)) {
			const number = clean(field.d);
			if (!number) {
				continue;
			}
			const library = clean(field.b) || clean(field.q);
			const collection = clean(field.c);
			const key = library + "\u0000" + number;
			if (holdingSeen.has(key)) {
				continue;
			}
			holdingSeen.add(key);
			holdings.push({
				institution: clean(field.a),
				library: library,
				library_name: clean(field.q),
				collection: collection,
				call_number: number,
				label: library ? library + ": " + number : number,
				available: clean(field.e).toLowerCase() === "available",
				coverage: clean(field.v),
			});
		}
		const orderedHoldings = holdings.filter(function (h) { return h.available; })
			.concat(holdings.filter(function (h) { return !h.available; }));
		const callNumbers = [];
		for (const holding of orderedHoldings) {
			if (!callNumbers.includes(holding.label)) {
				callNumbers.push(holding.label);
			}
		}

		const links = [];
		const linkDetails = [];
		for (const field of asList(marc["856"])) {
			const url = clean(field.u);
			if (!url) {
				continue;
			}
			const label = clean(field.z) || clean(field.y) || clean(field["3"]);
			if (!links.includes(url)) {
				links.push(url);
			}
			if (label) {
				const detail = { url: url, label: label };
				if (!linkDetails.some(function (d) { return d.url === url && d.label === label; })) {
					linkDetails.push(detail);
				}
			}
		}

		const host = bestHost(marc);
		const sp = host.sp || "";
		const ep = host.ep || "";
		const vl = host.vl || "";
		const issueNumber = host.is || "";
		if (host.g && !(sp || ep || vl || issueNumber)) {
			notes.push("Host: " + host.g);
		}

		const genres = [];
		for (const field of asList(marc["655"])) {
			const text = clean(field.a);
			if (text && !genres.includes(text)) {
				genres.push(text);
			}
		}

		const editions = [];
		for (const field of asList(marc["250"])) {
			const text = clean(field.a);
			if (text && !editions.includes(text)) {
				editions.push(text);
			}
		}

		const series = [];
		for (const tag of ["490", "800", "810", "811", "830"]) {
			for (const field of asList(marc[tag])) {
				const text = seriesText(field, tag);
				if (text && !series.includes(text)) {
					series.push(text);
				}
			}
		}

		const identifiers = [];
		const invalidIdentifiers = [];
		for (const tag of ["020", "022"]) {
			for (const field of asList(marc[tag])) {
				const number = clean(field.a);
				let qualifier = clean(field.q);
				if (tag === "022" && !qualifier) {
					qualifier = clean(field.l);
				}
				let value = number && qualifier ? number + " (" + qualifier + ")" : number;
				if (!value) {
					value = clean(field["9"]);
				}
				if (value && !identifiers.includes(value)) {
					identifiers.push(value);
				}
				const invalid = clean(field.z);
				if (invalid && !invalidIdentifiers.includes(invalid)) {
					invalidIdentifiers.push(invalid);
				}
			}
		}
		if (host.issn && !identifiers.includes(host.issn)) {
			identifiers.push(host.issn);
		}

		let doi = "";
		for (const field of asList(marc["024"])) {
			const value = clean(field.a);
			const source = clean(field["2"]).toLowerCase();
			if (value && (source === "doi" || /^10\.\d{4,}\//.test(value))) {
				doi = value;
				break;
			}
		}

		const publishers = [];
		const places = [];
		let pubYear = "";
		for (const tag of ["260", "264"]) {
			for (const field of asList(marc[tag])) {
				const place = clean(field.a);
				const publisher = clean(field.b);
				const date = clean(field.c);
				if (place && !places.includes(place)) {
					places.push(place);
				}
				if (publisher && !publishers.includes(publisher)) {
					publishers.push(publisher);
				}
				if (!pubYear && date) {
					pubYear = yearOf([date]);
				}
			}
		}

		let title = "";
		let statement = "";
		for (const field of asList(marc["245"])) {
			const main = clean(field.a).replace(/[\s:/;]+$/, "");
			const subtitle = clean(field.b).replace(/[\s/;]+$/, "");
			const number = clean(field.n);
			const part = clean(field.p);
			title = main && subtitle ? main + " : " + subtitle : (main || subtitle);
			if (number || part) {
				title = [title, number, part].filter(Boolean).join(" ");
			}
			statement = clean(field.c);
			if (title) {
				break;
			}
		}

		let uniformTitle = "";
		for (const field of asList(marc["240"])) {
			const main = clean(field.a);
			const subtitle = clean(field.b);
			uniformTitle = main && subtitle ? main + " : " + subtitle : (main || subtitle);
			if (uniformTitle) {
				break;
			}
		}

		const variantTitles = [];
		for (const field of asList(marc["246"])) {
			const main = clean(field.a);
			const subtitle = clean(field.b);
			const label = clean(field.i);
			let text = main && subtitle ? main + " : " + subtitle : (main || subtitle);
			if (label && text) {
				text = label + ": " + text;
			}
			if (text && !variantTitles.includes(text)) {
				variantTitles.push(text);
			}
		}

		const otherTitles = [];
		for (const field of asList(marc["249"])) {
			const main = clean(field.a);
			const subtitle = clean(field.b);
			const text = main && subtitle ? main + " : " + subtitle : (main || subtitle);
			if (text && !otherTitles.includes(text)) {
				otherTitles.push(text);
			}
		}

		const summaries = [];
		for (const field of asList(marc["520"])) {
			const text = ["a", "b"]
				.map(function (code) { return clean(field[code]); })
				.filter(Boolean)
				.join(" ");
			if (text && !summaries.includes(text)) {
				summaries.push(text);
			}
		}

		const contributors = [];
		const seenContributors = new Set();
		for (const tag of ["100", "110", "111", "700", "710", "711"]) {
			for (const field of asList(marc[tag])) {
				const contributor = marcContributor(field, tag);
				const key = contributor.name + "\u0000" + contributor.role;
				if (contributor.name && !seenContributors.has(key)) {
					seenContributors.add(key);
					contributors.push(contributor);
				}
			}
		}

		const systemNumbers = [];
		for (const field of asList(marc["035"])) {
			for (const code of ["a", "z"]) {
				const text = clean(field[code]);
				if (text && !systemNumbers.includes(text)) {
					systemNumbers.push(text);
				}
			}
		}

		const languages = [];
		const originalLanguages = [];
		for (const field of asList(marc["041"])) {
			for (const code of clean(field.a).split(/\s+/)) {
				if (code && !languages.includes(code)) {
					languages.push(code);
				}
			}
			for (const code of clean(field.h).split(/\s+/)) {
				if (code && !originalLanguages.includes(code)) {
					originalLanguages.push(code);
				}
			}
		}

		const countries = [];
		for (const field of asList(marc["044"])) {
			for (const code of ["a", "c"]) {
				const text = clean(field[code]);
				if (text && !countries.includes(text)) {
					countries.push(text);
				}
			}
		}

		const classifications = [];
		for (const field of asList(marc["084"])) {
			const number = clean(field.a);
			const source = clean(field.q) || clean(field["2"]);
			const text = number && source ? number + " (" + source + ")" : number;
			if (text && !classifications.includes(text)) {
				classifications.push(text);
			}
		}

		const contentTypes = [];
		for (const pair of [["336", "Content"], ["337", "Media"], ["338", "Carrier"]]) {
			for (const field of asList(marc[pair[0]])) {
				const text = contentTypeText(field, pair[1]);
				if (text && !contentTypes.includes(text)) {
					contentTypes.push(text);
				}
			}
		}

		const otherEditions = [];
		for (const field of asList(marc["776"])) {
			const text = otherEditionText(field);
			if (text && !otherEditions.includes(text)) {
				otherEditions.push(text);
			}
		}

		let physical = "";
		for (const field of asList(marc["300"])) {
			const text = ["a", "b", "c", "e"]
				.map(function (code) { return clean(field[code]); })
				.filter(Boolean)
				.join(" ; ");
			if (text) {
				physical = physical ? physical + " ; " + text : text;
			}
		}

		let conference = "";
		for (const tag of ["111", "711"]) {
			for (const field of asList(marc[tag])) {
				conference = conference || clean(field.a);
			}
		}

		let primaryId = "";
		for (const field of asList(marc["035"])) {
			const text = clean(field.a);
			if (text) {
				primaryId = text;
				break;
			}
		}
		if (!primaryId) {
			for (const field of asList(marc["994"])) {
				const text = clean(field.d);
				if (text) {
					primaryId = text;
					break;
				}
			}
		}
		if (!primaryId) {
			for (const field of asList(marc["001"])) {
				const text = clean(field._);
				if (text) {
					primaryId = text;
					break;
				}
			}
		}

		return {
			notes: notes,
			keywords: keywords,
			authority_ids: authorityIds,
			primary_id: primaryId,
			holdings: orderedHoldings,
			call_numbers: callNumbers,
			links: links,
			link_details: linkDetails,
			genres: genres,
			editions: editions,
			series: series,
			identifiers: identifiers,
			invalid_identifiers: invalidIdentifiers,
			doi: doi,
			publishers: publishers,
			places: places,
			pub_year: pubYear,
			title: title,
			statement: statement,
			uniform_title: uniformTitle,
			variant_titles: variantTitles,
			other_titles: otherTitles,
			summary: summaries.join(" ; "),
			contributors: contributors,
			system_numbers: systemNumbers,
			languages: languages,
			original_languages: originalLanguages,
			countries: countries,
			classifications: classifications,
			content_types: contentTypes,
			other_editions: otherEditions,
			physical: physical,
			conference: conference,
			host_title: host.title || "",
			host_year: host.year || "",
			host_system: host.system || "",
			host_issn: host.issn || "",
			sp: sp,
			ep: ep,
			vl: vl,
			is: issueNumber,
		};
	}

	// ---------------------------------------------------------------- records

	function parseNumPages(text) {
		const match = /(\d+)\s*(?:S\.|Seiten|p\.|pages?)(?=\s|$|[;,])/i.exec(clean(text));
		return match ? match[1] : "";
	}

	/**
	 * Turn pnx (+ optional MARC and parent pnx) into a structured record.
	 * This is the direct equivalent of build_entry(), but without RIS tags.
	 */
	function buildRecord(pnx, docid, options) {
		options = options || {};
		pnx = pnx || {};
		const marc = options.marc || {};
		const parentPnx = options.parentPnx || null;
		const enriched = !!options.enriched;
		const display = pnx.display || {};
		const addata = pnx.addata || {};
		const rtype = (first(display.type) || "other").toLowerCase();

		let itemType = TYPE_MAP[rtype] || "document";
		let host = hostTitle(pnx);
		let parentAddata = {};

		if (rtype === "book_chapter" || rtype === "book_chapters") {
			itemType = "bookSection";
			if (parentPnx) {
				const parentDisplay = parentPnx.display || {};
				parentAddata = parentPnx.addata || {};
				const parentType = (first(parentDisplay.type) || "").toLowerCase();
				const parentTitle = first(parentDisplay.title);
				if (parentType === "journal" || parentType === "journals") {
					itemType = "journalArticle";
					if (parentTitle) {
						host = parentTitle.split(" : ")[0];
					}
				}
				else if (parentTitle && parentTitle.length > host.length) {
					host = parentTitle;
				}
			}
		}
		if (rtype === "other" && asList(display.ispartof).length) {
			itemType = "journalArticle";
		}

		const parts = marcParts(marc);
		if (parts.host_title) {
			host = parts.host_title;
		}

		const title = first(display.title)
			|| first(addata.atitle)
			|| first(addata.btitle)
			|| parts.title
			|| "";

		const notes = [];
		const seenNotes = new Set();
		function addNote(value) {
			value = String(value || "").trim();
			if (value && !seenNotes.has(value)) {
				seenNotes.add(value);
				notes.push(value);
			}
		}
		const seenTitles = new Set();
		function titleNote(label, value) {
			const text = String(value || "").trim();
			const key = clean(text).toLowerCase();
			if (text && key && !seenTitles.has(key)) {
				seenTitles.add(key);
				addNote(label + ": " + text);
			}
		}

		if (parts.uniform_title) {
			titleNote("Uniform Title", parts.uniform_title);
		}
		for (const value of parts.variant_titles || []) {
			titleNote("Variant Title", value);
		}
		for (const value of asList(display.lds27)) {
			titleNote("Variant Title", splitMarc(value));
		}
		for (const value of parts.other_titles || []) {
			titleNote("Other Title", value);
		}

		const statements = [];
		if (parts.statement) {
			statements.push(parts.statement);
		}
		for (const value of asList(display.lds28)) {
			const text = clean(value);
			if (text && !statements.includes(text)) {
				statements.push(text);
			}
		}
		for (const value of statements) {
			addNote("Statement of Responsibility: " + value);
		}

		const includes = [];
		for (const value of asList(display.includes)) {
			const text = splitMarc(value);
			if (text && !includes.includes(text)) {
				includes.push(text);
			}
		}
		if (includes.length) {
			addNote("Includes: " + includes.join(" ; "));
		}

		const otherEditions = (parts.other_editions || []).slice();
		if (!otherEditions.length) {
			for (const value of asList(display.lds95)) {
				const text = pnxTag(value, "V");
				const ident = pnxTag(value, "Q");
				if (text) {
					const entry = ident ? text + " (" + ident + ")" : text;
					if (!otherEditions.includes(entry)) {
						otherEditions.push(entry);
					}
				}
			}
		}
		for (const value of otherEditions) {
			addNote("Other edition: " + value);
		}

		// Creators: MARC roles first (they are more precise), then pnx
		// contributor, then addata as a last resort.
		const creators = [];
		const usedNames = [];
		function addCreator(name, role, corporate, primary) {
			const cleaned = person(name);
			if (!cleaned) {
				return;
			}
			if (usedNames.some(function (used) { return namesMatch(used, cleaned); })) {
				return;
			}
			usedNames.push(cleaned);
			creators.push({
				name: cleaned,
				role: normalizeRole(role),
				corporate: !!corporate,
				primary: !!primary,
			});
		}

		for (const contributor of parts.contributors || []) {
			addCreator(contributor.name, contributor.role, contributor.corporate, contributor.primary);
		}
		for (const value of asList(display.contributor)) {
			const parsed = pnxContributor(value);
			addCreator(parsed[0], parsed[1], isCorporateName(parsed[0]), false);
		}
		for (const value of asList(addata.au)) {
			addCreator(value, "aut", isCorporateName(value), true);
		}
		for (const value of asList(addata.addau)) {
			addCreator(value, "edt", isCorporateName(value), false);
		}
		if (!creators.length) {
			const fallback = asList(display.creator).concat(asList(addata.creatorfull));
			for (const value of fallback) {
				addCreator(value, "aut", isCorporateName(value), true);
			}
			if (!creators.length) {
				const corporate = first(addata.aucorp);
				if (corporate) {
					addCreator(corporate, "aut", true, true);
				}
			}
		}

		const publisherValues = asList(addata.pub)
			.concat(asList(parentAddata.pub), parts.publishers || []);
		const publisher = joinUnique(publisherValues) || first(display.publisher);
		const placeValues = asList(addata.cop)
			.concat(asList(parentAddata.cop), parts.places || []);
		const place = joinUnique(placeValues) || first(display.place);
		const edition = joinUnique(asList(addata.edition).concat(parts.editions || []));

		const seriesTexts = [];
		for (const value of asList(addata.seriestitle)) {
			const text = clean(value);
			if (text) {
				seriesTexts.push(text);
			}
		}
		const lds14 = first(display.lds14);
		if (lds14) {
			seriesTexts.push(lds14);
		}
		for (const value of asList(display.series)) {
			const text = splitMarc(value);
			if (text) {
				seriesTexts.push(text);
			}
		}
		seriesTexts.push.apply(seriesTexts, parts.series || []);

		const series = [];
		const seriesByTitle = new Map();
		const seenPairs = new Set();
		for (const text of seriesTexts) {
			const parsed = splitSeriesText(text);
			const seriesTitle = parsed[0];
			const volume = parsed[1];
			const key = seriesKey(seriesTitle) || clean(seriesTitle).toLowerCase();
			if (!key) {
				continue;
			}
			const pair = key + "\u0000" + volume;
			if (seenPairs.has(pair)) {
				continue;
			}
			seenPairs.add(pair);
			if (seriesByTitle.has(key)) {
				const existing = seriesByTitle.get(key);
				if (volume && !existing.volume) {
					existing.volume = volume;
				}
				else if (volume && existing.volume && volume !== existing.volume) {
					series.push({ title: seriesTitle, volume: volume });
				}
				continue;
			}
			const entry = { title: seriesTitle, volume: volume };
			seriesByTitle.set(key, entry);
			series.push(entry);
		}

		const volumeValue = first(addata.volume) || parts.vl || "";
		const issueValue = first(addata.issue) || parts.is || "";
		const spage = first(addata.spage) || parts.sp || "";
		const epage = first(addata.epage) || parts.ep || "";

		const snValues = new Map();
		const snOrder = [];
		function addIdentifier(raw) {
			const number = clean(raw);
			if (!number) {
				return;
			}
			const key = identifierKey(number) || number;
			if (!snValues.has(key)) {
				snValues.set(key, number);
				snOrder.push(key);
			}
			else if (number.indexOf("-") !== -1 && snValues.get(key).indexOf("-") === -1) {
				snValues.set(key, number);
			}
		}
		for (const source of [addata, parentAddata]) {
			for (const key of ["isbn", "issn"]) {
				for (const value of asList(source[key])) {
					addIdentifier(value);
				}
			}
		}
		for (const value of parts.identifiers || []) {
			addIdentifier(value);
		}
		const isbns = [];
		const issns = [];
		for (const key of snOrder) {
			const value = snValues.get(key);
			const digits = identifierKey(value);
			if (digits.length === 8) {
				if (!issns.includes(value)) {
					issns.push(value);
				}
			}
			else if (!isbns.includes(value)) {
				isbns.push(value);
			}
		}

		if (parts.invalid_identifiers && parts.invalid_identifiers.length) {
			addNote("Invalid ISBN/ISSN: " + parts.invalid_identifiers.join("; "));
		}

		const doi = first(addata.doi);

		const languages = [];
		for (const value of asList(display.language)) {
			for (const part of clean(value).split(";")) {
				const text = part.trim();
				if (text && !languages.includes(text)) {
					languages.push(text);
				}
			}
		}
		for (const code of parts.languages || []) {
			if (code && !languages.includes(code)) {
				languages.push(code);
			}
		}

		let abstractText = first(addata.abstract)
			|| first(display.description)
			|| parts.summary
			|| "";

		if (addata.addtitle) {
			addNote("Translated Title: " + clean(addata.addtitle[0]));
		}

		let physical = parts.physical || "";
		if (!physical) {
			physical = first(display.format);
		}
		if (physical && !notes.some(function (n) { return n.indexOf("Physical: ") === 0; })) {
			addNote("Physical: " + physical);
		}

		for (const value of parts.notes || []) {
			addNote(value);
		}
		if (parts.summary && abstractText && parts.summary !== abstractText) {
			addNote("Summary: " + parts.summary);
		}

		const callNumbers = (parts.call_numbers || []).slice();
		const holdings = (parts.holdings || []).slice();
		const genres = (parts.genres || []).slice();
		const links = (parts.links || []).slice();
		const linkDetails = (parts.link_details || []).slice();
		for (const value of asList(addata.url)) {
			const url = clean(value);
			if (url && !links.includes(url)) {
				links.push(url);
			}
		}

		const subjects = [];
		const seenSubjects = new Set();
		function addSubject(keyword) {
			const text = clean(keyword);
			const key = subjectKey(text) || clean(text).toLowerCase();
			if (text && key && !seenSubjects.has(key)) {
				seenSubjects.add(key);
				subjects.push(text);
			}
		}
		for (const keyword of parts.keywords || []) {
			addSubject(keyword);
		}
		for (const value of asList(display.subject)) {
			addSubject(splitMarc(value));
		}

		const systemNumbers = uniqueCi((parts.system_numbers || []).concat(asList(addata.oclcid)));

		const extras = [];
		function pushExtra(label, values) {
			const text = uniqueCi(values).join("; ");
			if (text) {
				extras.push(label + ": " + text);
			}
		}
		pushExtra("Kubikat ID", [parts.primary_id || ""]);
		pushExtra("Kubikat Doc ID", [docid]);
		pushExtra("Kubikat Source Type", [rtype]);
		pushExtra("Kubikat System Numbers", systemNumbers);
		pushExtra("Kubikat Classification", parts.classifications || []);
		pushExtra("Kubikat Format", parts.content_types || []);
		pushExtra("Kubikat Genre", genres);
		pushExtra("Kubikat Country", parts.countries || []);
		pushExtra("Kubikat Original Language", parts.original_languages || []);
		const authorityValues = (parts.authority_ids || []).concat(asList(display.lds97));
		const authoritySeen = new Set();
		const authorityUnique = [];
		for (const value of authorityValues) {
			const text = clean(value);
			const key = authorityKey(text);
			if (text && key && !authoritySeen.has(key)) {
				authoritySeen.add(key);
				authorityUnique.push(text);
			}
		}
		pushExtra("Kubikat Authority IDs", authorityUnique);
		pushExtra("Kubikat Host Record", [parts.host_system || ""]);

		const institution = publisher || "";
		const thesisType = genres[0] || (itemType === "thesis" ? "Dissertation" : "");

		return {
			docid: docid,
			sourceType: rtype,
			itemType: itemType,
			enriched: enriched,
			title: title,
			creators: creators,
			year: yearOf(addata.date)
				|| yearOf(display.creationdate)
				|| yearOf(parentAddata.date)
				|| parts.pub_year
				|| parts.host_year
				|| "",
			publisher: publisher,
			place: place,
			edition: edition,
			container: host,
			volume: volumeValue,
			issue: issueValue,
			spage: spage,
			epage: epage,
			series: series,
			isbns: isbns,
			issns: issns,
			doi: doi,
			languages: languages,
			abstract: abstractText,
			callNumbers: callNumbers,
			holdings: holdings,
			genres: genres,
			subjects: subjects,
			links: links,
			linkDetails: linkDetails,
			notes: notes,
			extras: extras,
			url: displayUrl(docid),
			primaryId: parts.primary_id || "",
			numPages: parseNumPages(physical),
			physical: physical,
			thesisType: thesisType,
			university: institution,
			reportType: genres[0] || "",
			reportNumber: parts.primary_id || "",
			institution: institution,
			conferenceName: parts.conference || "",
			pnx: pnx,
			marc: marc,
		};
	}

	// ---------------------------------------------------------------- MARC-only records

	function leaderOf(marc) {
		const field = asList((marc || {}).LDR)[0];
		return field && field._ !== undefined ? field._ : "";
	}

	/**
	 * Derive a Primo-like type from the MARC leader.  The SRU endpoint does not
	 * return pnx, so this replaces display.type from the public API.
	 */
	function typeFromMarc(marc) {
		marc = marc || {};
		const leader = leaderOf(marc);
		const recordType = leader.charAt(6);
		const bibLevel = leader.charAt(7);
		const has773 = asList(marc["773"]).length > 0;
		if (has773) {
			// A 773 with an ISSN describes an article in a journal; without one
			// we fall back to book section and verify against the parent later.
			const hostIssn = asList(marc["773"]).some(function (field) {
				return !!clean(field.x);
			});
			return hostIssn ? "article" : "book_chapter";
		}
		if (asList(marc["502"]).length) {
			return "dissertations";
		}
		const genres = asList(marc["655"]).map(function (field) {
			return clean(field.a);
		}).join(" ").toLowerCase();
		if (/report|bericht|research paper|working paper/.test(genres)) {
			return "report";
		}
		switch (recordType) {
			case "e":
			case "f":
				return "map";
			case "c":
			case "d":
				return "score";
			case "g":
				return "video";
			case "i":
			case "j":
				return "audio";
			case "k":
			case "r":
				return "image";
			case "t":
				return "manuscript";
			case "m":
				return "web_resources";
			case "a":
				return (bibLevel === "s" || bibLevel === "i") ? "journal" : "books";
			default:
				return "other";
		}
	}

	function parentMms(value) {
		const match = String(value || "").match(/(?:alma)?(\d{10,})/);
		return match ? match[1] : "";
	}

	/**
	 * Build the small pnx subset that buildRecord() reads.  Everything else
	 * comes from MARC through marcParts(), so this stays deliberately thin.
	 */
	function pnxFromMarc(marc, docid) {
		marc = marc || {};
		const parts = marcParts(marc);
		const host = bestHost(marc) || {};
		const parentId = parentMms(host.system);
		const display = {
			type: [typeFromMarc(marc)],
		};
		if (parts.title) {
			display.title = [parts.title];
		}
		const number = String(docid || marcId(marc) || "").replace(/^alma/, "");
		if (number) {
			display.mms = [number];
		}
		const hostText = host.title
			? host.title + (parentId ? " $$Z" + parentId : "")
			: (parentId ? "$$Z" + parentId : "");
		if (hostText) {
			display.ispartof = [hostText];
		}
		if (parts.pub_year) {
			display.creationdate = [parts.pub_year];
		}
		if (parts.languages.length) {
			display.language = parts.languages.slice();
		}
		if (parts.keywords.length) {
			display.subject = parts.keywords.slice();
		}
		if (parts.summary) {
			display.description = [parts.summary];
		}
		if (parts.publishers.length) {
			display.publisher = parts.publishers.slice();
		}
		if (parts.places.length) {
			display.place = parts.places.slice();
		}
		if (parts.physical) {
			display.format = [parts.physical];
		}
		const addata = {};
		if (parts.doi) {
			addata.doi = [parts.doi];
		}
		if (parts.publishers.length) {
			addata.pub = parts.publishers.slice();
		}
		if (parts.places.length) {
			addata.cop = parts.places.slice();
		}
		if (parts.pub_year) {
			addata.date = [parts.pub_year];
		}
		const parentIsbns = [];
		const parentIssns = [];
		for (const identifier of parts.identifiers) {
			if (identifierKey(identifier).length === 8) {
				if (!parentIssns.includes(identifier)) {
					parentIssns.push(identifier);
				}
			}
			else if (!parentIsbns.includes(identifier)) {
				parentIsbns.push(identifier);
			}
		}
		if (parentIsbns.length) {
			addata.isbn = parentIsbns;
		}
		if (parentIssns.length) {
			addata.issn = parentIssns;
		}
		return { display: display, addata: addata };
	}

	// ---------------------------------------------------------------- network

	function getStatus(error) {
		if (error && typeof error.status === "number") {
			return error.status;
		}
		const match = String((error && error.message) || "").match(/status code (\d+)/i);
		return match ? Number(match[1]) : 0;
	}

	function getRetryAfter(error) {
		try {
			const xhr = error && (error.xmlhttp || error.xhr);
			const value = xhr && xhr.getResponseHeader && xhr.getResponseHeader("Retry-After");
			if (!value) {
				return 0;
			}
			const seconds = Number(value);
			if (Number.isFinite(seconds)) {
				return Math.max(0, seconds * 1000);
			}
			const date = Date.parse(value);
			if (Number.isFinite(date)) {
				return Math.max(0, date - Date.now());
			}
		}
		catch (e) {
			// Ignore missing headers.
		}
		return 0;
	}

	function sruRequest(url, requestOptions) {
		return Zotero.HTTP.request("GET", url, {
			responseType: "text",
			timeout: requestOptions.timeout,
			headers: {
				"Accept": "application/xml, text/xml, */*",
				"X-Kubikat-Client": "Re-Kubikatia/1.0 (personal, non-commercial)",
			},
			noCache: true,
			anon: true,
		}).then(function (xhr) { return xhr.responseText; });
	}

	/**
	 * SRU-only client.
	 *
	 * - one request at a time
	 * - at least 10 seconds between requests (robots.txt Crawl-delay)
	 * - at most 200 requests per import
	 * - 429/503 responses are retried with Retry-After or a long backoff
	 * - no /primaws or /discovery/search requests
	 */
	function PrimoSruClient(options) {
		options = options || {};
		this.timeout = options.timeout || 45000;
		this.retries = options.retries === undefined ? 2 : options.retries;
		this.delayMs = options.delayMs === undefined
			? REQUEST_DELAY_MS
			: Math.max(0, options.delayMs);
		this.maxRequests = options.maxRequests === undefined
			? MAX_REQUESTS
			: Math.max(1, options.maxRequests);
		this.request = options.request || sruRequest;
		this._chain = Promise.resolve();
		this._lastRequestAt = 0;
		this._requests = 0;
	}

	PrimoSruClient.prototype.resetBudget = function () {
		this._requests = 0;
	};

	PrimoSruClient.prototype._schedule = function (task) {
		const self = this;
		const run = async function () {
			if (self._lastRequestAt) {
				const wait = self.delayMs - (Date.now() - self._lastRequestAt);
				if (wait > 0) {
					await delay(wait);
				}
			}
			if (self._requests >= self.maxRequests) {
				throw new Error("Request budget reached (" + self.maxRequests
					+ " requests). Reduce the number of items and try again.");
			}
			self._requests++;
			self._lastRequestAt = Date.now();
			return await task();
		};
		const result = this._chain.then(run, run);
		this._chain = result.then(function () {}, function () {});
		return result;
	};

	PrimoSruClient.prototype._getText = async function (url) {
		let lastError = null;
		for (let attempt = 0; attempt <= this.retries; attempt++) {
			try {
				return await this._schedule(async () => {
					return await this.request(url, { timeout: this.timeout });
				});
			}
			catch (error) {
				lastError = error;
				const text = String((error && error.message) || error);
				if (/budget/i.test(text)) {
					break;
				}
				const status = getStatus(error);
				if (status === 401 || status === 403 || status === 404) {
					break;
				}
				if (status === 429 || status === 503) {
					if (attempt < this.retries) {
						const retryAfter = getRetryAfter(error);
						await delay(retryAfter || (30000 * (attempt + 1)));
						continue;
					}
					break;
				}
				if (status >= 400 && status < 500) {
					break;
				}
				if (attempt < this.retries) {
					await delay(5000 * (attempt + 1));
				}
			}
		}
		throw lastError || new Error("Request failed: " + url);
	};

	PrimoSruClient.prototype.searchRecords = async function (searchUrl, options) {
		options = options || {};
		const pageSize = Math.max(1, Math.min(SRU_PAGE_SIZE, options.pageSize || SRU_PAGE_SIZE));
		const maximum = Math.min(options.max || MAX_ITEMS, MAX_ITEMS);
		const records = [];
		const seen = new Set();
		let startRecord = 1;

		while (true) {
			if (options.shouldStop && options.shouldStop()) {
				break;
			}
			const xml = await this._getText(sruSearchUrl(searchUrl, startRecord, pageSize));
			const parsed = parseSruResponse(xml);
			const page = parsed.records.slice();
			const newRecords = [];

			for (const item of page) {
				if (seen.has(item.docid)) {
					continue;
				}
				seen.add(item.docid);
				const record = {
					docid: item.docid,
					marc: item.marc,
					pnx: pnxFromMarc(item.marc, item.docid),
				};
				records.push(record);
				newRecords.push(record);
				if (maximum && records.length >= maximum) {
					break;
				}
			}

			if (options.onPage) {
				options.onPage(newRecords, parsed.total, records.length);
			}
			if (maximum && records.length >= maximum) {
				break;
			}
			if (!page.length) {
				break;
			}
			if (parsed.total) {
				if (startRecord + page.length > parsed.total) {
					break;
				}
			}
			else if (page.length < pageSize) {
				break;
			}
			startRecord += page.length;
		}
		return records;
	};

	PrimoSruClient.prototype.fetchBundle = async function (docid) {
		const xml = await this._getText(sruRecordUrl(docid));
		const parsed = parseSruResponse(xml);
		const number = String(docid || "").replace(/\D/g, "");
		let item = parsed.records.find(function (record) {
			return String(record.docid || "").replace(/\D/g, "") === number;
		});
		if (!item) {
			item = parsed.records[0];
		}
		if (!item) {
			throw new Error("The record returned no MARC data (it may be deleted or restricted)");
		}
		const resolved = item.docid || docid;
		return {
			docid: resolved,
			marc: item.marc,
			pnx: pnxFromMarc(item.marc, resolved),
			marcXml: xml,
		};
	};

	PrimoSruClient.prototype.fetchRecord = async function (docid) {
		const bundle = await this.fetchBundle(docid);
		return bundle.pnx;
	};

	PrimoSruClient.prototype.fetchMarcXml = async function (docid) {
		const bundle = await this.fetchBundle(docid);
		return bundle.marcXml;
	};

	return {
		HOST: HOST,
		VID: VID,
		INST: INST,
		TYPE_MAP: TYPE_MAP,
		SRU_PAGE_SIZE: SRU_PAGE_SIZE,
		MAX_ITEMS: MAX_ITEMS,
		REQUEST_DELAY_MS: REQUEST_DELAY_MS,
		MAX_REQUESTS: MAX_REQUESTS,
		PrimoSruClient: PrimoSruClient,
		parseInput: parseInput,
		queryTerms: queryTerms,
		displayUrl: displayUrl,
		sruUrlForQuery: sruUrlForQuery,
		sruSearchUrl: sruSearchUrl,
		sruRecordUrl: sruRecordUrl,
		cqlForSearch: cqlForSearch,
		parseSruResponse: parseSruResponse,
		parseMarcXml: parseMarcXml,
		parseMarcRecord: parseMarcRecord,
		marcParts: marcParts,
		typeFromMarc: typeFromMarc,
		pnxFromMarc: pnxFromMarc,
		buildRecord: buildRecord,
		needsParent: needsParent,
		parentDocid: parentDocid,
		clean: clean,
		person: person,
		splitSeriesText: splitSeriesText,
		isKubikatHost: isKubikatHost,
	};
})();
