/*
 * Dialog controller.  The dialog never talks to Zotero directly: it gets a
 * small plugin object through window.arguments[0] and polls job state, so an
 * import keeps running even if the dialog is closed.
 */

"use strict";

(function () {
	let plugin = null;
	let jobId = null;
	let pollingTimer = null;
	let ticking = false;
	let previewToken = 0;
	let preview = null;
	let lastState = null;
	let running = false;
	let collectionTouched = false;
	let acknowledged = false;

	const $ = (id) => document.getElementById(id);

	async function t(key, args) {
		try {
			if (document.l10n && document.l10n.formatValue) {
				return await document.l10n.formatValue(key, args);
			}
		}
		catch (error) {
			// Fall through to the key.
		}
		return key;
	}

	function setButtonLabel(button, key) {
		if (document.l10n && document.l10n.setAttributes) {
			document.l10n.setAttributes(button, key);
		}
		else {
			button.textContent = key;
		}
	}

	async function refreshPreview() {
		if (!plugin) {
			return;
		}
		const token = ++previewToken;
		const source = $("source").value;
		preview = plugin.previewInput(source);

		let status;
		if (!preview.ok) {
			status = preview.errors.length
				? preview.errors[0]
				: await t("kubikat-preview-empty");
		}
		else if (preview.kind === "search") {
			status = await t("kubikat-preview-search");
		}
		else {
			status = await t("kubikat-preview-items", { count: preview.count });
		}
		if (preview.notes && preview.notes.length) {
			status += " " + preview.notes.join(" ");
		}
		if (token !== previewToken) {
			return;
		}

		$("parse-status").textContent = status;
		if (!collectionTouched && preview.suggestedName) {
			$("collection-name").value = preview.suggestedName;
		}
		updateStartButton();
	}

	function updateStartButton() {
		$("start").disabled = running || !preview || !preview.ok || !acknowledged;
	}

	function setRunning(value) {
		running = value;
		for (const element of [$("source"), $("collection-name"), $("max"), $("tags"), $("attachments"), $("acknowledge")]) {
			element.disabled = value;
		}
		updateStartButton();
		$("cancel").disabled = false;
		setButtonLabel($("cancel"), value ? "kubikat-cancel-import" : "kubikat-close");
	}

	async function renderJob(state) {
		lastState = state;
		$("progress-box").hidden = false;
		$("progress").value = state.percent;
		$("progress-text").textContent = state.message || "";
		$("progress-count").textContent = state.total
			? state.current + " / " + state.total
			: (state.created ? String(state.created) : "");

		const lines = (state.logs || []).slice();
		for (const error of state.errors || []) {
			if (!lines.includes(error)) {
				lines.push("! " + error);
			}
		}
		$("log").textContent = lines.join("\n");
		$("log").scrollTop = $("log").scrollHeight;
		$("open-collection").hidden = !state.collectionID;

		if (state.status === "running") {
			return;
		}

		stopPolling();
		setRunning(false);
		$("cancel").disabled = false;

		if (state.status === "done") {
			$("parse-status").textContent = await t("kubikat-done", {
				count: state.created,
				name: state.collectionName || "",
			});
		}
		else if (state.status === "cancelled") {
			$("parse-status").textContent = await t("kubikat-cancelled", {
				count: state.created,
			});
		}
		else {
			$("parse-status").textContent = await t("kubikat-failed", {
				error: state.message || "",
			});
		}
	}

	async function tick() {
		if (!plugin || !jobId || ticking) {
			return;
		}
		ticking = true;
		try {
			const state = plugin.getJobState(jobId);
			if (state) {
				await renderJob(state);
			}
		}
		finally {
			ticking = false;
		}
	}

	function startPolling() {
		if (pollingTimer) {
			return;
		}
		pollingTimer = setInterval(tick, 400);
		tick();
	}

	function stopPolling() {
		if (pollingTimer) {
			clearInterval(pollingTimer);
			pollingTimer = null;
		}
	}

	async function startImport() {
		if (!plugin || !preview || !preview.ok || !acknowledged) {
			return;
		}
		const options = {
			source: $("source").value.trim(),
			collectionName: $("collection-name").value.trim(),
			max: Math.max(1, Math.min(50, Number($("max").value) || 25)),
			tags: $("tags").checked,
			attachments: $("attachments").checked,
			acknowledged: true,
		};
		plugin.saveDefaults(options);

		try {
			jobId = plugin.startImport(options);
		}
		catch (error) {
			$("parse-status").textContent = String((error && error.message) || error);
			return;
		}

		lastState = null;
		setRunning(true);
		$("progress-box").hidden = false;
		$("progress").value = 0;
		$("progress-text").textContent = await t("kubikat-starting");
		$("progress-count").textContent = "";
		$("log").textContent = "";
		$("open-collection").hidden = true;
		startPolling();
	}

	async function cancelOrClose() {
		if (running && jobId) {
			plugin.cancelJob(jobId);
			$("cancel").disabled = true;
			$("progress-text").textContent = await t("kubikat-cancelling");
			return;
		}
		window.close();
	}

	function openCollection() {
		if (lastState && lastState.collectionID) {
			plugin.showCollection(lastState.collectionID);
		}
		window.close();
	}

	function init() {
		const args = window.arguments && window.arguments[0];
		const bag = args && (args.wrappedJSObject || args);
		plugin = (bag && bag.plugin)
			|| (args && args.plugin)
			|| (bag && bag.wrappedJSObject && bag.wrappedJSObject.plugin)
			|| (args && args.wrappedJSObject && args.wrappedJSObject.plugin);
		if (!plugin) {
			$("parse-status").textContent = "Kubikat plugin object is unavailable.";
			$("start").disabled = true;
			return;
		}

		const defaults = plugin.getDefaults();
		$("library-name").textContent = defaults.libraryName || "My Library";
		$("max").value = String(Math.max(1, Math.min(50, defaults.max || 25)));
		$("tags").checked = !!defaults.tags;
		$("attachments").checked = !!defaults.attachments;
		acknowledged = !!defaults.acknowledged;
		$("acknowledge").checked = acknowledged;

		$("source").addEventListener("input", refreshPreview);
		$("collection-name").addEventListener("input", () => {
			collectionTouched = true;
		});
		$("acknowledge").addEventListener("change", () => {
			acknowledged = $("acknowledge").checked;
			updateStartButton();
		});
		$("start").addEventListener("click", startImport);
		$("cancel").addEventListener("click", cancelOrClose);
		$("open-collection").addEventListener("click", openCollection);
		window.addEventListener("unload", () => {
			stopPolling();
		}, { once: true });

		setRunning(false);
		refreshPreview();
		$("source").focus();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	}
	else {
		init();
	}
})();
