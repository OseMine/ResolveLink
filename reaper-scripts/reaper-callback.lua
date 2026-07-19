-- @reapack ResolveLink Callback script
-- @version 1.0.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
-- @provides [lua] reaper-scripts/reaper-callback.lua
--
-- ResolveLink REAPER Callback Script
-- ===================================
-- Run from: Actions > Show action list > Load
-- Or assign to a toolbar button for easy access.
--
-- This script polls the ResolveLink server for pending jobs
-- and executes REAPER import scripts automatically.
-- Uses reaper.defer() to stay alive without blocking REAPER.

local SERVER_URL = "http://127.0.0.1:3030"
local POLL_INTERVAL = 2.0  -- seconds between polls
local running = true
local jobCount = 0

-- ── Logging ───────────────────────────────────────────────
local function log(msg)
    reaper.ShowConsoleMsg(msg .. "\n")
end

-- ── File reader ───────────────────────────────────────────
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

    local function advance()
        pos = pos + 1
    end

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
            else
                pos = pos + 1
            end
        end
        return str:sub(start)
    end

    local function parse_number()
        local start = pos
        if str:sub(pos, pos) == '-' then pos = pos + 1 end
        while pos <= #str and str:sub(pos, pos):match("[%d%.eE%+%-]") do
            pos = pos + 1
        end
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
        else return parse_number()
        end
    end

    function json_decode(s)
        str = s
        pos = 1
        return parse_val()
    end
end

-- ── HTTP helper (uses curl) ───────────────────────────────
local function http_get(url)
    local handle = io.popen('curl -sf "' .. url .. '" 2>&1')
    if not handle then return nil end
    local result = handle:read("*a")
    handle:close()
    return result:gsub("%s+$", "")
end

local function http_put(url, data)
    local body = data:gsub("'", "\\'")
    local handle = io.popen("curl -sf -X PUT \"" .. url .. "\" -H \"Content-Type: application/json\" -d '" .. body .. "' 2>&1")
    if not handle then return nil end
    local result = handle:read("*a")
    handle:close()
    return result:gsub("%s+$", "")
end

-- ── Import a REAPER project from a payload file ───────────
local function executeImport(payloadPath)
    local payloadStr = readFile(payloadPath)
    if not payloadStr then
        reaper.ShowMessageBox("Could not read payload:\n" .. payloadPath, "ResolveLink", 0)
        return false
    end

    local data = json_decode(payloadStr)
    if not data then
        reaper.ShowMessageBox("Invalid JSON payload", "ResolveLink", 0)
        return false
    end

    -- Create new project
    reaper.Main_OnCommand(40023, 0) -- File: New project

    -- Set project sample rate
    if data.sampleRate then
        reaper.SetCurrentBPM(0, data.sampleRate, false)
    end

    -- Insert media items on tracks
    for _, trackData in ipairs(data.tracks or {}) do
        local trackIdx = trackData.trackIndex - 1
        local track = reaper.GetTrack(0, trackIdx)

        -- Create tracks as needed
        if not track then
            local trackCount = reaper.CountTracks(0)
            while trackCount < trackData.trackIndex do
                reaper.InsertTrackAtIndex(trackCount, true)
                trackCount = reaper.CountTracks(0)
            end
            track = reaper.GetTrack(0, trackIdx)
        end

        if track then
            reaper.GetSetMediaTrackInfo_String(track, "P_NAME", trackData.name, true)

            for _, item in ipairs(trackData.items or {}) do
                local source = reaper.PCM_Source_Create(item.filePath)
                if source then
                    local newItem = reaper.CreateNewMediaItemOnProj(item.positionSeconds, item.durationSeconds, source)
                    if newItem then
                        reaper.SetMediaItem_Track(newItem, track)

                        local take = reaper.GetActiveTake(newItem)
                        if take then
                            if item.sourceOffsetSeconds then
                                reaper.SetMediaItemTakeInfo_Value(take, "D_STARTOFFS", item.sourceOffsetSeconds)
                            end
                            if item.volume then
                                reaper.SetMediaItemTakeInfo_Value(take, "D_VOL", item.volume)
                            end
                        end

                        if item.muted then
                            reaper.SetMediaItemInfo_Value(newItem, "B_MUTE", 1)
                        end

                        reaper.UpdateItemInProject(newItem)
                    end
                    reaper.PCM_Source_Destroy(source)
                end
            end
        end
    end

    -- Fit view
    reaper.Main_OnCommand(40295, 0) -- View: Zoom to selected items
    reaper.UpdateArrange()

    return true
end

-- ── Main polling loop ─────────────────────────────────────
local function poll()
    if not running then return end

    -- GET /api/jobs/pending
    local resp = http_get(SERVER_URL .. "/api/jobs/pending")
    if resp and resp ~= "" then
        local job = json_decode(resp)
        if job and job.jobId then
            log("ResolveLink: Got job: " .. (job.type or "unknown") .. " [" .. job.jobId .. "]")

            if job.type == "execute-reaper" and job.payloadPath then
                local ok = executeImport(job.payloadPath)

                if ok then
                    -- Report success
                    http_put(
                        SERVER_URL .. "/api/jobs/" .. job.jobId .. "/status",
                        '{"status":"completed","result":{"message":"Import complete"}}'
                    )
                    jobCount = jobCount + 1
                    reaper.ShowMessageBox(
                        "ResolveLink: Import complete!\nJob #" .. jobCount .. "\nProject: " .. (job.projectName or "unknown"),
                        "ResolveLink",
                        0
                    )
                else
                    http_put(
                        SERVER_URL .. "/api/jobs/" .. job.jobId .. "/status",
                        '{"status":"error","error":"Import failed"}'
                    )
                end
            else
                -- Unknown job type, skip
                http_put(
                    SERVER_URL .. "/api/jobs/" .. job.jobId .. "/status",
                    '{"status":"error","error":"Unknown job type: ' .. (job.type or "nil") .. '"}'
                )
            end
        end
    end

    reaper.defer(poll)
end

-- ── Start ─────────────────────────────────────────────────
reaper.ShowConsoleMsg("ResolveLink: Callback started. Polling " .. SERVER_URL .. " every " .. POLL_INTERVAL .. "s.\n")
reaper.ShowConsoleMsg("ResolveLink: Press the button again to stop.\n")

-- Toggle: if already running, stop it
if _G.resolveLinkRunning then
    _G.resolveLinkRunning = false
    running = false
    reaper.ShowConsoleMsg("ResolveLink: Callback stopped.\n")
    return
end

_G.resolveLinkRunning = true
poll()
