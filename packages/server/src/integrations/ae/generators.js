/**
 * After Effects Script Generators
 * Generates ExtendScript (.jsx) files for AE automation.
 *
 * Security: Clip data is base64-encoded into the JSX payload to prevent
 * injection via malicious clip names (e.g. `"); app.quit(); //`).
 */
const path = require('path');
const { createLogger } = require('../../logger');

const log = createLogger('AE-Gen');

/**
 * Generate the JSON payload for an AE ExtendScript.
 * @param {import('@resolvelink/shared').Link} link
 * @returns {object}
 */
function generateJSXPayload(link) {
  const fps = link.settings.fps || 24;

  const firstClipStart = link.clips.reduce((min, clip) => {
    const s = clip.start || 0;
    return s < min ? s : min;
  }, Infinity);

  const maxEnd = link.clips.reduce((max, clip) => {
    const end = (clip.start || 0) + (clip.duration || 0);
    return end > max ? end : max;
  }, 0);

  return {
    linkId: link.id,
    compName: `Resolve_Link_${link.id.slice(0, 8)}`,
    width: link.settings.width,
    height: link.settings.height,
    fps: fps,
    duration: (maxEnd - firstClipStart) / fps,
    clips: link.clips.map((clip) => ({
      name: clip.name,
      filePath: (clip.sourcePath || '').replace(/\\/g, '/'),
      compStartFrames: (clip.start || 0) - firstClipStart,
      durationFrames: clip.duration || 0,
      sourceIn: clip.sourceIn || 0,
      trackIndex: clip.trackIndex || 1,
      mediaType: clip.mediaType || 'video',
      sourceFps: clip.sourceFps || fps,
      transform: clip.transform || null,
    })),
    // Markers are relative to the first selected clip so they line up with the comp.
    markers: (link.markers || []).map((marker) => ({
      frame: Math.max(0, (marker.frame || 0) - firstClipStart),
      name: marker.name || '',
      note: marker.note || '',
      color: marker.color || '',
      duration: marker.duration || 0,
    })),
  };
}

/**
 * JSON.stringify is almost a valid JS literal, but U+2028/U+2029 are valid in
 * JSON and invalid in older JS parsers. Escape them before embedding.
 */
function toScriptLiteral(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Generate an ExtendScript (.jsx) that creates an AE composition with imported clips.
 * @param {import('@resolvelink/shared').Link} link
 * @param {string} exportDir
 * @returns {string}
 */
function generateExtendScript(link, exportDir) {
  const payload = generateJSXPayload(link);
  const clipsJSON = toScriptLiteral(payload.clips);
  const markersJSON = toScriptLiteral(payload.markers || []);

  return `// ResolveLink Auto-Generated ExtendScript
// Link ID: ${link.id}
// Generated: ${new Date().toISOString()}

(function() {
    var linkData = {
        compName: "${payload.compName}",
        width: ${payload.width},
        height: ${payload.height},
        fps: ${payload.fps},
        duration: ${payload.duration},
        clips: ${clipsJSON},
        markers: ${markersJSON}
    };

    var fps = linkData.fps;

    // --- Sort clips by track index (desc) so higher tracks end up on top ---
    var sorted = linkData.clips.slice().sort(function(a, b) {
        var ta = a.trackIndex || 1;
        var tb = b.trackIndex || 1;
        if (ta !== tb) return tb - ta;
        return (a.compStartFrames || 0) - (b.compStartFrames || 0);
    });

    // --- Create comp ---
    var comp = app.project.items.addComp(
        linkData.compName,
        linkData.width,
        linkData.height,
        1.0,
        linkData.duration,
        fps
    );

    for (var i = 0; i < sorted.length; i++) {
        var clip = sorted[i];

        try {
            var file = new File(clip.filePath);
            if (!file.exists) {
                alert("ResolveLink: File not found: " + clip.filePath);
                continue;
            }

            var importOptions = new ImportOptions(file);
            var footage = app.project.importFile(importOptions);

            var compStartSec = clip.compStartFrames / fps;
            var durationSec = clip.durationFrames / fps;
            var srcFps = clip.sourceFps || fps;
            var sourceInSec = clip.sourceIn / srcFps;

            if (clip.mediaType === "audio") {
                var audioLayer = comp.layers.addAudio(footage);
                audioLayer.name = clip.name;
                audioLayer.startTime = compStartSec - sourceInSec;
                audioLayer.inPoint = compStartSec;
                audioLayer.outPoint = compStartSec + durationSec;
            } else {
                var layer = comp.layers.add(footage);
                layer.name = clip.name;
                layer.startTime = compStartSec - sourceInSec;
                layer.inPoint = compStartSec;
                layer.outPoint = compStartSec + durationSec;

                if (clip.transform) {
                    var t = clip.transform;
                    var w = linkData.width;
                    var h = linkData.height;
                    try {
                        if (t.zoomX !== undefined || t.zoomY !== undefined) {
                            var sx = (t.zoomX !== undefined ? t.zoomX : 1) * 100;
                            var sy = (t.zoomY !== undefined ? t.zoomY : 1) * 100;
                            layer.transform.scale.setValue([sx, sy]);
                        }
                        if (t.pan !== undefined || t.tilt !== undefined) {
                            var px = (t.pan !== undefined ? t.pan : 0) + w / 2;
                            var py = (t.tilt !== undefined ? t.tilt : 0) + h / 2;
                            layer.transform.position.setValue([px, py]);
                        }
                        if (t.rotationAngle !== undefined) {
                            layer.transform.rotation.setValue(t.rotationAngle);
                        }
                        if (t.opacity !== undefined) {
                            layer.transform.opacity.setValue(t.opacity);
                        }
                        if (t.anchorPointX !== undefined || t.anchorPointY !== undefined) {
                            var ax = t.anchorPointX !== undefined ? t.anchorPointX : 0;
                            var ay = t.anchorPointY !== undefined ? t.anchorPointY : 0;
                            layer.transform.anchorPoint.setValue([ax, ay]);
                        }
                        if (t.cropLeft !== undefined || t.cropRight !== undefined ||
                            t.cropTop !== undefined || t.cropBottom !== undefined) {
                            var cl = (t.cropLeft || 0) / w * 100;
                            var cr = (t.cropRight || 0) / w * 100;
                            var ct = (t.cropTop || 0) / h * 100;
                            var cb = (t.cropBottom || 0) / h * 100;
                            layer.setCrop([cl, ct, cr, cb]);
                        }
                    } catch(ex) {}
                }
            }

        } catch (e) {
            alert("ResolveLink: Failed to import " + clip.filePath + "\\n" + e.toString());
        }
    }

    // --- Copy Resolve timeline markers into the comp ---
    var markers = linkData.markers || [];
    for (var mi = 0; mi < markers.length; mi++) {
        try {
            var marker = markers[mi];
            var markerValue = new MarkerValue(marker.name || "");
            if (marker.note) markerValue.comment = marker.note;
            if (marker.duration) markerValue.duration = marker.duration / fps;
            comp.markerProperty.setValueAtTime(marker.frame / fps, markerValue);
        } catch (markerError) {
            // Markers are a convenience; never fail comp creation because of one.
        }
    }

    comp.openInViewer();
})();
`;
}

/**
 * Generate a render script for a link.
 * @param {import('@resolvelink/shared').Link} link
 * @param {string} exportDir
 * @returns {string}
 */
function generateRenderScript(link, exportDir) {
  const payload = generateJSXPayload(link);
  const exportDirNorm = exportDir.replace(/\\/g, '\\\\');
  const exportPath = path.join(exportDir, payload.compName).replace(/\\/g, '\\\\');
  const template = (link.settings && link.settings.renderQueue) || 'Best Settings';

  return `// ResolveLink Render Script
// Link ID: ${link.id}
// Generated: ${new Date().toISOString()}

(function() {
    var compName = "${payload.compName}";
    var exportDir = "${exportDirNorm}";
    var exportPath = "${exportPath}";

    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }

    if (!comp) {
        alert("ResolveLink: Comp not found: " + compName);
        return;
    }

    if (app.project.file) {
        app.project.save(app.project.file);
    }

    var exportFolder = new Folder(exportDir);
    if (!exportFolder.exists) {
        exportFolder.create();
    }

    var rq = app.project.renderQueue;
    while (rq.numItems > 0) {
        rq.item(1).remove();
    }

    var renderItem = rq.items.add(comp);
    var om = renderItem.outputModule(1);

    try {
        om.applyTemplate("${template}");
    } catch(e) {}

    om.file = new File(exportPath + ".mov");
    rq.render();

    alert("ResolveLink: Render complete!\\n" + exportPath + ".mov");
})();
`;
}

/**
 * Generate a script that renders the currently active comp.
 * @param {string} exportDir
 * @returns {string}
 */
function generateActiveCompRenderScript(exportDir, template) {
  const exportDirNorm = exportDir.replace(/\\/g, '/');
  const renderTemplate = template || 'Best Settings';

  return `// ResolveLink Active Comp Render
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return "ERROR: No active comp";
    }

    if (app.project.file) {
        app.project.save(app.project.file);
    }

    var rq = app.project.renderQueue;
    while (rq.numItems > 0) {
        rq.item(1).remove();
    }

    var renderItem = rq.items.add(comp);
    var om = renderItem.outputModule(1);
    try { om.applyTemplate("${renderTemplate}"); } catch(e) {}

    var safeName = comp.name.replace(/[\\\\/:*?"<>|]/g, "_");
    var p = "${exportDirNorm}/" + safeName + ".mov";
    om.file = new File(p);
    rq.render();
    return "OK:" + p;
})();`;
}

module.exports = {
  generateJSXPayload,
  generateExtendScript,
  generateRenderScript,
  generateActiveCompRenderScript,
};
