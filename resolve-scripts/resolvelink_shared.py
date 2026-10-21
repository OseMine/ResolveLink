#!/usr/bin/env python3
"""
ResolveLink Shared Module
Common utilities for DaVinci Resolve scripts.
"""

import sys
import os
import json
import urllib.request
import urllib.error
import platform

# ─────────────────────────────────────────────────────────────────
# DaVinci Resolve Connection
# ─────────────────────────────────────────────────────────────────

def get_resolve_module():
    """Locate and import the DaVinciResolveScript module."""
    try:
        import DaVinciResolveScript as bmd
        return bmd
    except ImportError:
        pass

    if sys.platform.startswith("win") or sys.platform.startswith("cygwin"):
        expected_path = os.getenv("PROGRAMDATA") + "\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting\\Modules\\"
    elif sys.platform.startswith("darwin"):
        expected_path = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/"
    else:
        expected_path = "/opt/resolve/Developer/Scripting/Modules/"

    try:
        import importlib.util
        script_path = os.path.join(expected_path, "DaVinciResolveScript.py")
        spec = importlib.util.spec_from_file_location("DaVinciResolveScript", script_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["DaVinciResolveScript"] = module
        spec.loader.exec_module(module)
        import DaVinciResolveScript as bmd
        return bmd
    except Exception as ex:
        raise RuntimeError(
            f"Could not find DaVinciResolveScript module.\n"
            f"Expected at: {expected_path}\n"
            f"Error: {ex}"
        )


def get_resolve():
    """Connect to running DaVinci Resolve instance."""
    bmd = get_resolve_module()
    resolve = bmd.scriptapp("Resolve")
    if resolve is None:
        raise RuntimeError(
            "Cannot connect to DaVinci Resolve.\n"
            "Ensure Resolve is running with External Scripting enabled:\n"
            "  Preferences → System → General → External scripting using → Local"
        )
    return resolve


# ─────────────────────────────────────────────────────────────────
# Server Communication
# ─────────────────────────────────────────────────────────────────

DEFAULT_SERVER = "http://127.0.0.1:3030"

def get_server_url():
    """Get server URL from environment or use default."""
    return os.getenv("RESOLVELINK_SERVER", DEFAULT_SERVER)


def server_post(path, data, server_url=None, timeout=10):
    """POST JSON data to ResolveLink server."""
    server_url = server_url or get_server_url()
    url = server_url.rstrip("/") + path
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        raise RuntimeError(f"Server returned HTTP {e.code}: {e.reason}\n  Response: {body}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Cannot reach server at {server_url}: {e}\nStart the server first: .\\start.ps1")
    except Exception as e:
        raise RuntimeError(f"Server communication failed: {e}")


# ─────────────────────────────────────────────────────────────────
# Timecode & Frame Helpers
# ─────────────────────────────────────────────────────────────────

def frames_to_timecode(frames, fps):
    """Convert frame number to HH:MM:SS:FF timecode."""
    if fps <= 0:
        return "00:00:00:00"
    total_seconds = frames / fps
    hours = int(total_seconds // 3600)
    minutes = int((total_seconds % 3600) // 60)
    seconds = int(total_seconds % 60)
    frame = int(frames % round(fps))
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}:{frame:02d}"


def timecode_to_frames(tc, fps):
    """Convert HH:MM:SS:FF timecode to frame number."""
    parts = tc.split(":")
    if len(parts) != 4:
        return 0
    h, m, s, f = map(int, parts)
    return ((h * 3600 + m * 60 + s) * round(fps)) + f


def format_duration(frames, fps):
    """Format frame duration as human-readable string."""
    seconds = frames / fps if fps > 0 else 0
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = int(seconds // 60)
    seconds = seconds % 60
    return f"{minutes}m {seconds:.1f}s"


# ─────────────────────────────────────────────────────────────────
# Clip Property Extraction
# ─────────────────────────────────────────────────────────────────

TRANSFORM_PROPS = [
    ("zoomX", "ZoomX"), ("zoomY", "ZoomY"),
    ("pan", "Pan"), ("tilt", "Tilt"),
    ("rotationAngle", "RotationAngle"),
    ("anchorPointX", "AnchorPointX"), ("anchorPointY", "AnchorPointY"),
    ("cropLeft", "CropLeft"), ("cropRight", "CropRight"),
    ("cropTop", "CropTop"), ("cropBottom", "CropBottom"),
    ("opacity", "Opacity"),
]

CROP_PROPS = [
    "CropLeft", "CropRight", "CropTop", "CropBottom",
    "CropSoftness", "CropRetain",
]

TRANSFORM_PROPS_EXT = [
    "ZoomX", "ZoomY", "ZoomGang",
    "Pan", "Tilt",
    "RotationAngle",
    "AnchorPointX", "AnchorPointY",
    "Pitch", "Yaw",
    "Tracking",
    "Opacity",
]


def extract_transform(item):
    """Extract transform properties from a timeline item."""
    transform = {}
    for key, prop in TRANSFORM_PROPS:
        try:
            val = item.GetProperty(prop)
            if val is not None:
                transform[key] = val
        except Exception:
            pass
    return transform if transform else None


def extract_clip_properties(mpi):
    """Extract clip properties from MediaPoolItem."""
    if not mpi:
        return {}
    props = mpi.GetClipProperty() or {}
    return {
        "filePath": props.get("File Path", ""),
        "fps": float(props.get("FPS", 0) or 0),
        "type": props.get("Type", ""),
        "format": props.get("Format", ""),
        "duration": props.get("Duration", ""),
    }


# ─────────────────────────────────────────────────────────────────
# Marker Handling
# ─────────────────────────────────────────────────────────────────

def get_timeline_markers(timeline):
    """Extract all markers from timeline (clip + timeline level)."""
    markers = []
    
    # Clip markers
    for track_type in ["video", "audio"]:
        for t in range(1, timeline.GetTrackCount(track_type) + 1):
            items = timeline.GetItemListInTrack(track_type, t) or []
            for item in items:
                item_markers = item.GetMarkers() or {}
                for frame, marker_data in item_markers.items():
                    markers.append({
                        "frame": int(float(frame)),
                        "name": marker_data.get("name", "") or "",
                        "note": marker_data.get("note", "") or "",
                        "color": marker_data.get("color", "") or "",
                        "duration": marker_data.get("duration", 0) or 0,
                        "trackType": track_type,
                        "trackIndex": t,
                        "clipName": item.GetName(),
                    })

    # Timeline markers
    tl_markers = timeline.GetMarkers() or {}
    for frame, marker_data in tl_markers.items():
        markers.append({
            "frame": int(float(frame)),
            "name": marker_data.get("name", "") or "",
            "note": marker_data.get("note", "") or "",
            "color": marker_data.get("color", "") or "",
            "duration": marker_data.get("duration", 0) or 0,
            "trackType": "timeline",
            "trackIndex": 0,
            "clipName": None,
        })

    return sorted(markers, key=lambda m: m["frame"])


def filter_markers_in_range(markers, first_frame, last_frame):
    """Filter markers to those within the given frame range (exclusive end)."""
    return [
        {**m, "frame": m["frame"] - first_frame}
        for m in markers
        if first_frame <= m["frame"] < last_frame
    ]


# ─────────────────────────────────────────────────────────────────
# UI Helpers (Tkinter)
# ─────────────────────────────────────────────────────────────────

class ClipSelectionDialog:
    """Reusable clip selection dialog for both AE and REAPER."""

    def __init__(self, clips, meta, title="ResolveLink", clip_type="video"):
        self.clips = clips
        self.meta = meta
        self.title = title
        self.clip_type = clip_type
        self.result = None

    def show(self):
        try:
            import tkinter as tk
            from tkinter import ttk
        except ImportError:
            return list(range(len(self.clips)))

        self._build_ui()
        return self.result

    def _build_ui(self):
        import tkinter as tk
        from tkinter import ttk

        self.root = tk.Tk()
        self.root.title(self.title)
        self.root.geometry("750x500")
        self.root.configure(bg="#1e1e1e")
        self.root.protocol("WM_DELETE_WINDOW", self._on_cancel)

        self.selected = {}
        self._build_header()
        self._build_toolbar()
        self._build_list()
        self._build_footer()

        self._update_count()
        self.root.mainloop()

    def _build_header(self):
        import tkinter as tk
        hdr = tk.Frame(self.root, bg="#2d2d2d", padx=14, pady=8)
        hdr.pack(fill="x")
        clip_word = "Audio" if self.clip_type == "audio" else "Clips"
        tk.Label(hdr, text=f"Send to {'REAPER' if self.clip_type == 'audio' else 'After Effects'}",
                 font=("Segoe UI", 12, "bold"), fg="white", bg="#2d2d2d").pack(anchor="w")
        info = f"{self.meta.get('projectName', '?')} / {self.meta.get('timelineName', '?')}"
        if self.clip_type == "audio":
            info += f"   {self.meta.get('sampleRate', '?')} Hz"
        else:
            info += f"   {self.meta.get('width', '?')}x{self.meta.get('height', '?')} @ {self.meta.get('fps', '?')} fps"
        info += f"   {len(self.clips)} {clip_word.lower()}(s)"
        tk.Label(hdr, text=info, font=("Segoe UI", 9), fg="#999", bg="#2d2d2d").pack(anchor="w", pady=(2, 0))

    def _build_toolbar(self):
        import tkinter as tk
        from tkinter import ttk

        tb = tk.Frame(self.root, bg="#1e1e1e", padx=14, pady=4)
        tb.pack(fill="x")

        def sel_all():
            for v in self.selected.values(): v.set(True)
            self._update_count()

        def desel_all():
            for v in self.selected.values(): v.set(False)
            self._update_count()

        self.count_var = tk.StringVar()
        tk.Button(tb, text="All", command=lambda: [v.set(True) for v in self.selected.values()] or self._update_count(),
                  font=("Segoe UI", 9), bg="#3a3a3a", fg="white", relief="flat", padx=8).pack(side="left", padx=(0, 4))
        tk.Button(tb, text="None", command=lambda: [v.set(False) for v in self.selected.values()] or self._update_count(),
                  font=("Segoe UI", 9), bg="#3a3a3a", fg="white", relief="flat", padx=8).pack(side="left")
        tk.Label(tb, textvariable=self.count_var, font=("Segoe UI", 9), fg="#aaa", bg="#1e1e1e").pack(side="right")

    def _build_list(self):
        import tkinter as tk
        from tkinter import ttk

        container = tk.Frame(self.root, bg="#1e1e1e")
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

        self.selected = {}
        for i, c in enumerate(self.clips):
            var = tk.BooleanVar(value=True)
            self.selected[i] = var
            bg = "#252525" if i % 2 == 0 else "#1e1e1e"
            row = tk.Frame(inner, bg=bg)
            row.pack(fill="x")

            tk.Checkbutton(row, variable=var, bg=bg, fg="white", selectcolor="#333",
                           activebackground=bg, command=self._update_count).grid(row=0, column=0, padx=(4, 0))

            fps = self.meta.get("fps", 24) if self.clip_type == "video" else self.meta.get("fps", 24)
            start_s = f"{c['start'] / fps:.2f}s"
            dur_s = f"{c['duration'] / fps:.2f}s"
            track_label = f"V{c['trackIndex']}" if self.clip_type == "video" else f"A{c['trackIndex']}"
            label = f"{track_label}   {c['name']}   {start_s}   {dur_s}"

            tk.Label(row, text=label, font=("Consolas", 9), fg="#ddd", bg=bg,
                     anchor="w", padx=4, pady=3).grid(row=0, column=1, sticky="w")

    def _update_count(self):
        n = sum(1 for v in self.selected.values() if v.get())
        self.count_var.set(f"{n} / {len(self.clips)} selected")

    def _build_footer(self):
        import tkinter as tk
        from tkinter import ttk

        ft = tk.Frame(self.root, bg="#2d2d2d", padx=14, pady=8)
        ft.pack(fill="x", side="bottom")

        self.result = {"action": None}

        def on_send():
            self.result = {"action": "send", "indices": [i for i, v in self.selected.items() if v.get()]}
            self.root.destroy()

        def on_cancel():
            self.result = {"action": "cancel"}
            self.root.destroy()

        tk.Button(ft, text="Cancel", command=self._on_cancel, font=("Segoe UI", 10),
                  bg="#3a3a3a", fg="white", relief="flat", padx=14).pack(side="right", padx=(6, 0))
        tk.Button(ft, text=f"Send to {'REAPER' if hasattr(self, 'clip_type') and self.clip_type == 'audio' else 'After Effects'}",
                  command=on_send, font=("Segoe UI", 10, "bold"),
                  bg="#0078d4", fg="white", relief="flat", padx=14).pack(side="right")

    def _on_cancel(self):
        self.result = {"action": "cancel"}
        self.root.destroy()


def show_selection_dialog(clips, meta, title="ResolveLink", clip_type="video"):
    """Show clip selection dialog and return selected indices."""
    dialog = ClipSelectionDialog(clips, meta, title, clip_type)
    return dialog.show()


# ─────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────

import datetime

def log_info(msg, tag="ResolveLink"):
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [{tag}] {msg}")

def log_warn(msg, tag="ResolveLink"):
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [WARN][{tag}] {msg}")

def log_error(msg, tag="ResolveLink"):
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [ERROR][{tag}] {msg}")