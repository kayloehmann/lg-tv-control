const state = { settings: [], profiles: [], history: [], controls: null, maintenance: null, controlBusy: false, remoteBusy: false, undoableId: null, devices: [], device: null, group: "Alle", explorer: {}, busy: new Set(), selectedProfile: null };
const elements = Object.fromEntries([
  "groups", "status", "settings", "notice", "refresh", "section-title", "setting-count",
  "explorer-category", "explorer-filter", "explorer-output", "device-info", "device-address",
  "sidebar-model", "sidebar-version", "profile-list", "profile-dialog", "profile-dialog-title",
  "profile-dialog-description", "profile-changes", "profile-note", "apply-profile", "device-select", "history-list",
  "control-content", "control-current", "maintenance-info", "maintenance-refresh", "backup-download", "backup-file",
  "system-backup-create", "system-backup-status"
].map(id => [id, document.getElementById(id)]));

async function api(path, options = {}) {
  const requestUrl = new URL(path.replace(/^\//, ""), window.location.href);
  if (state.device && !requestUrl.pathname.endsWith("/api/devices")) requestUrl.searchParams.set("device", state.device);
  const response = await fetch(requestUrl, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function sameValue(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function optionLabel(setting, value) {
  return setting?.options.find(option => sameValue(option.value, value))?.label ?? String(value);
}

function appIconUrl(id) {
  const url = new URL("api/control/icon", window.location.href);
  url.searchParams.set("device", state.device);
  url.searchParams.set("id", id);
  return url.toString();
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days} T` : "", hours ? `${hours} Std` : "", `${minutes} Min`].filter(Boolean).join(" ");
}

function renderDeviceInfo(status) {
  const device = status.device || {};
  const values = [
    ["Modell", device.model],
    ["Firmware", device.firmware],
    ["webOS-Plattform", device.product],
    ["SDK-Version", device.sdk],
    ["Board", device.board],
    ["Panelklasse", device.uhd ? "UHD / 4K" : "Standard"],
    ["Hostname", device.hostname],
    ["Systemlaufzeit", formatUptime(device.uptimeSeconds || 0)]
  ];
  elements["device-info"].innerHTML = values.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "–")}</strong></div>`).join("");
  elements["device-address"].textContent = status.host;
  elements["sidebar-model"].textContent = `${status.label || "TV"} · ${device.model || "LG webOS TV"}`;
  elements["sidebar-version"].textContent = `Firmware ${device.firmware || "–"} · ${status.root ? "Root" : "Online"}`;
}

async function loadDevices() {
  const data = await api("/api/devices");
  state.devices = data.devices;
  state.device = state.device && data.devices.some(device => device.id === state.device) ? state.device : data.defaultDevice;
  elements["device-select"].innerHTML = data.devices.map(device => `<option value="${escapeHtml(device.id)}" ${device.id === state.device ? "selected" : ""}>${escapeHtml(device.label)}</option>`).join("");
}

async function changeDevice(event) {
  state.device = event.currentTarget.value;
  state.settings = [];
  state.history = [];
  state.controls = null;
  state.undoableId = null;
  state.explorer = {};
  state.busy.clear();
  elements.status.className = "status loading";
  elements.status.innerHTML = "<i></i><span>TV wird geprüft …</span>";
  elements["history-list"].innerHTML = '<div class="skeleton small"></div>';
  elements["control-content"].innerHTML = '<div class="skeleton small"></div>';
  elements["control-current"].textContent = "Live-Status wird geladen";
  await loadStatus();
  await Promise.all([loadSettings(), loadExplorer(), loadHistory(), loadControls(), loadMaintenance()]);
}

function showNotice(message, kind = "info") {
  elements.notice.innerHTML = `<div class="notice ${kind}">${escapeHtml(message)}</div>`;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => { elements.notice.innerHTML = ""; }, 6000);
}

function renderGroups() {
  const groups = ["Alle", ...new Set(state.settings.map(setting => setting.group))];
  elements.groups.innerHTML = groups.map(group => {
    const count = group === "Alle" ? state.settings.length : state.settings.filter(setting => setting.group === group).length;
    return `<button class="nav-item ${group === state.group ? "active" : ""}" data-group="${escapeHtml(group)}"><span>${escapeHtml(group)}</span><b>${count}</b></button>`;
  }).join("");
  elements.groups.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    state.group = button.dataset.group;
    elements["section-title"].textContent = state.group === "Alle" ? "Alle Einstellungen" : state.group;
    renderGroups();
    renderSettings();
  }));
}

function renderSettings() {
  const visible = state.settings.filter(setting => state.group === "Alle" || setting.group === state.group);
  elements.settings.setAttribute("aria-busy", "false");
  elements.settings.innerHTML = visible.map(setting => {
    const unavailable = !setting.available;
    const busy = state.busy.has(setting.id);
    const options = setting.options.map(option => `<option value="${escapeHtml(JSON.stringify(option.value))}" ${sameValue(option.value, setting.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
    const recommended = setting.recommended !== undefined && sameValue(setting.value, setting.recommended);
    return `<article class="setting-card ${unavailable ? "unavailable" : ""}">
      <div class="setting-top"><span class="group-tag">${escapeHtml(setting.group)}</span>${recommended ? '<span class="recommended">empfohlen</span>' : ""}</div>
      <h3>${escapeHtml(setting.label)}</h3>
      <p>${escapeHtml(setting.description)}</p>
      ${setting.warning ? `<p class="warning">⚠ ${escapeHtml(setting.warning)}</p>` : ""}
      <div class="setting-control">
        <select data-setting="${escapeHtml(setting.id)}" ${unavailable || busy ? "disabled" : ""}>${options}</select>
        ${setting.restartRequired ? '<span class="restart">Neustart nötig</span>' : ""}
      </div>
    </article>`;
  }).join("") || '<p class="empty">Keine Einstellungen in dieser Gruppe.</p>';

  elements.settings.querySelectorAll("select[data-setting]").forEach(select => select.addEventListener("change", changeSetting));
}

async function changeSetting(event) {
  const id = event.currentTarget.dataset.setting;
  const setting = state.settings.find(item => item.id === id);
  const value = JSON.parse(event.currentTarget.value);
  if (setting.warning && !window.confirm(`${setting.label}\n\n${setting.warning}\n\nWirklich ändern?`)) {
    renderSettings();
    return;
  }
  state.busy.add(id);
  renderSettings();
  try {
    const result = await api("/api/settings", { method: "POST", body: JSON.stringify({ id, value }) });
    setting.value = result.value;
    await loadHistory();
    showNotice(`${setting.label} wurde gesetzt und vom TV bestätigt.`, "success");
  } catch (error) {
    showNotice(`${setting.label}: ${error.message}`, "error");
  } finally {
    state.busy.delete(id);
    renderSettings();
  }
}

function profileChanges(profile) {
  return profile.targets.flatMap(target => {
    const setting = state.settings.find(item => item.id === target.id);
    return setting?.available ? [{ setting, value: target.value, changed: !sameValue(setting.value, target.value) }] : [];
  });
}

function renderProfiles() {
  elements["profile-list"].innerHTML = state.profiles.map(profile => {
    const changes = profileChanges(profile);
    const pending = changes.filter(change => change.changed).length;
    const button = pending ? `${pending} Änderungen prüfen` : "Profil ansehen";
    return `<article class="profile-card">
      <div><h3>${escapeHtml(profile.label)}</h3><p>${escapeHtml(profile.description)}</p></div>
      <button type="button" data-profile="${escapeHtml(profile.id)}" class="${pending ? "" : "profile-active"}">${escapeHtml(button)}</button>
    </article>`;
  }).join("") || '<p class="empty">Keine Profile verfügbar.</p>';
  elements["profile-list"].querySelectorAll("button[data-profile]").forEach(button => button.addEventListener("click", () => openProfile(button.dataset.profile)));
}

function openProfile(id) {
  const profile = state.profiles.find(item => item.id === id);
  if (!profile) return;
  state.selectedProfile = profile;
  const changes = profileChanges(profile);
  const pending = changes.filter(change => change.changed).length;
  elements["profile-dialog-title"].textContent = profile.label;
  elements["profile-dialog-description"].textContent = profile.description;
  elements["profile-note"].textContent = profile.note;
  elements["profile-changes"].innerHTML = changes.map(change => `<div class="profile-change">
    <strong>${escapeHtml(change.setting.label)}</strong>
    <span class="${change.changed ? "will-change" : "unchanged"}">${escapeHtml(optionLabel(change.setting, change.setting.value))} → ${escapeHtml(optionLabel(change.setting, change.value))}${change.changed ? "" : " · bereits gesetzt"}</span>
  </div>`).join("");
  elements["apply-profile"].disabled = pending === 0;
  elements["apply-profile"].textContent = pending ? `${pending} Änderungen anwenden` : "Bereits aktiv";
  elements["profile-dialog"].showModal();
}

async function applyProfile() {
  const profile = state.selectedProfile;
  if (!profile) return;
  elements["apply-profile"].disabled = true;
  elements["apply-profile"].textContent = "Wird angewendet …";
  try {
    const result = await api("/api/profiles/apply", { method: "POST", body: JSON.stringify({ id: profile.id }) });
    elements["profile-dialog"].close();
    await Promise.all([loadSettings(), loadExplorer(), loadHistory()]);
    const restart = result.restartRequired ? " Ein Neustart ist erforderlich." : " Kein Neustart nötig.";
    showNotice(`${profile.label}: ${result.changed.length} Änderungen wurden vom TV bestätigt.${restart}`, "success");
  } catch (error) {
    elements["apply-profile"].disabled = false;
    elements["apply-profile"].textContent = "Erneut versuchen";
    showNotice(`${profile.label}: ${error.message}`, "error");
  }
}

function formatHistoryTime(value) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function renderHistory() {
  elements["history-list"].innerHTML = state.history.map(entry => {
    const summary = entry.changes.map(change => `${change.label}: ${optionLabel(state.settings.find(setting => setting.id === change.id), change.oldValue)} → ${optionLabel(state.settings.find(setting => setting.id === change.id), change.value)}`).join(" · ");
    const canUndo = entry.id === state.undoableId && !entry.undoneAt;
    return `<article class="history-item ${entry.undoneAt ? "history-undone" : ""}">
      <div class="history-dot" aria-hidden="true"></div>
      <div><div class="history-meta"><span>${escapeHtml(entry.type === "profile" ? "Profil" : "Einstellung")}</span><time datetime="${escapeHtml(entry.at)}">${escapeHtml(formatHistoryTime(entry.at))}</time></div>
      <h3>${escapeHtml(entry.label)}</h3><p>${escapeHtml(summary)}</p>${entry.undoneAt ? '<small>Rückgängig gemacht</small>' : ""}</div>
      ${canUndo ? `<button type="button" data-undo="${escapeHtml(entry.id)}">↶ Rückgängig</button>` : ""}
    </article>`;
  }).join("") || '<p class="empty">Noch keine Änderungen über dieses Dashboard.</p>';
  elements["history-list"].querySelectorAll("button[data-undo]").forEach(button => button.addEventListener("click", undoHistory));
}

async function loadHistory() {
  try {
    const data = await api("/api/history");
    state.history = data.entries;
    state.undoableId = data.undoableId;
    renderHistory();
  } catch (error) {
    elements["history-list"].innerHTML = `<p class="empty">Verlauf konnte nicht geladen werden: ${escapeHtml(error.message)}</p>`;
  }
}

function renderControls() {
  const control = state.controls;
  if (!control) return;
  elements["control-current"].textContent = `${control.foregroundLabel} · ${control.powerState}`;
  const favoriteIds = new Set(control.favorites || []);
  const apps = control.apps.map(app => `<div class="launch-wrap"><button type="button" class="launch-button ${app.id === control.foregroundAppId ? "active" : ""}" data-action="launch" data-id="${escapeHtml(app.id)}"><span class="app-icon"><img src="${escapeHtml(appIconUrl(app.id))}" alt="" loading="lazy"><b>${escapeHtml(app.badge)}</b></span><span>${escapeHtml(app.label)}</span></button><button type="button" class="favorite-toggle ${favoriteIds.has(`app:${app.id}`) ? "active" : ""}" data-favorite="app:${escapeHtml(app.id)}" aria-label="${escapeHtml(app.label)} als Favorit umschalten" title="Favorit umschalten">★</button></div>`).join("");
  const inputs = control.inputs.map(input => `<div class="input-wrap"><button type="button" class="input-button ${input.active ? "active" : ""}" data-action="input" data-id="${escapeHtml(input.id)}"><strong>HDMI ${escapeHtml(input.port)}</strong><span>${escapeHtml(input.label)}${input.connected ? "" : " · nicht verbunden"}</span></button><button type="button" class="favorite-toggle ${favoriteIds.has(`input:${input.id}`) ? "active" : ""}" data-favorite="input:${escapeHtml(input.id)}" aria-label="${escapeHtml(input.label)} als Favorit umschalten" title="Favorit umschalten">★</button></div>`).join("");
  const audio = control.audio ? `<div class="audio-row">
    <button type="button" class="mute-button ${control.audio.muted ? "active" : ""}" data-action="mute">${control.audio.muted ? "Ton an" : "Stumm"}</button>
    <label for="volume-control">Lautstärke <strong id="volume-value">${escapeHtml(control.audio.volume)}</strong></label>
    <input id="volume-control" type="range" min="0" max="100" step="1" value="${escapeHtml(control.audio.volume)}" aria-label="Lautstärke">
  </div>` : '<p class="control-hint">Für den aktuellen Audioausgang ist keine Lautstärkesteuerung verfügbar.</p>';
  const remoteButtons = new Map((control.remote?.buttons || []).map(button => [button.id, button]));
  const remoteButton = (id, className = "") => {
    const button = remoteButtons.get(id);
    if (!button) return "";
    return `<button type="button" class="remote-button ${className}" data-remote="${escapeHtml(button.id)}" aria-label="${escapeHtml(button.label)}" title="${escapeHtml(button.label)}"><span aria-hidden="true">${escapeHtml(button.icon)}</span>${className === "shortcut" ? `<small>${escapeHtml(button.label)}</small>` : ""}</button>`;
  };
  const remote = control.remote?.available ? `<div class="remote-shell">
    <div class="remote-main">
      <div class="remote-shortcuts">${["home", "back", "settings", "info"].map(id => remoteButton(id, "shortcut")).join("")}</div>
      <div class="dpad" role="group" aria-label="Navigation">
        ${remoteButton("up", "dpad-up")}${remoteButton("left", "dpad-left")}${remoteButton("enter", "dpad-enter")}${remoteButton("right", "dpad-right")}${remoteButton("down", "dpad-down")}
      </div>
    </div>
    <div class="remote-secondary">
      <div><span class="remote-label">Wiedergabe</span><div class="media-buttons">${["rewind", "play", "pause", "stop", "fast-forward"].map(id => remoteButton(id, "media-key")).join("")}</div></div>
      <div class="rocker-grid">
        <div><span class="remote-label">Lautstärke</span><div class="rocker">${remoteButton("volume-up", "rocker-up")}${remoteButton("volume-down", "rocker-down")}</div></div>
        <div><span class="remote-label">Programm</span><div class="rocker">${remoteButton("channel-up", "rocker-up")}${remoteButton("channel-down", "rocker-down")}</div></div>
      </div>
      <div class="smart-input">
        <span class="remote-label">Touchpad & Texteingabe</span>
        <div class="touchpad-row"><div id="touchpad" class="touchpad" role="button" tabindex="0" aria-label="TV-Zeiger bewegen und klicken"><span>ziehen · tippen</span></div><div class="scroll-buttons"><button type="button" data-pointer="scroll-up" aria-label="Nach oben scrollen">⌃</button><button type="button" data-pointer="scroll-down" aria-label="Nach unten scrollen">⌄</button></div></div>
        <form id="text-input-form" class="text-input-form"><input id="tv-text-input" type="text" maxlength="256" autocomplete="off" placeholder="Text an aktives TV-Feld senden" aria-label="Text an Fernseher senden"><button type="submit">Senden</button></form>
      </div>
    </div>
  </div>` : '<p class="control-hint">Die Fernbedienung ist auf diesem Fernseher derzeit nicht verfügbar.</p>';
  const choicesById = new Map((control.favoriteChoices || []).map(choice => [choice.id, choice]));
  const favorites = (control.favorites || []).map(id => choicesById.get(id)).filter(Boolean).map(choice => choice.type === "app"
    ? `<button type="button" class="favorite-action" data-action="launch" data-id="${escapeHtml(choice.target)}"><span>${escapeHtml(choice.badge)}</span><strong>${escapeHtml(choice.label)}</strong></button>`
    : `<button type="button" class="favorite-action" data-action="input" data-id="${escapeHtml(choice.target)}"><span>${escapeHtml(choice.badge)}</span><strong>${escapeHtml(choice.label)}</strong></button>`).join("");
  elements["control-content"].innerHTML = `<div class="control-group favorites-group"><h3>Favoriten</h3><div class="favorite-grid">${favorites || '<p class="control-hint">Mit dem Stern bei Apps und Eingängen Favoriten hinzufügen.</p>'}</div></div>
    <div class="control-group remote-group"><h3>Fernbedienung</h3>${remote}</div>
    <div class="control-group"><h3>Apps</h3><div class="launch-grid">${apps || '<p class="control-hint">Keine freigegebenen Apps gefunden.</p>'}</div></div>
    <div class="control-group"><h3>Eingänge</h3><div class="input-grid">${inputs || '<p class="control-hint">Keine HDMI-Eingänge gefunden.</p>'}</div></div>
    <div class="control-group"><h3>Ton</h3>${audio}</div>
    <div class="control-group"><h3>System</h3><div class="system-actions">
      <button type="button" data-action="screen-off">Bildschirm aus</button><button type="button" data-action="screen-on">Bildschirm an</button>
      <button type="button" data-action="wake">Aufwecken</button><button type="button" class="danger" data-action="power-off">Ausschalten</button>
      <button type="button" class="danger" data-action="reboot">Neustart</button>
    </div></div>`;
  elements["control-content"].querySelectorAll("button[data-action]").forEach(button => button.addEventListener("click", runControl));
  elements["control-content"].querySelectorAll("button[data-remote]").forEach(button => button.addEventListener("click", runRemoteButton));
  elements["control-content"].querySelectorAll("button[data-favorite]").forEach(button => button.addEventListener("click", toggleFavorite));
  elements["control-content"].querySelectorAll(".app-icon img").forEach(image => {
    const loaded = () => image.parentElement?.classList.add("loaded");
    image.addEventListener("load", loaded, { once: true });
    image.addEventListener("error", () => image.remove(), { once: true });
    if (image.complete && image.naturalWidth) loaded();
  });
  const volume = document.getElementById("volume-control");
  if (volume) {
    volume.addEventListener("input", () => { document.getElementById("volume-value").textContent = volume.value; });
    volume.addEventListener("change", runVolume);
  }
  bindSmartInput();
  elements["control-content"].querySelectorAll("button, input").forEach(element => { element.disabled = state.controlBusy; });
}

async function toggleFavorite(event) {
  const id = event.currentTarget.dataset.favorite;
  const favorites = new Set(state.controls?.favorites || []);
  if (favorites.has(id)) favorites.delete(id);
  else if (favorites.size < 8) favorites.add(id);
  else return showNotice("Es sind höchstens acht Favoriten möglich.", "error");
  event.currentTarget.disabled = true;
  try {
    const result = await api("/api/preferences", { method: "POST", body: JSON.stringify({ favorites: [...favorites] }) });
    state.controls.favorites = result.favorites;
    renderControls();
  } catch (error) {
    showNotice(`Favoriten: ${error.message}`, "error");
    event.currentTarget.disabled = false;
  }
}

function bindSmartInput() {
  const pad = document.getElementById("touchpad");
  if (!pad) return;
  let gesture = null;
  pad.addEventListener("pointerdown", event => {
    gesture = { x: event.clientX, y: event.clientY };
    pad.setPointerCapture(event.pointerId);
    pad.classList.add("active");
  });
  pad.addEventListener("pointerup", async event => {
    if (!gesture) return;
    const dx = Math.max(-800, Math.min(800, Math.round((event.clientX - gesture.x) * 2)));
    const dy = Math.max(-800, Math.min(800, Math.round((event.clientY - gesture.y) * 2)));
    gesture = null;
    pad.classList.remove("active");
    await sendPointer(Math.abs(dx) + Math.abs(dy) < 10 ? { event: "click" } : { event: "move", dx, dy });
  });
  pad.addEventListener("pointercancel", () => { gesture = null; pad.classList.remove("active"); });
  pad.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); sendPointer({ event: "click" }); }
  });
  elements["control-content"].querySelectorAll("button[data-pointer]").forEach(button => button.addEventListener("click", () => sendPointer({ event: "scroll", dy: button.dataset.pointer === "scroll-up" ? -5 : 5 })));
  document.getElementById("text-input-form")?.addEventListener("submit", sendTvText);
}

async function sendPointer(pointer) {
  if (state.remoteBusy) return;
  state.remoteBusy = true;
  try {
    await api("/api/control", { method: "POST", body: JSON.stringify({ action: "pointer", ...pointer }) });
  } catch (error) {
    showNotice(`Touchpad: ${error.message}`, "error");
  } finally {
    state.remoteBusy = false;
  }
}

async function sendTvText(event) {
  event.preventDefault();
  const input = document.getElementById("tv-text-input");
  const value = input?.value || "";
  if (!value.trim()) return;
  input.disabled = true;
  try {
    await api("/api/control", { method: "POST", body: JSON.stringify({ action: "text", value }) });
    input.value = "";
    showNotice("Text wurde an das aktive TV-Eingabefeld gesendet.", "success");
  } catch (error) {
    showNotice(`Texteingabe: ${error.message}`, "error");
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function runRemoteButton(event) {
  if (state.remoteBusy) return;
  const button = event.currentTarget;
  const id = button.dataset.remote;
  state.remoteBusy = true;
  const buttons = [...elements["control-content"].querySelectorAll("button[data-remote]")];
  buttons.forEach(item => { item.disabled = true; });
  button.classList.add("pressed");
  try {
    await api("/api/control", { method: "POST", body: JSON.stringify({ action: "button", id }) });
  } catch (error) {
    showNotice(`Fernbedienung: ${error.message}`, "error");
  } finally {
    state.remoteBusy = false;
    buttons.forEach(item => { item.disabled = false; });
    window.setTimeout(() => button.classList.remove("pressed"), 120);
  }
}

async function loadControls() {
  try {
    const data = await api("/api/control");
    state.controls = data;
    renderControls();
  } catch (error) {
    state.controls = null;
    elements["control-current"].textContent = "Steuerung nicht erreichbar";
    elements["control-content"].innerHTML = `<div class="control-offline"><p>${escapeHtml(error.message)}</p><button type="button" data-action="wake">TV per Wake-on-LAN aufwecken</button></div>`;
    elements["control-content"].querySelector("button").addEventListener("click", runControl);
  }
}

async function runVolume(event) {
  await sendControl({ action: "volume", value: Number(event.currentTarget.value) }, "Lautstärke wurde bestätigt.");
}

async function runControl(event) {
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;
  if (action === "power-off" && !window.confirm("Fernseher wirklich ausschalten?")) return;
  if (action === "reboot" && !window.confirm("Fernseher wirklich neu starten? Die Verbindung ist kurzzeitig unterbrochen.")) return;
  if (action === "screen-off" && !window.confirm("Bildschirm ausschalten? Der Ton kann dabei weiterlaufen.")) return;
  const payload = { action };
  if (id) payload.id = id;
  if (action === "mute") payload.value = !state.controls?.audio?.muted;
  if (action === "power-off" || action === "reboot") payload.confirm = action;
  const messages = {
    launch: "App wurde gestartet.", input: "Eingang wurde gewechselt.", mute: "Tonstatus wurde bestätigt.",
    "screen-off": "Bildschirm wurde ausgeschaltet.", "screen-on": "Bildschirm wurde eingeschaltet.",
    wake: "Wake-on-LAN wurde gesendet.", "power-off": "Ausschalten wurde gesendet.", reboot: "Neustart wurde gesendet."
  };
  await sendControl(payload, messages[action] || "Aktion wurde ausgeführt.");
}

async function sendControl(payload, successMessage) {
  if (state.controlBusy) return;
  state.controlBusy = true;
  if (state.controls) renderControls();
  try {
    const result = await api("/api/control", { method: "POST", body: JSON.stringify(payload) });
    if (result.audio && state.controls) state.controls.audio = result.audio;
    if (result.foregroundAppId && state.controls) {
      state.controls.foregroundAppId = result.foregroundAppId;
      state.controls.foregroundLabel = result.foregroundLabel;
    }
    showNotice(successMessage, "success");
    if (!["wake", "power-off", "reboot"].includes(payload.action)) await loadControls();
  } catch (error) {
    showNotice(`Steuerung: ${error.message}`, "error");
  } finally {
    state.controlBusy = false;
    if (state.controls) renderControls();
  }
}

async function undoHistory(event) {
  const id = event.currentTarget.dataset.undo;
  const entry = state.history.find(item => item.id === id);
  if (!entry || !window.confirm(`„${entry.label}“ rückgängig machen?\n\nVorher wird geprüft, ob sich die betroffenen Werte seitdem verändert haben.`)) return;
  event.currentTarget.disabled = true;
  try {
    const result = await api("/api/history/undo", { method: "POST", body: JSON.stringify({ id }) });
    await Promise.all([loadSettings(), loadExplorer(), loadHistory()]);
    const restart = result.restartRequired ? " Ein Neustart kann erforderlich sein." : "";
    showNotice(`${entry.label} wurde rückgängig gemacht und vom TV bestätigt.${restart}`, "success");
  } catch (error) {
    await loadHistory();
    showNotice(`Rückgängig nicht möglich: ${error.message}`, "error");
  }
}

async function loadStatus() {
  try {
    const status = await api("/api/status");
    elements.status.className = "status online";
    elements.status.innerHTML = `<i></i><span>${status.root ? "Root online" : "TV online"}</span>`;
    renderDeviceInfo(status);
  } catch {
    elements.status.className = "status offline";
    elements.status.innerHTML = "<i></i><span>TV nicht erreichbar</span>";
    elements["device-info"].innerHTML = '<p class="empty">Technische Daten sind derzeit nicht erreichbar.</p>';
  }
}

function renderMaintenance() {
  const value = state.maintenance;
  if (!value) return;
  const checks = [
    ["Root-Zugriff", value.root ? "Online" : "Nicht verfügbar", value.root],
    ["Firmware-Updates", value.updatesBlocked ? "Blockiert" : "Freigegeben", value.updatesBlocked],
    ["Homebrew Channel", value.homebrew?.installed ? value.homebrew.version : "Nicht installiert", value.homebrew?.installed],
    ["Installierte Apps", String(value.installedApps), true],
    ["Systemlaufzeit", formatUptime(value.uptimeSeconds || 0), true],
    ["Konfigurationsbackup", value.backup?.available ? "Bereit" : "Nicht verfügbar", value.backup?.available]
  ];
  elements["maintenance-info"].innerHTML = checks.map(([label, detail, good]) => `<div><span class="health-dot ${good ? "good" : "warn"}"></span><span>${escapeHtml(label)}</span><strong>${escapeHtml(detail)}</strong></div>`).join("");
  const backup = value.systemBackup;
  elements["system-backup-status"].textContent = backup
    ? `Letzte geprüfte NAS-Sicherung: ${formatHistoryTime(backup.createdAt)} · ${(backup.sizeBytes / 1024 / 1024).toFixed(1)} MB · ${backup.files} Dateien`
    : "Noch keine vollständige NAS-Sicherung für diesen Fernseher.";
}

async function loadMaintenance() {
  elements["maintenance-info"].innerHTML = '<div class="skeleton small"></div>';
  try {
    state.maintenance = await api("/api/maintenance");
    renderMaintenance();
  } catch (error) {
    elements["maintenance-info"].innerHTML = `<p class="empty">Wartungsstatus nicht verfügbar: ${escapeHtml(error.message)}</p>`;
  }
}

async function downloadBackup() {
  elements["backup-download"].disabled = true;
  try {
    const backup = await api("/api/backup");
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `lg-tv-${state.device}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showNotice("Konfigurationsbackup wurde erstellt.", "success");
  } catch (error) {
    showNotice(`Backup: ${error.message}`, "error");
  } finally {
    elements["backup-download"].disabled = false;
  }
}

async function createSystemBackup() {
  const button = elements["system-backup-create"];
  button.disabled = true;
  button.textContent = "Sicherung läuft …";
  try {
    const result = await api("/api/system-backup", { method: "POST", body: "{}" });
    await loadMaintenance();
    showNotice(`NAS-Sicherung geprüft: ${(result.backup.sizeBytes / 1024 / 1024).toFixed(1)} MB, ${result.backup.files} Dateien.`, "success");
  } catch (error) {
    showNotice(`NAS-Sicherung: ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "NAS-Sicherung erstellen";
  }
}

async function restoreBackup(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    if (file.size > 65_536) throw new Error("Die Backupdatei ist ungewöhnlich groß.");
    const backup = JSON.parse(await file.text());
    if (backup?.device?.id !== state.device) throw new Error("Das Backup gehört zu einem anderen Fernseher.");
    if (!window.confirm(`Backup für ${backup.device.label || state.device} vom ${formatHistoryTime(backup.createdAt)} wiederherstellen?\n\nNur veränderte, weiterhin freigegebene Werte werden gesetzt. Bei einem Fehler erfolgt ein Rollback.`)) return;
    const result = await api("/api/backup/restore", { method: "POST", body: JSON.stringify({ confirm: "restore", backup }) });
    await Promise.all([loadSettings(), loadExplorer(), loadHistory(), loadControls(), loadMaintenance()]);
    showNotice(`Backup wiederhergestellt: ${result.changed} bestätigte Änderungen.`, "success");
  } catch (error) {
    showNotice(`Wiederherstellung: ${error.message}`, "error");
  } finally {
    event.currentTarget.value = "";
  }
}

async function loadSettings() {
  elements.settings.setAttribute("aria-busy", "true");
  elements.settings.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const data = await api("/api/settings");
    state.settings = data.settings;
    elements["setting-count"].textContent = data.settings.filter(setting => setting.available).length;
    renderGroups();
    renderSettings();
    renderProfiles();
    renderHistory();
  } catch (error) {
    elements.settings.innerHTML = `<div class="error-panel"><strong>TV-Daten konnten nicht geladen werden</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function loadProfiles() {
  try {
    const data = await api("/api/profiles");
    state.profiles = data.profiles;
    renderProfiles();
  } catch (error) {
    elements["profile-list"].innerHTML = `<p class="empty">Profile konnten nicht geladen werden: ${escapeHtml(error.message)}</p>`;
  }
}

function renderExplorer() {
  const filter = elements["explorer-filter"].value.trim().toLowerCase();
  const entries = Object.entries(state.explorer).filter(([key, value]) => `${key} ${JSON.stringify(value)}`.toLowerCase().includes(filter));
  elements["explorer-output"].innerHTML = entries.map(([key, value]) => `<div><code>${escapeHtml(key)}</code><span>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</span></div>`).join("") || '<p class="empty">Keine passenden Parameter.</p>';
}

async function loadExplorer() {
  elements["explorer-output"].innerHTML = '<div class="skeleton small"></div>';
  try {
    const data = await api(`/api/explorer?category=${encodeURIComponent(elements["explorer-category"].value)}`);
    state.explorer = data.settings;
    renderExplorer();
  } catch (error) {
    elements["explorer-output"].innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

elements.refresh.addEventListener("click", async () => {
  await loadStatus();
  await Promise.all([loadSettings(), loadExplorer(), loadHistory(), loadControls(), loadMaintenance()]);
});
elements["explorer-category"].addEventListener("change", loadExplorer);
elements["explorer-filter"].addEventListener("input", renderExplorer);
elements["apply-profile"].addEventListener("click", applyProfile);
elements["device-select"].addEventListener("change", changeDevice);
elements["maintenance-refresh"].addEventListener("click", loadMaintenance);
elements["backup-download"].addEventListener("click", downloadBackup);
elements["system-backup-create"].addEventListener("click", createSystemBackup);
elements["backup-file"].addEventListener("change", restoreBackup);

await loadDevices();
await loadStatus();
await Promise.all([loadProfiles(), loadSettings(), loadExplorer(), loadHistory(), loadControls(), loadMaintenance()]);
