/*
 * Bootstrapped Zotero 7/8 plugin entry point — plugin.
 *
 * The plugin registers its own chrome namespace (rekubikatia) and
 * plugin id so it can be installed alongside the private edition.
 */

"use strict";

var chromeHandle = null;
var plugin = null;

function log(message) {
	Zotero.debug("[Re-Kubikatia] " + message);
}

function install(data, reason) {
	// Nothing to do: the XPI contains everything it needs.
}

function uninstall(data, reason) {
	// Nothing to do.
}

async function startup({ id, version, rootURI }, reason) {
	await Zotero.initializationPromise;

	var aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"]
		.getService(Ci.amIAddonManagerStartup);
	var manifestURI = Services.io.newURI(rootURI + "manifest.json");
	chromeHandle = aomStartup.registerChrome(manifestURI, [
		["content", "rekubikatia", "content/"],
	]);

	Services.scriptloader.loadSubScript(rootURI + "content/primo.js");
	Services.scriptloader.loadSubScript(rootURI + "content/mapper.js");
	Services.scriptloader.loadSubScript(rootURI + "content/kubikat.js");

	plugin = new KubikatPlugin({ id: id, version: version, rootURI: rootURI });
	Zotero.ReKubikatia = plugin;
	await plugin.startup();
	log("startup complete");
}

function shutdown(data, reason) {
	if (typeof APP_SHUTDOWN !== "undefined" && reason === APP_SHUTDOWN) {
		return;
	}
	try {
		if (plugin) {
			plugin.shutdown();
			plugin = null;
		}
	}
	finally {
		try {
			delete Zotero.ReKubikatia;
		}
		catch (error) {
			// ignore
		}
		if (chromeHandle) {
			chromeHandle.destruct();
			chromeHandle = null;
		}
	}
	log("shutdown complete");
}

function onMainWindowLoad({ window }) {
	if (plugin) {
		plugin.onMainWindowLoad(window);
	}
}

function onMainWindowUnload({ window }) {
	if (plugin) {
		plugin.onMainWindowUnload(window);
	}
}
