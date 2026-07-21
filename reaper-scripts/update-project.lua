-- @reapack ResolveLink Update Project
-- @version 1.0.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
--
-- ResolveLink - Update REAPER Project from DaVinci Timeline
-- ==========================================================
-- Syncs REAPER items to match current DaVinci Resolve timeline.
-- When video cuts change in DaVinci, press this to update
-- REAPER item positions/durations to match. Your REAPER
-- effects, volume, and pan settings are preserved.
--
-- Usage: Workspace > Scripts > ResolveLink > Update Project
-- Or assign to a toolbar button.

local SERVER_URL = "http://127.0.0.1:3030"
local TEMP_DIR = ""

-- Query server for actual paths on startup
local function fetchConfig()
    local handle = io.popen('curl -sf "' .. SERVER_URL .. '/api/config" 2>NUL')
    if handle then
        local raw = handle:read("*a")
        handle:close()
        if raw and raw ~= "" then
            local temp = raw:match('"tempDir"%s*:%s*"([^"]*)"')
            if temp then TEMP_DIR = temp:gsub("\\", "/") end
        end
    end
end
fetchConfig()

-- ── Helpers ────────────────────────────────────────────────
local function log(msg)
    reaper.ShowConsoleMsg("[ResolveLink] " .. os.date("%H:%M:%S") .. "  " .. msg .. "\n")
end

local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local content = f:read("*a")
    f:close()
    return content
end

-- ── JSON decoder (shared module) ──────────────────────────
local scriptDir = debug.getinfo(1, "S").source:match("@?(.*/)")
local json_decode = dofile(scriptDir .. "json.lua").decode

-- ── HTTP via curl ──────────────────────────────────────────
local function httpGet(url)
    local tmpFile = TEMP_DIR .. "/_update_project_result.json"
    local curlCmd = 'curl -sf "' .. url .. '" -o "' .. tmpFile .. '" 2>&1'
    local handle = io.popen(curlCmd)
    if not handle then os.remove(tmpFile); return nil end
    local result = handle:read("*a")
    handle:close()
    local f = io.open(tmpFile, "r")
    if not f then return nil end
    local json = f:read("*a")
    f:close()
    os.remove(tmpFile)
    return json
end

-- ── Normalize file path for matching ──────────────────────
-- "C:/Users/Oskar/Downloads/clip.mp4" -> "clip.mp4"
-- "C:\\Users\\Oskar\\Downloads\\clip.mp4" -> "clip.mp4"
local function normalizePath(p)
    if not p then return nil end
    p = p:gsub("\\", "/")
    local name = p:match("([^/]+)$")
    return name and name:lower() or nil
end

-- ── Get source file from REAPER item ──────────────────────
local function getItemSourceFile(item)
    local take = reaper.GetActiveTake(item)
    if not take then return nil end

    -- Try GetMediaSourceFileName first
    local source = reaper.GetMediaItemTake_Source(take)
    if source then
        local _, filename = reaper.GetMediaSourceFileName(source, "")
        if filename and filename ~= "" then return filename end
    end

    -- Fallback: use take name (usually the filename)
    local _, takeName = reaper.GetSetMediaItemTakeInfo_String(take, "P_NAME", "", false)
    if takeName and takeName ~= "" then return takeName end

    return nil
end

-- ── Main ───────────────────────────────────────────────────
local function main()
    log("Fetching DaVinci timeline...")

    local json = httpGet(SERVER_URL .. "/api/resolve/timeline")
    if not json then
        log("ERROR: Could not reach ResolveLink server")
        reaper.ShowMessageBox("Could not reach ResolveLink server.\nMake sure the server is running.", "ResolveLink", 0)
        return
    end

    local timeline = json_decode(json)
    if not timeline or timeline.error then
        log("ERROR: " .. (timeline and timeline.error or "Invalid response"))
        reaper.ShowMessageBox("Error: " .. (timeline and timeline.error or "Invalid response"), "ResolveLink", 0)
        return
    end

    local fps = tonumber(timeline.frameRate) or 24
    log("Timeline: " .. (timeline.name or "unknown") .. " @ " .. fps .. "fps")

    -- Collect all video clips from DaVinci timeline
    -- Key by "trackIdx:filename" for disambiguation when same filename on different tracks
    local davinciClips = {}
    for trackKey, items in pairs(timeline.tracks or {}) do
        if trackKey:match("^video_") then
            local trackNum = tonumber(trackKey:match("video_(%d+)")) or 1
            for _, item in ipairs(items) do
                local sourceFile = normalizePath(item.mediaPoolItem or item.name)
                if sourceFile then
                    local key = trackNum .. ":" .. sourceFile
                    davinciClips[key] = {
                        name = item.name,
                        start = item.start or 0,
                        duration = item.duration or 0,
                        sourceFile = sourceFile,
                        trackKey = trackKey,
                    }
                    -- Also store basename-only for fallback (last one wins, same as before)
                    davinciClips[sourceFile] = davinciClips[key]
                end
            end
        end
    end

    local clipCount = 0
    for _ in pairs(davinciClips) do clipCount = clipCount + 1 end
    log("Found " .. clipCount .. " video clip(s) in DaVinci timeline")

    if clipCount == 0 then
        reaper.ShowMessageBox("No video clips found in DaVinci timeline.", "ResolveLink", 0)
        return
    end

    -- Scan all REAPER items and match by source file
    local updated = 0
    local matched = 0
    local unmatched = 0
    local totalTracks = reaper.CountTracks(0)
    log("REAPER tracks: " .. totalTracks)

    for trackIdx = 0, totalTracks - 1 do
        local track = reaper.GetTrack(0, trackIdx)
        local itemCount = reaper.CountTrackMediaItems(track)
        log("Track " .. (trackIdx + 1) .. ": " .. itemCount .. " item(s)")

        for itemIdx = 0, itemCount - 1 do
            local item = reaper.GetTrackMediaItem(track, itemIdx)
            local sourceFile = getItemSourceFile(item)
            log("  Item " .. (itemIdx + 1) .. " source: " .. (sourceFile or "nil"))

            if sourceFile then
                local norm = normalizePath(sourceFile)
                -- Try track-aware match first, then basename fallback
                local reaperTrackNum = trackIdx + 1
                local davinciClip = davinciClips[reaperTrackNum .. ":" .. norm] or davinciClips[norm]

                if davinciClip then
                    matched = matched + 1

                    local oldPos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
                    local oldLen = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")

                    local newPos = davinciClip.start / fps
                    local newLen = davinciClip.duration / fps

                    -- Determine target track from video track number
                    local videoTrackNum = tonumber(davinciClip.trackKey:match("video_(%d+)")) or 1
                    local targetTrack = reaper.GetTrack(0, videoTrackNum - 1)
                    local currentTrack = reaper.GetMediaItem_Track(item)
                    local trackChanged = targetTrack and currentTrack ~= targetTrack

                    -- Ensure target track exists
                    if not targetTrack then
                        local trackCount = reaper.CountTracks(0)
                        while trackCount < videoTrackNum do
                            reaper.InsertTrackAtIndex(trackCount, true)
                            trackCount = reaper.CountTracks(0)
                        end
                        targetTrack = reaper.GetTrack(0, videoTrackNum - 1)
                    end

                    local posChanged = math.abs(oldPos - newPos) > 0.001
                    local lenChanged = math.abs(oldLen - newLen) > 0.001

                    if posChanged or lenChanged or trackChanged then
                        if trackChanged and targetTrack then
                            reaper.MoveMediaItemToTrack(item, targetTrack, false)
                        end
                        reaper.SetMediaItemInfo_Value(item, "D_POSITION", newPos)
                        reaper.SetMediaItemInfo_Value(item, "D_LENGTH", newLen)
                        reaper.UpdateItemInProject(item)
                        updated = updated + 1
                        local changes = {}
                        if trackChanged then changes[#changes+1] = "track=" .. videoTrackNum end
                        if posChanged then changes[#changes+1] = "pos=" .. string.format("%.2f", newPos) end
                        if lenChanged then changes[#changes+1] = "len=" .. string.format("%.2f", newLen) end
                        log("Updated: " .. norm .. " (" .. table.concat(changes, ", ") .. ")")
                    end
                else
                    unmatched = unmatched + 1
                end
            end
        end
    end

    reaper.UpdateArrange()

    local msg = string.format(
        "Update complete!\n\n"
        .. "Matched: %d clip(s)\n"
        .. "Updated: %d clip(s) (position/length changed)\n"
        .. "Unmatched: %d clip(s) (no DaVinci match)\n\n"
        .. "Your REAPER effects, volume, and pan are preserved.",
        matched, updated, unmatched)

    log(msg)
    reaper.ShowMessageBox(msg, "ResolveLink", 0)
end

main()
