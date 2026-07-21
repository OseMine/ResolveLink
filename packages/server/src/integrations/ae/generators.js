/**
 * After Effects Script Generators
 * Generates ExtendScript (.jsx) files for AE automation.
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
    })),
  };
}

/**
 * Generate an ExtendScript (.jsx) that creates an AE composition with imported clips.
 * @param {import('@resolvelink/shared').Link} link
 * @param {string} exportDir
 * @returns {string}
 */
function generateExtendScript(link, exportDir) {
  const payload = generateJSXPayload(link);
  const clipsJSON = JSON.stringify(payload.clips);

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
        clips: ${clipsJSON}
    };

    var fps = linkData.fps;

    // --- Create comp ---
    var comp = app.project.items.addComp(
        linkData.compName,
        linkData.width,
        linkData.height,
        1.0,
        linkData.duration,
        fps
    );

    for (var i = 0; i < linkData.clips.length; i++) {
        var clip = linkData.clips[i];

        try {
            var file = new File(clip.filePath);
            if (!file.exists) {
                alert("ResolveLink: File not found: " + clip.filePath);
                continue;
            }

            var importOptions = new ImportOptions(file);
            var footage = app.project.importFile(importOptions);
            var layer = comp.layers.add(footage);

            layer.name = clip.name;

            var compStartSec = clip.compStartFrames / fps;
            var durationSec = clip.durationFrames / fps;
            var sourceInSec = clip.sourceIn / fps;

            layer.startTime = compStartSec - sourceInSec;
            layer.inPoint = compStartSec;
            layer.outPoint = compStartSec + durationSec;

        } catch (e) {
            alert("ResolveLink: Failed to import " + clip.filePath + "\\n" + e.toString());
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
        om.applyTemplate("Best Settings");
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
function generateActiveCompRenderScript(exportDir) {
  const exportDirNorm = exportDir.replace(/\\/g, '/');

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
    try { om.applyTemplate("Best Settings"); } catch(e) {}

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
