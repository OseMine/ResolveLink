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

local function GetResolve()
    if resolve then return resolve end
    local ok, res = pcall(function()
        return ScriptApp("Resolve")
    end)
    if ok and res then
        resolve = res
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
    if sep == "\\" then
        local localappdata = os.getenv("LOCALAPPDATA") or (os.getenv("USERPROFILE") .. "\\AppData\\Local")
        return localappdata .. "\\ResolveLink"
    else
        local home = os.getenv("HOME") or "~"
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

local function is_windows()
    return package.config:sub(1,1) == "\\"
end

-- ============================================================
-- Helpers
-- ============================================================
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

local function shell_exec(cmd)
    os.execute(cmd)
end

local function wait_seconds(n)
    if is_windows() then
        shell_exec("timeout /t " .. n .. " /nobreak >nul 2>&1")
    else
        shell_exec("sleep " .. n)
    end
end

-- ============================================================
-- Actions
-- ============================================================
local function action_send_to_ae()
    local sep = package.config:sub(1,1)
    local resolve_scripts_dir
    if is_windows() then
        local appdata = os.getenv("APPDATA") or ""
        resolve_scripts_dir = appdata .. "\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Scripts\\Utility"
    else
        local home = os.getenv("HOME") or "~"
        resolve_scripts_dir = home .. "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Support/Fusion/Scripts/Utility"
    end
    local script_path = resolve_scripts_dir .. sep .. "send-to-ae.py"
    if is_windows() then
        script_path = script_path:gsub("/", "\\")
    end
    local fu = Fusion()
    if fu then
        fu:Execute('load("' .. script_path .. '")')
    else
        print("[ResolveLink] Could not access Fusion to run send-to-ae.py")
    end
end

local function action_start_server()
    local dir = get_install_dir()
    if is_windows() then
        shell_exec('powershell -ExecutionPolicy Bypass -File "' .. dir .. '\\scripts\\start.ps1" -NoBrowser')
    else
        shell_exec('bash "' .. dir .. '/scripts/start.sh"')
    end
    print("[ResolveLink] Server starting...")
end

local function action_stop_server()
    local dir = get_install_dir()
    if is_windows() then
        shell_exec('powershell -ExecutionPolicy Bypass -File "' .. dir .. '\\scripts\\stop.ps1"')
    else
        shell_exec('bash "' .. dir .. '/scripts/stop.sh"')
    end
    print("[ResolveLink] Server stopped.")
end

local function action_restart_server()
    action_stop_server()
    wait_seconds(2)
    action_start_server()
end

local function action_status()
    print("")
    print("=== ResolveLink Status ===")
    print("")
    if server_running() then
        print("  Server:    running (" .. SERVER_URL .. ")")
    else
        print("  Server:    STOPPED")
    end
    local r = GetResolve()
    if r then
        print("  Resolve:   connected")
        local proj = get_project_name()
        if proj then print("  Project:   " .. proj) end
        local tl = get_timeline_info()
        if tl then print("  Timeline:  " .. tl.name .. " (" .. tl.frames .. " frames, " .. tl.fps .. " fps)") end
    else
        print("  Resolve:   not available")
    end
    print("  Install:   " .. get_install_dir())
    local health = http_get(SERVER_URL .. "/api/health")
    if health and #health > 0 then print("  Health:    " .. health) end
    print("")
end

local function action_update()
    local dir = get_install_dir()
    print("[ResolveLink] Updating...")
    shell_exec('cd "' .. dir .. '" && git pull')
    if is_windows() then
        shell_exec('powershell -ExecutionPolicy Bypass -File "' .. dir .. '\\scripts\\setup.ps1" -NoBrowser -Force')
    else
        shell_exec('bash "' .. dir .. '/scripts/setup.sh" --force')
    end
    print("[ResolveLink] Update complete!")
end

local function action_open_web()
    if server_running() then
        if is_windows() then
            shell_exec('start "" "' .. SERVER_URL .. '"')
        else
            shell_exec('open "' .. SERVER_URL .. '"')
        end
    else
        print("[ResolveLink] Server not running. Start it first.")
    end
end

-- ============================================================
-- UI Dialog (Fusion UIManager — DaVinci Resolve 17+)
-- ============================================================
local function show_dialog()
    local fu = Fusion()
    if not fu then
        print("[ResolveLink] Fusion not available. Running status check instead.")
        action_status()
        return
    end

    local ui = fu.UIManager
    local disp = bmd.UIDispatcher(fu)
    if not ui or not disp then
        print("[ResolveLink] Fusion UI Manager not available. Running status check instead.")
        action_status()
        return
    end

    -- Check server status
    local isRunning = server_running()
    local statusColor = isRunning and "#4CAF50" or "#F44336"
    local statusText = isRunning and "Server running" or "Server stopped"

    -- Build window with inline UI hierarchy
    local win = disp:AddWindow({
        ID = "ResolveLink_Launcher",
        WindowTitle = "ResolveLink",
        Geometry = { 100, 100, 340, 480 },

        ui:VGroup{
            ID = "RootLayout",

            -- Header
            ui:Label{
                ID = "Header",
                Text = "<h2>ResolveLink</h2>",
            },
            ui:Label{
                ID = "Status",
                Text = "<span style='color:" .. statusColor .. ";'>● " .. statusText .. "</span>",
            },
            ui:Label{ Text = "<hr/>" },

            -- Quick Actions
            ui:Label{
                ID = "QuickTitle",
                Text = "<b>Quick Actions</b>",
            },
            ui:PushButton{
                ID = "SendBtn",
                Text = "Send Clips to After Effects",
                MinimumSize = { 300, 32 },
            },
            ui:PushButton{
                ID = "WebBtn",
                Text = "Open Web UI",
                MinimumSize = { 300, 28 },
            },
            ui:Label{ Text = "<hr/>" },

            -- Server Control
            ui:Label{
                ID = "ServerTitle",
                Text = "<b>Server Control</b>",
            },
            ui:HGroup{
                ID = "ServerBtns",
                ui:PushButton{ ID = "StartBtn", Text = "Start", MinimumSize = { 95, 28 } },
                ui:PushButton{ ID = "StopBtn", Text = "Stop", MinimumSize = { 95, 28 } },
                ui:PushButton{ ID = "RestartBtn", Text = "Restart", MinimumSize = { 95, 28 } },
            },
            ui:Label{ Text = "<hr/>" },

            -- System
            ui:Label{
                ID = "SysTitle",
                Text = "<b>System</b>",
            },
            ui:PushButton{
                ID = "StatusBtn",
                Text = "Check Status",
                MinimumSize = { 300, 28 },
            },
            ui:PushButton{
                ID = "UpdateBtn",
                Text = "Update ResolveLink",
                MinimumSize = { 300, 28 },
            },
            ui:Label{ Text = "<hr/>" },

            ui:Label{
                ID = "Footer",
                Text = "<span style='color:#666;'>v1.0.0 — github.com/OseMine/ResolveLink</span>",
            },
        },
    })

    local items = win:GetItems()

    -- Event handlers
    function win.On.ResolveLink_Launcher.Close(ev)
        disp:ExitLoop()
    end

    function win.On.SendBtn.Clicked(ev)
        action_send_to_ae()
    end

    function win.On.WebBtn.Clicked(ev)
        action_open_web()
    end

    function win.On.StartBtn.Clicked(ev)
        action_start_server()
        wait_seconds(3)
        local now = server_running()
        local col = now and "#4CAF50" or "#F44336"
        local txt = now and "Server running" or "Server still stopped"
        items.Status.Text = "<span style='color:" .. col .. ";'>● " .. txt .. "</span>"
    end

    function win.On.StopBtn.Clicked(ev)
        action_stop_server()
        items.Status.Text = "<span style='color:#F44336;'>● Server stopped</span>"
    end

    function win.On.RestartBtn.Clicked(ev)
        action_restart_server()
        wait_seconds(4)
        local now = server_running()
        local col = now and "#4CAF50" or "#F44336"
        local txt = now and "Server running" or "Server still stopped"
        items.Status.Text = "<span style='color:" .. col .. ";'>● " .. txt .. "</span>"
    end

    function win.On.StatusBtn.Clicked(ev)
        action_status()
    end

    function win.On.UpdateBtn.Clicked(ev)
        action_update()
    end

    win:Show()
    disp:RunLoop()
end

-- ============================================================
-- Main
-- ============================================================
show_dialog()
