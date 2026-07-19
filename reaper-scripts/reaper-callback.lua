-- @reapack ResolveLink Callback script
-- @version 2.0.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
-- @provides [lua] reaper-scripts/reaper-callback.lua
--
-- ResolveLink REAPER Panel
-- =========================
-- File-based IPC: reads job files from exports/reaper-jobs/
-- No HTTP, no io.popen, no console windows.
--
-- Requires: ReaImGui extension (install via ReaPack > Browse packages)

-- ── Config ────────────────────────────────────────────────
local EXPORT_DIR = ""
local JOBS_DIR = ""
local RESULTS_DIR = ""
local POLL_INTERVAL = 1.0

-- Detect export dir from server config or default path
local function detectPaths()
    local sep = package.config:sub(1,1)
    -- Try to find the AE-Link exports folder
    local candidates = {
        "X:" .. sep .. "coding" .. sep .. "AE-Link" .. sep .. "exports",
        os.getenv("USERPROFILE") .. sep .. "Documents" .. sep .. "ResolveLink" .. sep .. "exports",
    }
    for _, dir in ipairs(candidates) do
        local f = io.open(dir .. sep .. ".test", "w")
        if f then
            f:close()
            os.remove(dir .. sep .. ".test")
            EXPORT_DIR = dir
            break
        end
    end
    if EXPORT_DIR == "" then
        -- Fallback: use REAPER resource path
        EXPORT_DIR = reaper.GetResourcePath() .. sep .. "ResolveLink"
    end
    JOBS_DIR = EXPORT_DIR .. sep .. "reaper-jobs"
    RESULTS_DIR = EXPORT_DIR .. sep .. "reaper-results"

    -- Ensure directories exist
    os.execute('mkdir "' .. JOBS_DIR .. '" 2>nul')
    os.execute('mkdir "' .. RESULTS_DIR .. '" 2>nul')
end

detectPaths()

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

-- ── File-based job polling (no HTTP!) ─────────────────────
local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local content = f:read("*a")
    f:close()
    return content
end

local function listJobFiles()
    local files = {}
    local i = 0
    while true do
        local file = reaper.EnumerateFiles(JOBS_DIR, i)
        if not file then break end
        if file:sub(-5) == ".json" then
            files[#files + 1] = file
        end
        i = i + 1
    end
    return files
end

local function writeResult(jobId, status, message)
    os.execute('mkdir "' .. RESULTS_DIR .. '" 2>nul')
    local f = io.open(RESULTS_DIR .. "\\" .. jobId .. ".json", "w")
    if f then
        f:write('{"status":"' .. status .. '","message":"' .. (message or "") .. '"}')
        f:close()
    end
end

local function deleteFile(path)
    os.remove(path)
end

-- ── Import audio into REAPER from payload ─────────────────
local function executeImport(payloadPath)
    local payloadStr = readFile(payloadPath)
    if not payloadStr then return false, "Could not read payload" end

    local data = json_decode(payloadStr)
    if not data then return false, "Invalid JSON payload" end

    -- Create new project
    reaper.Main_OnCommand(40023, 0)

    -- Insert media items on tracks
    for _, trackData in ipairs(data.tracks or {}) do
        local trackIdx = (trackData.trackIndex or 1) - 1
        local track = reaper.GetTrack(0, trackIdx)

        if not track then
            local trackCount = reaper.CountTracks(0)
            while trackCount < (trackData.trackIndex or 1) do
                reaper.InsertTrackAtIndex(trackCount, true)
                trackCount = reaper.CountTracks(0)
            end
            track = reaper.GetTrack(0, trackIdx)
        end

        if track then
            reaper.GetSetMediaTrackInfo_String(track, "P_NAME", trackData.name or "Track", true)

            for _, item in ipairs(trackData.items or {}) do
                local source = reaper.PCM_Source_CreateFromFile(item.filePath)
                if source then
                    local newItem = reaper.CreateNewMediaItemOnProj(
                        item.positionSeconds or 0,
                        item.durationSeconds or 0,
                        source
                    )
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

    reaper.Main_OnCommand(40295, 0)
    reaper.UpdateArrange()
    return true, "Import complete"
end

-- ── ReaImGui GUI ──────────────────────────────────────────
local ctx = reaper.ImGui_CreateContext('ResolveLink Panel')
local running = true
local status_msg = "Idle"
local job_count = 0
local log_messages = {}
local max_log = 50

local function addLog(msg)
    local timestamp = os.date("%H:%M:%S")
    log_messages[#log_messages + 1] = timestamp .. " " .. msg
    if #log_messages > max_log then
        table.remove(log_messages, 1)
    end
end

local function scanAndProcessJobs()
    local files = listJobFiles()
    if #files == 0 then return end

    for _, filename in ipairs(files) do
        local filepath = JOBS_DIR .. "\\" .. filename
        local content = readFile(filepath)
        if content then
            local job = json_decode(content)
            if job and job.jobId then
                addLog("Job: " .. (job.type or "unknown") .. " [" .. job.jobId:sub(1, 8) .. "]")
                status_msg = "Processing..."

                if job.type == "execute-reaper" and job.payloadPath then
                    local ok, msg = executeImport(job.payloadPath)
                    if ok then
                        writeResult(job.jobId, "completed", msg)
                        job_count = job_count + 1
                        addLog("Done: " .. msg)
                        status_msg = "Import complete!"
                    else
                        writeResult(job.jobId, "error", msg)
                        addLog("Error: " .. msg)
                        status_msg = "Error: " .. msg
                    end
                else
                    writeResult(job.jobId, "error", "Unknown job type")
                    addLog("Skipped unknown job type")
                end

                deleteFile(filepath)
            end
        end
    end
end

local function loop()
    if not running then return end

    scanAndProcessJobs()

    -- GUI
    local visible, open = reaper.ImGui_Begin(ctx, 'ResolveLink', true)
    if visible then
        -- Header
        reaper.ImGui_TextColored(ctx, 0.6, 0.4, 0.8, 1.0, "RESOLVELINK")
        reaper.ImGui_SameLine(ctx)
        reaper.ImGui_TextColored(ctx, 0.5, 0.5, 0.5, 1.0, "REAPER Panel")

        reaper.ImGui_Separator(ctx)

        -- Status
        reaper.ImGui_Text(ctx, "Status:")
        reaper.ImGui_SameLine(ctx)
        if status_msg:find("complete") then
            reaper.ImGui_TextColored(ctx, 0.3, 0.7, 0.3, 1.0, status_msg)
        elseif status_msg:find("Error") then
            reaper.ImGui_TextColored(ctx, 0.8, 0.3, 0.3, 1.0, status_msg)
        elseif status_msg:find("Processing") then
            reaper.ImGui_TextColored(ctx, 0.8, 0.6, 0.1, 1.0, status_msg)
        else
            reaper.ImGui_TextColored(ctx, 0.5, 0.5, 0.5, 1.0, status_msg)
        end

        reaper.ImGui_Text(ctx, "Jobs processed: " .. job_count)
        reaper.ImGui_Text(ctx, "Watching: " .. JOBS_DIR)

        reaper.ImGui_Separator(ctx)

        -- Log
        reaper.ImGui_Text(ctx, "Log:")
        reaper.ImGui_BeginChild(ctx, 'Log', -1, 200, true)
        for _, msg in ipairs(log_messages) do
            reaper.ImGui_TextWrapped(ctx, msg)
        end
        if #log_messages == 0 then
            reaper.ImGui_TextColored(ctx, 0.4, 0.4, 0.4, 1.0, "Waiting for jobs...")
        end
        reaper.ImGui_EndChild(ctx)

        reaper.ImGui_Separator(ctx)

        -- Buttons
        if reaper.ImGui_Button(ctx, "Refresh", -1, 0) then
            scanAndProcessJobs()
            addLog("Manual refresh")
        end

        reaper.ImGui_End(ctx)
    end

    if open then
        reaper.defer(loop)
    else
        running = false
        reaper.ImGui_DestroyContext(ctx)
    end
end

-- ── Start ─────────────────────────────────────────────────
addLog("Panel started - watching for jobs")
addLog("Jobs dir: " .. JOBS_DIR)
loop()
