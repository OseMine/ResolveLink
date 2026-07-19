-- @reapack ResolveLink Callback script
-- @version 1.2.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
-- @provides [lua] reaper-scripts/reaper-callback.lua
--
-- ResolveLink REAPER Callback Script
-- ===================================
-- Run from: Actions > Show action list > Load
-- Or assign to a toolbar button for easy access.
--
-- Job detection is FILE-BASED FIRST (watches exports/reaper-jobs/ next
-- to this script, no HTTP needed), falling back to HTTP polling of
-- /api/jobs/pending only if no local job file is found. This removes
-- the old script's main failure mode: a blocking io.popen/curl call
-- (which spawns a visible console window) firing dozens of times a
-- second when SWS/js_ReaScriptAPI aren't installed.
--
-- REQUIRES: ReaImGui (install via ReaPack: "ReaImGui: ReaScript
-- binding for Dear ImGui") for the status window.
-- RECOMMENDED: js_ReaScriptAPI or SWS (via ReaPack) so the HTTP
-- backup path never falls back to spawning curl/console windows.

local SERVER_URL = "http://127.0.0.1:3030"
local POLL_INTERVAL = 2.0  -- seconds between polls
local running = true
local jobCount = 0
local lastPollTime = 0
local lastStatus = "idle"
local serverReachable = nil  -- nil=unknown, true=up, false=down
local lastPingTime = 0
local PING_INTERVAL = 3
local logLines = {}
local MAX_LOG_LINES = 200

-- ── Resolve exports/ dirs relative to this script's location ──
-- Assumes the typical ResolveLink repo layout: reaper-scripts/ and
-- exports/ as siblings under the project root. If your checkout is
-- laid out differently, just hardcode EXPORTS_JOBS_DIR / _RESULTS_DIR
-- below instead.
-- Hardcoded to ResolveLink project root (the relative derivation from
-- REAPER's Scripts/ folder doesn't work after deployment).
local EXPORTS_JOBS_DIR   = "X:/coding/AE-Link/exports/reaper-jobs"
local EXPORTS_RESULTS_DIR = "X:/coding/AE-Link/exports/reaper-results"

-- ── Logging (goes to the UI log panel instead of the console) ──
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

-- ── HTTP helpers (backup path only) ──────────────────────
-- Tries SWS (SNM_CreateFastHTTPRequest) or js_ReaScriptAPI (JS_HTTP_Get)
-- first to avoid io.popen, which spawns visible console windows on
-- Windows AND blocks REAPER's main thread while curl runs.
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

-- ── Result-file writer (file-based IPC back to the server) ──
local function writeResultFile(jobId, ok, message)
    local path = EXPORTS_RESULTS_DIR .. "/" .. tostring(jobId) .. ".json"
    local f = io.open(path, "w")
    if not f then
        log("WARNING: could not write result file " .. path)
        return
    end
    local status = ok and "completed" or "error"
    local safeMsg = tostring(message):gsub('\\', '\\\\'):gsub('"', '\\"')
    f:write('{"jobId":"' .. tostring(jobId):gsub('"', '\\"') .. '","status":"' .. status .. '","message":"' .. safeMsg .. '"}')
    f:close()
end

-- ── File-based job discovery (primary path, no HTTP needed) ──
local function findPendingJobFile()
    local idx = 0
    while true do
        local fn = reaper.EnumerateFiles(EXPORTS_JOBS_DIR, idx)
        if not fn then return nil end
        if fn:match("%.json$") then
            return EXPORTS_JOBS_DIR .. "/" .. fn
        end
        idx = idx + 1
    end
end

local function handleJob(job, jobId, reportViaHttp)
    log("Got job: " .. (job.type or "unknown") .. " [" .. tostring(jobId) .. "]")

    local ok, resultMsg
    if job.type == "execute-reaper" and job.payloadPath then
        ok = executeImport(job.payloadPath)
        resultMsg = ok and "Import complete" or "Import failed"
    else
        ok = false
        resultMsg = "Unknown job type: " .. (job.type or "nil")
    end

    -- Report back via file (always) and HTTP (best-effort, non-fatal)
    writeResultFile(jobId, ok, resultMsg)
    if reportViaHttp then
        http_put(
            SERVER_URL .. "/api/jobs/" .. tostring(jobId) .. "/status",
            '{"status":"' .. (ok and "completed" or "error") .. '","message":"' .. resultMsg:gsub('"', '\\"') .. '"}'
        )
    end

    if ok then
        jobCount = jobCount + 1
        log("Import complete! Job #" .. jobCount .. " (" .. (job.projectName or "unknown") .. ")")
    else
        log("Import FAILED for job " .. tostring(jobId) .. ": " .. resultMsg)
    end
end

-- ── Server reachability check ────────────────────────────────
local function pingServer()
    local resp = http_get(SERVER_URL .. "/api/resolve/status")
    if resp and resp ~= "" then
        local data = json_decode(resp)
        -- Got any valid JSON back = server is up (even if Resolve is disconnected)
        if data and data.connected ~= nil then
            if serverReachable ~= true then
                log("Server reachable (" .. SERVER_URL .. ")")
            end
            serverReachable = true
            return true
        end
    end
    if serverReachable ~= false and serverReachable ~= nil then
        log("Server NOT reachable (" .. SERVER_URL .. ")")
    end
    serverReachable = false
    return false
end

-- ── Actual poll work (only called once per POLL_INTERVAL) ──
-- Primary: check exports/reaper-jobs/ for a job file (no HTTP at all).
-- Backup: if no local job file exists, ask the server over HTTP.
local function doPoll()
    lastStatus = "polling..."

    -- Primary: file-based IPC
    local jobFile = findPendingJobFile()
    if jobFile then
        local payloadStr = readFile(jobFile)
        local job = payloadStr and json_decode(payloadStr)
        local jobId = (job and job.jobId) or jobFile:match("([^/\\]+)%.json$")

        -- Remove the job file immediately so it isn't reprocessed
        -- on the next poll while we're still working on it.
        os.remove(jobFile)

        if job then
            handleJob(job, jobId, true)
        else
            log("ERROR: invalid JSON in job file " .. jobFile)
        end

        lastStatus = "idle"
        return
    end

    -- Backup: HTTP polling
    local resp = http_get(SERVER_URL .. "/api/jobs/pending")
    if resp and resp ~= "" then
        local job = json_decode(resp)
        if job and job.jobId then
            handleJob(job, job.jobId, true)
        end
    end

    lastStatus = "idle"
end

-- ── ReaImGui setup ────────────────────────────────────────
local hasImGui = (reaper.ImGui_CreateContext ~= nil)
local ctx
local monoFont = nil

-- AE-panel-matched palette (see extension/client/style.css):
-- dark base #141414, blue primary #2563a0, green accent, status dots
-- green=connected / red=error / orange=loading.
local COL_BG        = 0x141414  -- window background
local COL_PANEL_BG  = 0x1B1B1B  -- log/card background, slightly lifted
local COL_HEADER_BG = 0x1C1C1C
local COL_BORDER    = 0x2A2A2A
local COL_TEXT      = 0xE6E6E6
local COL_TEXT_DIM  = 0x8A8A8A
local COL_BLUE      = 0x2563A0  -- primary button (AE gradient base)
local COL_BLUE_HOV  = 0x3B7CC4
local COL_GREEN     = 0x2ECC71  -- connected / success accent
local COL_RED       = 0xE74C3C  -- error / stop
local COL_RED_HOV   = 0xF06355
local COL_ORANGE    = 0xF39C12  -- loading

-- Compose an RRGGBB constant with an alpha (0.0-1.0) into RGBA for ReaImGui.
local function col(rgb, alpha)
    local a = math.floor((alpha or 1.0) * 255 + 0.5)
    return (rgb << 8) | a
end

local function pushStyle()
    reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_WindowRounding(), 8)
    reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_FrameRounding(), 5)
    reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_WindowPadding(), 14, 14)
    reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_ItemSpacing(), 8, 8)
    reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_FramePadding(), 8, 6)

    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_WindowBg(), col(COL_BG))
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_TitleBgActive(), col(COL_HEADER_BG))
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_TitleBg(), col(COL_HEADER_BG))
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), col(COL_TEXT))
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ChildBg(), col(COL_PANEL_BG))
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Border(), col(COL_BORDER))
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Separator(), col(COL_BORDER))

    return 5, 7 -- style var count, style color count (must match pushes above)
end

local function popStyle(varCount, colorCount)
    reaper.ImGui_PopStyleColor(ctx, colorCount)
    reaper.ImGui_PopStyleVar(ctx, varCount)
end

local function dimText(text)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), col(COL_TEXT_DIM))
    reaper.ImGui_Text(ctx, text)
    reaper.ImGui_PopStyleColor(ctx, 1)
end

local function statusDot(ok)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), ok and col(COL_GREEN) or col(COL_RED))
    reaper.ImGui_Text(ctx, ok and "\226\151\143 connected" or "\226\151\143 stopped")
    reaper.ImGui_PopStyleColor(ctx, 1)
end

-- ── Main loop: single defer chain doing both polling + UI.
--    Polling is throttled to POLL_INTERVAL; the UI redraws every
--    frame (cheap) regardless. ImGui_End/EndChild are ALWAYS called
--    to match Begin/BeginChild, whether visible or not (this was the
--    earlier crash: End() was only called inside `if visible`, which
--    corrupts ReaImGui's window stack every frame). ──────────────
local function mainLoop()
    if not running then return end

    -- 1. throttled poll
    local now = reaper.time_precise()
    if now - lastPollTime >= POLL_INTERVAL then
        lastPollTime = now
        doPoll()
    end

    -- 2. server reachability check (less frequent than job polling)
    if now - lastPingTime >= PING_INTERVAL then
        lastPingTime = now
        pingServer()
    end

    -- 2. UI (only if ReaImGui is available)
    if hasImGui then
        local varCount, colorCount = pushStyle()
        if monoFont then reaper.ImGui_PushFont(ctx, monoFont) end

        reaper.ImGui_SetNextWindowSize(ctx, 440, 380, reaper.ImGui_Cond_FirstUseEver())
        local visible, open = reaper.ImGui_Begin(ctx, "ResolveLink###resolvelink_main", true)

        if visible then
            local httpMethod = "io.popen (fallback, spawns console windows)"
            if use_jsapi then httpMethod = "js_ReaScriptAPI"
            elseif use_sws then httpMethod = "SWS" end

            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), col(COL_BLUE_HOV))
            reaper.ImGui_Text(ctx, "RESOLVELINK")
            reaper.ImGui_PopStyleColor(ctx, 1)
            reaper.ImGui_SameLine(ctx)
            if serverReachable == true then
                statusDot(true)
            elseif serverReachable == false then
                statusDot(false)
            else
                reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), col(COL_ORANGE))
                reaper.ImGui_Text(ctx, "\226\151\143 checking...")
                reaper.ImGui_PopStyleColor(ctx, 1)
            end

            dimText(SERVER_URL)

            reaper.ImGui_Dummy(ctx, 0, 4)
            reaper.ImGui_Separator(ctx)
            reaper.ImGui_Dummy(ctx, 0, 4)

            dimText("Jobs completed")
            reaper.ImGui_Text(ctx, tostring(jobCount))

            reaper.ImGui_Dummy(ctx, 0, 2)
            dimText("Server")
            if serverReachable == true then
                reaper.ImGui_Text(ctx, SERVER_URL .. " (up)")
            elseif serverReachable == false then
                reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), col(COL_RED))
                reaper.ImGui_Text(ctx, SERVER_URL .. " (unreachable)")
                reaper.ImGui_PopStyleColor(ctx, 1)
            else
                reaper.ImGui_Text(ctx, SERVER_URL)
            end

            reaper.ImGui_Dummy(ctx, 0, 2)
            dimText("Job source")
            reaper.ImGui_Text(ctx, "files + HTTP backup")

            reaper.ImGui_Dummy(ctx, 0, 2)
            dimText("HTTP transport")
            if not use_jsapi and not use_sws then
                reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), col(COL_ORANGE))
                reaper.ImGui_Text(ctx, httpMethod .. " — install js_ReaScriptAPI")
                reaper.ImGui_PopStyleColor(ctx, 1)
            else
                reaper.ImGui_Text(ctx, httpMethod)
            end

            reaper.ImGui_Dummy(ctx, 0, 6)
            reaper.ImGui_Separator(ctx)
            reaper.ImGui_Dummy(ctx, 0, 6)

            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Button(), col(running and COL_RED or COL_BLUE))
            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ButtonHovered(), col(running and COL_RED_HOV or COL_BLUE_HOV))
            reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ButtonActive(), col(running and COL_RED_HOV or COL_BLUE_HOV))
            if reaper.ImGui_Button(ctx, running and "  Stop  " or "  Start  ") then
                running = not running
                _G.resolveLinkRunning = running
                if running then lastPollTime = 0 end
            end
            reaper.ImGui_PopStyleColor(ctx, 3)

            reaper.ImGui_Dummy(ctx, 0, 8)
            dimText("Log")

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
        if monoFont then reaper.ImGui_PopFont(ctx) end
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

-- Make sure the file-IPC directories exist (best-effort, non-fatal).
if reaper.RecursiveCreateDirectory then
    pcall(reaper.RecursiveCreateDirectory, EXPORTS_JOBS_DIR, 0)
    pcall(reaper.RecursiveCreateDirectory, EXPORTS_RESULTS_DIR, 0)
end

if hasImGui then
    ctx = reaper.ImGui_CreateContext("ResolveLink")
    -- Best-effort monospace font for the log panel; silently falls
    -- back to the default font if unavailable on this system.
    local ok, f = pcall(reaper.ImGui_CreateFont, "JetBrains Mono", 14)
    if not (ok and f) then
        ok, f = pcall(reaper.ImGui_CreateFont, "Consolas", 14)
    end
    if ok and f then
        monoFont = f
        reaper.ImGui_Attach(ctx, monoFont)
    end
    log("Callback started (polling every " .. POLL_INTERVAL .. "s).")
    log("Watching " .. EXPORTS_JOBS_DIR .. " for job files.")
else
    reaper.ShowConsoleMsg("ResolveLink: ReaImGui not found — install it via ReaPack for a status window.\n")
    reaper.ShowConsoleMsg("ResolveLink: Callback started. Polling " .. SERVER_URL .. " every " .. POLL_INTERVAL .. "s.\n")
    reaper.ShowConsoleMsg("ResolveLink: Watching " .. EXPORTS_JOBS_DIR .. " for job files.\n")
end

reaper.defer(mainLoop)
