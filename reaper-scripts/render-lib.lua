-- render-lib.lua — Shared render config + import logic for REAPER scripts
-- Usage: local renderLib = dofile(scriptDir .. "render-lib.lua")

local M = {}

-- ── Parse render config from JSON file ─────────────────────
function M.readConfig(exportDir, exportPath)
    return {
        exportDir = exportDir or "",
        exportPath = exportPath or "output.wav",
    }
end

-- ── Set REAPER render settings from config ─────────────────
function M.applyRenderConfig(config)
    local dir = config.exportDir
    local fileName = config.exportPath:match("([^/\\]+)$") or config.exportPath
    fileName = fileName:gsub("%.[^.]+$", "")

    reaper.GetSetProjectInfo_String(0, "RENDER_FILE", dir, true)
    reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", fileName, true)
    reaper.GetSetProjectInfo_String(0, "RENDER_SRATE", "48000", true)

    return fileName
end

-- ── Send rendered audio file to ResolveLink server ─────────
-- Returns: response string or nil
function M.sendFileToResolve(serverUrl, filePath, tempDir)
    local resultFile = tempDir .. "/_import_result.json"
    local tmpFile = tempDir .. "/_import_request.json"

    local normalizedPath = filePath:gsub("\\", "/")
    local json = '{"filePath":"' .. normalizedPath .. '"}'
    local f = io.open(tmpFile, "w")
    if not f then return nil, "Could not write temp file" end
    f:write(json)
    f:close()

    local curlCmd = 'curl -sf -X PUT "' .. serverUrl .. '/api/reaper/import-to-resolve" '
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

-- ── Ensure directory exists ────────────────────────────────
function M.ensureDir(dir)
    if reaper.RecursiveCreateDirectory then
        pcall(reaper.RecursiveCreateDirectory, dir, 0)
    end
end

return M
