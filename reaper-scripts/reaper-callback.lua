-- @reapack ResolveLink Callback script
-- @version 1.4.0
-- @author OseMine
-- @repository https://github.com/OseMine/ResolveLink
--
-- ResolveLink REAPER Callback Script (headless)
-- ===============================================
-- Run from: Actions > Show action list > Load
-- Or assign to a toolbar button for easy access.
--
-- Polls for job files in exports/reaper-jobs/ and executes imports.
-- Logs to REAPER console (View > Open console). No GUI required.
-- Supports auto-import-back after render and WebSocket job delivery.

local SERVER_URL = "http://127.0.0.1:3030"
local POLL_INTERVAL = 2.0
local running = true
local jobCount = 0
local lastPollTime = 0

-- Auto-import-back: automatically send rendered audio to Resolve after render completes
local AUTO_IMPORT_BACK = true

-- WebSocket for real-time job delivery (falls back to file polling)
local USE_WEBSOCKET = true
local ws = nil
local wsReconnectTime = 0
local WS_RECONNECT_DELAY = 5.0

local EXPORTS_JOBS_DIR    = ""
local EXPORTS_RESULTS_DIR = ""
local PROJECTS_DIR        = ""

-- Query server for actual paths on startup
local function fetchConfig()
    local handle = io.popen('curl -sf "' .. SERVER_URL .. '/api/config" 2>NUL')
    if not handle then
        reaper.ShowConsoleMsg("[ResolveLink] ERROR: curl not found. Install curl and ensure it is in your PATH.\n")
        return
    end
    local raw = handle:read("*a")
    handle:close()
    if raw and raw ~= "" then
        local export = raw:match('"exportDir"%s*:%s*"([^"]*)"')
        if export then
            EXPORTS_JOBS_DIR = export:gsub("\\", "/") .. "/reaper-jobs"
            EXPORTS_RESULTS_DIR = export:gsub("\\", "/") .. "/reaper-results"
            PROJECTS_DIR = export:gsub("\\", "/") .. "/reaper-projects"
        end
    end
end
fetchConfig()

-- ── Helpers ────────────────────────────────────────────────
local function log(msg)
    reaper.ShowConsoleMsg("[ResolveLink] " .. os.date("%H:%M:%S") .. "  " .. msg .. "\n")
end

-- ── File Locking ────────────────────────────────────────────
local scriptDir = debug.getinfo(1, "S").source:match("@?(.*/)")
if not scriptDir then
    scriptDir = reaper.GetResourcePath() .. "/Scripts/ResolveLink/"
end
local file_lock = dofile(scriptDir .. "lock.lua")

local function readFile(path)
    local content, err = file_lock.read_file_locked(path, 5000)
    if not content then
        log("WARN: Could not read file (lock): " .. (err or path))
        return nil
    end
    return content
end

local function writeFile(path, content)
    local ok, err = file_lock.write_file_locked(path, content, 5000)
    if not ok then
        log("WARN: Could not write file (lock): " .. (err or path))
        return false
    end
    return true
end

-- ── Native Extension Named Pipe Connection ────────────────────
local native_pipe = nil

local function connectNativePipe()
    -- Try to connect to the native extension's named pipe
    -- The native extension creates a named pipe at \\.\pipe\ResolveLink (Windows) or /tmp/ResolveLink (Unix)
    local pipe_name = package.config:sub(1,1) == '\\' 
        and [[\\.\pipe\ResolveLink]] 
        or [[/tmp/ResolveLink]]
    
    -- Check if native extension is available by trying to connect
    -- We'll use a simple approach: try to open the pipe
    local pipe = io.open(pipe_name, "r")
    if pipe then
        pipe:close()
        log("Native extension named pipe detected: " .. pipe_name)
        return pipe_name
    end
    
    log("Native extension named pipe not found, falling back to WebSocket/file polling")
    return nil
end

local function listenNativePipe(pipe_name)
    -- In Lua, we can't easily do async named pipe reading
    -- Instead, we'll poll the pipe using a deferred function
    local function poll()
        if not running then return end
        
        local pipe = io.open(pipe_name, "r")
        if pipe then
            local data = pipe:read("*l")
            pipe:close()
            if data and data ~= "" then
                local job = json_decode(data)
                if job and job.type == "execute-reaper" and job.payloadPath then
                    log("Native pipe job received: " .. tostring(job.jobId))
                    handleJob(job, job.jobId)
                end
            end
        end
        
        if running then
            reaper.defer(poll)
        end
    end
    
    poll()
end

-- ── WebSocket Connection for Real-time Job Delivery ──────────
local function connectWebSocket()
    if not USE_WEBSOCKET then return end
    
    local wsUrl = SERVER_URL:gsub("^http", "ws") .. "/api/ws/reaper"
    log("Connecting to WebSocket: " .. wsUrl)
    
    -- First try native extension named pipe (preferred)
    local pipe_name = connectNativePipe()
    if pipe_name then
        log("Using native extension named pipe for IPC")
        listenNativePipe(pipe_name)
        return
    end
    
    -- Fall back to WebSocket
    -- Use REAPER's built-in WebSocket support if available (REAPER 6.70+)
    if reaper.SNM_CreateWebSocket then
        ws = reaper.SNM_CreateWebSocket(wsUrl)
        if ws then
            reaper.SNM_WebSocketSetOnOpen(ws, function()
                log("WebSocket connected")
            end)
            
            reaper.SNM_WebSocketSetOnMessage(ws, function(data)
                local job = json_decode(data)
                if job and job.type == "execute-reaper" and job.payloadPath then
                    log("WebSocket job received: " .. tostring(job.jobId))
                    handleJob(job, job.jobId)
                end
            end)
            
            reaper.SNM_WebSocketSetOnClose(ws, function()
                log("WebSocket disconnected")
                ws = nil
                wsReconnectTime = reaper.time_precise() + WS_RECONNECT_DELAY
            end)
            
            reaper.SNM_WebSocketSetOnError(ws, function(err)
                log("WebSocket error: " .. tostring(err))
            end)
            
            return true
        end
    end
    
    -- Fallback: use external ws client if available
    log("WebSocket not available, using file polling")
    USE_WEBSOCKET = false
    return false
end

local function checkWebSocketReconnect()
    if not USE_WEBSOCKET then return end
    if ws then return end
    
    local now = reaper.time_precise()
    if now >= wsReconnectTime then
        log("Attempting WebSocket reconnect...")
        connectWebSocket()
    end
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

-- ── Auto-import-back after render ────────────────────────────
local function autoImportBack(jobId, payloadPath)
    if not AUTO_IMPORT_BACK then return end
    
    -- Read the payload to get linkId and export path
    local payloadStr = readFile(payloadPath)
    if not payloadStr then return end
    
    local data = json_decode(payloadStr)
    if not data or not data.linkId then return end
    
    log("Auto-import-back triggered for link: " .. data.linkId)
    
    -- Find the latest rendered audio file
    local renderDir = EXPORTS_RESULTS_DIR:gsub("/reaper%-results$", "")
    local latestFile, latestTime, latestSize = findLatestAudio(renderDir)
    
    if latestFile then
        log("Found render: " .. latestFile .. " (size: " .. latestSize .. ")")
        
        -- Send to Resolve via server
        local result = sendToResolve(latestFile, data.linkId)
        if result then
            log("Auto-import-back complete: " .. result)
        else
            log("Auto-import-back failed")
        end
    else
        log("No rendered audio found for auto-import-back")
    end
end

-- Find latest audio file in directory (with content hash for change detection)
local function findLatestAudio(dir)
    local latestFile = nil
    local latestTime = 0
    local latestSize = 0
    local idx = 0

    while true do
        local fn = reaper.EnumerateFiles(dir, idx)
        if not fn then break end

        local lower = fn:lower()
        if lower:match("%.wav$") or lower:match("%.mp3$") or lower:match("%.flac$") or lower:match("%.aiff$") then
            local fullPath = dir .. "/" .. fn
            local f = io.open(fullPath, "r")
            if f then
                local size = f:seek("end") or 0
                f:close()
                local modTime = 0
                if reaper.GetFileModTime then
                    modTime = reaper.GetFileModTime(fullPath) or 0
                end
                -- Use modTime + size for content-based change detection
                if modTime > latestTime or (modTime == latestTime and size >= latestSize) then
                    latestTime = modTime
                    latestSize = size
                    latestFile = fullPath
                end
            end
        end
        idx = idx + 1
    end

    return latestFile, latestTime, latestSize
end

-- Send rendered audio to Resolve via server
local function sendToResolve(filePath, linkId)
    local resultFile = EXPORTS_RESULTS_DIR .. "/_import_result.json"
    local tmpFile = EXPORTS_RESULTS_DIR .. "/_import_request.json"

    local normalizedPath = filePath:gsub("\\", "/")
    local json = '{"filePath":"' .. normalizedPath .. '","trackName":"' .. (data and data.projectName or "ResolveLink") .. '"}'
    local f = io.open(tmpFile, "w")
    if not f then return nil, "Could not write temp file" end
    f:write(json)
    f:close()

    local curlCmd = 'curl -sf -X PUT "' .. SERVER_URL .. '/api/reaper/import-to-resolve" '
        .. '-H "Content-Type: application/json" '
        .. '-d @"' .. tmpFile .. '" '
        .. '-o "' .. resultFile .. '" 2>&1'

    local handle = io.popen(curlCmd)
    if not handle then
        os.remove(tmpFile)
        return nil, "Failed to run curl"
    end
    local result = handle:read("*a")
    handle:close()
    os.remove(tmpFile)

    local rf = io.open(resultFile, "r")
    if rf then
        local resp = rf:read("*a")
        rf:close()
        os.remove(resultFile)
        return resp
    end

    return result
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

    -- Auto-save project
    local projName = data.projectName or "ResolveLink"
    local tlName = data.timelineName or "Timeline"
    local safeName = projName .. "_" .. tlName
    safeName = safeName:gsub('[<>:"/\\|?*]', '_')
    local savePath = PROJECTS_DIR .. "/" .. safeName .. ".rpp"

    if reaper.RecursiveCreateDirectory then
        pcall(reaper.RecursiveCreateDirectory, PROJECTS_DIR, 0)
    end
    reaper.Main_SaveProject(0, savePath)
    log("Project saved: " .. savePath)

    return true
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
    -- Use EXPORTS_RESULTS_DIR when available, otherwise use os.tmpname() directly
    local tmpFile
    if EXPORTS_RESULTS_DIR ~= "" then
        tmpFile = EXPORTS_RESULTS_DIR .. "/_import_request.json"
    else
        tmpFile = os.tmpname() .. ".json"
    end
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

-- ── Result writer ──────────────────────────────────────────
local function writeResultFile(jobId, ok, message)
    local path = EXPORTS_RESULTS_DIR .. "/" .. tostring(jobId) .. ".json"
    local status = ok and "completed" or "error"
    local safeMsg = tostring(message):gsub('\\', '\\\\'):gsub('"', '\\"')
    local json = '{"jobId":"' .. tostring(jobId):gsub('"', '\\"') .. '","status":"' .. status .. '","message":"' .. safeMsg .. '"}'
    writeFile(path, json)
end

-- ── Job discovery ──────────────────────────────────────────
local function findPendingJobFile()
    local idx = 0
    while true do
        local fn = reaper.EnumerateFiles(EXPORTS_JOBS_DIR, idx)
        if not fn then return nil end
        if fn:match("%.json$") then
            local jobPath = EXPORTS_JOBS_DIR .. "/" .. fn
            -- Read with lock to avoid race conditions
            local content, err = file_lock.read_file_locked(jobPath, 2000)
            if content then
                return jobPath, content
            end
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
        
        -- Auto-import-back after successful import (if render was already done)
        if ok and AUTO_IMPORT_BACK then
            autoImportBack(jobId, job.payloadPath)
        end
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

    -- Check WebSocket reconnect
    checkWebSocketReconnect()

    local now = reaper.time_precise()
    if now - lastPollTime >= POLL_INTERVAL then
        lastPollTime = now

        local jobFile, payloadStr = findPendingJobFile()
        if jobFile and payloadStr then
            local job = json_decode(payloadStr)
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
    if ws then
        reaper.SNM_WebSocketClose(ws)
        ws = nil
    end
    log("Callback stopped.")
    return
end

_G.resolveLinkRunning = true
lastPollTime = 0

if reaper.RecursiveCreateDirectory then
    pcall(reaper.RecursiveCreateDirectory, EXPORTS_JOBS_DIR, 0)
    pcall(reaper.RecursiveCreateDirectory, EXPORTS_RESULTS_DIR, 0)
end

-- Initialize WebSocket connection
connectWebSocket()

log("Callback started. Polling " .. EXPORTS_JOBS_DIR .. " every " .. POLL_INTERVAL .. "s." .. (USE_WEBSOCKET and " WebSocket enabled." or ""))
reaper.defer(mainLoop)
