#!/usr/bin/env python

"""
ResolveLink — Send Audio Timeline Clips to REAPER
===================================================
Run from: Workspace -> Scripts -> send-to-reaper.py

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


# ── Timeline Data (audio tracks) ────────────────────────────

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
                "duration": item.GetDuration(),
                "sourceIn": item.GetLeftOffset() or 0,
                "sourcePath": source_path,
                "trackIndex": track_idx,
                "trackName": f"Audio {track_idx}",
                "_mpi": mpi,
            })

    meta = {
        "fps": fps,
        "sampleRate": sample_rate,
        "timelineName": timeline.GetName(),
        "projectName": project.GetName(),
        "audioTrackCount": track_count,
    }

    return clips, meta, None


def get_all_timeline_data(resolve):
    """Get both audio and video clips for reference."""
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

    # Audio tracks
    for track_idx in range(1, timeline.GetTrackCount("audio") + 1):
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
                "duration": item.GetDuration(),
                "sourceIn": item.GetLeftOffset() or 0,
                "sourcePath": source_path,
                "trackIndex": track_idx,
                "trackName": f"Audio {track_idx}",
                "_mpi": mpi,
                "_type": "audio",
            })

    meta = {
        "fps": fps,
        "sampleRate": sample_rate,
        "timelineName": timeline.GetName(),
        "projectName": project.GetName(),
    }

    return clips, meta, None


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
    root.title("ResolveLink — Send to REAPER")
    root.geometry("750x500")
    root.configure(bg="#1e1e1e")

    # ── header ──
    hdr = tk.Frame(root, bg="#2d2d2d", padx=14, pady=8)
    hdr.pack(fill="x")
    tk.Label(hdr, text="Send Audio to REAPER",
             font=("Segoe UI", 12, "bold"), fg="white", bg="#2d2d2d").pack(anchor="w")
    info = f"{meta['projectName']} / {meta['timelineName']}   {meta['sampleRate']} Hz   {meta.get('audioTrackCount', '?')} audio track(s)   {len(clips)} clip(s)"
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
        label = f"A{c['trackIndex']}   {c['name']}   {start_s}   {dur_s}"

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
    tk.Button(ft, text="Send to REAPER", command=on_send, font=("Segoe UI", 10, "bold"),
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

    clips, meta, err = get_audio_timeline_data(resolve)
    if err:
        print(f"ERROR: {err}")
        sys.exit(1)
    if not clips:
        print("No audio clips on the timeline.")
        sys.exit(0)

    indices = show_dialog(clips, meta)
    if indices is None:
        print("Cancelled.")
        sys.exit(0)
    if not indices:
        print("No clips selected.")
        sys.exit(0)

    sel = [clips[i] for i in indices]

    # build server payload
    fps = meta["fps"]
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

    max_end = max(c["start"] + c["duration"] for c in sel)
    comp_dur = (max_end - first_start) / fps if fps else 10

    payload = {
        "clipData": server_clips,
        "settings": {
            "fps": fps,
            "sampleRate": meta["sampleRate"],
            "duration": comp_dur,
        },
    }

    # send to server
    try:
        print("Sending to ResolveLink server...")
        resp = server_post("/api/reaper/link-clip", payload)
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
        auto = server_post(f"/api/links/{link_id}/reaper-auto", {})
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
