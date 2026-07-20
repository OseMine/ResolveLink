-- @reapack ResolveLink Send to Resolve
-- @version 1.0.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
--
-- ResolveLink - Send Rendered Audio to DaVinci Resolve
-- =====================================================
-- Renders current REAPER project to WAV, then imports it
-- into DaVinci Resolve via the ResolveLink server.
--
-- Usage: Actions > Show action list > Load > select this file
-- Then assign to a toolbar button for easy access.

local SERVER_URL = "http://127.0.0.1:3030"
local RENDER_DIR = "X:/coding/AE-Link/exports/reaper-renders"

-- ── Helpers ────────────────────────────────────────────────
local function log(msg)
    reaper.ShowConsoleMsg("[ResolveLink] " .. os.date("%H:%M:%S") .. "  " .. msg .. "\n")
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

local function getTimestamp()
    return os.date("%Y%m%d_%H%M%S")
end

-- ── Render project to WAV ──────────────────────────────────
local function renderProject()
    ensureDir(RENDER_DIR)

    -- Get project name for filename
    local projName = reaper.GetProjectName(0, "")
    if projName == "" then projName = "untitled" end
    projName = projName:gsub("%.RPP$", "")

    local timestamp = getTimestamp()
    local outputPath = RENDER_DIR .. "/" .. projName .. "_" .. timestamp .. ".wav"

    -- Save current render settings
    local _, renderFile = reaper.GetSetProjectInfo_String(0, "RENDER_FILE", "", false)
    local _, renderPattern = reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", "", false)

    -- Set render to single file WAV
    reaper.GetSetProjectInfo_String(0, "RENDER_FILE", outputPath, true)
    reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", "", true)

    -- Render (command 40010 = File: Render project, using last render settings)
    reaper.Main_OnCommand(40010, 0)

    -- Restore original render settings
    reaper.GetSetProjectInfo_String(0, "RENDER_FILE", renderFile, true)
    reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", renderPattern, true)

    return outputPath
end

-- ── HTTP via curl (most reliable on Windows) ───────────────
local function sendToResolve(filePath)
    ensureDir(RENDER_DIR)
    local resultFile = RENDER_DIR .. "/import_result.json"

    local curlCmd = 'curl -sf -X PUT "' .. SERVER_URL .. '/api/reaper/import-to-resolve" '
        .. '-H "Content-Type: application/json" '
        .. '-d "{\\"filePath\\": \\"'" .. filePath:gsub("\\", "/"):gsub('"', '\\"') .. '\\"}" '
        .. '-o "' .. resultFile .. '" 2>&1'

    log("Sending to Resolve: " .. filePath)
    local handle = io.popen(curlCmd)
    if not handle then
        log("ERROR: Failed to run curl")
        return nil
    end
    local result = handle:read("*a")
    handle:close()

    -- Read result file
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
    log("Starting render...")

    local outputPath = renderProject()
    log("Rendered to: " .. outputPath)

    -- Wait for file to appear
    local waitTime = 0
    while not fileExists(outputPath) and waitTime < 30 do
        reaper.defer(function()
            waitTime = waitTime + 0.1
        end)
    end

    if not fileExists(outputPath) then
        log("ERROR: Rendered file not found after 30s: " .. outputPath)
        reaper.ShowMessageBox("Render failed. File not found:\n" .. outputPath, "ResolveLink", 0)
        return
    end

    log("File ready, sending to Resolve...")
    local result = sendToResolve(outputPath)

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
