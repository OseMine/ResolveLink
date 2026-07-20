-- @reapack ResolveLink Callback script
-- @version 1.3.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
--
-- ResolveLink REAPER Callback Script (headless)
-- ===============================================
-- Run from: Actions > Show action list > Load
-- Or assign to a toolbar button for easy access.
--
-- Polls for job files in exports/reaper-jobs/ and executes imports.
-- Logs to REAPER console (View > Open console). No GUI required.

local SERVER_URL = "http://127.0.0.1:3030"
local POLL_INTERVAL = 2.0
local running = true
local jobCount = 0
local lastPollTime = 0

local EXPORTS_JOBS_DIR    = "X:/coding/AE-Link/exports/reaper-jobs"
local EXPORTS_RESULTS_DIR = "X:/coding/AE-Link/exports/reaper-results"

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

-- ── HTTP via SWS (no console windows) ─────────────────────
local use_sws = (reaper.SNM_CreateFastHTTPRequest ~= nil)

local function http_put(url, data)
    if use_sws then
        local fs = reaper.SNM_CreateFastHTTPRequest(url, 2)
        if fs then
            reaper.SNM_AddFastString(fs, data)
            local result = reaper.SNM_GetFastString(fs)
            reaper.SNM_FreeFastString(fs)
            if result and result ~= "" then return result end
        end
    end
    local tmpFile = os.tmpname() .. ".json"
    local f = io.open(tmpFile, "w")
    if not f then return nil end
    f:write(data)
    f:close()
    local handle = io.popen('curl -sf -X PUT "' .. url .. '" -H "Content-Type: application/json" -d @"' .. tmpFile .. '" 2>&1')
    if not handle then os.remove(tmpFile); return nil end
    local result = handle:read("*a")
    handle:close()
    os.remove(tmpFile)
    return result and result:gsub("%s+$", "") or nil
end

-- ── Import from payload ────────────────────────────────────
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
                if item.filePath and item.filePath ~= "" then
                    reaper.SetOnlyTrackSelected(track)
                    reaper.SetEditCurPos(item.positionSeconds, false, false)
                    reaper.InsertMedia(item.filePath, 0)

                    local itemCount = reaper.CountTrackMediaItems(track)
                    local newItem = reaper.GetTrackMediaItem(track, itemCount - 1)
                    if newItem then
                        reaper.SetMediaItemInfo_Value(newItem, "D_POSITION", item.positionSeconds)
                        reaper.SetMediaItemInfo_Value(newItem, "D_LENGTH", item.durationSeconds)

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
                end
            end
        end
    end

    reaper.Main_OnCommand(40295, 0) -- View: Zoom to selected items
    reaper.UpdateArrange()
    return true
end

-- ── Result writer ──────────────────────────────────────────
local function writeResultFile(jobId, ok, message)
    local path = EXPORTS_RESULTS_DIR .. "/" .. tostring(jobId) .. ".json"
    local f = io.open(path, "w")
    if not f then return end
    local status = ok and "completed" or "error"
    local safeMsg = tostring(message):gsub('\\', '\\\\'):gsub('"', '\\"')
    f:write('{"jobId":"' .. tostring(jobId):gsub('"', '\\"') .. '","status":"' .. status .. '","message":"' .. safeMsg .. '"}')
    f:close()
end

-- ── Job discovery ──────────────────────────────────────────
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

local function handleJob(job, jobId)
    log("Got job: " .. (job.type or "unknown") .. " [" .. tostring(jobId) .. "]")

    local ok, resultMsg
    if job.type == "execute-reaper" and job.payloadPath then
        ok = executeImport(job.payloadPath)
        resultMsg = ok and "Import complete" or "Import failed"
    else
        ok = false
        resultMsg = "Unknown job type: " .. (job.type or "nil")
    end

    writeResultFile(jobId, ok, resultMsg)
    http_put(
        SERVER_URL .. "/api/jobs/" .. tostring(jobId) .. "/status",
        '{"status":"' .. (ok and "completed" or "error") .. '","message":"' .. resultMsg:gsub('"', '\\"') .. '"}'
    )

    if ok then
        jobCount = jobCount + 1
        log("Import complete! Job #" .. jobCount .. " (" .. (job.projectName or "unknown") .. ")")
    else
        log("Import FAILED for job " .. tostring(jobId) .. ": " .. resultMsg)
    end
end

-- ── Main loop ──────────────────────────────────────────────
local function mainLoop()
    if not running then return end

    local now = reaper.time_precise()
    if now - lastPollTime >= POLL_INTERVAL then
        lastPollTime = now

        local jobFile = findPendingJobFile()
        if jobFile then
            local payloadStr = readFile(jobFile)
            local job = payloadStr and json_decode(payloadStr)
            local jobId = (job and job.jobId) or jobFile:match("([^/\\]+)%.json$")
            os.remove(jobFile)
            if job then
                handleJob(job, jobId)
            end
        end
    end

    if running then
        reaper.defer(mainLoop)
    end
end

-- ── Start ──────────────────────────────────────────────────
if _G.resolveLinkRunning then
    _G.resolveLinkRunning = false
    running = false
    log("Callback stopped.")
    return
end

_G.resolveLinkRunning = true
lastPollTime = 0

if reaper.RecursiveCreateDirectory then
    pcall(reaper.RecursiveCreateDirectory, EXPORTS_JOBS_DIR, 0)
    pcall(reaper.RecursiveCreateDirectory, EXPORTS_RESULTS_DIR, 0)
end

log("Callback started. Polling " .. EXPORTS_JOBS_DIR .. " every " .. POLL_INTERVAL .. "s.")
reaper.defer(mainLoop)
