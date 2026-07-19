// ResolveLink - AE ExtendScript Host
// Provides functions callable from the CEP panel

/**
 * Create a composition from clip data.
 * Called by the CEP panel with a JSON payload.
 *
 * @param {string} jsonPayload - JSON string with comp settings and clip data
 * @returns {string} "OK" or error message
 */
function createCompFromPayload(jsonPayload) {
    try {
        var data = JSON.parse(jsonPayload);
        var fps = data.fps || 24;

        // Find first clip start to offset comp
        var firstClipStart = Infinity;
        var maxEnd = 0;
        for (var i = 0; i < data.clips.length; i++) {
            var c = data.clips[i];
            if (c.start < firstClipStart) firstClipStart = c.start;
            var end = c.start + c.duration;
            if (end > maxEnd) maxEnd = end;
        }
        if (firstClipStart === Infinity) firstClipStart = 0;

        var duration = (maxEnd - firstClipStart) / fps;

        // Create comp
        var comp = app.project.items.addComp(
            data.compName,
            data.width,
            data.height,
            1.0,
            duration,
            fps
        );

        // Import and place each clip
        for (var j = 0; j < data.clips.length; j++) {
            var clip = data.clips[j];
            try {
                var file = new File(clip.filePath);
                if (!file.exists) continue;

                var importOpts = new ImportOptions(file);
                var footage = app.project.importFile(importOpts);
                var layer = comp.layers.add(footage);

                layer.name = clip.name;

                var compStartSec = (clip.start - firstClipStart) / fps;
                var durationSec = clip.duration / fps;
                var sourceInSec = (clip.sourceIn || 0) / fps;

                layer.startTime = compStartSec - sourceInSec;
                layer.inPoint = compStartSec;
                layer.outPoint = compStartSec + durationSec;
            } catch (e) {
                // Skip failed clips
            }
        }

        comp.openInViewer();
        return "OK";
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

/**
 * Get info about the currently active composition.
 * @returns {string|null} JSON string or null
 */
function getActiveCompInfo() {
    try {
        var c = app.project.activeItem;
        if (!c || !(c instanceof CompItem)) return null;

        var layers = [];
        for (var i = 1; i <= c.numLayers; i++) {
            var layer = c.layer(i);
            layers.push({
                name: layer.name,
                enabled: layer.enabled,
                inPoint: layer.inPoint,
                outPoint: layer.outPoint,
            });
        }

        return JSON.stringify({
            name: c.name,
            width: c.width,
            height: c.height,
            duration: c.duration,
            frameRate: c.frameRate,
            numLayers: c.numLayers,
            layers: layers,
        });
    } catch (e) {
        return null;
    }
}

/**
 * Render the active comp to a specific path.
 * @param {string} outputPath - Full path without extension
 * @returns {string} Output file path or error
 */
function renderActiveComp(outputPath) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "ERROR: No active composition";
        }

        if (app.project.file) {
            app.project.save(app.project.file);
        }

        var rq = app.project.renderQueue;
        while (rq.numItems > 0) {
            rq.item(1).remove();
        }

        var ri = rq.items.add(comp);
        var om = ri.outputModule(1);
        try { om.applyTemplate("Best Settings"); } catch (e) {}

        om.file = new File(outputPath);
        rq.render();

        return outputPath;
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}
