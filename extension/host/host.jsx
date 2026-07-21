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
        // Sort by track index (desc) so higher tracks end up on top in AE
        var sorted = data.clips.slice().sort(function(a, b) {
            var ta = a.trackIndex || 1;
            var tb = b.trackIndex || 1;
            if (ta !== tb) return tb - ta;
            return (a.start || 0) - (b.start || 0);
        });

        for (var j = 0; j < sorted.length; j++) {
            var clip = sorted[j];
            try {
                var file = new File(clip.filePath);
                if (!file.exists) continue;

                var importOpts = new ImportOptions(file);
                var footage = app.project.importFile(importOpts);

                var compStartSec = (clip.start - firstClipStart) / fps;
                var durationSec = clip.duration / fps;
                var srcFps = clip.sourceFps || fps;
                var sourceInSec = (clip.sourceIn || 0) / srcFps;

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
                        var w = data.width;
                        var h = data.height;
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
 * @param {string} [template] - Render settings template name (defaults to "Best Settings")
 * @returns {string} Output file path or error
 */
function renderActiveComp(outputPath, template) {
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
        try { om.applyTemplate(template || "Best Settings"); } catch (e) {}

        om.file = new File(outputPath);
        rq.render();

        return outputPath;
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}
