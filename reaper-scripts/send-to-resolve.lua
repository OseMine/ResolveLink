-- @reapack ResolveLink Send to Resolve
-- @version 1.4.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
--
-- ResolveLink - Send Rendered Audio to DaVinci Resolve
-- =====================================================
-- Reads config from the latest render script in temp/,
-- auto-renders using those settings, then sends the
-- rendered WAV to DaVinci Resolve via the server.
--
-- Usage: Actions > Show action list > Load > select this file
-- Then assign to a toolbar button for easy access.

local SERVER_URL = "http://127.0.0.1:3030"
local TEMP_DIR = ""
local AUTO_RENDER = true

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
        local temp = raw:match('"tempDir"%s*:%s*"([^"]*)"')
        if temp then TEMP_DIR = temp:gsub("\\", "/") end
    end
end
fetchConfig()

-- ── Helpers ────────────────────────────────────────────────
local function log(msg)
    reaper.ShowConsoleMsg("[ResolveLink] " .. os.date("%H:%M:%S") .. "  " .. msg .. "\n")
end

local function ensureDir(dir)
    if reaper.RecursiveCreateDirectory then
        pcall(reaper.RecursiveCreateDirectory, dir, 0)
    end
end

local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local content = f:read("*a")
    f:close()
    return content
end

local function fileExists(path)
    local f = io.open(path, "r")
    if f then f:close(); return true end
    return false
end

-- ── Read config from latest render script in temp/ ──────────
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

    log("Reading config from: " .. latestFile)
    local content = readFile(latestFile)
    if not content then return nil end

    local exportDir = content:match('local export_dir = "([^"]*)"')
    local exportPath = content:match('local export_path = "([^"]*)"')
    local compName = content:match('local comp_name = "([^"]*)"')
    local linkId = content:match("Link ID: (%S+)")

    if exportDir and exportPath then
        return {
            exportDir = exportDir,
            exportPath = exportPath,
            compName = compName or "ResolveLink_Audio",
            linkId = linkId or "unknown",
        }
    end
    return nil
end

-- ── Find latest audio file in directory ────────────────────
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

-- ── HTTP via curl ──────────────────────────────────────────
local function sendToResolve(filePath)
    local resultFile = TEMP_DIR .. "/_import_result.json"
    local tmpFile = TEMP_DIR .. "/_import_request.json"

    local normalizedPath = filePath:gsub("\\", "/")
    local json = '{"filePath":"' .. normalizedPath .. '"}'
    local f = io.open(tmpFile, "w")
    if not f then
        log("ERROR: Could not write temp file")
        return nil
    end
    f:write(json)
    f:close()

    local curlCmd = 'curl -sf -X PUT "' .. SERVER_URL .. '/api/reaper/import-to-resolve" '
        .. '-H "Content-Type: application/json" '
        .. '-d @"' .. tmpFile .. '" '
        .. '-o "' .. resultFile .. '" 2>&1'

    log("Sending to Resolve: " .. filePath)
    local handle = io.popen(curlCmd)
    if not handle then
        log("ERROR: Failed to run curl")
        os.remove(tmpFile)
        return nil
    end
    local result = handle:read("*a")
    handle:close()
    os.remove(tmpFile)

    local rf = io.open(resultFile, "r")
    if rf then
        local json = rf:read("*a")
        rf:close()
        os.remove(resultFile)
        return json
    end

    return result
end

-- ── Main ───────────────────────────────────────────────────
local function main()
    local config = readConfigFromRenderScript()

    if not config then
        log("No render script found in " .. TEMP_DIR)
        reaper.ShowMessageBox(
            "No render configuration found.\n\n"
            .. "First send audio from DaVinci to REAPER\n"
            .. "(ResolveLink panel > Send Audio to REAPER).",
            "ResolveLink", 0)
        return
    end

    log("Export dir: " .. config.exportDir)
    log("Export path: " .. config.exportPath)

    ensureDir(config.exportDir)

    local wavPath = config.exportDir .. "/" .. (config.exportPath:match("([^/\\]+)$") or "output") .. ".wav"

    local preRenderPath, preRenderTime, preRenderSize = findLatestAudio(config.exportDir)

    if AUTO_RENDER then
        local fileName = config.exportPath:match("([^/\\]+)$") or config.exportPath
        fileName = fileName:gsub("%.[^.]+$", "")

        log("Auto-render: RENDER_FILE=" .. config.exportDir .. " RENDER_PATTERN=" .. fileName)
        reaper.GetSetProjectInfo_String(0, "RENDER_FILE", config.exportDir, true)
        reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", fileName, true)
        reaper.GetSetProjectInfo_String(0, "RENDER_SRATE", "48000", true)

        log("Auto-render: triggering render (41824)...")
        reaper.Main_OnCommand(41824, 0)
        log("Auto-render: render command returned.")

        reaper.defer(function() end)
    end

    local renderPath, renderTime, renderSize = findLatestAudio(config.exportDir)

    if not renderPath then
        log("No rendered audio found in " .. config.exportDir)
        reaper.ShowMessageBox(
            "No rendered audio files found in:\n" .. config.exportDir
            .. "\n\nMake sure your project has audio items to render.",
            "ResolveLink", 0)
        return
    end

    if AUTO_RENDER and preRenderPath and renderPath == preRenderPath and renderTime <= preRenderTime and renderSize == preRenderSize then
        log("WARNING: File unchanged after render (same path, time, and size). Sending latest anyway.")
    end

    log("Found render: " .. renderPath)

    local result = sendToResolve(renderPath)

    if result then
        log("Server response: " .. result)
        if result:find('"success":true') then
            log("Import complete!")
            reaper.ShowMessageBox("Audio imported into DaVinci Resolve!", "ResolveLink", 0)
        else
            log("Import may have failed. Check server logs.")
            reaper.ShowMessageBox("Import may have failed. Check REAPER console.", "ResolveLink", 0)
        end
    else
        log("ERROR: No response from server. Is ResolveLink running?")
        reaper.ShowMessageBox("Could not reach ResolveLink server.\nMake sure the server is running.", "ResolveLink", 0)
    end
end

main()
