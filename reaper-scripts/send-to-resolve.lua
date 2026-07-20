-- @reapack ResolveLink Send to Resolve
-- @version 1.1.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
--
-- ResolveLink - Send Rendered Audio to DaVinci Resolve
-- =====================================================
-- Imports the most recently rendered WAV from the REAPER
-- render directory into DaVinci Resolve via the ResolveLink server.
--
-- 1. Render your project in REAPER (File > Render)
-- 2. Click this script's button
-- 3. Audio appears in DaVinci Resolve
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

-- ── Find latest WAV/MP3 in render directory ────────────────
local function findLatestRender()
    local latestFile = nil
    local latestTime = 0
    local idx = 0

    while true do
        local fn = reaper.EnumerateFiles(RENDER_DIR, idx)
        if not fn then break end

        local lower = fn:lower()
        if lower:match("%.wav$") or lower:match("%.mp3$") or lower:match("%.flac$") or lower:match("%.aiff$") then
            local fullPath = RENDER_DIR .. "/" .. fn
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

    return latestFile
end

-- ── HTTP via curl ──────────────────────────────────────────
local function sendToResolve(filePath)
    ensureDir(RENDER_DIR)
    local resultFile = RENDER_DIR .. "/import_result.json"
    local tmpFile = os.tmpname() .. ".json"

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
    local renderPath = findLatestRender()

    if not renderPath then
        log("No rendered audio found in " .. RENDER_DIR)
        reaper.ShowMessageBox(
            "No rendered audio files found.\n\n"
            .. "First render your project:\n"
            .. "  File > Render > choose WAV output > Render\n\n"
            .. "Render directory:\n" .. RENDER_DIR,
            "ResolveLink", 0)
        return
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
