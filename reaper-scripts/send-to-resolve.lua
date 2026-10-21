-- @reapack ResolveLink Send to Resolve
-- @version 1.5.0
-- @author OseMine
-- @repository https://github.com/OseMine/ResolveLink
--
-- ResolveLink - Send Rendered Audio to DaVinci Resolve
-- =====================================================
-- Reads config from the latest render script in temp/,
-- auto-renders using those settings, then sends the
-- rendered WAV to DaVinci Resolve via the server.
-- Supports auto-import-back after render, content-hash change detection.
--
-- Usage: Actions > Show action list > Load > select this file
-- Then assign to a toolbar button for easy access.

local SERVER_URL = "http://127.0.0.1:3030"
local TEMP_DIR = ""
local AUTO_RENDER = true
local AUTO_IMPORT_BACK = true

local scriptDir = debug.getinfo(1, "S").source:match("@?(.*/)")
if not scriptDir then
    scriptDir = reaper.GetResourcePath() .. "/Scripts/ResolveLink/"
end
local renderLib = dofile(scriptDir .. "render-lib.lua")

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

-- ── Logger ──────────────────────────────────────────────────
local logger = dofile(scriptDir .. "resolve-link-logger.lua")
local function log(msg) logger.info(msg, "SendResolve") end
local function logwarn(msg) logger.warn(msg, "SendResolve") end
local function logerr(msg) logger.error(msg, "SendResolve") end

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

-- ── File Locking ────────────────────────────────────────────
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

-- ── SHA256 hash for content-based change detection ───────────
local function sha256_file(path)
    -- Try to use LuaCrypto if available
    local crypto_ok, crypto = pcall(require, "crypto")
    if crypto_ok then
        local f = io.open(path, "rb")
        if f then
            local content = f:read("*a")
            f:close()
            return crypto.digest("sha256", content)
        end
    end
    -- Fallback: use file size + mod time as pseudo-hash
    local f = io.open(path, "r")
    if f then
        local size = f:seek("end") or 0
        f:close()
        local modTime = 0
        if reaper.GetFileModTime then
            modTime = reaper.GetFileModTime(path) or 0
        end
        return string.format("%x_%x", modTime, size)
    end
    return nil
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

-- ── Find latest audio file in directory (with content hash) ───
local function findLatestAudio(dir)
    local latestFile = nil
    local latestTime = 0
    local latestSize = 0
    local latestHash = nil
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
                -- Content-hash-based change detection
                local hash = sha256_file(fullPath)
                if modTime > latestTime or (modTime == latestTime and size >= latestSize) then
                    latestTime = modTime
                    latestSize = size
                    latestHash = hash
                    latestFile = fullPath
                end
            end
        end
        idx = idx + 1
    end

    return latestFile, latestTime, latestSize, latestHash
end

-- ── Auto-import-back after render ────────────────────────────
local function autoImportBack(linkId, exportDir)
    if not AUTO_IMPORT_BACK then return end
    
    log("Auto-import-back triggered for link: " .. linkId)
    
    -- Find the latest rendered audio file
    local latestFile, latestTime, latestSize, latestHash = findLatestAudio(exportDir)
    
    if latestFile then
        log("Found render: " .. latestFile .. " (size: " .. latestSize .. ", hash: " .. (latestHash or "unknown") .. ")")
        
        -- Send to Resolve via server
        local result = renderLib.sendFileToResolve(SERVER_URL, latestFile, TEMP_DIR)
        if result then
            log("Auto-import-back complete: " .. result)
        else
            log("Auto-import-back failed")
        end
    else
        log("No rendered audio found for auto-import-back")
    end
end

-- ── HTTP via curl ──────────────────────────────────────────
local function sendToResolve(filePath)
    log("Sending to Resolve: " .. filePath)
    local resp, err = renderLib.sendFileToResolve(SERVER_URL, filePath, TEMP_DIR)
    if not resp then
        log("ERROR: " .. (err or "Failed to run curl"))
        return nil
    end
    return resp
end

-- ── Main ───────────────────────────────────────────────────
local function main()
    local config = readConfigFromRenderScript()

    if not config then
        log("No render script found in " .. TEMP_DIR)
        reaper.ShowMessageBox(
            "No render configuration found.\n\n" ..
            "First send audio from DaVinci to REAPER\n" ..
            "(ResolveLink panel > Send Audio to REAPER).",
            "ResolveLink", 0)
        return
    end

    log("Export dir: " .. config.exportDir)
    log("Export path: " .. config.exportPath)

    renderLib.ensureDir(config.exportDir)

    local wavPath = config.exportDir .. "/" .. (config.exportPath:match("([^/\\]+)$") or "output") .. ".wav"

    local preRenderPath, preRenderTime, preRenderSize, preRenderHash = findLatestAudio(config.exportDir)

    if AUTO_RENDER then
        local fileName = config.exportPath:match("([^/\\]+)$") or config.exportPath
        fileName = fileName:gsub("%.[^.]+$", "")

        log("Auto-render: RENDER_FILE=" .. config.exportDir .. " RENDER_PATTERN=" .. fileName)
        reaper.GetSetProjectInfo_String(0, "RENDER_FILE", config.exportDir, true)
        reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", fileName, true)
        reaper.GetSetProjectInfo_String(0, "RENDER_SRATE", "48000", true)

        log("Auto-render: triggering render (40015)...")
        reaper.Main_OnCommand(40015, 0) -- File: Render to file
        log("Auto-render: render command returned.")

        reaper.defer(function() end)
    end

    local renderPath, renderTime, renderSize, renderHash = findLatestAudio(config.exportDir)

    if not renderPath then
        log("No rendered audio found in " .. config.exportDir)
        reaper.ShowMessageBox(
            "No rendered audio files found in:\n" .. config.exportDir
            .. "\n\nMake sure your project has audio items to render.",
            "ResolveLink", 0)
        return
    end

    -- Content-hash-based change detection
    if AUTO_RENDER and preRenderPath and renderPath == preRenderPath and renderTime <= preRenderTime and renderSize == preRenderSize and renderHash == preRenderHash then
        log("WARNING: File unchanged after render (same path, time, size, and hash). Sending latest anyway.")
    end

    log("Found render: " .. renderPath .. " (hash: " .. (renderHash or "unknown") .. ")")

    local result = sendToResolve(renderPath)

    if result then
        log("Server response: " .. result)
        if result:find('"success":true') then
            log("Import complete!")
            reaper.ShowMessageBox("Audio imported into DaVinci Resolve!", "ResolveLink", 0)
            
            -- Trigger auto-import-back after successful import
            if AUTO_IMPORT_BACK and config.linkId then
                autoImportBack(config.linkId, config.exportDir)
            end
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