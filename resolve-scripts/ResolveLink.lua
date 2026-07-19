--[[
    ResolveLink — DaVinci Resolve Launcher
    =======================================
    Run from: Workspace > Scripts > ResolveLink.lua

    Provides a unified interface for all ResolveLink operations:
    - Send clips to After Effects
    - Start / Stop / Restart server
    - Check status
    - Update ResolveLink
    - Open web UI
]]

-- ============================================================
-- Resolve Connection
-- ============================================================
local resolve = nil
local projectManager = nil

local function GetResolve()
    if resolve then return resolve end
    ok, res = pcall(function()
        return ScriptApp("Resolve")
    end)
    if ok and res then
        resolve = res
        projectManager = resolve:GetProjectManager()
        return resolve
    end
    return nil
end

-- ============================================================
-- Config
-- ============================================================
local SERVER_URL = "http://localhost:3030"

local function get_install_dir()
    local sep = package.config:sub(1,1)
    local localappdata = os.getenv("LOCALAPPDATA") or (os.getenv("USERPROFILE") .. "\\AppData\\Local")
    local home = os.getenv("HOME") or os.getenv("USERPROFILE") or "~"

    if sep == "\\" then
        return localappdata .. "\\ResolveLink"
    else
        -- Check macOS vs Linux
        local handle = io.popen("uname -s 2>/dev/null")
        if handle then
            local uname = handle:read("*a"):gsub("%s+", "")
            handle:close()
            if uname == "Darwin" then
                return home .. "/Applications/ResolveLink"
            end
        end
        return home .. "/.local/share/ResolveLink"
    end
end

local function get_scripts_ext()
    return package.config:sub(1,1) == "\\" and ".ps1" or ".sh"
end

-- ============================================================
-- Helpers
-- ============================================================
local function run(cmd)
    local handle = io.popen(cmd .. " 2>&1")
    if not handle then return nil end
    local result = handle:read("*a")
    handle:close()
    return result:gsub("%s+$", "")
end

local function http_get(url)
    local handle = io.popen('curl -sf "' .. url .. '" 2>&1')
    if not handle then return nil end
    local result = handle:read("*a")
    handle:close()
    return result:gsub("%s+$", "")
end

local function server_running()
    local resp = http_get(SERVER_URL .. "/api/health")
    return resp and resp:find("ok") ~= nil
end

local function get_project_name()
    local r = GetResolve()
    if not r then return nil end
    local pm = r:GetProjectManager()
    if not pm then return nil end
    local proj = pm:GetCurrentProject()
    if not proj then return nil end
    return proj:GetName()
end

local function get_timeline_info()
    local r = GetResolve()
    if not r then return nil end
    local pm = r:GetProjectManager()
    if not pm then return nil end
    local proj = pm:GetCurrentProject()
    if not proj then return nil end
    local tl = proj:GetCurrentTimeline()
    if not tl then return nil end
    return {
        name = tl:GetName(),
        frames = tl:GetTimelineFrameCount(),
        fps = tl:GetTimelineFrameRate(),
    }
end

-- ============================================================
-- Actions
-- ============================================================
local function action_send_to_ae()
    -- Run the Python send script
    local sep = package.config:sub(1,1)
    local resolve_scripts_dir

    if sep == "\\" then
        local appdata = os.getenv("APPDATA") or ""
        resolve_scripts_dir = appdata .. "\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Scripts\\Utility"
    else
        local home = os.getenv("HOME") or "~"
        resolve_scripts_dir = home .. "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Support/Fusion/Scripts/Utility"
    end

    local script_path = resolve_scripts_dir .. sep .. "send-to-ae.py"
    if sep == "\\" then
        script_path = script_path:gsub("/", "\\")
    end

    local fusion = Fusion()
    if fusion then
        fusion:Execute('load("' .. script_path .. '")')
    else
        print("[ResolveLink] Could not access Fusion to run send-to-ae.py")
    end
end

local function action_start_server()
    local dir = get_install_dir()
    local ext = get_scripts_ext()
    if ext == ".ps1" then
        os.execute('powershell -ExecutionPolicy Bypass -File "' .. dir .. '\\scripts\\start.ps1" -NoBrowser')
    else
        os.execute('bash "' .. dir .. '/scripts/start.sh"')
    end
    print("[ResolveLink] Server starting...")
end

local function action_stop_server()
    local dir = get_install_dir()
    local ext = get_scripts_ext()
    if ext == ".ps1" then
        os.execute('powershell -ExecutionPolicy Bypass -File "' .. dir .. '\\scripts\\stop.ps1"')
    else
        os.execute('bash "' .. dir .. '/scripts/stop.sh"')
    end
    print("[ResolveLink] Server stopped.")
end

local function action_restart_server()
    action_stop_server()
    -- brief pause
    if package.config:sub(1,1) == "\\" then
        os.execute("timeout /t 2 /nobreak >nul 2>&1")
    else
        os.execute("sleep 2")
    end
    action_start_server()
end

local function action_status()
    print("")
    print("=== ResolveLink Status ===")
    print("")

    -- Server
    if server_running() then
        print("  Server:    running (" .. SERVER_URL .. ")")
    else
        print("  Server:    STOPPED")
    end

    -- Resolve
    local r = GetResolve()
    if r then
        print("  Resolve:   connected")
        local proj = get_project_name()
        if proj then
            print("  Project:   " .. proj)
        end
        local tl = get_timeline_info()
        if tl then
            print("  Timeline:  " .. tl.name .. " (" .. tl.frames .. " frames, " .. tl.fps .. " fps)")
        end
    else
        print("  Resolve:   not available")
    end

    -- Install dir
    print("  Install:   " .. get_install_dir())

    -- Server health endpoint
    local health = http_get(SERVER_URL .. "/api/health")
    if health and #health > 0 then
        print("  Health:    " .. health)
    end

    print("")
end

local function action_update()
    local dir = get_install_dir()
    print("[ResolveLink] Updating...")
    os.execute('cd "' .. dir .. '" && git pull')
    -- Re-run setup
    local ext = get_scripts_ext()
    if ext == ".ps1" then
        os.execute('powershell -ExecutionPolicy Bypass -File "' .. dir .. '\\scripts\\setup.ps1" -NoBrowser -Force')
    else
        os.execute('bash "' .. dir .. '/scripts/setup.sh" --force')
    end
    print("[ResolveLink] Update complete!")
end

local function action_open_web()
    if server_running() then
        os.execute('start "" "' .. SERVER_URL .. '"')
    else
        print("[ResolveLink] Server not running. Start it first.")
    end
end

-- ============================================================
-- UI Dialog
-- ============================================================
local function show_dialog()
    local sep = package.config:sub(1,1)

    -- Fusion UI
    local ui = fusion:UI()
    if not ui then
        print("[ResolveLink] Fusion UI not available. Use scripts directly.")
        return
    end

    local win = ui:NewWindow({
        Identifier = "ResolveLink_Launcher",
        WindowTitle = "ResolveLink",
        WindowFlags = {
            Window = true,
            CustomizeWindowHint = true,
        },
        Geometry = {
            X = 0, Y = 0,
            Width = 340, Height = 480,
        },
    })

    local winId = ui:ID("ResolveLinkMain")

    -- Build layout
    local layout = ui:VGroup(winId)
    layout:SetSpacing(8)
    layout:SetContentsMargins(12, 12, 12, 12)

    -- Header
    local header = ui:HGroup(winId)
    local title = ui:Label(winId)
    title.Text = "<h2 style='color:#E0E0E0;'>ResolveLink</h2>"
    header:Add(title)

    -- Status indicator
    local statusLabel = ui:Label(winId)
    if server_running() then
        statusLabel.Text = "<span style='color:#4CAF50;'>● Server running</span>"
    else
        statusLabel.Text = "<span style='color:#F44336;'>● Server stopped</span>"
    end
    layout:Add(statusLabel)

    -- Separator
    layout:Add(ui:HSeparator(winId))

    -- === Quick Actions ===
    local quickGroup = ui:VGroup(winId)
    quickGroup:SetSpacing(4)

    local quickLabel = ui:Label(winId)
    quickLabel.Text = "<b style='color:#9E9E9E;'>Quick Actions</b>"
    quickGroup:Add(quickLabel)

    -- Send to AE button
    local sendBtn = ui:PushButton(winId)
    sendBtn.Text = "Send Clips to After Effects"
    sendBtn.MinimumSize = ui:Size(300, 32)
    sendBtn.Clicked = function()
        action_send_to_ae()
    end
    quickGroup:Add(sendBtn)

    -- Open Web UI button
    local webBtn = ui:PushButton(winId)
    webBtn.Text = "Open Web UI"
    webBtn.MinimumSize = ui:Size(300, 28)
    webBtn.Clicked = function()
        action_open_web()
    end
    quickGroup:Add(webBtn)

    layout:Add(quickGroup)

    -- Separator
    layout:Add(ui:HSeparator(winId))

    -- === Server Control ===
    local serverGroup = ui:VGroup(winId)
    serverGroup:SetSpacing(4)

    local serverLabel = ui:Label(winId)
    serverLabel.Text = "<b style='color:#9E9E9E;'>Server Control</b>"
    serverGroup:Add(serverLabel)

    local serverBtns = ui:HGroup(winId)
    serverBtns:SetSpacing(6)

    local startBtn = ui:PushButton(winId)
    startBtn.Text = "Start"
    startBtn.MinimumSize = ui:Size(95, 28)
    startBtn.Clicked = function()
        action_start_server()
        -- Refresh status after a moment
        if package.config:sub(1,1) == "\\" then
            os.execute("timeout /t 3 /nobreak >nul 2>&1")
        else
            os.execute("sleep 3")
        end
        if server_running() then
            statusLabel.Text = "<span style='color:#4CAF50;'>● Server running</span>"
        end
    end
    serverBtns:Add(startBtn)

    local stopBtn = ui:PushButton(winId)
    stopBtn.Text = "Stop"
    stopBtn.MinimumSize = ui:Size(95, 28)
    stopBtn.Clicked = function()
        action_stop_server()
        statusLabel.Text = "<span style='color:#F44336;'>● Server stopped</span>"
    end
    serverBtns:Add(stopBtn)

    local restartBtn = ui:PushButton(winId)
    restartBtn.Text = "Restart"
    restartBtn.MinimumSize = ui:Size(95, 28)
    restartBtn.Clicked = function()
        action_restart_server()
        if package.config:sub(1,1) == "\\" then
            os.execute("timeout /t 4 /nobreak >nul 2>&1")
        else
            os.execute("sleep 4")
        end
        if server_running() then
            statusLabel.Text = "<span style='color:#4CAF50;'>● Server running</span>"
        else
            statusLabel.Text = "<span style='color:#F44336;'>● Server stopped</span>"
        end
    end
    serverBtns:Add(restartBtn)

    layout:Add(serverBtns)

    -- Separator
    layout:Add(ui:HSeparator(winId))

    -- === System ===
    local sysGroup = ui:VGroup(winId)
    sysGroup:SetSpacing(4)

    local sysLabel = ui:Label(winId)
    sysLabel.Text = "<b style='color:#9E9E9E;'>System</b>"
    sysGroup:Add(sysLabel)

    local statusBtn = ui:PushButton(winId)
    statusBtn.Text = "Check Status"
    statusBtn.MinimumSize = ui:Size(300, 28)
    statusBtn.Clicked = function()
        action_status()
    end
    sysGroup:Add(statusBtn)

    local updateBtn = ui:PushButton(winId)
    updateBtn.Text = "Update ResolveLink"
    updateBtn.MinimumSize = ui:Size(300, 28)
    updateBtn.Clicked = function()
        action_update()
    end
    sysGroup:Add(updateBtn)

    layout:Add(sysGroup)

    -- Footer
    layout:Add(ui:HSeparator(winId))
    local footer = ui:Label(winId)
    footer.Text = "<span style='color:#666666; font-size:10px;'>v1.0.0 — github.com/OseMine/ResolveLink</span>"
    layout:Add(footer)

    -- Show
    win:Show()
end

-- ============================================================
-- Main — show the dialog
-- ============================================================
show_dialog()
