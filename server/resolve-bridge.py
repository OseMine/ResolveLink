#!/usr/bin/env python3
"""
ResolveLink - DaVinci Resolve Scripting Bridge
Connects to a running DaVinci Resolve instance and exposes project,
timeline, and selection data as JSON via stdout.

Usage:
    python resolve_bridge.py status
    python resolve_bridge.py project
    python resolve_bridge.py timeline
    python resolve_bridge.py selection
    python resolve_bridge.py selection --track 1
    python resolve_bridge.py clip-properties <clip_path>

Requires DaVinci Resolve Studio 18+ running with Scripting API enabled.
"""

import sys
import os
import json
import platform


# ---------------------------------------------------------------------------
# Resolve module loader - finds fusionscript from the Resolve install
# ---------------------------------------------------------------------------

def get_resolve_module():
    """Locate and import the DaVinciResolveScript module."""
    resolve_module = None
    errors = []

    # Attempt 1: Already in sys.path (Resolve adds this when running via its own Python)
    try:
        import DaVinciResolveScript as dvr
        return dvr.scriptapp("Resolve")
    except ImportError:
        pass

    # Attempt 2: Standard install locations
    search_paths = []

    if platform.system() == "Windows":
        program_files = os.environ.get("ProgramFiles", "C:\\Program Files")
        program_data = os.environ.get("ProgramData", "C:\\ProgramData")
        base_dirs = [program_files, program_data]
        for base in base_dirs:
            for year in ["2025", "2024", "2023", "2022"]:
                search_paths.append(
                    os.path.join(base, "Blackmagic Design", "DaVinci Resolve", f"Support Modules {year}")
                )
                search_paths.append(
                    os.path.join(base, "Blackmagic Design", "DaVinci Resolve", "Support Modules")
                )
                # Studio-specific paths
                search_paths.append(
                    os.path.join(base, "Blackmagic Design", "DaVinci Resolve Studio", f"Support Modules {year}")
                )
                search_paths.append(
                    os.path.join(base, "Blackmagic Design", "DaVinci Resolve Studio", "Support Modules")
                )
            # Actual scriptable modules path (Support\Developer\Scripting\Modules)
            search_paths.append(
                os.path.join(base, "Blackmagic Design", "DaVinci Resolve", "Support", "Developer", "Scripting", "Modules")
            )
            search_paths.append(
                os.path.join(base, "Blackmagic Design", "DaVinci Resolve Studio", "Support", "Developer", "Scripting", "Modules")
            )
    elif platform.system() == "Darwin":
        for year in ["2025", "2024", "2023", "2022"]:
            search_paths.append(
                f"/Applications/Blackmagic Design/DaVinci Resolve/DaVinci Resolve.app/Contents/Resources/Developer/Scripting/Modules"
            )
            search_paths.append(
                f"/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules"
            )
        # Home directory paths
        home = os.path.expanduser("~")
        search_paths.append(
            os.path.join(home, "Library", "Application Support", "Blackmagic Design", "DaVinci Resolve", "Developer", "Scripting", "Modules")
        )

    for sp in search_paths:
        if os.path.isdir(sp) and sp not in sys.path:
            sys.path.insert(0, sp)
            try:
                import DaVinciResolveScript as dvr
                resolve = dvr.scriptapp("Resolve")
                if resolve is not None:
                    return resolve
            except ImportError as e:
                errors.append(f"{sp}: {e}")
            except Exception as e:
                errors.append(f"{sp}: connection failed - {e}")

    # Attempt 3: Environment variable override
    env_path = os.environ.get("RESAE_RESOLVE_MODULES_PATH")
    if env_path and os.path.isdir(env_path):
        sys.path.insert(0, env_path)
        try:
            import DaVinciResolveScript as dvr
            resolve = dvr.scriptapp("Resolve")
            if resolve is not None:
                return resolve
        except ImportError as e:
            errors.append(f"ENV path: {e}")

    # If we get here, Resolve is not running or not reachable
    return None


# ---------------------------------------------------------------------------
# API functions - each returns a dict
# ---------------------------------------------------------------------------

def cmd_status(resolve):
    """Check if Resolve is running and reachable."""
    if resolve is None:
        return {"connected": False, "error": "DaVinci Resolve not running or Scripting API not enabled"}

    try:
        version = resolve.GetVersion()
        return {
            "connected": True,
            "version": version,
            "product": "DaVinci Resolve",
        }
    except Exception as e:
        return {"connected": False, "error": str(e)}


def cmd_project(resolve):
    """Get current project information."""
    if resolve is None:
        return {"connected": False, "error": "DaVinci Resolve not running"}

    try:
        pm = resolve.GetProjectManager()
        if pm is None:
            return {"error": "Project manager unavailable"}

        project = pm.GetCurrentProject()
        if project is None:
            return {"error": "No project open"}

        name = project.GetName()
        fps = project.GetSetting("timelineFrameRate")
        w = project.GetSetting("timelineResolutionWidth")
        h = project.GetSetting("timelineResolutionHeight")
        cs = project.GetSetting("colorSpaceTimeline")

        tc = 0
        try:
            folders = project.GetTimelinesInCurrentFolder()
            if folders:
                tc = len(folders)
        except Exception:
            pass

        return {
            "name": name,
            "frameRate": fps,
            "resolution": {
                "width": int(w or 1920),
                "height": int(h or 1080),
            },
            "colorSpace": cs,
            "timelineCount": tc,
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_timeline(resolve):
    """Get current timeline information."""
    if resolve is None:
        return {"connected": False, "error": "DaVinci Resolve not running"}

    try:
        pm = resolve.GetProjectManager()
        if pm is None:
            return {"error": "Project manager unavailable"}

        project = pm.GetCurrentProject()
        if project is None:
            return {"error": "No project open"}

        timeline = project.GetCurrentTimeline()
        if timeline is None:
            return {"error": "No timeline open"}

        track_count_v = timeline.GetTrackCount("video")
        track_count_a = timeline.GetTrackCount("audio")

        tracks = {}
        for track_idx in range(1, track_count_v + 1):
            items = timeline.GetItemListInTrack("video", track_idx)
            if items:
                tracks[f"video_{track_idx}"] = [
                    {
                        "name": item.GetName(),
                        "start": item.GetStart(),
                        "end": item.GetEnd(),
                        "duration": item.GetDuration(),
                        "sourceStart": item.GetLeftOffset(),
                        "sourceEnd": item.GetRightOffset(),
                        "mediaPoolItem": item.GetMediaPoolItem().GetClipProperty("File Path") if item.GetMediaPoolItem() else None,
                    }
                    for item in items
                ]

        return {
            "name": timeline.GetName(),
            "frameRate": project.GetSetting("timelineFrameRate"),
            "resolution": {
                "width": int(project.GetSetting("timelineResolutionWidth") or 1920),
                "height": int(project.GetSetting("timelineResolutionHeight") or 1080),
            },
            "videoTrackCount": track_count_v,
            "audioTrackCount": track_count_a,
            "currentTimecode": timeline.GetCurrentTimecode(),
            "tracks": tracks,
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_selection(resolve, track=None):
    """Get selected clips from the current timeline.

    Since the Resolve Scripting API does not expose a direct
    'GetSelectedClips' method in all versions, we read all clips from
    specified tracks and return them. The frontend can filter further.
    """
    if resolve is None:
        return {"connected": False, "error": "DaVinci Resolve not running", "clips": [], "clipCount": 0}

    try:
        pm = resolve.GetProjectManager()
        if pm is None:
            return {"error": "Project manager unavailable", "clips": [], "clipCount": 0}

        project = pm.GetCurrentProject()
        if project is None:
            return {"error": "No project open", "clips": [], "clipCount": 0}

        timeline = project.GetCurrentTimeline()
        if timeline is None:
            return {"error": "No timeline open", "clips": [], "clipCount": 0}

        track_count = timeline.GetTrackCount("video")
        selected_clips = []

        target_tracks = [int(track)] if track else range(1, track_count + 1)

        fps = float(project.GetSetting("timelineFrameRate") or 24)
        width = int(project.GetSetting("timelineResolutionWidth") or 1920)
        height = int(project.GetSetting("timelineResolutionHeight") or 1080)

        for track_idx in target_tracks:
            if track_idx > track_count:
                continue

            items = timeline.GetItemListInTrack("video", track_idx)
            if not items:
                continue

            for item in items:
                mpi = item.GetMediaPoolItem()
                if mpi is None:
                    continue

                clip_props = mpi.GetClipProperty()
                source_path = clip_props.get("File Path", "") if clip_props else ""

                source_start = item.GetLeftOffset() or 0
                source_end = item.GetRightOffset() or 0
                duration = item.GetDuration() or 0

                item_start = item.GetStart() or 0
                item_end = item.GetEnd() or 0

                selected_clips.append({
                    "name": item.GetName(),
                    "start": item_start,
                    "end": item_end,
                    "duration": duration,
                    "sourceIn": source_start,
                    "sourceOut": source_end if source_end > 0 else source_start + duration,
                    "sourcePath": source_path,
                    "trackIndex": track_idx,
                    "mediaType": clip_props.get("Type", "") if clip_props else "",
                    "fps": fps,
                    "resolution": {
                        "width": int(clip_props.get("Resolution Width", width) or width) if clip_props else width,
                        "height": int(clip_props.get("Resolution Height", height) or height) if clip_props else height,
                    },
                })

        return {
            "timeline": timeline.GetName(),
            "fps": fps,
            "width": width,
            "height": height,
            "clips": selected_clips,
            "clipCount": len(selected_clips),
        }
    except Exception as e:
        return {"error": str(e), "clips": [], "clipCount": 0}


def cmd_clip_properties(resolve, clip_path=None):
    """Get properties of a specific clip in the media pool."""
    if resolve is None:
        return {"connected": False, "error": "DaVinci Resolve not running"}

    try:
        pm = resolve.GetProjectManager()
        if pm is None:
            return {"error": "Project manager unavailable"}

        project = pm.GetCurrentProject()
        if project is None:
            return {"error": "No project open"}

        media_pool = project.GetMediaPool()
        if media_pool is None:
            return {"error": "No media pool"}

        root_bin = media_pool.GetRootFolder()

        def search_bin(bin_item, path):
            clips = bin_item.GetClipList()
            if clips:
                for clip in clips:
                    props = clip.GetClipProperty()
                    if props and props.get("File Path", "") == path:
                        return {
                            "name": clip.GetName(),
                            "properties": props,
                        }

            sub_bins = bin_item.GetSubFolderList()
            if sub_bins:
                for sub in sub_bins:
                    result = search_bin(sub, path)
                    if result:
                        return result
            return None

        if clip_path:
            result = search_bin(root_bin, clip_path)
            if result:
                return result

        return {"error": "Clip not found"}
    except Exception as e:
        return {"error": str(e)}


def cmd_import_rendered(resolve, args=None):
    """Import rendered file into the AE Timeline (Render & Replace).

    Flow:
      1. Import rendered file into 'AE Renders' bin
      2. Find the AE_Timeline in 'AE Timelines' bin and switch to it
      3. Find earliest clip start across all tracks
      4. Add new video + audio tracks on top
      5. Place rendered clip on those tracks at the correct position
      6. Disable all original clips below
      7. Switch back to the original timeline

    Usage: python resolve-bridge.py import-rendered <rendered_file>
    """
    if resolve is None:
        return {"connected": False, "error": "DaVinci Resolve not running"}

    if not args or len(args) < 1:
        return {"error": "Usage: import-rendered <rendered_file>"}

    rendered_file = args[0]

    if not os.path.isfile(rendered_file):
        return {"error": f"File not found: {rendered_file}"}

    try:
        pm = resolve.GetProjectManager()
        if pm is None:
            return {"error": "Project manager unavailable"}

        project = pm.GetCurrentProject()
        if project is None:
            return {"error": "No project open"}

        master_timeline = project.GetCurrentTimeline()
        if master_timeline is None:
            return {"error": "No timeline open"}

        media_pool = project.GetMediaPool()
        if media_pool is None:
            return {"error": "No media pool"}

        # Step 1: Create/find 'AE Renders' folder in media pool
        root_bin = media_pool.GetRootFolder()
        render_folder = None
        for folder in (root_bin.GetSubFolderList() or []):
            if folder.GetName() == "AE Renders":
                render_folder = folder
                break
        if render_folder is None:
            render_folder = media_pool.AddSubFolder(root_bin, "AE Renders")

        # Step 2: Import rendered file into the AE Renders folder
        # Normalize path for Resolve (forward slashes)
        render_path = rendered_file.replace("\\", "/")
        previous_folder = media_pool.GetCurrentFolder()
        media_pool.SetCurrentFolder(render_folder)
        imported = media_pool.ImportMedia([render_path])
        media_pool.SetCurrentFolder(previous_folder)

        if not imported or len(imported) == 0:
            # Retry: try importing directly without folder switch
            imported2 = media_pool.ImportMedia([render_path])
            if not imported2 or len(imported2) == 0:
                return {"error": f"Failed to import '{render_path}' into media pool"}
            imported = imported2

        rendered_mpi = imported[0]

        # Step 3: Find the AE_Timeline by name
        master_name = master_timeline.GetName()
        ae_timeline_obj = None

        # Search by timeline index (most reliable)
        tl_count = project.GetTimelineCount()
        for i in range(1, tl_count + 1):
            tl = project.GetTimelineByIndex(i)
            if tl is None:
                continue
            tl_name = tl.GetName()
            if tl_name.startswith("AE_") and tl_name != master_name:
                ae_timeline_obj = tl

        if ae_timeline_obj is None:
            return {"error": "No AE_Timeline found"}

        # Switch to the AE timeline
        project.SetCurrentTimeline(ae_timeline_obj)

        # Step 4: Find earliest clip start and duration across all tracks
        earliest_start = None
        latest_end = None
        for track_type in ["video", "audio"]:
            for t in range(1, ae_timeline_obj.GetTrackCount(track_type) + 1):
                items = ae_timeline_obj.GetItemListInTrack(track_type, t) or []
                for item in items:
                    s = item.GetStart()
                    e = s + item.GetDuration()
                    if earliest_start is None or s < earliest_start:
                        earliest_start = s
                    if latest_end is None or e > latest_end:
                        latest_end = e

        if earliest_start is None:
            project.SetCurrentTimeline(master_timeline)
            return {"error": "No clips found on AE timeline"}

        total_duration = latest_end - earliest_start

        # Step 5: Disable ALL original clips on ALL tracks in the AE timeline
        disabled_count = 0
        for track_type in ["video", "audio"]:
            for t in range(1, ae_timeline_obj.GetTrackCount(track_type) + 1):
                items = ae_timeline_obj.GetItemListInTrack(track_type, t) or []
                for item in items:
                    try:
                        item.SetClipEnabled(False)
                        disabled_count += 1
                    except Exception:
                        pass

        # Step 6: Add new video + audio tracks on top
        new_video_track = ae_timeline_obj.GetTrackCount("video") + 1
        new_audio_track = ae_timeline_obj.GetTrackCount("audio") + 1
        ae_timeline_obj.AddTrack("video")
        ae_timeline_obj.AddTrack("audio")

        # Step 7: Place rendered clip on the new top tracks
        append_result = media_pool.AppendToTimeline([{
            "mediaPoolItem": rendered_mpi,
            "startFrame": 0,
            "endFrame": total_duration,
            "trackIndex": new_video_track,
            "recordFrame": earliest_start,
            "mediaType": 1,
        }, {
            "mediaPoolItem": rendered_mpi,
            "startFrame": 0,
            "endFrame": total_duration,
            "trackIndex": new_audio_track,
            "recordFrame": earliest_start,
            "mediaType": 2,
        }])

        if not append_result:
            project.SetCurrentTimeline(master_timeline)
            return {"error": "Failed to place rendered clip on timeline"}

        # Step 8: Switch back to master timeline
        project.SetCurrentTimeline(master_timeline)

        return {
            "status": "success",
            "renderedFile": rendered_file,
            "disabledClips": disabled_count,
            "newVideoTrack": new_video_track,
            "newAudioTrack": new_audio_track,
            "startFrame": earliest_start,
        }

    except Exception as e:
        return {"error": str(e)}


def cmd_timeline_at(resolve, name=None):
    """Get timeline info by name (for batch export)."""
    if resolve is None:
        return {"connected": False, "error": "DaVinci Resolve not running"}
    if not name:
        return {"error": "Usage: timeline-at <name>"}

    try:
        pm = resolve.GetProjectManager()
        project = pm.GetCurrentProject()
        if project is None:
            return {"error": "No project open"}

        tl = None
        for i in range(1, project.GetTimelineCount() + 1):
            t = project.GetTimelineByIndex(i)
            if t and t.GetName() == name:
                tl = t
                break

        if tl is None:
            return {"error": f"Timeline '{name}' not found"}

        prev = project.GetCurrentTimeline()
        project.SetCurrentTimeline(tl)

        track_count_v = tl.GetTrackCount("video")
        tracks = {}
        for track_idx in range(1, track_count_v + 1):
            items = tl.GetItemListInTrack("video", track_idx)
            if items:
                tracks[f"video_{track_idx}"] = [
                    {
                        "name": item.GetName(),
                        "start": item.GetStart(),
                        "end": item.GetEnd(),
                        "duration": item.GetDuration(),
                        "sourceStart": item.GetLeftOffset(),
                        "sourceEnd": item.GetRightOffset(),
                        "mediaPoolItem": item.GetMediaPoolItem().GetClipProperty("File Path") if item.GetMediaPoolItem() else None,
                    }
                    for item in items
                ]

        result = {
            "name": tl.GetName(),
            "frameRate": project.GetSetting("timelineFrameRate"),
            "resolution": {
                "width": int(project.GetSetting("timelineResolutionWidth") or 1920),
                "height": int(project.GetSetting("timelineResolutionHeight") or 1080),
            },
            "videoTrackCount": track_count_v,
            "audioTrackCount": tl.GetTrackCount("audio"),
            "tracks": tracks,
        }

        project.SetCurrentTimeline(prev)
        return result
    except Exception as e:
        return {"error": str(e)}


def cmd_markers(resolve):
    """Get timeline markers for transfer to AE."""
    if resolve is None:
        return {"connected": False, "error": "DaVinci Resolve not running"}

    try:
        pm = resolve.GetProjectManager()
        project = pm.GetCurrentProject()
        if project is None:
            return {"error": "No project open"}

        timeline = project.GetCurrentTimeline()
        if timeline is None:
            return {"error": "No timeline open"}

        fps = float(project.GetSetting("timelineFrameRate") or 24)

        markers = []
        # Clip-level markers
        for track_type in ["video", "audio"]:
            for t in range(1, timeline.GetTrackCount(track_type) + 1):
                items = timeline.GetItemListInTrack(track_type, t) or []
                for item in items:
                    item_markers = item.GetMarkers() or {}
                    for frame, marker_data in item_markers.items():
                        markers.append({
                            "frame": frame,
                            "name": marker_data.get("name", ""),
                            "note": marker_data.get("note", ""),
                            "color": marker_data.get("color", "Blue"),
                            "duration": marker_data.get("duration", 0),
                            "trackType": track_type,
                            "trackIndex": t,
                            "clipName": item.GetName(),
                            "startTimecode": _frames_to_tc(frame, fps),
                        })

        # Timeline-level markers
        tl_markers = timeline.GetMarkers() or {}
        for frame, marker_data in tl_markers.items():
            markers.append({
                "frame": frame,
                "name": marker_data.get("name", ""),
                "note": marker_data.get("note", ""),
                "color": marker_data.get("color", "Blue"),
                "duration": marker_data.get("duration", 0),
                "trackType": "timeline",
                "trackIndex": 0,
                "clipName": None,
                "startTimecode": _frames_to_tc(frame, fps),
            })

        return {
            "timeline": timeline.GetName(),
            "fps": fps,
            "markers": sorted(markers, key=lambda m: m["frame"]),
            "count": len(markers),
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_import_audio(resolve, args=None):
    """Import rendered audio from REAPER into DaVinci Resolve Media Pool and timeline.

    Flow:
      1. Import audio file into 'REAPER Renders' bin
      2. Add new audio track to current timeline
      3. Append audio clip to the new track

    Usage: python resolve-bridge.py import-audio <audio_file> [track_name] [position_frames]
    """
    if resolve is None:
        return {"connected": False, "error": "DaVinci Resolve not running"}

    if not args or len(args) < 1:
        return {"error": "Usage: import-audio <audio_file> [track_name] [position_frames]"}

    audio_file = args[0]
    track_name = args[1] if len(args) > 1 else "REAPER Audio"
    position_frames = int(args[2]) if len(args) > 2 else None

    if not os.path.isfile(audio_file):
        return {"error": f"File not found: {audio_file}"}

    try:
        pm = resolve.GetProjectManager()
        if pm is None:
            return {"error": "Project manager unavailable"}

        project = pm.GetCurrentProject()
        if project is None:
            return {"error": "No project open"}

        timeline = project.GetCurrentTimeline()
        if timeline is None:
            return {"error": "No timeline open"}

        media_pool = project.GetMediaPool()
        if media_pool is None:
            return {"error": "No media pool"}

        # Step 1: Create/find 'REAPER Renders' folder in media pool
        root_bin = media_pool.GetRootFolder()
        render_folder = None
        for folder in (root_bin.GetSubFolderList() or []):
            if folder.GetName() == "REAPER Renders":
                render_folder = folder
                break
        if render_folder is None:
            render_folder = media_pool.AddSubFolder(root_bin, "REAPER Renders")

        # Step 2: Import audio file
        audio_path = audio_file.replace("\\", "/")
        previous_folder = media_pool.GetCurrentFolder()
        media_pool.SetCurrentFolder(render_folder)
        imported = media_pool.ImportMedia([audio_path])
        media_pool.SetCurrentFolder(previous_folder)

        if not imported or len(imported) == 0:
            imported2 = media_pool.ImportMedia([audio_path])
            if not imported2 or len(imported2) == 0:
                return {"error": f"Failed to import '{audio_path}' into media pool"}
            imported = imported2

        audio_mpi = imported[0]

        # Step 3: Add new audio track
        new_audio_track = timeline.GetTrackCount("audio") + 1
        timeline.AddTrack("audio")

        # Step 4: Determine position
        if position_frames is None:
            position_frames = 0

        # Step 5: Append audio to timeline
        append_result = media_pool.AppendToTimeline([{
            "mediaPoolItem": audio_mpi,
            "startFrame": 0,
            "trackIndex": new_audio_track,
            "recordFrame": position_frames,
            "mediaType": 2,
        }])

        if not append_result:
            return {"error": "Failed to append audio to timeline"}

        # Get the item info for response
        items = timeline.GetItemListInTrack("audio", new_audio_track) or []
        item_info = None
        if items:
            last_item = items[-1]
            item_info = {
                "name": last_item.GetName(),
                "start": last_item.GetStart(),
                "duration": last_item.GetDuration(),
            }

        return {
            "success": True,
            "trackIndex": new_audio_track,
            "trackName": track_name,
            "item": item_info,
            "file": audio_path,
        }
    except Exception as e:
        return {"error": str(e)}


def _frames_to_tc(frames, fps):
    """Convert frame number to timecode string HH:MM:SS:FF."""
    total_seconds = frames / fps
    hours = int(total_seconds // 3600)
    minutes = int((total_seconds % 3600) // 60)
    seconds = int(total_seconds % 60)
    frame = int(frames % round(fps))
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}:{frame:02d}"


# ---------------------------------------------------------------------------
# Main dispatcher
# ---------------------------------------------------------------------------

COMMANDS = {
    "status": cmd_status,
    "project": cmd_project,
    "timeline": cmd_timeline,
    "selection": cmd_selection,
    "clip-properties": cmd_clip_properties,
    "create-compound": cmd_import_rendered,
    "import-rendered": cmd_import_rendered,
    "import-audio": cmd_import_audio,
    "timeline-at": cmd_timeline_at,
    "markers": cmd_markers,
}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command specified. Usage: resolve_bridge.py <command>"}))
        sys.exit(1)

    command = sys.argv[1].lower()

    if command not in COMMANDS:
        print(json.dumps({"error": f"Unknown command: {command}. Available: {', '.join(COMMANDS.keys())}"}))
        sys.exit(1)

    resolve = get_resolve_module()

    try:
        if command in ("create-compound", "import-rendered"):
            result = cmd_import_rendered(resolve, sys.argv[2:])
        elif command == "import-audio":
            result = cmd_import_audio(resolve, sys.argv[2:])
        elif command == "timeline-at":
            result = cmd_timeline_at(resolve, sys.argv[2] if len(sys.argv) > 2 else None)
        else:
            result = COMMANDS[command](resolve, *sys.argv[2:])
    except Exception as e:
        result = {"error": str(e)}

    print(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
