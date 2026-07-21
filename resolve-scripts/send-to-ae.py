#!/usr/bin/env python

"""
ResolveLink — Send Timeline Clips to After Effects
==================================================
Run from: Workspace -> Scripts -> send-to-ae.py

Shows a dialog with all timeline clips, lets you select which ones to send.
The selected clips are sent to the ResolveLink server which creates an AE comp.

Requires:
  - DaVinci Resolve with External Scripting enabled
  - ResolveLink server running at http://localhost:3030
"""

import sys
import os
import json
import urllib.request
import urllib.error

# ── Resolve Connection (standard Blackmagic pattern) ─────────

def GetResolve():
    try:
        import DaVinciResolveScript as bmd
    except ImportError:
        if sys.platform.startswith("win") or sys.platform.startswith("cygwin"):
            expectedPath = os.getenv("PROGRAMDATA") + "\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting\\Modules\\"
        elif sys.platform.startswith("darwin"):
            expectedPath = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/"
        else:
            expectedPath = "/opt/resolve/Developer/Scripting/Modules/"

        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("DaVinciResolveScript", expectedPath + "DaVinciResolveScript.py")
            module = importlib.util.module_from_spec(spec)
            sys.modules["DaVinciResolveScript"] = module
            spec.loader.exec_module(module)
            import DaVinciResolveScript as bmd
        except Exception as ex:
            print("Could not find DaVinciResolveScript module.")
            print("Expected at: " + expectedPath)
            print(str(ex))
            sys.exit(1)

    return bmd.scriptapp("Resolve")


# ── Timeline Data ────────────────────────────────────────────

def get_timeline_data(resolve):
    pm = resolve.GetProjectManager()
    project = pm.GetCurrentProject()
    if not project:
        return None, None, "No project open"

    timeline = project.GetCurrentTimeline()
    if not timeline:
        return None, None, "No timeline open"

    fps = float(project.GetSetting("timelineFrameRate") or 24)
    width = int(project.GetSetting("timelineResolutionWidth") or 1920)
    height = int(project.GetSetting("timelineResolutionHeight") or 1080)

    clips = []
    track_count = timeline.GetTrackCount("video")
    for track_idx in range(1, track_count + 1):
        items = timeline.GetItemListInTrack("video", track_idx)
        if not items:
            continue
        for item in items:
            mpi = item.GetMediaPoolItem()
            source_path = ""
            source_fps = fps
            props = {}
            if mpi:
                props = mpi.GetClipProperty() or {}
                source_path = props.get("File Path", "")
                try:
                    source_fps = float(props.get("FPS") or fps)
                except (ValueError, TypeError):
                    source_fps = fps

            transform = {}
            for key, prop in [
                ("zoomX", "ZoomX"), ("zoomY", "ZoomY"),
                ("pan", "Pan"), ("tilt", "Tilt"),
                ("rotationAngle", "RotationAngle"),
                ("anchorPointX", "AnchorPointX"), ("anchorPointY", "AnchorPointY"),
                ("cropLeft", "CropLeft"), ("cropRight", "CropRight"),
                ("cropTop", "CropTop"), ("cropBottom", "CropBottom"),
                ("opacity", "Opacity"),
            ]:
                try:
                    val = item.GetProperty(prop)
                    if val is not None:
                        transform[key] = val
                except Exception:
                    pass

            clips.append({
                "name": item.GetName() or os.path.basename(source_path) or "Untitled",
                "start": item.GetStart(),
                "end": item.GetEnd(),
                "duration": item.GetDuration(),
                "sourceIn": item.GetLeftOffset() or 0,
                "sourcePath": source_path,
                "trackIndex": track_idx,
                "sourceFps": source_fps,
                "transform": transform,
                "mpi": mpi,
            })

    meta = {
        "fps": fps,
        "width": width,
        "height": height,
        "timelineName": timeline.GetName(),
        "projectName": project.GetName(),
    }

    return clips, meta, None


def create_ae_timeline(resolve, selected_clips, meta):
    """
    1. Create 'AE Timelines' bin with a new timeline containing selected clips + audio.
    2. Find the new timeline as a MediaPoolItem.
    3. Delete originals in the original timeline.
    4. Insert the new timeline as a nested clip via media_pool.AppendToTimeline.
    5. Copy basic properties (crop, transform) from originals.
    """
    import time

    pm = resolve.GetProjectManager()
    project = pm.GetCurrentProject()
    media_pool = project.GetMediaPool()
    orig_timeline = project.GetCurrentTimeline()

    # ── find or create "AE Timelines" bin ──
    root = media_pool.GetRootFolder()
    ae_bin = None
    for folder in (root.GetSubFolderList() or []):
        if folder.GetName() == "AE Timelines":
            ae_bin = folder
            break
    if not ae_bin:
        ae_bin = media_pool.AddSubFolder(root, "AE Timelines")

    tl_name = f"AE_{meta['timelineName']}_{int(time.time()) % 100000}"

    # ── create new timeline in AE Timelines bin ──
    prev_folder = media_pool.GetCurrentFolder()
    media_pool.SetCurrentFolder(ae_bin)

    new_tl = media_pool.CreateEmptyTimeline(tl_name)
    if not new_tl:
        media_pool.SetCurrentFolder(prev_folder)
        return None, "Failed to create timeline", orig_timeline

    project.SetCurrentTimeline(new_tl)

    # ── ensure enough video tracks ──
    used_v_tracks = sorted(set(c["trackIndex"] for c in selected_clips))
    if len(used_v_tracks) == 1:
        v_track_map = {used_v_tracks[0]: 1}
    else:
        v_track_map = {orig_idx: i + 1 for i, orig_idx in enumerate(used_v_tracks)}
    while new_tl.GetTrackCount("video") < len(v_track_map):
        new_tl.AddTrack("video")

    # ── find matching audio items from original timeline ──
    audio_matches = []  # (orig_audio_item, video_clip, orig_audio_track_idx)
    used_a_tracks = set()
    for a_idx in range(1, orig_timeline.GetTrackCount("audio") + 1):
        items = orig_timeline.GetItemListInTrack("audio", a_idx) or []
        for item in items:
            item_start = item.GetStart()
            for c in selected_clips:
                if c["start"] <= item_start < c["start"] + c["duration"]:
                    audio_matches.append((item, c, a_idx))
                    used_a_tracks.add(a_idx)
                    break

    a_track_map = {orig_idx: i + 1 for i, orig_idx in enumerate(sorted(used_a_tracks))}
    while new_tl.GetTrackCount("audio") < len(used_a_tracks):
        new_tl.AddTrack("audio")

    # ── build append_list: video entries + audio entries ──
    first_orig_start = min(c["start"] for c in selected_clips)

    # collect (clip, orig_item) pairs
    pairs = []
    for c in selected_clips:
        orig_item = None
        for track_idx in range(1, orig_timeline.GetTrackCount("video") + 1):
            items = orig_timeline.GetItemListInTrack("video", track_idx)
            if not items:
                continue
            for item in items:
                if item.GetStart() == c["start"] and item.GetDuration() == c["duration"]:
                    orig_item = item
                    break
            if orig_item:
                break
        pairs.append((c, orig_item))

    # sort by original position to preserve adjacency
    pairs.sort(key=lambda p: (p[0]["trackIndex"], p[0]["start"]))
    video_entries = [p[0] for p in pairs]
    orig_items = [p[1] for p in pairs]

    # only use recordFrame when clips span multiple tracks
    multi_track = len(set(c["trackIndex"] for c in video_entries)) > 1

    append_list = []
    for c in video_entries:
        source_in = c.get("sourceIn", 0)
        source_out = source_in + c.get("duration", 0)
        entry = {
            "mediaPoolItem": c.get("mpi"),
            "startFrame": source_in,
            "endFrame": source_out,
            "trackIndex": v_track_map[c["trackIndex"]],
            "mediaType": 1,
        }
        if multi_track:
            entry["recordFrame"] = c["start"] - first_orig_start
        append_list.append(entry)

    # append standalone audio items, sorted by position
    audio_matches.sort(key=lambda t: (t[2], t[0].GetStart()))
    for a_item, c, orig_a_idx in audio_matches:
        a_mpi = a_item.GetMediaPoolItem()
        if not a_mpi:
            continue
        a_source_in = a_item.GetLeftOffset() or 0
        a_source_out = a_source_in + a_item.GetDuration()
        a_entry = {
            "mediaPoolItem": a_mpi,
            "startFrame": a_source_in,
            "endFrame": a_source_out,
            "trackIndex": a_track_map[orig_a_idx],
            "mediaType": 2,
        }
        if multi_track:
            a_entry["recordFrame"] = a_item.GetStart() - first_orig_start
        append_list.append(a_entry)

    if append_list:
        result = media_pool.AppendToTimeline(append_list)
        if not result:
            media_pool.SetCurrentFolder(prev_folder)
            return None, "Failed to populate new timeline", orig_timeline

    # ── copy basic properties from originals (index-based) ──
    PROP_KEYS = [
        "CropLeft", "CropRight", "CropTop", "CropBottom",
        "CropSoftness", "CropRetain",
        "ZoomX", "ZoomY", "ZoomGang",
        "Pan", "Tilt",
        "RotationAngle",
        "AnchorPointX", "AnchorPointY",
        "Pitch", "Yaw",
        "Tracking",
        "Opacity",
    ]

    new_items = new_tl.GetItemListInTrack("video", 1) or []
    for new_item, orig_item in zip(new_items, orig_items):
        if not orig_item:
            continue
        for key in PROP_KEYS:
            try:
                val = orig_item.GetProperty(key)
                if val is not None:
                    new_item.SetProperty(key, val)
            except Exception:
                pass

    # ── go back to original timeline ──
    project.SetCurrentTimeline(orig_timeline)

    # ── find the new timeline as a MediaPoolItem (with retry) ──
    def find_timeline_mpi(folder, name, depth=0):
        indent = "  " * depth
        for item in (folder.GetClipList() or []):
            item_name = item.GetName()
            clip_type = item.GetClipProperty("Clip Type") or item.GetClipProperty("Type") or "?"
            print(f"  {indent}[pool] {item_name} (type={clip_type})")
            if item_name == name:
                return item
        for sub in (folder.GetSubFolderList() or []):
            sub_name = sub.GetName() if hasattr(sub, 'GetName') else "?"
            print(f"  {indent}>> subfolder: {sub_name}")
            found = find_timeline_mpi(sub, name, depth + 1)
            if found:
                return found
        return None

    print(f"Looking for timeline '{tl_name}' in Media Pool...")
    new_tl_mpi = None
    for attempt in range(10):
        new_tl_mpi = find_timeline_mpi(root, tl_name)
        if new_tl_mpi:
            print(f"  Found on attempt {attempt + 1}")
            break
        print(f"  Attempt {attempt + 1}: not found, retrying...")
        time.sleep(0.2)

    media_pool.SetCurrentFolder(prev_folder)

    if not new_tl_mpi:
        print(f"  WARNING: Timeline not found. Skipping nesting.")
        return tl_name, None, orig_timeline

    # ── calculate total span BEFORE deleting originals ──
    first_start = min(c["start"] for c in selected_clips)
    last_end = max(c["start"] + c["duration"] for c in selected_clips)
    total_duration = last_end - first_start
    target_track = min(c["trackIndex"] for c in selected_clips)

    # ── delete originals from original timeline ──
    items_to_delete = []
    for track_idx in range(1, orig_timeline.GetTrackCount("video") + 1):
        items = orig_timeline.GetItemListInTrack("video", track_idx)
        if not items:
            continue
        for item in items:
            for c in selected_clips:
                if c["start"] == item.GetStart() and c["duration"] == item.GetDuration():
                    items_to_delete.append(item)
                    break

    for track_idx in range(1, orig_timeline.GetTrackCount("audio") + 1):
        items = orig_timeline.GetItemListInTrack("audio", track_idx)
        if not items:
            continue
        for item in items:
            item_start = item.GetStart()
            for c in selected_clips:
                if c["start"] <= item_start < c["start"] + c["duration"]:
                    if item not in items_to_delete:
                        items_to_delete.append(item)
                    break

    print(f"Deleting {len(items_to_delete)} original items...")
    if items_to_delete:
        delete_result = orig_timeline.DeleteClips(items_to_delete)
        print(f"  Delete result: {delete_result}")

    # ── insert nested timeline trimmed to original span ──
    print(f"Inserting nested timeline at frame {first_start}, duration {total_duration}...")
    nested = media_pool.AppendToTimeline([{
        "mediaPoolItem": new_tl_mpi,
        "startFrame": 0,
        "endFrame": total_duration,
        "recordFrame": first_start,
        "trackIndex": target_track,
    }])

    print(f"  Nested insert result: {nested}")
    if not nested:
        print("  WARNING: Nested insertion failed. Originals were deleted — manual recovery may be needed.")
        return tl_name, None, orig_timeline

    return tl_name, None, orig_timeline


# ── Server Communication ─────────────────────────────────────

SERVER = "http://127.0.0.1:3030"

def server_post(path, data):
    url = SERVER + path
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ── Tkinter Selection Dialog ─────────────────────────────────

def show_dialog(clips, meta):
    """
    Returns list of selected clip indices, or None if cancelled.
    """
    try:
        import tkinter as tk
        from tkinter import ttk
    except ImportError:
        # No GUI — select all
        return list(range(len(clips)))

    selected = {}
    root = tk.Tk()
    root.title("ResolveLink")
    root.geometry("750x500")
    root.configure(bg="#1e1e1e")

    # ── header ──
    hdr = tk.Frame(root, bg="#2d2d2d", padx=14, pady=8)
    hdr.pack(fill="x")
    tk.Label(hdr, text="Send to After Effects",
             font=("Segoe UI", 12, "bold"), fg="white", bg="#2d2d2d").pack(anchor="w")
    info = f"{meta['projectName']} / {meta['timelineName']}   {meta['width']}x{meta['height']} @ {meta['fps']} fps   {len(clips)} clip(s)"
    tk.Label(hdr, text=info, font=("Segoe UI", 9), fg="#999", bg="#2d2d2d").pack(anchor="w", pady=(2, 0))

    # ── toolbar ──
    tb = tk.Frame(root, bg="#1e1e1e", padx=14, pady=4)
    tb.pack(fill="x")

    def sel_all():
        for v in selected.values(): v.set(True)
        upd()

    def desel_all():
        for v in selected.values(): v.set(False)
        upd()

    count_var = tk.StringVar()
    tk.Button(tb, text="All", command=sel_all, font=("Segoe UI", 9),
              bg="#3a3a3a", fg="white", relief="flat", padx=8).pack(side="left", padx=(0, 4))
    tk.Button(tb, text="None", command=desel_all, font=("Segoe UI", 9),
              bg="#3a3a3a", fg="white", relief="flat", padx=8).pack(side="left")
    tk.Label(tb, textvariable=count_var, font=("Segoe UI", 9), fg="#aaa", bg="#1e1e1e").pack(side="right")

    # ── scrollable list ──
    container = tk.Frame(root, bg="#1e1e1e")
    container.pack(fill="both", expand=True, padx=14, pady=(0, 8))

    canvas = tk.Canvas(container, bg="#1e1e1e", highlightthickness=0)
    vsb = ttk.Scrollbar(container, orient="vertical", command=canvas.yview)
    inner = tk.Frame(canvas, bg="#1e1e1e")
    inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
    canvas.create_window((0, 0), window=inner, anchor="nw")
    canvas.configure(yscrollcommand=vsb.set)
    canvas.pack(side="left", fill="both", expand=True)
    vsb.pack(side="right", fill="y")

    def _on_wheel(event):
        canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
    canvas.bind_all("<MouseWheel>", _on_wheel)

    # ── rows ──
    def upd():
        n = sum(1 for v in selected.values() if v.get())
        count_var.set(f"{n} / {len(clips)} selected")

    for i, c in enumerate(clips):
        var = tk.BooleanVar(value=True)
        selected[i] = var
        bg = "#252525" if i % 2 == 0 else "#1e1e1e"
        row = tk.Frame(inner, bg=bg)
        row.pack(fill="x")

        tk.Checkbutton(row, variable=var, bg=bg, fg="white", selectcolor="#333",
                       activebackground=bg, command=upd).grid(row=0, column=0, padx=(4, 0))

        start_s = f"{c['start'] / meta['fps']:.2f}s"
        dur_s = f"{c['duration'] / meta['fps']:.2f}s"
        label = f"V{c['trackIndex']}   {c['name']}   {start_s}   {dur_s}"

        tk.Label(row, text=label, font=("Consolas", 9), fg="#ddd", bg=bg,
                 anchor="w", padx=4, pady=3).grid(row=0, column=1, sticky="w")

    upd()

    # ── footer buttons ──
    ft = tk.Frame(root, bg="#2d2d2d", padx=14, pady=8)
    ft.pack(fill="x", side="bottom")

    result = {"action": None}

    def on_send():
        result["action"] = "send"
        root.destroy()

    def on_cancel():
        root.destroy()

    tk.Button(ft, text="Cancel", command=on_cancel, font=("Segoe UI", 10),
              bg="#3a3a3a", fg="white", relief="flat", padx=14).pack(side="right", padx=(6, 0))
    tk.Button(ft, text="Send to AE", command=on_send, font=("Segoe UI", 10, "bold"),
              bg="#0078d4", fg="white", relief="flat", padx=14).pack(side="right")

    root.mainloop()

    if result["action"] != "send":
        return None
    return [i for i, v in selected.items() if v.get()]


# ── Main ─────────────────────────────────────────────────────

def main():
    resolve = GetResolve()
    if resolve is None:
        print("ERROR: Cannot connect to Resolve. Is it running with External Scripting enabled?")
        sys.exit(1)

    clips, meta, err = get_timeline_data(resolve)
    if err:
        print(f"ERROR: {err}")
        sys.exit(1)
    if not clips:
        print("No video clips on the timeline.")
        sys.exit(0)

    indices = show_dialog(clips, meta)
    if indices is None:
        print("Cancelled.")
        sys.exit(0)
    if not indices:
        print("No clips selected.")
        sys.exit(0)

    sel = [clips[i] for i in indices]

    # filter out clips without a valid source path (can't be imported into AE)
    valid_sel = [c for c in sel if c.get("sourcePath")]
    if not valid_sel:
        print("ERROR: No clips with valid file paths found. All selected clips lack source files.")
        sys.exit(1)
    if len(valid_sel) < len(sel):
        print(f"Warning: Skipping {len(sel) - len(valid_sel)} clip(s) without file paths.")
    sel = valid_sel

    # create timeline in "AE Timelines" bin + replace originals with compound
    print("Creating AE timeline...")
    tl_name, tl_err, orig_timeline = create_ae_timeline(resolve, sel, meta)
    if tl_err:
        print(f"WARNING: Could not create timeline: {tl_err}")
    else:
        print(f"Timeline created: {tl_name}")

    # build server payload — relative to new timeline (matches recordFrame offsets)
    fps = meta["fps"]
    first_start = min(c["start"] for c in sel)
    server_clips = []
    for c in sel:
        clip_data = {
            "name": c["name"],
            "sourcePath": c["sourcePath"],
            "start": c["start"] - first_start,
            "duration": c["duration"],
            "sourceIn": c["sourceIn"],
            "trackIndex": c["trackIndex"],
            "mediaType": "video",
            "sourceFps": c.get("sourceFps", fps),
        }
        if c.get("transform"):
            clip_data["transform"] = c["transform"]
        server_clips.append(clip_data)

    # gather audio clips from the original timeline
    seen_audio = set()
    for a_idx in range(1, orig_timeline.GetTrackCount("audio") + 1):
        items = orig_timeline.GetItemListInTrack("audio", a_idx) or []
        for item in items:
            item_start = item.GetStart()
            for c in sel:
                if c["start"] <= item_start < c["start"] + c["duration"]:
                    mpi = item.GetMediaPoolItem()
                    source_path = ""
                    if mpi:
                        props = mpi.GetClipProperty()
                        if props:
                            source_path = props.get("File Path", "")
                    a_key = (item.GetStart(), item.GetDuration())
                    if a_key not in seen_audio:
                        seen_audio.add(a_key)
                        if not source_path:
                            continue
                        server_clips.append({
                            "name": item.GetName() or "Audio",
                            "sourcePath": source_path,
                            "start": item.GetStart() - first_start,
                            "duration": item.GetDuration(),
                            "sourceIn": item.GetLeftOffset() or 0,
                            "trackIndex": a_idx,
                            "mediaType": "audio",
                        })
                    break

    max_end = max(c["start"] + c["duration"] for c in sel)
    comp_dur = (max_end - first_start) / fps if fps else 10

    payload = {
        "clipData": server_clips,
        "settings": {
            "width": meta["width"],
            "height": meta["height"],
            "fps": fps,
            "duration": comp_dur,
        },
    }

    # send to server
    try:
        print("Sending to ResolveLink server...")
        resp = server_post("/api/link-clip", payload)
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

    print(f"Link created: {link_id}")

    # trigger auto-workflow
    try:
        auto = server_post(f"/api/links/{link_id}/auto", {})
        status = auto.get("status", "unknown")
        print(f"Status: {status}")
        if status == "queued":
            print("Job queued — AE extension will pick it up.")
        elif status == "sending":
            print("Launched After Effects with script.")
    except Exception as e:
        print(f"WARNING: Could not trigger auto-workflow: {e}")
        print(f"Link {link_id} was created. Send it from http://localhost:3030")


if __name__ == "__main__":
    main()
