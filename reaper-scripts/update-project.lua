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

-- ── Minimal JSON decoder ──────────────────────────────────
local json_decode
do
    local pos = 1
    local str = ""
    local function skip_ws()
        pos = str:find("[^ \t\n\r]", pos) or (#str + 1)
    end
    local function peek()
        skip_ws()
        return str:sub(pos, pos)
    end
    local function advance() pos = pos + 1 end
    local parse_val

    local function parse_string()
        pos = pos + 1
        local start = pos
        while pos <= #str do
            local c = str:sub(pos, pos)
            if c == '\\' then pos = pos + 2
            elseif c == '"' then
                local s = str:sub(start, pos - 1)
                pos = pos + 1
                return s
            else pos = pos + 1 end
        end
        return str:sub(start)
    end

    local function parse_number()
        local start = pos
        if str:sub(pos, pos) == '-' then pos = pos + 1 end
        while pos <= #str and str:sub(pos, pos):match("[%d%.eE%+%-]") do pos = pos + 1 end
        return tonumber(str:sub(start, pos - 1))
    end

    local function parse_array()
        pos = pos + 1
        local arr = {}
        skip_ws()
        if peek() == ']' then pos = pos + 1; return arr end
        while true do
            arr[#arr + 1] = parse_val()
            skip_ws()
            if peek() == ',' then advance()
            elseif peek() == ']' then advance(); return arr
            else break end
        end
        return arr
    end

    local function parse_object()
        pos = pos + 1
        local obj = {}
        skip_ws()
        if peek() == '}' then pos = pos + 1; return obj end
        while true do
            skip_ws()
            local key = parse_string()
            skip_ws()
            advance() -- ':'
            obj[key] = parse_val()
            skip_ws()
            if peek() == ',' then advance()
            elseif peek() == '}' then advance(); return obj
            else break end
        end
        return obj
    end

    parse_val = function()
        skip_ws()
        local c = peek()
        if c == '"' then return parse_string()
        elseif c == '{' then return parse_object()
        elseif c == '[' then return parse_array()
        elseif c == 't' then pos = pos + 4; return true
        elseif c == 'f' then pos = pos + 5; return false
        elseif c == 'n' then pos = pos + 4; return nil
        else return parse_number() end
    end

    function json_decode(s)
        str = s
        pos = 1
        return parse_val()
    end
end

-- ── HTTP via curl ──────────────────────────────────────────
local function httpGet(url)
    local tmpFile = os.tmpname() .. ".json"
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
    local source = reaper.GetMediaItemTake_Source(take)
    if not source then return nil end
    local _, filename = reaper.GetMediaSourceFileName(source, "")
    if filename == "" then return nil end
    return filename
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
    local davinciClips = {}
    for trackKey, items in pairs(timeline.tracks or {}) do
        if trackKey:match("^video_") then
            for _, item in ipairs(items) do
                local sourceFile = normalizePath(item.mediaPoolItem or item.name)
                if sourceFile then
                    davinciClips[sourceFile] = {
                        name = item.name,
                        start = item.start or 0,
                        duration = item.duration or 0,
                        sourceFile = sourceFile,
                        trackKey = trackKey,
                    }
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

    for trackIdx = 0, totalTracks - 1 do
        local track = reaper.GetTrack(0, trackIdx)
        local itemCount = reaper.CountTrackMediaItems(track)

        for itemIdx = 0, itemCount - 1 do
            local item = reaper.GetTrackMediaItem(track, itemIdx)
            local sourceFile = getItemSourceFile(item)

            if sourceFile then
                local norm = normalizePath(sourceFile)
                local davinciClip = davinciClips[norm]

                if davinciClip then
                    matched = matched + 1

                    local oldPos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
                    local oldLen = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")

                    local newPos = davinciClip.start / fps
                    local newLen = davinciClip.duration / fps

                    local posChanged = math.abs(oldPos - newPos) > 0.001
                    local lenChanged = math.abs(oldLen - newLen) > 0.001

                    if posChanged or lenChanged then
                        reaper.SetMediaItemInfo_Value(item, "D_POSITION", newPos)
                        reaper.SetMediaItemInfo_Value(item, "D_LENGTH", newLen)
                        reaper.UpdateItemInProject(item)
                        updated = updated + 1
                        log("Updated: " .. norm .. " pos=" .. string.format("%.2f", newPos) .. " len=" .. string.format("%.2f", newLen))
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
