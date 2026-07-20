-- @reapack ResolveLink Panel
-- @version 1.0.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
--
-- ResolveLink Control Panel
-- ==========================
-- Unified UI for all ResolveLink REAPER functions.
-- - Toggle Callback (polls for DaVinci import jobs)
-- - Send to Resolve (render + import back to DaVinci)
-- - Update Project (sync REAPER to DaVinci timeline)
-- - Status display

local SERVER_URL = "http://127.0.0.1:3030"
local TEMP_DIR = "X:/coding/AE-Link/temp"
local EXPORTS_JOBS_DIR = "X:/coding/AE-Link/exports/reaper-jobs"
local EXPORTS_RESULTS_DIR = "X:/coding/AE-Link/exports/reaper-results"
local PROJECTS_DIR = "X:/coding/AE-Link/exports/reaper-projects"
local POLL_INTERVAL = 2.0

-- ── State ──────────────────────────────────────────────────
local callbackActive = false
local lastPollTime = 0
local jobCount = 0
local statusMsg = "Idle"
local statusColor = {0.6, 0.6, 0.6}
local logLines = {}
local MAX_LOG_LINES = 8

-- ── GFX Layout ─────────────────────────────────────────────
local W, H = 320, 340
local BTN_H = 28
local BTN_PAD = 6
local LOG_H = 120

-- ── Helpers ────────────────────────────────────────────────
local function log(msg)
    local line = os.date("%H:%M:%S") .. "  " .. msg
    reaper.ShowConsoleMsg("[ResolveLink] " .. line .. "\n")
    logLines[#logLines + 1] = line
    if #logLines > MAX_LOG_LINES then
        table.remove(logLines, 1)
    end
end

local function setStatus(msg, color)
    statusMsg = msg
    statusColor = color or {0.6, 0.6, 0.6}
end

local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local content = f:read("*a")
    f:close()
    return content
end

local function ensureDir(dir)
    if reaper.RecursiveCreateDirectory then
        pcall(reaper.RecursiveCreateDirectory, dir, 0)
    end
end

local function fileExists(path)
    local f = io.open(path, "r")
    if f then f:close(); return true end
    return false
end

-- ── JSON decoder (inline) ──────────────────────────────────
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
            advance()
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
    local tmpFile = TEMP_DIR .. "/_panel_result.json"
    local curlCmd = 'curl -sf "' .. url .. '" -o "' .. tmpFile .. '" 2>&1'
    local handle = io.popen(curlCmd)
    if not handle then os.remove(tmpFile); return nil end
    handle:read("*a")
    handle:close()
    local f = io.open(tmpFile, "r")
    if not f then return nil end
    local json = f:read("*a")
    f:close()
    os.remove(tmpFile)
    return json
end

local function httpPut(url, data)
    local tmpFile = TEMP_DIR .. "/_panel_request.json"
    local resultFile = TEMP_DIR .. "/_panel_result.json"
    local f = io.open(tmpFile, "w")
    if not f then return nil end
    f:write(data)
    f:close()
    local curlCmd = 'curl -sf -X PUT "' .. url .. '" -H "Content-Type: application/json" -d @"' .. tmpFile .. '" -o "' .. resultFile .. '" 2>&1'
    local handle = io.popen(curlCmd)
    if not handle then os.remove(tmpFile); return nil end
    handle:read("*a")
    handle:close()
    os.remove(tmpFile)
    local rf = io.open(resultFile, "r")
    if not rf then return nil end
    local json = rf:read("*a")
    rf:close()
    os.remove(resultFile)
    return json
end

-- ── Normalize file path for matching ──────────────────────
local function normalizePath(p)
    if not p then return nil end
    p = p:gsub("\\", "/")
    local name = p:match("([^/]+)$")
    return name and name:lower() or nil
end

local function getItemSourceFile(item)
    local take = reaper.GetActiveTake(item)
    if not take then return nil end
    local source = reaper.GetMediaItemTake_Source(take)
    if source then
        local _, filename = reaper.GetMediaSourceFileName(source, "")
        if filename and filename ~= "" then return filename end
    end
    local _, takeName = reaper.GetSetMediaItemTakeInfo_String(take, "P_NAME", "", false)
    if takeName and takeName ~= "" then return takeName end
    return nil
end

-- ── Callback Logic ─────────────────────────────────────────
local function executeImport(payloadPath)
    local payloadStr = readFile(payloadPath)
    if not payloadStr then return false end
    local data = json_decode(payloadStr)
    if not data then return false end

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

    reaper.Main_OnCommand(40295, 0)
    reaper.UpdateArrange()

    local projName = data.projectName or "ResolveLink"
    local tlName = data.timelineName or "Timeline"
    local safeName = (projName .. "_" .. tlName):gsub('[<>:"/\\|?*]', '_')
    local savePath = PROJECTS_DIR .. "/" .. safeName .. ".rpp"
    ensureDir(PROJECTS_DIR)
    reaper.Main_SaveProject(0, savePath)
    log("Project saved: " .. savePath)

    return true
end

local function writeResultFile(jobId, ok, message)
    local path = EXPORTS_RESULTS_DIR .. "/" .. tostring(jobId) .. ".json"
    local f = io.open(path, "w")
    if not f then return end
    local status = ok and "completed" or "error"
    local safeMsg = tostring(message):gsub('\\', '\\\\'):gsub('"', '\\"')
    f:write('{"jobId":"' .. tostring(jobId):gsub('"', '\\"') .. '","status":"' .. status .. '","message":"' .. safeMsg .. '"}')
    f:close()
end

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
    log("Job: " .. (job.type or "unknown"))
    local ok, resultMsg
    if job.type == "execute-reaper" and job.payloadPath then
        ok = executeImport(job.payloadPath)
        resultMsg = ok and "Import complete" or "Import failed"
    else
        ok = false
        resultMsg = "Unknown type: " .. (job.type or "nil")
    end
    writeResultFile(jobId, ok, resultMsg)
    httpPut(
        SERVER_URL .. "/api/jobs/" .. tostring(jobId) .. "/status",
        '{"status":"' .. (ok and "completed" or "error") .. '","message":"' .. resultMsg:gsub('"', '\\"') .. '"}'
    )
    if ok then
        jobCount = jobCount + 1
        setStatus("Imported #" .. jobCount, {0.4, 0.8, 0.4})
    else
        setStatus("Import failed", {0.8, 0.3, 0.3})
    end
end

local function callbackPoll()
    if not callbackActive then return end
    local now = reaper.time_precise()
    if now - lastPollTime >= POLL_INTERVAL then
        lastPollTime = now
        local jobFile = findPendingJobFile()
        if jobFile then
            local payloadStr = readFile(jobFile)
            local job = payloadStr and json_decode(payloadStr)
            local jobId = (job and job.jobId) or jobFile:match("([^/\\]+)%.json$")
            os.remove(jobFile)
            if job then handleJob(job, jobId) end
        end
    end
end

-- ── Send to Resolve ────────────────────────────────────────
local function readConfigFromRenderScript()
    local latestFile = nil
    local latestTime = 0
    local idx = 0
    while true do
        local fn = reaper.EnumerateFiles(TEMP_DIR, idx)
        if not fn then break end
        if fn:match("^render_.*_reaper%.lua$") then
            local fullPath = TEMP_DIR .. "/" .. fn
            local f = io.open(fullPath, "r")
            if f then
                f:close()
                local modTime = 0
                if reaper.GetFileModTime then
                    modTime = reaper.GetFileModTime(fullPath) or 0
                end
                if modTime >= latestTime then
                    latestTime = modTime
                    latestFile = fullPath
                end
            end
        end
        idx = idx + 1
    end
    if not latestFile then return nil end
    local content = readFile(latestFile)
    if not content then return nil end
    local exportDir = content:match('local export_dir = "([^"]*)"')
    local exportPath = content:match('local export_path = "([^"]*)"')
    local compName = content:match('local comp_name = "([^"]*)"')
    if exportDir and exportPath then
        return { exportDir = exportDir, exportPath = exportPath, compName = compName or "ResolveLink_Audio" }
    end
    return nil
end

local function findLatestAudio(dir)
    local latestFile = nil
    local latestTime = 0
    local idx = 0
    while true do
        local fn = reaper.EnumerateFiles(dir, idx)
        if not fn then break end
        local lower = fn:lower()
        if lower:match("%.wav$") or lower:match("%.mp3$") or lower:match("%.flac$") or lower:match("%.aiff$") then
            local fullPath = dir .. "/" .. fn
            local f = io.open(fullPath, "r")
            if f then
                f:close()
                local modTime = 0
                if reaper.GetFileModTime then
                    modTime = reaper.GetFileModTime(fullPath) or 0
                end
                if modTime >= latestTime then
                    latestTime = modTime
                    latestFile = fullPath
                end
            end
        end
        idx = idx + 1
    end
    return latestFile, latestTime
end

local function doSendToResolve()
    local config = readConfigFromRenderScript()
    if not config then
        log("No render config in " .. TEMP_DIR)
        setStatus("No render config", {0.8, 0.3, 0.3})
        return
    end

    ensureDir(config.exportDir)

    local fileName = config.exportPath:match("([^/\\]+)$") or config.exportPath
    fileName = fileName:gsub("%.[^.]+$", "")

    log("Render: RENDER_FILE=" .. config.exportDir .. " RENDER_PATTERN=" .. fileName)
    reaper.GetSetProjectInfo_String(0, "RENDER_FILE", config.exportDir, true)
    reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", fileName, true)
    reaper.GetSetProjectInfo_String(0, "RENDER_SRATE", "48000", true)

    setStatus("Rendering...", {0.8, 0.8, 0.3})
    gfx.update()

    reaper.Main_OnCommand(40009, 0)
    reaper.defer(function() end)

    local wavPath = config.exportDir .. "/" .. fileName .. ".wav"
    local renderPath = fileExists(wavPath) and wavPath or findLatestAudio(config.exportDir)

    if not renderPath then
        log("No rendered audio found")
        setStatus("Render failed", {0.8, 0.3, 0.3})
        return
    end

    log("Sending: " .. renderPath)
    setStatus("Sending to Resolve...", {0.4, 0.6, 0.8})

    local resultFile = TEMP_DIR .. "/_import_result.json"
    local tmpFile = TEMP_DIR .. "/_import_request.json"
    local normalizedPath = renderPath:gsub("\\", "/")
    local f = io.open(tmpFile, "w")
    if not f then setStatus("Write error", {0.8, 0.3, 0.3}); return end
    f:write('{"filePath":"' .. normalizedPath .. '"}')
    f:close()

    local curlCmd = 'curl -sf -X PUT "' .. SERVER_URL .. '/api/reaper/import-to-resolve" '
        .. '-H "Content-Type: application/json" '
        .. '-d @"' .. tmpFile .. '" '
        .. '-o "' .. resultFile .. '" 2>&1'
    local handle = io.popen(curlCmd)
    if handle then handle:read("*a"); handle:close() end
    os.remove(tmpFile)

    local rf = io.open(resultFile, "r")
    if rf then
        local json = rf:read("*a")
        rf:close()
        os.remove(resultFile)
        if json and json:find('"success":true') then
            log("Import complete!")
            setStatus("Sent to Resolve", {0.4, 0.8, 0.4})
        else
            log("Import may have failed")
            setStatus("Import failed", {0.8, 0.3, 0.3})
        end
    else
        log("No response from server")
        setStatus("Server unreachable", {0.8, 0.3, 0.3})
    end
end

-- ── Update Project ─────────────────────────────────────────
local function doUpdateProject()
    log("Fetching DaVinci timeline...")
    setStatus("Updating...", {0.4, 0.6, 0.8})
    gfx.update()

    local json = httpGet(SERVER_URL .. "/api/resolve/timeline")
    if not json then
        log("Cannot reach server")
        setStatus("Server unreachable", {0.8, 0.3, 0.3})
        return
    end

    local timeline = json_decode(json)
    if not timeline or timeline.error then
        log("Error: " .. (timeline and timeline.error or "Invalid"))
        setStatus("Error", {0.8, 0.3, 0.3})
        return
    end

    local fps = tonumber(timeline.frameRate) or 24
    log("Timeline: " .. (timeline.name or "?") .. " @ " .. fps .. "fps")

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
    log("Found " .. clipCount .. " clip(s)")

    if clipCount == 0 then
        setStatus("No clips", {0.8, 0.6, 0.3})
        return
    end

    local updated = 0
    local matched = 0
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
                    local videoTrackNum = tonumber(davinciClip.trackKey:match("video_(%d+)")) or 1
                    local targetTrack = reaper.GetTrack(0, videoTrackNum - 1)
                    local currentTrack = reaper.GetMediaItem_Track(item)
                    local trackChanged = targetTrack and currentTrack ~= targetTrack

                    if not targetTrack then
                        local tc = reaper.CountTracks(0)
                        while tc < videoTrackNum do
                            reaper.InsertTrackAtIndex(tc, true)
                            tc = reaper.CountTracks(0)
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
                    end
                end
            end
        end
    end

    reaper.UpdateArrange()
    log("Matched: " .. matched .. " Updated: " .. updated)
    setStatus("Updated " .. updated .. " clip(s)", {0.4, 0.8, 0.4})
end

-- ── GFX Drawing ────────────────────────────────────────────
local function drawButton(x, y, w, h, label, r, g, b)
    gfx.r = r or 0.25
    gfx.g = g or 0.25
    gfx.b = b or 0.25
    gfx.a = 1
    gfx.rect(x, y, w, h, 1)

    gfx.r = 0.1
    gfx.g = 0.1
    gfx.b = 0.1
    gfx.a = 0.3
    gfx.rect(x, y, w, 1, 1)
    gfx.rect(x, y, 1, h, 1)

    gfx.r = 0.5
    gfx.g = 0.5
    gfx.b = 0.5
    gfx.a = 0.3
    gfx.rect(x, y + h - 1, w, 1, 1)
    gfx.rect(x + w - 1, y, 1, h, 1)

    gfx.r = 1
    gfx.g = 1
    gfx.b = 1
    gfx.a = 1
    gfx.setfont(1, "Arial", 13, 'b')
    local tw = gfx.measurestr(label)
    gfx.drawstr(label, 0, x + (w - tw) / 2, y + (h - 13) / 2, x + (w + tw) / 2, y + (h + 13) / 2)
end

local function drawToggle(x, y, w, h, label, active)
    local r, g, b
    if active then
        r, g, b = 0.2, 0.55, 0.2
    else
        r, g, b = 0.5, 0.2, 0.2
    end
    drawButton(x, y, w, h, label, r, g, b)
end

local function isInRect(mx, my, x, y, w, h)
    return mx >= x and mx <= x + w and my >= y and my <= y + h
end

local function drawPanel()
    gfx.clear = 0.15
    gfx.r = 0.18
    gfx.g = 0.18
    gfx.b = 0.2
    gfx.a = 1
    gfx.rect(0, 0, W, H, 1)

    local pad = BTN_PAD
    local bw = W - pad * 2
    local y = pad

    -- Title
    gfx.r = 1
    gfx.g = 1
    gfx.b = 1
    gfx.a = 1
    gfx.setfont(1, "Arial", 16, 'b')
    gfx.drawstr("ResolveLink", 0, pad, y + 2, W - pad, y + 22)
    y = y + 26

    -- Status
    gfx.r = statusColor[1]
    gfx.g = statusColor[2]
    gfx.b = statusColor[3]
    gfx.a = 0.9
    gfx.setfont(1, "Arial", 11, '')
    gfx.drawstr("Status: " .. statusMsg, 0, pad, y, W - pad, y + 16)
    y = y + 22

    -- Separator
    gfx.r = 0.4
    gfx.g = 0.4
    gfx.b = 0.4
    gfx.a = 0.5
    gfx.line(0, y, W, y)
    y = y + pad

    -- Callback toggle
    drawToggle(pad, y, bw, BTN_H, callbackActive and "Callback: ON  (click to stop)" or "Callback: OFF  (click to start)", callbackActive)
    y = y + BTN_H + pad

    -- Send to Resolve
    drawButton(pad, y, bw, BTN_H, "Send to Resolve", 0.25, 0.35, 0.5)
    y = y + BTN_H + pad

    -- Update Project
    drawButton(pad, y, bw, BTN_H, "Update Project", 0.25, 0.4, 0.45)
    y = y + BTN_H + pad * 2

    -- Separator
    gfx.r = 0.4
    gfx.g = 0.4
    gfx.b = 0.4
    gfx.a = 0.5
    gfx.line(0, y, W, y)
    y = y + pad

    -- Log area
    gfx.r = 0.12
    gfx.g = 0.12
    gfx.b = 0.13
    gfx.a = 1
    gfx.rect(pad, y, bw, LOG_H, 1)

    gfx.setfont(1, "Arial", 10, '')
    gfx.r = 0.5
    gfx.g = 0.5
    gfx.b = 0.5
    gfx.a = 0.7
    gfx.drawstr("Log:", 0, pad + 4, y + 2, W - pad, y + 14)

    gfx.r = 0.7
    gfx.g = 0.7
    gfx.b = 0.7
    gfx.a = 0.85
    local logY = y + 16
    for i = 1, #logLines do
        if logY > y + LOG_H - 4 then break end
        local line = logLines[i]
        if #line > 42 then line = line:sub(1, 39) .. "..." end
        gfx.drawstr(line, 0, pad + 4, logY, W - pad, logY + 13)
        logY = logY + 13
    end

    -- Jobs counter
    gfx.r = 0.5
    gfx.g = 0.5
    gfx.b = 0.5
    gfx.a = 0.6
    gfx.setfont(1, "Arial", 9, '')
    gfx.drawstr("Jobs completed: " .. jobCount, 0, pad, H - 16, W - pad, H - 2)
end

-- ── Button click handling ──────────────────────────────────
local function handleClick(mx, my)
    local pad = BTN_PAD
    local bw = W - pad * 2
    local y = pad + 26 + 16 + pad  -- title + status + separator

    -- Callback toggle
    if isInRect(mx, my, pad, y, bw, BTN_H) then
        callbackActive = not callbackActive
        if callbackActive then
            ensureDir(EXPORTS_JOBS_DIR)
            ensureDir(EXPORTS_RESULTS_DIR)
            lastPollTime = 0
            log("Callback started")
            setStatus("Callback active", {0.4, 0.8, 0.4})
        else
            log("Callback stopped")
            setStatus("Idle", {0.6, 0.6, 0.6})
        end
        return
    end
    y = y + BTN_H + pad

    -- Send to Resolve
    if isInRect(mx, my, pad, y, bw, BTN_H) then
        doSendToResolve()
        return
    end
    y = y + BTN_H + pad

    -- Update Project
    if isInRect(mx, my, pad, y, bw, BTN_H) then
        doUpdateProject()
        return
    end
end

-- ── Main loop ──────────────────────────────────────────────
local function mainLoop()
    callbackPoll()

    if gfx.getchar() >= 0 then
        if gfx.mouse_cap == 1 and gfx.mouse_x >= 0 and gfx.mouse_x <= W and gfx.mouse_y >= 0 and gfx.mouse_y <= H then
            handleClick(gfx.mouse_x, gfx.mouse_y)
            while gfx.mouse_cap == 1 do reaper.defer(function() end) end
        end

        drawPanel()
        gfx.update()
        reaper.defer(mainLoop)
    else
        gfx.quit()
    end
end

-- ── Init ───────────────────────────────────────────────────
gfx.init("ResolveLink", W, H, 0)
gfx.setfont(1, "Arial", 13, 'b')
setStatus("Idle", {0.6, 0.6, 0.6})
log("Panel opened")
reaper.defer(mainLoop)
