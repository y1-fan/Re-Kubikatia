kubikat-menu-import =
    .label = Import from Kubikat…

kubikat-dialog-title = Re-Kubikatia
kubikat-dialog-heading = Re-Kubikatia
kubikat-dialog-intro =
    Import from Kubikat: paste a search-results URL, or one item link/docid per
    line. This plugin uses the SRU interface only, one request at a time, and
    writes the records directly into a new Zotero collection.

kubikat-notice =
    Rate limits: 1 request at a time · 10 seconds between requests · maximum
    50 items per import. Do not run repeated large imports or try to bypass
    these limits. Please respect Kubikat's robots.txt and terms of use.

kubikat-ack =
    I understand the rate limits and will use this only for personal,
    non-commercial purposes.

kubikat-source-label = Links
kubikat-source =
    .placeholder = https://www.kubikat.org/discovery/search?query=…

kubikat-collection-label = Collection name
kubikat-collection =
    .placeholder = Leave empty to generate a name automatically

kubikat-max-label = Maximum items
kubikat-max-hint = 1–50 per import

kubikat-library-label = Target library:
kubikat-options-label = Options
kubikat-option-tags = Write subject headings as tags
kubikat-option-attachments = Add full-text links as URL attachments

kubikat-start = Start import
kubikat-close = Close
kubikat-cancel-import = Cancel import
kubikat-open-collection = Show collection

kubikat-preview-empty = Paste a Kubikat URL to begin.
kubikat-preview-search = Search URL ready (SRU, basic query terms only).
kubikat-preview-items = { $count } item link(s) ready.

kubikat-starting = Starting…
kubikat-cancelling = Cancelling…
kubikat-done = Done: { $count } item(s) added to “{ $name }”.
kubikat-cancelled = Cancelled after { $count } item(s) were added.
kubikat-failed = Import failed: { $error }
