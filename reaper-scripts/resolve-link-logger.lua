-- @reapack ResolveLink Logger
-- @version 1.0.0
-- @author Oskar
-- @repository https://github.com/OseMine/ResolveLink
--
-- Toggleable logger for ResolveLink scripts.
-- Logs are displayed in the REAPER console (View > Open console).
--
-- Enable/disable via: Scripts > ResolveLink > Toggle Logger
-- Or call from other scripts: local log = dofile(scriptDir .. "resolve-link-logger.lua")

local M = {}
local LOG_FILE = nil
local LOG_ENABLED = true

-- Persistent state stored in REAPER extstate
local EXT_STATE_SECTION = "ResolveLink"
local EXT_STATE_KEY = "LoggerEnabled"

-- Load persisted state
local function loadState()
    local val = reaper.GetExtState(EXT_STATE_SECTION, EXT_STATE_KEY)
    if val == "0" then
        LOG_ENABLED = false
    elseif val == "1" then
        LOG_ENABLED = true
    end
end

local function saveState()
    reaper.SetExtState(EXT_STATE_SECTION, EXT_STATE_KEY, LOG_ENABLED and "1" or "0", true)
end

loadState()

function M.isEnabled()
    return LOG_ENABLED
end

function M.setEnabled(enabled)
    LOG_ENABLED = enabled
    saveState()
    if enabled then
        reaper.ShowConsoleMsg("[ResolveLink] Logger ENABLED\n")
    else
        reaper.ShowConsoleMsg("[ResolveLink] Logger DISABLED\n")
    end
end

function M.toggle()
    M.setEnabled(not LOG_ENABLED)
end

function M.info(msg, tag)
    if not LOG_ENABLED then return end
    tag = tag or "INFO"
    reaper.ShowConsoleMsg("[ResolveLink][" .. tag .. "] " .. os.date("%H:%M:%S") .. "  " .. msg .. "\n")
end

function M.warn(msg, tag)
    if not LOG_ENABLED then return end
    tag = tag or "WARN"
    reaper.ShowConsoleMsg("[ResolveLink][" .. tag .. "] " .. os.date("%H:%M:%S") .. "  " .. msg .. "\n")
end

function M.error(msg, tag)
    if not LOG_ENABLED then return end
    tag = tag or "ERROR"
    reaper.ShowConsoleMsg("[ResolveLink][" .. tag .. "] " .. os.date("%H:%M:%S") .. "  " .. msg .. "\n")
end

function M.debug(msg, tag)
    if not LOG_ENABLED then return end
    tag = tag or "DEBUG"
    reaper.ShowConsoleMsg("[ResolveLink][" .. tag .. "] " .. os.date("%H:%M:%S") .. "  " .. msg .. "\n")
end

-- Log an HTTP request
function M.http(method, url, status)
    if not LOG_ENABLED then return end
    local statusStr = status and (" -> " .. tostring(status)) or ""
    reaper.ShowConsoleMsg("[ResolveLink][HTTP] " .. os.date("%H:%M:%S") .. "  " .. method .. " " .. url .. statusStr .. "\n")
end

-- Log a file operation
function M.file(action, path)
    if not LOG_ENABLED then return end
    reaper.ShowConsoleMsg("[ResolveLink][FILE] " .. os.date("%H:%M:%S") .. "  " .. action .. " " .. path .. "\n")
end

-- Toggle command (for assigning to a toolbar button or action)
local function toggleCmd()
    M.toggle()
end

-- If run directly (not dofile'd), toggle the logger
if debug.getinfo(2) == nil then
    toggleCmd()
end

return M
