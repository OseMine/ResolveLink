// =============================================================================
// ResolveLink — Import Pipeline for After Effects
// =============================================================================
//
// Standalone ExtendScript that creates AE compositions from Resolve clip data.
//
// Usage:
//   1. Via CEP extension (automatic — host.jsx calls these functions)
//   2. Via File > Scripts > Run Script File (select a .json payload)
//   3. Via command line: "aerender.exe" -r import_pipeline.jsx payload.json
//
// The script expects a JSON payload file as argument, or reads from
// the file path passed as a string argument.
//
// JSON Payload Format:
// {
//   "compName": "Resolve_Link_a1b2c3d4",
//   "width": 1920,
//   "height": 1080,
//   "fps": 24,
//   "duration": 10.5,
//   "clips": [
//     {
//       "name": "VFX_Shot_01",
//       "filePath": "X:/footage/shot01.mov",
//       "compStartFrames": 0,
//       "durationFrames": 120,
//       "sourceIn": 0
//     }
//   ]
// }
//
// =============================================================================

(function() {
    // ---------------------------------------------------------------------------
    // Parse arguments
    // ---------------------------------------------------------------------------
    var payloadPath = null;
    var payloadData = null;

    // Check script arguments (passed via -r flag or CEP evalScript)
    if (arguments.length > 0 && arguments[0]) {
        var arg = String(arguments[0]);

        // If it looks like a file path, load the JSON from it
        if (arg.indexOf("{") === -1) {
            payloadPath = arg;
        } else {
            // If it's raw JSON, parse it directly
            try {
                payloadData = JSON.parse(arg);
            } catch (e) {
                alert("ResolveLink: Invalid JSON in argument.\n" + e.toString());
                return;
            }
        }
    }

    // Load from file if path was provided
    if (payloadPath && !payloadData) {
        var f = new File(payloadPath);
        if (!f.exists) {
            alert("ResolveLink: Payload file not found:\n" + payloadPath);
            return;
        }
        f.open("r");
        var content = f.read();
        f.close();
        try {
            payloadData = JSON.parse(content);
        } catch (e) {
            alert("ResolveLink: Invalid JSON in payload file.\n" + e.toString());
            return;
        }
    }

    if (!payloadData) {
        alert("ResolveLink: No payload data.\nPass a JSON file path as argument.");
        return;
    }

    // ---------------------------------------------------------------------------
    // Validate payload
    // ---------------------------------------------------------------------------
    if (!payloadData.compName || !payloadData.clips || payloadData.clips.length === 0) {
        alert("ResolveLink: Payload missing compName or clips.");
        return;
    }

    var fps = payloadData.fps || 24;
    var width = payloadData.width || 1920;
    var height = payloadData.height || 1080;

    // ---------------------------------------------------------------------------
    // Create the composition
    // ---------------------------------------------------------------------------
    var comp = app.project.items.addComp(
        payloadData.compName,
        width,
        height,
        1.0,
        payloadData.duration || 10,
        fps
    );

    // ---------------------------------------------------------------------------
    // Sort clips by track index (desc) so higher tracks end up on top in AE
    // ---------------------------------------------------------------------------
    var sorted = payloadData.clips.slice().sort(function(a, b) {
        var ta = a.trackIndex || 1;
        var tb = b.trackIndex || 1;
        if (ta !== tb) return tb - ta;
        return (a.compStartFrames || 0) - (b.compStartFrames || 0);
    });

    // ---------------------------------------------------------------------------
    // Import and place each clip
    // ---------------------------------------------------------------------------
    var imported = 0;
    var failed = 0;

    for (var i = 0; i < sorted.length; i++) {
        var clip = sorted[i];

        try {
            var file = new File(clip.filePath);
            if (!file.exists) {
                $.writeln("ResolveLink: File not found: " + clip.filePath);
                failed++;
                continue;
            }

            var importOptions = new ImportOptions(file);
            var footage = app.project.importFile(importOptions);

            var compStartSec = (clip.compStartFrames || 0) / fps;
            var durationSec = (clip.durationFrames || 0) / fps;
            var sourceInSec = (clip.sourceIn || 0) / (clip.sourceFps || fps);

            if (clip.mediaType === "audio") {
                var audioLayer = comp.layers.addAudio(footage);
                audioLayer.name = clip.name || ("Audio_" + (i + 1));
                audioLayer.startTime = compStartSec - sourceInSec;
                audioLayer.inPoint = compStartSec;
                audioLayer.outPoint = compStartSec + durationSec;
            } else {
                var layer = comp.layers.add(footage);
                layer.name = clip.name || ("Clip_" + (i + 1));
                layer.startTime = compStartSec - sourceInSec;
                layer.inPoint = compStartSec;
                layer.outPoint = compStartSec + durationSec;

                if (clip.transform) {
                    var t = clip.transform;
                    try {
                        if (t.zoomX !== undefined || t.zoomY !== undefined) {
                            layer.transform.scale.setValue([
                                (t.zoomX !== undefined ? t.zoomX : 1) * 100,
                                (t.zoomY !== undefined ? t.zoomY : 1) * 100
                            ]);
                        }
                        if (t.pan !== undefined || t.tilt !== undefined) {
                            layer.transform.position.setValue([
                                (t.pan !== undefined ? t.pan : 0) + width / 2,
                                (t.tilt !== undefined ? t.tilt : 0) + height / 2
                            ]);
                        }
                        if (t.rotationAngle !== undefined) layer.transform.rotation.setValue(t.rotationAngle);
                        if (t.opacity !== undefined) layer.transform.opacity.setValue(t.opacity);
                        if (t.anchorPointX !== undefined || t.anchorPointY !== undefined) {
                            layer.transform.anchorPoint.setValue([
                                t.anchorPointX !== undefined ? t.anchorPointX : 0,
                                t.anchorPointY !== undefined ? t.anchorPointY : 0
                            ]);
                        }
                        if (t.cropLeft !== undefined || t.cropRight !== undefined ||
                            t.cropTop !== undefined || t.cropBottom !== undefined) {
                            layer.setCrop([
                                (t.cropLeft || 0) / width * 100,
                                (t.cropTop || 0) / height * 100,
                                (t.cropRight || 0) / width * 100,
                                (t.cropBottom || 0) / height * 100
                            ]);
                        }
                    } catch (transformError) {}
                }
            }

            imported++;
        } catch (e) {
            $.writeln("ResolveLink: Failed to import " + clip.filePath + ": " + e.toString());
            failed++;
        }
    }

    // ---------------------------------------------------------------------------
    // Copy timeline markers into the comp
    // ---------------------------------------------------------------------------
    var markers = payloadData.markers || [];
    for (var mi = 0; mi < markers.length; mi++) {
        try {
            var markerValue = new MarkerValue(markers[mi].name || "");
            if (markers[mi].note) markerValue.comment = markers[mi].note;
            if (markers[mi].duration) markerValue.duration = markers[mi].duration / fps;
            comp.markerProperty.setValueAtTime((markers[mi].frame || 0) / fps, markerValue);
        } catch (markerError) {}
    }

    // ---------------------------------------------------------------------------
    // Open in viewer and report
    // ---------------------------------------------------------------------------
    comp.openInViewer();

    var msg = "ResolveLink: Composition created — " + imported + " clip(s) imported";
    if (failed > 0) {
        msg += ", " + failed + " failed";
    }
    $.writeln(msg);

    // If running standalone (not via CEP), show a brief alert
    if (payloadData._alert !== false) {
        alert(msg);
    }
})();
