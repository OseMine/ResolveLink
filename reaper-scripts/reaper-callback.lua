-- @reapack ResolveLink Callback script
-- @version 1.1.0
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
--
-- REQUIRES: ReaImGui (install via ReaPack: "ReaImGui: ReaScript
-- binding for Dear ImGui") for the status window.
-- STRONGLY RECOMMENDED: js_ReaScriptAPI (via ReaPack) so HTTP
-- calls never fall back to spawning curl/console windows.

local SERVER_URL = "http://127.0.0.1:3030"
local POLL_INTERVAL = 2.0  -- seconds between polls
local running = true
local jobCount = 0
local lastPollTime = 0
local lastStatus = "idle"
local logLines = {}
local MAX_LOG_LINES = 200

-- ── Logging (now goes to the UI log panel instead of the console) ──
local function log(msg)
    local line = os.date("%H:%M:%S") .. "  " .. msg
    table.insert(logLines, line)
    while #logLines > MAX_LOG_LINES do
        table.remove(logLines, 1)
    end
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

-- ── HTTP helpers ─────────────────────────────────────────
-- Tries SWS (SNM_CreateFastHTTPRequest) or js_ReaScriptAPI (JS_HTTP_Get)
-- first to avoid io.popen which spawns visible console windows on Windows
-- AND blocks REAPER's main thread while curl runs.
local use_sws = (reaper.SNM_CreateFastHTTPRequest ~= nil)
local use_jsapi = (reaper.JS_HTTP_Get ~= nil)

local function http_get(url)
    if use_jsapi then
        local ok, content = reaper.JS_HTTP_Get(url)
        if ok and content then return content end
    end
    if use_sws then
        local fs = reaper.SNM_CreateFastHTTPRequest(url, 0)
        if fs then
            local content = reaper.SNM_GetFastString(fs)
            reaper.SNM_FreeFastString(fs)
            if content and content ~= "" then return content end
        end
    end
    -- Fallback: io.popen (spawns console window on Windows, blocks main thread)
    local handle = io.popen('curl -sf "' .. url .. '" 2>&1')
    if not handle then return nil end
    local result = handle:read("*a")
    handle:close()
    return result:gsub("%s+$", "")
end

local function http_put(url, data)
    if use_jsapi then
        local ok, content = reaper.JS_HTTP_Put(url, data, "application/json")
        if ok then return content end
    end
    if use_sws then
        local fs = reaper.SNM_CreateFastHTTPRequest(url, 1)
        if fs then
            reaper.SNM_AddFastString(fs, data)
            local result = reaper.SNM_GetFastString(fs)
            reaper.SNM_FreeFastString(fs)
            if result and result ~= "" then return result end
        end
    end
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
        log("ERROR: Could not read payload: " .. payloadPath)
        return false
    end

    local data = json_decode(payloadStr)
    if not data then
        log("ERROR: Invalid JSON payload")
        return false
    end

    reaper.Main_OnCommand(40023, 0) -- File: New project

    if data.sampleRate then
        reaper.SetCurrentBPM(0, data.sampleRate, false)
    end

    for _, trackData in ipairs(data.tracks or {}) do
        local trackIdx = trackData.trackIndex - 1
        local track = reaper.GetTrack(0, trackIdx)

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
                local source = reaper.PCM_Source_CreateFromFile(item.filePath)
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

    reaper.Main_OnCommand(40295, 0) -- View: Zoom to selected items
    reaper.UpdateArrange()

    return true
end

-- ── Actual poll work (only called once per POLL_INTERVAL) ──
local function doPoll()
    lastStatus = "polling..."
    local resp = http_get(SERVER_URL .. "/api/jobs/pending")
    if resp and resp ~= "" then
        local job = json_decode(resp)
        if job and job.jobId then
            log("Got job: " .. (job.type or "unknown") .. " [" .. job.jobId .. "]")

            if job.type == "execute-reaper" and job.payloadPath then
                local ok = executeImport(job.payloadPath)

                if ok then
                    http_put(
                        SERVER_URL .. "/api/jobs/" .. job.jobId .. "/status",
                        '{"status":"completed","result":{"message":"Import complete"}}'
                    )
                    jobCount = jobCount + 1
                    log("Import complete! Job #" .. jobCount .. " (" .. (job.projectName or "unknown") .. ")")
                else
                    http_put(
                        SERVER_URL .. "/api/jobs/" .. job.jobId .. "/status",
                        '{"status":"error","error":"Import failed"}'
                    )
                    log("Import FAILED for job " .. job.jobId)
                end
            else
                http_put(
                    SERVER_URL .. "/api/jobs/" .. job.jobId .. "/status",
                    '{"status":"error","error":"Unknown job type: ' .. (job.type or "nil") .. '"}'
                )
                log("Unknown job type: " .. (job.type or "nil"))
            end
        end
    end
    lastStatus = "idle"
end

-- ── Main defer loop: ticks every frame, but only actually polls
--    the server once every POLL_INTERVAL seconds. This is the fix
--    for the "runs 30x/sec instead of once per 2s" bug. ──────────
local function tick()
    if not running then return end

    local now = reaper.time_precise()
    if now - lastPollTime >= POLL_INTERVAL then
        lastPollTime = now
        doPoll()
    end

    reaper.defer(tick)
end

-- ── ReaImGui status window ───────────────────────────────
local hasImGui = (reaper.ImGui_CreateContext ~= nil)
local ctx

local function guiLoop()
    if not hasImGui or not running then return end

    reaper.ImGui_SetNextWindowSize(ctx, 420, 320, reaper.ImGui_Cond_FirstUseEver())
    local visible, open = reaper.ImGui_Begin(ctx, "ResolveLink", true)
    if visible then
        local httpMethod = "io.popen (slow, opens console windows)"
        if use_jsapi then httpMethod = "js_ReaScriptAPI"
        elseif use_sws then httpMethod = "SWS" end

        reaper.ImGui_Text(ctx, "Status: " .. lastStatus)
        reaper.ImGui_Text(ctx, "Jobs completed: " .. jobCount)
        reaper.ImGui_Text(ctx, "HTTP transport: " .. httpMethod)
        reaper.ImGui_Text(ctx, "Server: " .. SERVER_URL)
        reaper.ImGui_Separator(ctx)

        if reaper.ImGui_Button(ctx, running and "Stop" or "Start") then
            running = not running
            _G.resolveLinkRunning = running
            if running then
                lastPollTime = 0
                reaper.defer(tick)
                reaper.defer(guiLoop)
            end
        end

        reaper.ImGui_Separator(ctx)
        reaper.ImGui_Text(ctx, "Log:")
        reaper.ImGui_BeginChild(ctx, "log", 0, 0)
        for _, line in ipairs(logLines) do
            reaper.ImGui_TextWrapped(ctx, line)
        end
        reaper.ImGui_EndChild(ctx)

        reaper.ImGui_End(ctx)
    end

    if not open then
        running = false
        _G.resolveLinkRunning = false
    end

    if running then
        reaper.defer(guiLoop)
    end
end

-- ── Start ─────────────────────────────────────────────────
-- Toggle: if already running, stop it
if _G.resolveLinkRunning then
    _G.resolveLinkRunning = false
    running = false
    log("Callback stopped.")
    return
end

_G.resolveLinkRunning = true
lastPollTime = 0

if hasImGui then
    ctx = reaper.ImGui_CreateContext("ResolveLink")
    log("Callback started (polling every " .. POLL_INTERVAL .. "s).")
    reaper.defer(tick)
    reaper.defer(guiLoop)
else
    reaper.ShowConsoleMsg("ResolveLink: ReaImGui not found — install it via ReaPack for a status window.\n")
    reaper.ShowConsoleMsg("ResolveLink: Callback started. Polling " .. SERVER_URL .. " every " .. POLL_INTERVAL .. "s.\n")
    reaper.defer(tick)
end
