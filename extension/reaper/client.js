// ResolveLink REAPER Panel - Client
// Standalone HTML panel for REAPER integration

var SERVER = "http://localhost:3030";
var currentSelection = null;
var renderedFilePath = null;
var exportDir = "";
var activeLinkId = null;

// ── Server API ──

function api(method, path, body) {
  var url = SERVER + path;
  var opts = { method: method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts).then(function (r) { return r.json(); });
}

// ── Init ──

document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("btnRefresh").addEventListener("click", refreshSelection);
  document.getElementById("btnSend").addEventListener("click", sendToReaper);
  document.getElementById("btnRender").addEventListener("click", renderInReaper);
  document.getElementById("btnImportBack").addEventListener("click", importBack);

  checkServerStatus();
});

// ── Status ──

function checkServerStatus() {
  var dot = document.getElementById("statusDot");
  var text = document.getElementById("statusText");
  dot.className = "dot loading";
  text.textContent = "Connecting...";

  api("GET", "/api/health")
    .then(function () { return api("GET", "/api/config"); })
    .then(function (cfg) {
      if (cfg && cfg.exportDir) exportDir = cfg.exportDir;
      return api("GET", "/api/resolve/status");
    })
    .then(function (status) {
      if (status.connected) {
        dot.className = "dot connected";
        var v = status.version;
        text.textContent = "Resolve " + (v ? v[0] + "." + v[1] : "connected");
        loadProjectInfo();
        setBridgeStatus(true);
      } else {
        dot.className = "dot error";
        text.textContent = "Resolve not running";
        setBridgeStatus(false);
      }
      return api("GET", "/api/reaper/status");
    })
    .then(function (reaper) {
      if (reaper && reaper.installed) {
        var rb = document.getElementById("reaperBadge");
        rb.style.display = "flex";
        document.getElementById("reaperVersion").textContent = "REAPER " + (reaper.version || "");
      }
    })
    .catch(function () {
      dot.className = "dot error";
      text.textContent = "Server offline";
      setBridgeStatus(false);
    });

  setTimeout(checkServerStatus, 5000);
}

function setBridgeStatus(connected) {
  var dot = document.getElementById("bridgeDot");
  var text = document.getElementById("bridgeText");
  dot.className = "dot-xs " + (connected ? "connected" : "error");
  text.textContent = connected ? "Bridge connected" : "Bridge disconnected";
}

function loadProjectInfo() {
  api("GET", "/api/resolve/project").then(function (p) {
    if (p.error) return;
    var strip = document.getElementById("projectStrip");
    strip.style.display = "flex";
    document.getElementById("projectName").textContent = p.name || "-";
    document.getElementById("projectFps").textContent = (p.frameRate || "-") + "fps";
    var r = p.resolution || {};
    document.getElementById("projectRes").textContent = (r.width || "?") + "x" + (r.height || "?");

    var rb = document.getElementById("resolveBadge");
    rb.style.display = "flex";
    document.getElementById("resolveVersion").textContent = "Resolve";

    var rd = document.getElementById("resolveDot");
    rd.className = "dot-sm connected";

    return api("GET", "/api/resolve/timeline");
  }).then(function (t) {
    if (t && !t.error) {
      document.getElementById("timelineName").textContent = t.name || "-";
    }
  }).catch(function () {});
}

// ── Selection ──

function refreshSelection() {
  var icon = document.getElementById("refreshIcon");
  var hint = document.getElementById("emptySelection");
  var card = document.getElementById("selectionCard");
  var btn = document.getElementById("btnSend");

  icon.classList.add("spinning");
  btn.disabled = true;

  api("GET", "/api/resolve/selection")
    .then(function (data) {
      icon.classList.remove("spinning");

      if (data.error) {
        showError(data.error);
        return;
      }

      var clips = data.clips || [];
      if (clips.length === 0) {
        hint.style.display = "block";
        card.style.display = "none";
        btn.disabled = true;
        document.getElementById("sendLabel").textContent = "Select audio in Resolve";
        return;
      }

      currentSelection = data;
      hint.style.display = "none";
      card.style.display = "block";
      btn.disabled = false;

      var count = clips.length;
      document.getElementById("clipCount").textContent = count;
      document.getElementById("clipPlural").textContent = count !== 1 ? "s" : "";
      document.getElementById("selectionMeta").textContent =
        data.fps + "fps \u00b7 " + data.width + "x" + data.height;

      var list = document.getElementById("clipList");
      list.innerHTML = "";

      clips.forEach(function (clip, i) {
        var item = document.createElement("div");
        item.className = "clip-item";

        var dur = clip.duration ? Math.round(clip.duration / (data.fps || 24)) + "s" : "";
        item.innerHTML =
          '<div class="clip-item-left">' +
            '<span class="clip-num">' + (i + 1) + '</span>' +
            '<span class="clip-name">' + clip.name + '</span>' +
          '</div>' +
          '<div class="clip-item-right">' +
            '<span class="clip-tag">T' + clip.trackIndex + '</span>' +
            '<span class="clip-dur">' + dur + '</span>' +
          '</div>';
        list.appendChild(item);
      });

      document.getElementById("sendLabel").textContent = "Send to REAPER";
    })
    .catch(function () {
      icon.classList.remove("spinning");
      showError("Connection error");
    });
}

// ── Send to REAPER ──

function sendToReaper() {
  if (!currentSelection) return;

  var clips = currentSelection.clips;
  var fps = currentSelection.fps || 24;
  var width = currentSelection.width || 1920;
  var height = currentSelection.height || 1080;

  var btn = document.getElementById("btnSend");
  btn.disabled = true;

  api("POST", "/api/link-clip", {
    clipData: clips,
    settings: { width: width, height: height, fps: fps, duration: 10 }
  }).then(function (result) {
    if (result.error) {
      showError(result.error);
      btn.disabled = false;
      return;
    }

    activeLinkId = result.linkId;

    // Use reaper-auto to launch REAPER with script
    api("POST", "/api/links/" + result.linkId + "/reaper-auto").then(function (autoResult) {
      if (autoResult.error) {
        showError(autoResult.error);
        btn.disabled = false;
        return;
      }

      btn.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' +
        '<span>Sent to REAPER!</span>';
      setTimeout(function () {
        btn.innerHTML =
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
          '<span>Send to REAPER</span>' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron"><polyline points="9 18 15 12 9 6"/></svg>';
        btn.disabled = false;
      }, 2000);
    }).catch(function (e) {
      showError(e.message);
      btn.disabled = false;
    });
  }).catch(function (e) {
    showError(e.message);
    btn.disabled = false;
  });
}

// ── Render in REAPER ──

function renderInReaper() {
  if (!activeLinkId) {
    showError("No active REAPER link");
    return;
  }

  var btn = document.getElementById("btnRender");
  var statusEl = document.getElementById("renderStatus");
  var fill = document.getElementById("progressFill");
  var text = document.getElementById("renderText");

  btn.disabled = true;
  statusEl.style.display = "block";
  fill.style.width = "20%";
  text.textContent = "Requesting render script...";

  api("GET", "/api/links/" + activeLinkId + "/reaper-render-script")
    .then(function (result) {
      if (result.error) {
        text.textContent = "Error: " + result.error;
        btn.disabled = false;
        setTimeout(function () { statusEl.style.display = "none"; }, 3000);
        return;
      }

      fill.style.width = "50%";
      text.textContent = "Render script generated. Run it in REAPER.";

      // Try to launch REAPER with the render script
      return api("GET", "/api/reaper/status");
    })
    .then(function (reaper) {
      if (reaper && reaper.running) {
        fill.style.width = "80%";
        text.textContent = "REAPER running - use Actions > Load to run render script";
      }
      setTimeout(function () {
        fill.style.width = "100%";
        text.textContent = "Ready to render in REAPER";
        btn.disabled = false;
        setTimeout(function () { statusEl.style.display = "none"; }, 3000);
      }, 1000);
    })
    .catch(function (e) {
      text.textContent = "Error: " + e.message;
      btn.disabled = false;
      setTimeout(function () { statusEl.style.display = "none"; }, 3000);
    });
}

// ── Import Back ──

function importBack() {
  if (!renderedFilePath) {
    showError("Render a file in REAPER first");
    return;
  }

  var btn = document.getElementById("btnImportBack");
  var statusEl = document.getElementById("renderStatus");
  var fill = document.getElementById("progressFill");
  var text = document.getElementById("renderText");

  btn.disabled = true;
  statusEl.style.display = "block";
  fill.style.width = "50%";
  text.textContent = "Importing to Resolve...";

  api("POST", "/api/import-back", { renderedPath: renderedFilePath })
    .then(function (result) {
      fill.style.width = "100%";

      if (result.error) {
        text.textContent = "Error: " + result.error;
        btn.disabled = false;
        setTimeout(function () { statusEl.style.display = "none"; }, 3000);
        return;
      }

      text.textContent = "Audio imported to Resolve!";
      btn.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' +
        '<span>Sent to Resolve!</span>';

      setTimeout(function () {
        statusEl.style.display = "none";
        fill.style.width = "0%";
        btn.innerHTML =
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' +
          '<span id="importLabel">Send Back to Resolve</span>';
        btn.disabled = false;
      }, 3000);
    })
    .catch(function (e) {
      text.textContent = "Error: " + e.message;
      btn.disabled = false;
      setTimeout(function () { statusEl.style.display = "none"; }, 3000);
    });
}

// ── Helpers ──

function showError(msg) {
  var bar = document.getElementById("errorBar");
  var text = document.getElementById("errorText");
  bar.style.display = "flex";
  text.textContent = msg;
  setTimeout(function () { bar.style.display = "none"; }, 4000);
}
