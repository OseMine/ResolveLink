-- @reapack ResolveLink Send to Resolve
-- @version 1.2.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
--
-- ResolveLink - Send Rendered Audio to DaVinci Resolve
-- =====================================================
-- Optionally auto-renders the project (using your most recently
-- used render settings), then imports the newest WAV from the
-- REAPER render directory into DaVinci Resolve via the
-- ResolveLink server.
--
-- Setup (one-time):
--   File > Render, set the output directory to match RENDER_DIR
--   below, and render once so REAPER remembers these settings.
--
-- Usage:
--   1. (Optional, if AUTO_RENDER is true) Just click the button -
--      the script renders for you automatically.
--   2. (If AUTO_RENDER is false) Render manually first
--      (File > Render), then click this script's button.
--   3. Audio appears in DaVinci Resolve.
--
-- Usage: Actions > Show action list > Load > select this file
-- Then assign to a toolbar button for easy access.

local SERVER_URL = "http://127.0.0.1:3030"
local RENDER_DIR = "X:/coding/AE-Link/exports/reaper-renders"

-- ── Auto-render settings ────────────────────────────────────
-- If true, the script triggers a render using REAPER's "most
-- recent render settings" before looking for a file to send.
-- If false, the script only looks for a file that was already
-- rendered manually (original behavior).
local AUTO_RENDER = true

-- Action ID for "File: Render project, using the most recent
-- render settings". This shows the render progress dialog and
-- blocks script execution until the render finishes.
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

-- ── Find latest WAV/MP3/FLAC/AIFF in render directory ───────
-- Returns the full path and mod-time of the newest matching file,
-- or nil if none exist.
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

    return latestFile, latestTime
end

-- ── Trigger a render using REAPER's most recent render settings ─
local function triggerRender()
    ensureDir(RENDER_DIR)
    log("Auto-render: setting render output to " .. RENDER_DIR)
    reaper.GetSetProjectInfo_String(0, "RENDER_FILE", RENDER_DIR, true)
    reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", "", true)
    log("Auto-render: starting render with most recent render settings...")
    reaper.Main_OnCommand(RENDER_COMMAND_ID, 0)
    log("Auto-render: render command returned.")
end

-- ── HTTP via curl ──────────────────────────────────────────
local function sendToResolve(filePath)
    ensureDir(RENDER_DIR)
    local resultFile = RENDER_DIR .. "/import_result.json"
    local tmpFile = os.tmpname() .. ".json"

    local normalizedPath = filePath:gsub("\\", "/")
    local json = '{"filePath":"' .. normalizedPath .. '"}'
    local tmpFile = RENDER_DIR .. "/_import_request.json"
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
    -- Remember what the newest render was before we (maybe) render,
    -- so we can confirm a NEW file actually showed up afterwards.
    local preRenderPath, preRenderTime = findLatestRender()

    if AUTO_RENDER then
        triggerRender()
    end

    local renderPath, renderTime = findLatestRender()

    if not renderPath then
        log("No rendered audio found in " .. RENDER_DIR)
        reaper.ShowMessageBox(
            "No rendered audio files found.\n\n"
            .. (AUTO_RENDER
                and ("Auto-render ran, but no output landed in:\n" .. RENDER_DIR
                    .. "\n\nMake sure your project's render output path is\n"
                    .. "set to this folder (File > Render), then render once\n"
                    .. "manually so REAPER remembers the settings.")
                or ("First render your project:\n"
                    .. "  File > Render > choose WAV output > Render\n\n"
                    .. "Render directory:\n" .. RENDER_DIR)),
            "ResolveLink", 0)
        return
    end

    if AUTO_RENDER and preRenderPath and renderPath == preRenderPath and renderTime <= preRenderTime then
        log("WARNING: Auto-render did not appear to produce a new file. Sending existing latest render anyway.")
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
