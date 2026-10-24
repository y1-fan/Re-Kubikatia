<p align="center">
  <img width="76" alt="kubikat png" src="https://github.com/user-attachments/assets/495b45f0-eaff-4214-85e2-f08a38d25c0f" />
</p>

<h1 align="center">Re-Kubikatia</h1>

<p align="center">
  <a href="README.zh-CN.md">中文</a> · <strong>English</strong>
</p>

---

> **⚠️ Warning and disclaimer**
>
> This plugin is intended only for personal study, technical research, and exchange. It is not an official tool of Kubikat or any library, and has not been authorized or endorsed by them.
>
> - The plugin reads data through Kubikat's public SRU interface: one request at a time, at least 10 seconds between requests, and no more than 50 items per import.
> - Bulk reading can still put pressure on the server. Do not run repeated imports in a short period, and do not try to bypass these limits.
> - Please comply with the terms of use, robots.txt, access-rate limits, and copyright rules of Kubikat, the participating libraries, and data providers. **Do not use this tool for profit, commercial distribution, paid services, or any other purpose that violates their terms.**
> - **Do not use this tool to attack, stress-test, deny service to, bypass access restrictions on, or otherwise interfere with any server.**
> - You are solely responsible for any consequences of using this tool, including data loss, account issues, service interruption, and legal liability. The author makes no warranty regarding the completeness, availability, or fitness of the tool.
> - This project is not affiliated with, partnered with, or authorized by Kubikat, Ex Libris/Primo/Alma, or any library or data provider.

Re-Kubikatia is a Zotero 7–10 plugin: paste a Kubikat search-results URL, or a single record link / docid, and it creates a new Zotero collection and writes the matching records into it. It does not generate RIS files and does not need a local web service.

---

## TL;DR

> If the figures have no lively action, if they cannot express the intentions of their minds through their limbs, then these figures are **twice dead**. Painting in itself has no life; it only represents living things, and if it cannot give movement and action to the things it represents, it dies a second time. (Leonardo da Vinci, *Treatise on Painting*)

This repository is an iteration of [zotero-kubikat](https://github.com/y1-fan/zotero-kubikat).

The traditional workflow tried to export data to RIS and then import it into Zotero; in practice this caused serious mapping problems. RIS is a fairly simple, limited bibliographic exchange format, and it has clear shortcomings in this workflow.

MARC is the machine-readable cataloging format widely used in libraries. It can express rich bibliographic fields and their semantic relationships. RIS, by contrast, focuses on generic exchange between bibliographic management systems. Kubikat's own MARC data is very rich, but its export system leaves much of that data unmapped to RIS, and maps much of what should be mapped incorrectly. Zotero's RIS support is also limited, resulting in a **twice failure**.

Re-Kubikatia therefore skips the RIS intermediate step. As a Zotero plugin, it links MARC data directly to Zotero and preserves as much of the original record's richness and semantic structure as possible. Authors and editors are distinguished, document types can be identified more precisely, and information that cannot be mapped directly is kept in the Extra field or in notes.

---

## Features

- Three input forms, which can be mixed:
  - a Kubikat search-results URL (`/discovery/search?...`)
  - a single fulldisplay link (with `docid`)
  - a bare docid (`alma990003239662009152` or `990003239662009152`)
- Generates a collection name automatically; you can also set one manually. Duplicate names get ` (2)`, ` (3)`.
- The target library is the one currently selected in Zotero; read-only group libraries fall back to My Library.
- Maps item type, creators, publication details, series, ISBN/ISSN, DOI, abstract, language, call number, holdings, subject headings, and links from SRU/MARC.
- Can write subject headings as Zotero tags.
- Can attach full-text links as URL attachments (up to 20 per item).
- Creates a child note for each item with notes, holdings, and all links.
- Shows progress, item counts, and logs; can be cancelled at any time.
- The job continues if the dialog is closed, and the result appears in a Zotero progress window.
- After completion, jump to the new collection with one click.

---

## Compliance and rate limits

The following was verified on **2026-10-23**. It is not legal advice; confirm the latest terms before public distribution or long-term use.

### Kubikat `robots.txt`

<https://www.kubikat.org/robots.txt>

```
User-agent: *
Disallow: /primaws
Disallow: /discovery/search
Disallow: /nde/search
Crawl-delay: 10
```

- `/primaws` and `/discovery/search` are explicitly disallowed for automated crawling.
- `Crawl-delay: 10` means requests should be spaced about 10 seconds apart.
- `eu06.alma.exlibrisgroup.com` returns the same `robots.txt`, so the same delay applies to the SRU host.

This plugin therefore **never requests `/primaws`**. It uses only `/view/sru/` and enforces a 10-second interval.

### Purpose of Alma SRU

<https://developers.exlibrisgroup.com/alma/integrations/sru/>

Ex Libris states that SRU is intended mainly for automated scenarios such as interlibrary loan, copy cataloging, and selection. **It is not supported as a bulk export tool.** A single search can return at most 10,000 records, and `maximumRecords` is capped at 50.

This plugin limits each import to 50 items and is intended only for personal bibliography management; it does not provide bulk export.

### Ex Libris API quotas

<https://developers.exlibrisgroup.com/primo/apis/>

The governance thresholds for the official Primo APIs are **50 requests/second and 1,500 requests/minute** (aggregated per institution), with a daily threshold of 5 requests × FTE. These thresholds apply to the official API gateway, not to SRU or direct Alma-domain requests. This plugin still chooses a rate far below them.

### Specific limits in this plugin

- SRU only: search, single-record, and parent-record requests all go through `https://eu06.alma.exlibrisgroup.com/view/sru/49MPG_KUBIKAT`
- Serial requests: only one request at a time
- Request interval: at least 10 seconds
- Items per import: at most 50
- Request budget: at most 200 requests per import
- Retries: at most 2; `429`/`503` honor `Retry-After` first; `401/403/404` stop immediately
- Identifiable client: requests carry `X-Kubikat-Client: Re-Kubikatia/1.0 (personal, non-commercial)`
- Single job: a second import cannot start in parallel

### Please do not abuse the service

- Do not split or repeat imports to get around the 50-item limit
- Do not modify the code to remove the request interval, concurrency limit, or request budget
- Do not use this plugin for whole-catalogue harvesting, continuous monitoring, or bulk export
- Do not use the data for commercial distribution, paid services, or any purpose that violates Kubikat's terms
- For larger-scale or commercial use, contact the Kubikat operators first: **kubikat@zikg.eu**

---

## Installation

Run from the project root:

```powershell
py -3 build.py
```

The generated `dist\kubikat-1.0.0.xpi` can be installed as follows:

1. Zotero → **Tools → Plugins**
2. Gear icon in the top-right → **Install Plugin From File…**
3. Select `dist\kubikat-1.0.0.xpi`
4. Restart Zotero

Supports Zotero 7, 8, 9, and 10.

---

## Usage

1. Run a search in Kubikat and copy the URL from the address bar; or prepare single fulldisplay links / docids, one per line.
2. Zotero → **Tools → Re-Kubikatia**.
3. Paste the links, set the collection name and maximum number of items (1–50).
4. Tick the usage notice and click **Start import**.

You need to tick the notice on the first import; it is remembered afterwards.

### Expected time

- **Search import**: one SRU request can return up to 50 complete MARC records, so usually only one search request is needed. Parent records are fetched only for chapters, with a 10-second interval per request.
- **Docid import**: one SRU request per record; 50 records take at least 8 minutes.

---

## Search scope

The plugin translates Primo query terms into CQL and supports only basic search terms:

- `any` / `all` → `alma.all_for_ui`
- `title` → `alma.title`
- `creator` / `author` → `alma.creator`
- `subject` → `alma.subjects`
- `isbn` / `issn` / `publisher` / `date` / `language` / `doi` / `series` map to the corresponding indexes
- Multiple conditions are combined with `AND` / `OR` / `NOT`

Primo parameters such as `tab`, `search_scope`, `rtype`, `pfilter`, and sorting are not passed to SRU, so filters and sorting have no effect and results may differ from the web UI.

---

## Data mapping

The plugin derives item types and fields from MARC:

| MARC feature | Zotero type |
| --- | --- |
| Leader/06=`a`, Leader/07=`m` | book |
| Leader/07=`s`/`i` | journalArticle |
| 773 present, with 773 `$x` (ISSN) | journalArticle |
| 773 present, without `$x` | bookSection; corrected after fetching the parent record |
| 502 | thesis |
| Leader/06=`e`/`f` | map |
| Leader/06=`c`/`d` | book (Zotero has no score type) |
| Leader/06=`g` | videoRecording |
| Leader/06=`i`/`j` | audioRecording |
| Leader/06=`k`/`r` | artwork |
| Leader/06=`t` | manuscript |
| Leader/06=`m` | webpage |
| 655 containing report/Bericht | report |
| other | document |

Field sources:

- Title: 245
- Creators: 100/110/111/700/710/711, with roles from `$4`/`$e`
- Publication: 260/264
- Edition: 250
- Volume/issue/pages: 773 `$g`
- Series: 490/800/810/811/830
- ISBN/ISSN: 020/022/773 `$x`
- DOI: 024
- Language: 041
- Abstract: 520
- Call number/holdings: AVA
- Links: 856
- Subject headings: 600/610/611/630/648/650/651/653/688/689
- URL: the Kubikat fulldisplay page for the record
- Extra: Kubikat ID, docid, source type, system numbers, classification, carrier type, genre, country, original language, authority IDs, etc.

When the same field appears in several spellings from different sources, values are deduplicated by their letters and digits, and the longest complete spelling is kept. Digits remain significant, so `Bd. 1` and `Bd. 2` are not merged.

---

## Tests

Start a test server from the project root:

```powershell
py -3 -m http.server 8898 --bind 127.0.0.1
```

Open <http://127.0.0.1:8898/tests/test.html>. **26 tests currently pass**, covering:

- input parsing, CQL generation, and SRU response parsing
- MARC-only record modeling, type inference, and 773 volume/issue/pages
- item plan fields, tags, notes, and Extra
- `PrimoSruClient` pagination, single-record requests, serial requests and intervals, and SRU-only traffic
- the complete import job (mock Zotero)
- manifest and all JavaScript syntax

The tests use real SRU/MARC data in `tests/fixtures/primo-records.json` and do not require network access.

---

## Known limitations

- Only kubikat.org is supported; other domains are rejected.
- Only basic query terms are supported; Primo filters, sorting, and facets have no effect, so results may differ from the web UI.
- At most 50 items per import; this cannot be bypassed through the UI (the server-side logic also truncates).
- No deduplication; repeated imports create duplicate items.
- PDFs are not downloaded; only URL attachments are registered.
- Read-only group libraries fall back to My Library.
- Changes to the SRU interface or MARC fields may break fetching or mapping.
- Before public distribution, confirm Kubikat's latest robots.txt and terms of use; for larger-scale use, obtain permission from the operators first.

---

## Layout

```
.
├── manifest.json              plugin manifest
├── bootstrap.js               startup/shutdown, chrome namespace rekubikatia
├── prefs.js                   preferences
├── content/
│   ├── primo.js               SRU client, CQL, MARC parsing, record modeling
│   ├── mapper.js              record → Zotero item plan
│   ├── kubikat.js             plugin lifecycle, job, rate limits, Zotero writes
│   ├── dialog.xhtml           import dialog
│   ├── dialog.js              dialog controller
│   ├── dialog.css
│   └── icons/
├── locale/
│   ├── en-US/rekubikatia.ftl
│   └── zh-CN/rekubikatia.ftl
├── tests/                     browser tests and real SRU/MARC fixtures
├── build.py
├── README.md
└── README.zh-CN.md
```
