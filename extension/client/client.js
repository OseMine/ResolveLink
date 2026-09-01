// ResolveLink AE Extension - Client
// Remembers everything via localStorage

var csInterface = null;
var SERVER = "http://localhost:3030";
var currentSelection = null;
var renderedFilePath = null;
var exportDir = "";
var activeLinkId = null;
var activeRenderTemplate = "Best Settings";
var authToken = null;

// ── Persistence ──

function saveState() {
  var state = {
    renderedFilePath: renderedFilePath,
    exportDir: exportDir,
    activeLinkId: activeLinkId,
    activeRenderTemplate: activeRenderTemplate,
    compName: document.getElementById("compName").textContent,
    compVisible: document.getElementById("compStrip").style.display !== "none"
  };
  try { localStorage.setItem("resolvelink_v2", JSON.stringify(state)); } catch (e) {}
}

function loadState() {
  try {
    var raw = localStorage.getItem("resolvelink_v2");
    if (!raw) {
      // Migrate from un-namespaced key
      raw = localStorage.getItem("resolvelink");
      if (raw) {
        localStorage.setItem("resolvelink_v2", raw);
        localStorage.removeItem("resolvelink");
      }
    }
    if (!raw) return;
    var state = JSON.parse(raw);
    renderedFilePath = state.renderedFilePath || null;
    exportDir = state.exportDir || exportDir;
    activeLinkId = state.activeLinkId || null;
    activeRenderTemplate = state.activeRenderTemplate || "Best Settings";
    if (state.compVisible && state.compName) {
      document.getElementById("compStrip").style.display = "flex";
      document.getElementById("compName").textContent = state.compName;
      document.getElementById("btnRender").disabled = false;
    }
    if (renderedFilePath) {
      document.getElementById("btnImportBack").disabled = false;
    }
  } catch (e) {}
}

// ── Init ──

document.addEventListener("DOMContentLoaded", function () {
  try { csInterface = new CSInterface(); } catch (e) { csInterface = null; }

  document.getElementById("btnRefresh").addEventListener("click", refreshSelection);
  document.getElementById("btnSend").addEventListener("click", sendToAE);
  document.getElementById("btnRender").addEventListener("click", renderComp);
  document.getElementById("btnImportBack").addEventListener("click", importBack);
  document.getElementById("modalAccept").addEventListener("click", acceptImport);
  document.getElementById("modalCancel").addEventListener("click", cancelImport);

  if (csInterface) {
    csInterface.addEventListener("com.adobe.csxs.events.FocusChanged", refreshCompInfo);
  }

  loadState();
  checkServerStatus();
  refreshCompInfo();
  startJobPolling();
  startEditingHeartbeat();
});

// ── Server API ──

function api(method, path, body) {
  var url = SERVER + path;
  var opts = { method: method, headers: { "Content-Type": "application/json" } };
  if (authToken) opts.headers["Authorization"] = "Bearer " + authToken;
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts).then(function (r) { return r.json(); });
}

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
      return api("GET", "/api/auth");
    })
    .then(function (auth) {
      if (auth && auth.enabled && auth.token) authToken = auth.token;
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
        document.getElementById("sendLabel").textContent = "Select clips in Resolve";
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

        var left = document.createElement("div");
        left.className = "clip-item-left";

        var num = document.createElement("span");
        num.className = "clip-num";
        num.textContent = (i + 1);

        var name = document.createElement("span");
        name.className = "clip-name";
        name.textContent = clip.name;

        left.appendChild(num);
        left.appendChild(name);

        var right = document.createElement("div");
        right.className = "clip-item-right";

        var tag = document.createElement("span");
        tag.className = "clip-tag";
        tag.textContent = "T" + clip.trackIndex;

        var durSpan = document.createElement("span");
        durSpan.className = "clip-dur";
        durSpan.textContent = dur;

        right.appendChild(tag);
        right.appendChild(durSpan);

        item.appendChild(left);
        item.appendChild(right);
        list.appendChild(item);
      });

      document.getElementById("sendLabel").textContent = "Send to After Effects";
    })
    .catch(function () {
      icon.classList.remove("spinning");
      showError("Connection error");
    });
}

// ── Send to AE ──

function sendToAE() {
  if (!currentSelection) return;

  var clips = currentSelection.clips;
  var fps = currentSelection.fps || 24;
  var width = currentSelection.width || 1920;
  var height = currentSelection.height || 1080;

  var maxEnd = 0;
  var firstStart = Infinity;
  for (var i = 0; i < clips.length; i++) {
    var c = clips[i];
    var s = c.start || 0;
    var e = s + (c.duration || 0);
    if (s < firstStart) firstStart = s;
    if (e > maxEnd) maxEnd = e;
  }
  if (firstStart === Infinity) firstStart = 0;
  var duration = (maxEnd - firstStart) / fps;

  var btn = document.getElementById("btnSend");
  btn.disabled = true;

  api("POST", "/api/link-clip", {
    clipData: clips,
    settings: { width: width, height: height, fps: fps, duration: duration }
  }).then(function (result) {
    if (result.error) {
      showError(result.error);
      btn.disabled = false;
      return;
    }

    activeLinkId = result.linkId;
    saveState();

    api("POST", "/api/links/" + result.linkId + "/auto").then(function (autoResult) {
      if (autoResult.error) {
        showError(autoResult.error);
        btn.disabled = false;
        return;
      }

      btn.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' +
        '<span>Queued!</span>';
      refreshCompInfo();
      setTimeout(function () {
        btn.innerHTML =
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
          '<span>Send to After Effects</span>' +
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

// ── Render ──

function renderComp() {
  var btn = document.getElementById("btnRender");
  var statusEl = document.getElementById("renderStatus");
  var fill = document.getElementById("progressFill");
  var text = document.getElementById("renderText");

  btn.disabled = true;
  statusEl.style.display = "block";
  fill.style.width = "10%";
  text.textContent = "Preparing render...";

  evalScript(
    '(function() { var c = app.project.activeItem; return (c && c instanceof CompItem) ? c.name : null; })()',
    function (compName) {
      if (!compName) {
        text.textContent = "No active comp";
        btn.disabled = false;
        setTimeout(function () { statusEl.style.display = "none"; }, 2000);
        return;
      }

      fill.style.width = "30%";
      text.textContent = "Starting render in After Effects...";

      var safeName = compName.replace(/[\\/:*?"<>|]/g, "_");
      var exportPath = exportDir.replace(/\\/g, "/") + "/" + safeName + ".mov";

      var script =
        '(function() {' +
        '  var comp = app.project.activeItem;' +
        '  if (!comp || !(comp instanceof CompItem)) return "NO_COMP";' +
        '  if (app.project.file) app.project.save(app.project.file);' +
        '  var rq = app.project.renderQueue;' +
        '  var existing = rq.numItems;' +
        '  var ri = rq.items.add(comp);' +
        '  var om = ri.outputModule(1);' +
        '  try { om.applyTemplate("' + activeRenderTemplate + '"); } catch(e) {}' +
        '  om.file = new File("' + exportPath + '");' +
        '  rq.render();' +
        '  return "DONE";' +
        '})()';

      evalScript(script, function (result) {
        fill.style.width = "90%";
        text.textContent = "Render complete!";

        if (result === "NO_COMP") {
          text.textContent = "No active comp";
        } else if (result === "DONE") {
          renderedFilePath = exportPath;
          saveState();
          var importBtn = document.getElementById("btnImportBack");
          importBtn.disabled = false;
          document.getElementById("importLabel").textContent = "Send Back to Resolve";
        } else {
          text.textContent = "Render finished (status: " + result + ")";
        }

        btn.disabled = false;
        setTimeout(function () {
          statusEl.style.display = "none";
          fill.style.width = "0%";
        }, 3000);
      });
    }
  );
}

// ── Import Back ──

function importBack() {
  if (!renderedFilePath) {
    showError("Render a comp first");
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

      text.textContent = "Render imported — originals disabled!";
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

function evalScript(script, callback) {
  if (!csInterface) {
    if (callback) callback(null);
    return;
  }
  csInterface.evalScript(script, callback);
}

function refreshCompInfo() {
  evalScript(
    '(function() { var c = app.project.activeItem; return (c && c instanceof CompItem) ? c.name : null; })()',
    function (name) {
      var strip = document.getElementById("compStrip");
      if (name) {
        strip.style.display = "flex";
        document.getElementById("compName").textContent = name;
        document.getElementById("btnRender").disabled = false;
        saveState();
      } else {
        strip.style.display = "none";
      }

      // Send editing heartbeat
      sendEditingHeartbeat(name);
    }
  );
}

// ── Editing Status Heartbeat ──
// Sends a heartbeat every 5s so the Resolve panel knows which comp is being edited

var heartbeatInterval = null;
var lastHeartbeatComp = null;

function sendEditingHeartbeat(compName) {
  // Only send heartbeat when we have a full link ID from a job
  if (!activeLinkId) {
    lastHeartbeatComp = compName;
    return;
  }

  // Send heartbeat to server
  api("POST", "/api/links/" + activeLinkId + "/editing", {
    compName: compName,
    status: compName ? "editing" : "idle"
  }).catch(function () {});

  // Tell previous comp it's no longer being edited
  if (lastHeartbeatComp && lastHeartbeatComp !== compName) {
    api("POST", "/api/links/" + activeLinkId + "/editing", {
      status: "idle"
    }).catch(function () {});
  }

  lastHeartbeatComp = compName;
}

function startEditingHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(function () {
    refreshCompInfo();
  }, 5000);
}

// Stop heartbeat when comp is closed or panel loses focus
function stopEditingHeartbeat() {
  if (lastHeartbeatComp) {
    sendEditingHeartbeat(null);
  }
}

function showError(msg) {
  var bar = document.getElementById("errorBar");
  var text = document.getElementById("errorText");
  bar.style.display = "flex";
  text.textContent = msg;
  setTimeout(function () { bar.style.display = "none"; }, 4000);
}

// ── Job Polling ──

var jobPollInterval = null;
var pendingJob = null;

function startJobPolling() {
  if (jobPollInterval) return;
  console.log("[ResolveLink] Starting job polling...");
  jobPollInterval = setInterval(pollForJobs, 2000);
}

function pollForJobs() {
  if (!csInterface) return;

  api("GET", "/api/jobs/pending")
    .then(function (job) {
      if (!job || !job.jobId) return;
      console.log("[ResolveLink] Received job:", job.jobId);
      showImportModal(job);
    })
    .catch(function () {});
}

function showImportModal(job) {
  pendingJob = job;
  var modal = document.getElementById("importModal");
  var info = document.getElementById("modalCompInfo");
  var list = document.getElementById("modalClipList");

  info.textContent = job.compName || "Untitled Comp";

  // fetch link details to show clips
  list.innerHTML = '<div class="modal-clip"><span class="modal-clip-name" style="color:#666">Loading...</span></div>';
  modal.style.display = "flex";

  api("GET", "/api/links/" + job.linkId)
    .then(function (link) {
      if (!link || link.error) {
        list.innerHTML = '<div class="modal-clip"><span class="modal-clip-name" style="color:#666">Unknown clips</span></div>';
        return;
      }
      var clips = link.clips || [];
      var fps = (link.settings && link.settings.fps) || 24;
      list.innerHTML = "";
      clips.forEach(function (c, i) {
        var dur = c.duration ? (c.duration / fps).toFixed(1) + "s" : "";
        var div = document.createElement("div");
        div.className = "modal-clip";

        var num = document.createElement("span");
        num.className = "modal-clip-num";
        num.textContent = (i + 1);

        var nameSpan = document.createElement("span");
        nameSpan.className = "modal-clip-name";
        nameSpan.textContent = c.name || "Clip";

        var durSpan = document.createElement("span");
        durSpan.className = "modal-clip-dur";
        durSpan.textContent = dur;

        div.appendChild(num);
        div.appendChild(nameSpan);
        div.appendChild(durSpan);
        list.appendChild(div);
      });
    })
    .catch(function () {
      list.innerHTML = '<div class="modal-clip"><span class="modal-clip-name" style="color:#666">Could not load clip info</span></div>';
    });
}

function acceptImport() {
  document.getElementById("importModal").style.display = "none";
  if (!pendingJob) return;
  executeJob(pendingJob);
  pendingJob = null;
}

function cancelImport() {
  document.getElementById("importModal").style.display = "none";
  if (pendingJob) {
    api("PUT", "/api/jobs/" + pendingJob.jobId + "/status", {
      status: "cancelled"
    }).catch(function () {});
  }
  pendingJob = null;
}

function executeJob(job) {
  var statusEl = document.getElementById("renderStatus");
  var fill = document.getElementById("progressFill");
  var text = document.getElementById("renderText");

  statusEl.style.display = "block";
  fill.style.width = "20%";
  text.textContent = "Executing script...";

  api("PUT", "/api/jobs/" + job.jobId + "/status", {
    status: "executing"
  }).catch(function () {});

  console.log("[ResolveLink] Executing job:", job.jobId, "link:", job.linkId);

  api("GET", "/api/links/" + job.linkId + "/jsx")
    .then(function (result) {
      if (result.error) {
        throw new Error(result.error);
      }

      console.log("[ResolveLink] JSX content received, length:", result.content.length);
      fill.style.width = "50%";
      text.textContent = "Running JSX in After Effects...";

      evalScript(result.content, function (evalResult) {
        console.log("[ResolveLink] evalScript result:", evalResult);

        if (evalResult && evalResult.indexOf && evalResult.indexOf("ERROR") > -1) {
          var errMsg = evalResult;
          fill.style.width = "0%";
          text.textContent = "Script error: " + errMsg;

          console.error("[ResolveLink] Script error:", errMsg);

          api("PUT", "/api/jobs/" + job.jobId + "/status", {
            status: "error",
            error: errMsg
          }).catch(function () {});

          setTimeout(function () { statusEl.style.display = "none"; }, 3000);
          return;
        }

        fill.style.width = "100%";
        text.textContent = "Comp created!";

        activeLinkId = job.linkId;
        saveState();

        api("GET", "/api/links/" + job.linkId)
          .then(function (link) {
            if (link && link.settings && link.settings.renderQueue) {
              activeRenderTemplate = link.settings.renderQueue;
              saveState();
            }
          })
          .catch(function () {});

        api("PUT", "/api/jobs/" + job.jobId + "/status", {
          status: "completed",
          result: { compName: job.compName }
        }).catch(function () {});

        refreshCompInfo();

        setTimeout(function () {
          statusEl.style.display = "none";
          fill.style.width = "0%";
        }, 2000);
      });
    })
    .catch(function (e) {
      console.error("[ResolveLink] Job execution failed:", e);
      fill.style.width = "0%";
      text.textContent = "Error: " + (e.message || "Failed to load JSX");

      api("PUT", "/api/jobs/" + job.jobId + "/status", {
        status: "error",
        error: e.message
      }).catch(function () {});

      setTimeout(function () { statusEl.style.display = "none"; }, 3000);
    });
}
