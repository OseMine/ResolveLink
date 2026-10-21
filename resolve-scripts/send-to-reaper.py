#!/usr/bin/env python3
"""
ResolveLink — Send Audio Timeline Clips to REAPER
=================================================
Run from: Workspace → Scripts → send-to-reaper.py

Shows a dialog with all audio timeline clips, lets you select which ones to send.
The selected clips are sent to the ResolveLink server which creates a REAPER project.

Requires:
  - DaVinci Resolve with External Scripting enabled
  - ResolveLink server running at http://localhost:3030
"""

import sys
import os
import json
import urllib.request
import urllib.error

# ─── Shared Module ────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))
from resolvelink_shared import (
    get_resolve,
    server_post,
    get_timeline_markers,
    filter_markers_in_range,
    show_selection_dialog,
    log_info, log_warn, log_error,
    frames_to_timecode,
)

# ─── Timeline Data (audio tracks) ────────────────────────────

def get_audio_timeline_data(resolve):
    pm = resolve.GetProjectManager()
    project = pm.GetCurrentProject()
    if not project:
        return None, None, "No project open"

    timeline = project.GetCurrentTimeline()
    if not timeline:
        return None, None, "No timeline open"

    fps = float(project.GetSetting("timelineFrameRate") or 24)
    sample_rate = int(project.GetSetting("timelineSampleRate") or 48000)

    clips = []
    track_count = timeline.GetTrackCount("audio")

    for track_idx in range(1, track_count + 1):
        items = timeline.GetItemListInTrack("audio", track_idx)
        if not items:
            continue
        for item in items:
            mpi = item.GetMediaPoolItem()
            source_path = ""
            if mpi:
                props = mpi.GetClipProperty()
                if props:
                    source_path = props.get("File Path", "")

            clips.append({
                "name": item.GetName() or os.path.basename(source_path) or "Untitled",
                "start": item.GetStart(),
                "end": item.GetEnd(),
                "duration": item.GetEnd() - item.GetStart(),
                "sourceIn": item.GetLeftOffset() or 0,
                "sourcePath": source_path,
                "trackIndex": track_idx,
                "trackName": f"Audio {track_idx}",
            })

    # Timeline markers (for REAPER regions/markers)
    markers = []
    try:
        for frame_key, marker in (timeline.GetMarkers() or {}).items():
            try:
                frame = int(float(frame_key))
            except (TypeError, ValueError):
                continue
            markers.append({
                "frame": frame,
                "name": marker.get("name", "") or "",
                "note": marker.get("note", "") or "",
                "color": marker.get("color", "") or "",
                "duration": marker.get("duration", 0) or 0,
            })
    except Exception:
        markers = []

    meta = {
        "fps": fps,
        "sampleRate": sample_rate,
        "timelineName": timeline.GetName(),
        "projectName": project.GetName(),
        "audioTrackCount": track_count,
        "markers": markers,
    }

    return clips, meta, None


# ─── Main ─────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("ResolveLink — Send Audio to REAPER")
    print("=" * 60)

    try:
        resolve = get_resolve()
    except RuntimeError as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    clips, meta, err = get_audio_timeline_data(resolve)
    if err:
        print(f"ERROR: {err}")
        sys.exit(1)
    if not clips:
        print("No audio clips on the timeline.")
        sys.exit(0)

    result = show_selection_dialog(clips, meta, "ResolveLink — Send Audio to REAPER", "audio")
    if result is None:
        print("Cancelled.")
        sys.exit(0)
    indices, full_timeline = result
    if not indices and not full_timeline:
        print("No clips selected.")
        sys.exit(0)

    # In full timeline mode, use ALL clips; otherwise use selection
    sel = clips if full_timeline else [clips[i] for i in indices]

    # build server payload
    fps = meta["fps"]
    if full_timeline:
        first_start = 0
    else:
        first_start = min(c["start"] for c in sel)
    server_clips = []
    for c in sel:
        server_clips.append({
            "name": c["name"],
            "sourcePath": c["sourcePath"],
            "start": c["start"] - first_start,
            "duration": c["duration"],
            "sourceIn": c["sourceIn"],
            "trackIndex": c["trackIndex"],
            "trackName": c.get("trackName", f"Audio {c['trackIndex']}"),
        })

    # Markers within selected span, rebased to comp start
    max_end = max(c["start"] + c["duration"] for c in sel)
    selected_markers = []
    for marker in meta.get("markers", []):
        if first_start <= marker["frame"] < max_end:
            selected_markers.append({
                **marker,
                "frame": marker["frame"] - first_start,
            })
    if selected_markers:
        payload["markers"] = selected_markers

    comp_dur = (max_end - first_start) / fps if fps else 10

    payload = {
        "clipData": server_clips,
        "timelineMode": full_timeline,
        "projectName": meta["projectName"],
        "timelineName": meta["timelineName"],
        "settings": {
            "fps": fps,
            "sampleRate": meta["sampleRate"],
            "duration": comp_dur,
        },
    }
    if selected_markers:
        payload["markers"] = selected_markers

    # send to server
    try:
        print("Sending to ResolveLink server...")
        resp = server_post("/api/reaper/link-clip", payload)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        print(f"ERROR: Server returned HTTP {e.code}: {e.reason}")
        if body:
            print(f"  Response: {body}")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Cannot reach server at {SERVER}")
        print(f"  {e}")
        print("Start the server first: .\\start.ps1")
        sys.exit(1)

    link_id = resp.get("linkId")
    if not link_id:
        print(f"ERROR: Unexpected server response: {resp}")
        sys.exit(1)

    print(f"REAPER link created: {link_id}")

    # trigger auto-workflow
    try:
        auto = server_post(f"/api/reaper/{link_id}/reaper-auto", {})
        status = auto.get("status", "unknown")
        print(f"Status: {status}")
        if status == "queued":
            print("Job queued — REAPER polling script will pick it up.")
        elif status == "sending":
            print("Launched REAPER. Polling script will pick up the job.")
    except Exception as e:
        print(f"WARNING: Could not trigger auto-workflow: {e}")
        print(f"Link {link_id} was created. Send it from http://localhost:3030")


if __name__ == "__main__":
    main()