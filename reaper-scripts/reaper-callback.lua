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

-- ── ReaImGui setup ────────────────────────────────────────
local hasImGui = (reaper.ImGui_CreateContext ~= nil)
local ctx

-- Colors (0xRRGGBBAA)
local COL_BG          = 0x1E1E24FF
local COL_HEADER_BG   = 0x2A2A33FF
local COL_ACCENT      = 0x6C9BFAFF
local COL_ACCENT_HOV  = 0x8BB0FFFF
local COL_TEXT        = 0xE8E8ECFF
local COL_TEXT_DIM    = 0x9A9AA5FF
local COL_LOG_BG      = 0x17171CFF
local COL_STOP        = 0xE0605AFF
local COL_STOP_HOV    = 0xF07A74FF

local function pushStyle()
    reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_WindowRounding(), 8)
    reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_FrameRounding(), 5)
    reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_WindowPadding(), 14, 14)
    reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_ItemSpacing(), 8, 8)
    reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_FramePadding(), 8, 6)

    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_WindowBg(), COL_BG)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_TitleBgActive(), COL_HEADER_BG)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_TitleBg(), COL_HEADER_BG)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), COL_TEXT)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ChildBg(), COL_LOG_BG)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Separator(), COL_HEADER_BG)

    return 5, 6 -- style var count, style color count (must match pushes above)
end

local function popStyle(varCount, colorCount)
    reaper.ImGui_PopStyleColor(ctx, colorCount)
    reaper.ImGui_PopStyleVar(ctx, varCount)
end

local function statusDot(ok)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), ok and 0x6EE07AFF or COL_TEXT_DIM)
    reaper.ImGui_Text(ctx, ok and "\226\151\143 running" or "\226\151\143 stopped")
    reaper.ImGui_PopStyleColor(ctx, 1)
end

-- ── Main loop: single defer chain doing both polling + UI.
--    Polling is throttled to POLL_INTERVAL; the UI redraws every
--    frame (cheap) regardless. This is the fix for the earlier bug
--    where polling ran ~30x/sec instead of once per POLL_INTERVAL,
--    and the crash bug where ImGui_End wasn't always called to
--    match ImGui_Begin (it must ALWAYS be called, visible or not). ──
local function mainLoop()
    if not running then return end

    -- 1. throttled poll
    local now = reaper.time_precise()
    if now - lastPollTime >= POLL_INTERVAL then
        lastPollTime = now
        doPoll()
    end

    -- 2. UI (only if ReaImGui is available)
    if hasImGui then
        local varCount, colorCount = pushStyle()

        reaper.ImGui_SetNextWindowSize(ctx, 440, 360, reaper.ImGui_Cond_FirstUseEver())
        local visible, open = reaper.ImGui_Begin(ctx, "ResolveLink###resolvelink_main", true)

        if visible then
            local httpMethod = "io.popen (slow, opens console windows)"
            if use_jsapi then httpMethod = "js_ReaScriptAPI"
            elseif use_sws then httpMethod = "SWS" end

            statusDot(running)
            reaper.ImGui_SameLine(ctx)
            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), COL_TEXT_DIM)
            reaper.ImGui_Text(ctx, "  |  " .. SERVER_URL)
            reaper.ImGui_PopStyleColor(ctx, 1)

            reaper.ImGui_Dummy(ctx, 0, 2)
            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), COL_TEXT_DIM)
            reaper.ImGui_Text(ctx, "Jobs completed")
            reaper.ImGui_PopStyleColor(ctx, 1)
            reaper.ImGui_Text(ctx, tostring(jobCount))

            reaper.ImGui_Dummy(ctx, 0, 2)
            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), COL_TEXT_DIM)
            reaper.ImGui_Text(ctx, "Transport")
            reaper.ImGui_PopStyleColor(ctx, 1)
            reaper.ImGui_Text(ctx, httpMethod)

            reaper.ImGui_Dummy(ctx, 0, 6)
            reaper.ImGui_Separator(ctx)
            reaper.ImGui_Dummy(ctx, 0, 6)

            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Button(), running and COL_STOP or COL_ACCENT)
            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ButtonHovered(), running and COL_STOP_HOV or COL_ACCENT_HOV)
            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ButtonActive(), running and COL_STOP_HOV or COL_ACCENT_HOV)
            if reaper.ImGui_Button(ctx, running and "  Stop  " or "  Start  ") then
                running = not running
                _G.resolveLinkRunning = running
                if running then lastPollTime = 0 end
            end
            reaper.ImGui_PopStyleColor(ctx, 3)

            reaper.ImGui_Dummy(ctx, 0, 8)
            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), COL_TEXT_DIM)
            reaper.ImGui_Text(ctx, "Log")
            reaper.ImGui_PopStyleColor(ctx, 1)

            local childVisible = reaper.ImGui_BeginChild(ctx, "log", 0, -1, reaper.ImGui_ChildFlags_Border())
            if childVisible then
                for _, line in ipairs(logLines) do
                    reaper.ImGui_TextWrapped(ctx, line)
                end
                if reaper.ImGui_GetScrollY(ctx) >= reaper.ImGui_GetScrollMaxY(ctx) - 1 then
                    reaper.ImGui_SetScrollHereY(ctx, 1.0)
                end
            end
            -- BeginChild's matching EndChild must ALWAYS be called
            -- once BeginChild has been called, regardless of its return value.
            reaper.ImGui_EndChild(ctx)
        end

        -- Always call End(), matching Begin() above, regardless of `visible`.
        reaper.ImGui_End(ctx)
        popStyle(varCount, colorCount)

        if not open then
            running = false
            _G.resolveLinkRunning = false
        end
    end

    if running then
        reaper.defer(mainLoop)
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
else
    reaper.ShowConsoleMsg("ResolveLink: ReaImGui not found — install it via ReaPack for a status window.\n")
    reaper.ShowConsoleMsg("ResolveLink: Callback started. Polling " .. SERVER_URL .. " every " .. POLL_INTERVAL .. "s.\n")
end

reaper.defer(mainLoop)
