-- @reapack ResolveLink Send to Resolve
-- @version 1.3.0
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
local TEMP_DIR = "X:/coding/AE-Link/temp"

local AUTO_RENDER = false

-- Action ID for "File: Render project, using the most recent
-- render settings". Set to nil if your REAPER version doesn't have it.
local RENDER_COMMAND_ID = 41824

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

-- ── Read config from latest render script in temp/ ──────────
-- Scans for render_*_reaper.lua, extracts export_dir and export_path.
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

-- ── Find latest audio file matching export path ────────────
local function findLatestAudio(dir, compName)
    local latestFile = nil
    local latestTime = 0
    local idx = 0

    while true do
        local fn = reaper.EnumerateFiles(dir, idx)
        if not fn then break end

        local lower = fn:lower()
        if lower:match("%.wav$") or lower:match("%.mp3$") or lower:match("%.flac$") or lower:match("%.aiff$") then
            -- Prefer matching compName, but accept any audio file
            if not compName or fn:lower():find(compName:lower(), 1, true) then
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
        end
        idx = idx + 1
    end

    return latestFile, latestTime
end

-- ── Auto-render ────────────────────────────────────────────
local function triggerRender(config)
    ensureDir(config.exportDir)

    log("Auto-render: setting render output to " .. config.exportPath)
    reaper.GetSetProjectInfo_String(0, "RENDER_FILE", config.exportPath, true)
    reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", "", true)

    log("Auto-render: starting render...")
    reaper.Main_OnCommand(RENDER_COMMAND_ID, 0)
    log("Auto-render: render command returned.")
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
            .. "(ResolveLink panel > Send Audio to REAPER),\n"
            .. "which creates the render script with paths.",
            "ResolveLink", 0)
        return
    end

    log("Export dir: " .. config.exportDir)
    log("Export path: " .. config.exportPath)

    local preRenderPath, preRenderTime = findLatestAudio(config.exportDir, config.compName)

    if AUTO_RENDER then
        triggerRender(config)
    end

    local renderPath, renderTime = findLatestAudio(config.exportDir, config.compName)

    if not renderPath then
        log("No rendered audio found in " .. config.exportDir)
        reaper.ShowMessageBox(
            "No rendered audio files found in:\n" .. config.exportDir,
            "ResolveLink", 0)
        return
    end

    if AUTO_RENDER and preRenderPath and renderPath == preRenderPath and renderTime <= preRenderTime then
        log("WARNING: Auto-render did not produce a new file. Sending existing latest render.")
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
