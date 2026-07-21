# Workflow Guide

This document walks through the complete round-trip workflow from DaVinci Resolve to After Effects and back, as well as the parallel REAPER audio workflow.

---

## Overview

```
 Resolve Timeline                    After Effects
 ────────────────                    ─────────────
 1. Select clips
 2. Click "Send to AE"
         │
         ▼
 3. Plugin reads metadata
 4. Server generates .jsx + .json
 5. Server queues job or launches AE
         │
         ▼
                   6. CEP extension picks up job
                   7. AE creates composition
                   8. AE imports footage
                   9. VFX artist works
                  10. Artist renders
         │
         ▼
 11. File watcher detects render
 12. Auto-import to Resolve
 13. Compound clip created
 14. Plugin shows "Imported" badge


 Resolve Timeline                    REAPER DAW
 ────────────────                    ──────────
 1. Click "Send Audio to REAPER"
 2. Select audio clips in dialog
         │
         ▼
 3. Server generates .json payload
 4. Server writes job file to exports/reaper-jobs/
         │
         ▼
                   5. Panel callback picks up job
                   6. Panel creates tracks + items
                   7. Audio engineer mixes
                   8. Panel auto-saves project
         │
         ▼
 9. Panel renders audio
10. Panel sends to server
11. Server imports to Resolve
12. Old audio clips muted
```

---

## Step-by-Step Workflow

### Step 1: Select Clips in Resolve

In the DaVinci Resolve timeline, select one or more video clips that you want to send to After Effects for VFX work.

**Best practices:**
- Select contiguous clips on the same track for clean timecode alignment
- Ensure all selected clips have valid source media (no missing files)
- Note the timeline frame rate (shown in the timeline settings)

### Step 2: Open the ResolveLink Plugin

Go to **Workspace > Workflow Integrations > ResAE Link** in the Resolve menu bar.

The plugin panel opens showing:
- **Connection status** (green dot = bridge connected)
- **Active links count**
- **"Send Selection to After Effects"** button

### Step 3: Send to After Effects

Click the **"Send Selection to After Effects"** button.

The plugin will:
1. Read clip metadata from the timeline (name, path, duration, timecodes) via the Python scripting bridge
2. Package the data as JSON
3. Send it to the bridge server on `localhost:3030`
4. The server generates a `.jsx` ExtendScript file and a `.json` payload
5. A new link appears in the "Active Links" list with status **"Created"**
6. The server triggers the auto-workflow (see Step 4)

### Step 4: Auto-Workflow

After the link is created, the server automatically handles getting the script into After Effects:

**If After Effects is running (CEP extension active):**
1. The server queues a job in the job queue
2. Link status changes to **"Queued"**
3. The CEP extension inside AE polls `/api/jobs/pending` every 2 seconds
4. The CEP extension picks up the job and executes the JSX script
5. Link status changes to **"Rendering"** (while AE processes the script)

**If After Effects is not running:**
1. The server launches After Effects with the `-r` flag pointing to the generated JSX
2. Link status changes to **"Sending"**
3. After Effects opens and executes the script on startup
4. The CEP extension picks up once AE is running

### Step 5: After Effects Composition Created

The script execution (via CEP or `-r` flag) creates:

1. A new composition named `Resolve_Link_{id}` matching your Resolve settings (resolution, FPS, duration)
2. Each source clip imported as a footage item
3. Each clip placed as a layer at the correct timecode position
4. In/out points set to match the original clip boundaries
5. The composition opens in the AE viewer

**What you see in AE:**
- A new composition named `Resolve_Link_{id}` in the Project panel
- All selected clips arranged as layers
- Correct timing and duration matching the Resolve timeline

### Step 6: VFX Work in After Effects

Work in After Effects as you normally would:
- Add effects, masks, tracking data
- Create motion graphics
- Apply expressions
- Work with multiple passes

**Important notes:**
- The composition settings (resolution, FPS) match what was sent from Resolve
- Changing the composition dimensions will break the round-trip sync
- You can save the `.aep` project at any time

### Step 7: Render from After Effects

When VFX work is complete, render the composition. You can do this in several ways:

**Option A: Render via the CEP Extension**
1. In the ResolveLink CEP panel inside AE, ensure your comp is active
2. Click the **"Render"** button
3. The extension saves the project, adds the comp to the render queue, and renders
4. The output goes to the `exports/` directory

**Option B: Trigger render from the Resolve Plugin**
1. In the ResolveLink panel in Resolve, find the link you want to render
2. Click the **play icon** on the link card
3. The server will invoke `aerender` with the correct composition and output path
4. The link status changes to **"Rendering"** (orange pulsing dot)

**Option C: Render manually in AE**
1. Add the composition to the Render Queue (**Composition > Add to Render Queue**)
2. Set the output module to render to the `exports/` directory
3. Use a filename that includes the link ID (e.g., `Resolve_Link_32b0ff89.mov`)
4. Start the render

### Step 8: File Watcher Detects Render

The Chokidar file watcher monitors the `exports/` directory. When a new `.mov`, `.mp4`, or other supported format appears:

1. The file is detected (with 1-second debounce)
2. The server tries to match it to an active link by filename convention
3. If matched, the link status updates to **"Rendered"** (green dot)
4. A WebSocket message is broadcast to the UI
5. The server automatically triggers the import-back process (Step 9)

**Matching convention:**
The rendered file's name should contain either:
- The first 8 characters of the link UUID (e.g., `32b0ff89`)
- The string `Resolve_Link`

### Step 9: Compound Clip Import

Once a render is detected and matched, the server automatically imports it back into DaVinci Resolve:

1. The rendered file is imported into the Resolve media pool
2. All original clips on the target track are disabled
3. The rendered clip is appended to the timeline
4. A compound clip is created from all timeline items
5. Link status updates to **"Imported"** (green badge)

The compound clip contains:
- **V2 (top):** The rendered AE output
- **V1 (bottom, disabled):** The original clips (preserved for reference)

### Step 10: Review in Resolve

The compound clip is now on your Resolve timeline:
- The rendered VFX output plays on top
- Original clips are preserved underneath (disabled)
- You can double-click the compound clip to see both layers
- To revert, simply disable the compound clip and enable the originals

---

## Frame-Accurate Synchronization

### Timecode Handling

ResolveLink handles timecode conversion between Resolve and AE:

- **Resolve** provides timecodes in frames relative to the timeline
- **AE** works in seconds for layer timing
- The conversion uses: `seconds = frames / fps`

### Source vs. Timeline Timecodes

The plugin distinguishes between two types of timecodes:

| Type | Description | Usage |
|------|-------------|-------|
| **Timeline Timecode** | Position in the Resolve timeline | Used for placement |
| **Source Timecode** | Position within the original media file | Used for in/out points |

**Critical:** The plugin reads the *source timecode* of each clip, not just the timeline position. This ensures the correct portion of the media is imported into AE.

### Drop-Frame vs. Non-Drop-Frame

For NTSC broadcast frame rates (29.97, 59.94 fps):
- The plugin uses frame-count-based positioning (not timecode strings)
- This avoids drop-frame/non-drop-frame conversion issues
- Frame accuracy is maintained regardless of timecode format

---

## Multiple Clips

When sending multiple clips from the timeline:

1. Clips are ordered by their timeline position (left to right)
2. Each clip becomes a separate layer in the AE composition
3. Clips are placed sequentially based on their timeline offsets
4. Source in/out points are preserved for each clip

**Example:**

```
Resolve Timeline:
  [Clip A: 0-120] [Clip B: 120-216] [Clip C: 216-336]

AE Composition (24fps, 14 seconds):
  Layer 1: Clip A (frames 0-120, seconds 0-5)
  Layer 2: Clip B (frames 120-216, seconds 5-9)
  Layer 3: Clip C (frames 216-336, seconds 9-14)
```

---

## Working with Different Resolutions

The plugin creates the AE composition at the resolution specified in the settings:

- **Standard HD:** 1920x1080
- **4K UHD:** 3840x2160
- **DCI 4K:** 4096x2160
- **Custom:** Any resolution

Ensure the Resolve timeline settings match what you send to AE, or adjust the settings in the link configuration.

---

## Status Reference

### Link Status

| Badge | Color | Meaning |
|-------|-------|---------|
| **Created** | Blue dot | Link created, JSX generated, waiting for auto-workflow |
| **Sending** | Yellow dot | AE is being launched with the script |
| **Queued** | Yellow dot | Job queued, waiting for CEP extension to pick up |
| **Linked** | Green dot | AE composition confirmed active |
| **Rendering** | Orange pulsing dot | aerender is processing |
| **Rendered** | Green dot | Output file available, importing to Resolve |
| **Imported** | Green badge | Render imported back into Resolve as compound clip |
| **Error** | Red dot | Something went wrong |

### CEP Extension Job Status

| Status | Meaning |
|--------|---------|
| **pending** | Job created, waiting to be dispatched |
| **dispatched** | Job returned to CEP extension |
| **executing** | CEP extension is running the script |
| **completed** | Script executed successfully |
| **error** | Script execution failed |

---

## Best Practices

### Project Organization

1. **Use consistent naming** - Name your Resolve clips clearly; they become AE layer names
2. **One VFX task per link** - Send related clips together, unrelated clips separately
3. **Keep source files accessible** - AE needs to read the original media; don't move files after sending

### Performance

1. **Close unused AE projects** - aerender loads the full project; fewer items = faster startup
2. **Use proxy media** - For 4K+ footage, consider using Resolve's proxy mode before sending
3. **Batch renders** - Send multiple clips in one link rather than individual links

### Collaboration

1. **Network paths** - If using shared storage, ensure both Resolve and AE can access the same paths
2. **Path consistency** - Use absolute paths; relative paths may break between systems
3. **UUID tracking** - Links are tracked by UUID; even if you rename files, the link persists

### Version Control

1. **Save AE projects** - Before rendering, save your `.aep` to preserve the work
2. **Keep originals** - Never delete the original Resolve clips until the VFX is finalized
3. **Use compound clips** - The compound clip system preserves originals under the render

---

## Common Scenarios

### Scenario: Quick VFX Fix

1. Select the problematic clip in Resolve
2. Click "Send to After Effects"
3. CEP extension picks up the job and creates the comp
4. Fix the issue (remove object, color correct, etc.)
5. Render via CEP panel or manually to `exports/`
6. File watcher detects it and auto-imports to Resolve
7. Compound clip created with render over original
8. Compare with the original

### Scenario: Full VFX Shot

1. Select all clips belonging to the shot
2. Send to AE (they arrive as sequential layers)
3. CEP extension creates the composition
4. Create additional compositing layers in AE
5. Add tracking, roto, particles, etc.
6. Render multiple passes if needed
7. Import the final composite into Resolve as compound clip

### Scenario: Motion Graphics

1. Send a placeholder clip to AE
2. Create the motion graphic in AE
3. Render with alpha channel (ProRes 4444 or EXR)
4. Import into Resolve - the alpha composites over the timeline

### Scenario: Offline Editing

1. Send clips to AE while on the same machine
2. Complete VFX work
3. Render to a network-accessible `exports/` directory
4. On another machine, the file watcher detects the render
5. Compound clip is created automatically

### Scenario: AE Not Running

1. Select clips in Resolve and click "Send to AE"
2. The server detects AE is not running
3. Server launches After Effects with the `-r` flag
4. AE opens and executes the script automatically
5. Composition is created without manual intervention

---

## REAPER Audio Workflow

This section covers the complete round-trip workflow for audio post-production using REAPER.

### REAPER Step 1: Open the Send Dialog

In DaVinci Resolve, go to **Workspace > Scripts > send-to-reaper.py** (or click **"Send Audio to REAPER"** in the ResolveLink launcher dialog).

A Tkinter dialog appears showing all available audio clips from the current timeline.

### REAPER Step 2: Select Audio Clips

In the dialog:
1. Review the listed audio clips (name, duration, track)
2. Select the clips you want to send to REAPER
3. Choose "Full Timeline" for the entire timeline or "Selected Clips" for just the selection
4. Click **"Send"**

The plugin packages the audio clip data and sends it to the bridge server.

### REAPER Step 3: Server Generates Payload

The server processes the request:
1. Generates a UUID for the link
2. Converts frame-based clip data to seconds-based (`seconds = frames / fps`)
3. Groups clips by track
4. Writes a JSON payload to `temp/{uuid}.json`
5. Writes a job file to `exports/reaper-jobs/{uuid}.json`
6. Stores the link in memory

### REAPER Step 4: Panel Picks Up Job

The ResolveLink Panel's background callback (when toggled ON) polls the `exports/reaper-jobs/` directory every 2 seconds:

1. Detects the new job file
2. Reads and deletes the job file
3. Reads the JSON payload from `temp/`
4. Executes the import (creates tracks, items, positions)
5. Writes a result file to `exports/reaper-results/`

### REAPER Step 5: Audio Imported into REAPER

The panel's import handler creates:
1. New tracks matching the Resolve track indices
2. Media items for each audio clip, positioned at the correct time
3. Items grouped by track (matching Resolve track layout)
4. Source in/out points preserved for each clip
5. Project auto-saved to `exports/reaper-projects/{ProjectName}_{TimelineName}.rpp`

**What you see in REAPER:**
- Audio items arranged on tracks matching the Resolve timeline
- Correct timing and duration
- Ready for mixing

### REAPER Step 6: Audio Mixing

Work in REAPER as you normally would:
- Apply EQ, compression, reverb, and other effects
- Adjust levels and panning
- Add automation
- Work with multiple tracks and buses

### REAPER Step 7: Render from REAPER

When mixing is complete, use the panel to render:

**Option A: Render via the Panel**
1. In the ResolveLink Panel, click **"Send Render to Resolve"**
2. The panel reads the render config from the latest render script
3. Opens REAPER's render dialog (you click Render)
4. After rendering, the panel sends the audio to the server

**Option B: Render manually**
1. Go to **File > Render** in REAPER
2. Set the output directory to your export path
3. Choose your format (WAV, FLAC, AIFF, etc.)
4. Start the render

### REAPER Step 8: Audio Imported to Resolve

After rendering, the panel (or manual action) sends the rendered audio to the server:

1. The panel sends a PUT request to `/api/reaper/import-to-resolve`
2. The server calls the bridge's `import-audio` command
3. The bridge imports the audio into Resolve's media pool under "REAPER Renders"
4. A new audio track is created in the Resolve timeline
5. The audio clip is appended to the timeline
6. All old audio clips on the timeline are muted

### REAPER Step 9: Review in Resolve

The audio is now on your Resolve timeline:
- New audio track with the rendered mix
- Old audio clips muted (preserved for reference)
- Ready for final color grade and export

---

## REAPER Panel Features

### Callback Toggle

The panel's callback toggle controls background job polling:

- **ON (Green)** — Polls `exports/reaper-jobs/` every 2 seconds for new jobs
- **OFF (Default)** — No polling, manual operation only

When a job is detected:
1. Job file is read and deleted
2. Payload is processed
3. Audio items are created in REAPER
4. Project is auto-saved
5. Result is written to `exports/reaper-results/`

### Send Render to Resolve

This button:
1. Reads the render config from the latest render script in `temp/`
2. Sets REAPER's render settings (output dir, filename, sample rate)
3. Opens the render dialog (command 40015 — File: Render to file)
4. After you render, finds the rendered audio file
5. Sends it to the server via PUT `/api/reaper/import-to-resolve`

### Logger

The panel includes a built-in console logger for debugging:

- Toggle via **Ctrl+L** or the Logger button in the panel
- Log levels: `info`, `warn`, `error`, `debug`, `http`, `file`
- State persists between sessions via REAPER extstate
- All log methods accept format strings: `log:info("Processing %d clips", clipCount)`

### Update Project from Resolve

This button:
1. Fetches the current DaVinci timeline via GET `/api/resolve/timeline`
2. Matches REAPER items to DaVinci clips by source filename
3. Updates position, length, and track assignment
4. Preserves REAPER effects, volume, and pan

---

## REAPER vs AE Workflow Comparison

| Aspect | After Effects | REAPER |
|--------|--------------|--------|
| **Target** | VFX / Motion Graphics | Audio Post-Production |
| **Send Button** | "Send Selection to After Effects" | "Send Audio to REAPER" |
| **Dialog** | None (uses timeline selection) | Tkinter dialog for audio clip selection |
| **Script Format** | `.jsx` (ExtendScript) + `.json` | `.json` payload (file-based IPC) |
| **Job Type** | `execute-jsx` | `execute-reaper` (file-based) |
| **Polling** | CEP extension (HTTP) | Panel callback (file system) |
| **Render Formats** | `.mov`, `.mp4` | `.wav`, `.flac`, `.aiff`, `.ogg`, `.mp3` |
| **Frame/Time Basis** | Frames → seconds | Frames → seconds |
| **Auto-Import** | Compound clip (video) | Audio track (mutes old clips) |
| **Panel** | CEP Extension | Pure GFX Panel (no dependencies) |

---

## REAPER Best Practices

### Audio Organization

1. **Use consistent naming** — Name your Resolve audio clips clearly; they become REAPER item names
2. **Separate by type** — Send dialogue, music, and SFX as separate batches for better track organization
3. **Keep source files accessible** — REAPER needs to read the original media; don't move files after sending

### Performance

1. **Close unused REAPER projects** — Fewer items = faster loading
2. **Use audio proxies** — For high-resolution audio, consider working with compressed proxies during mixing
3. **Batch renders** — Send multiple related clips in one link

### Version Control

1. **Save REAPER projects** — Before rendering, save your `.RPP` project (the panel auto-saves on import)
2. **Keep originals** — Never delete the original Resolve audio until the mix is finalized
3. **Use the Update Project feature** — If the Resolve timeline changes, sync REAPER to match
