--[[
    ResolveLink Installer for DaVinci Resolve
    ==========================================
    Paste this into: Workspace > Console > Lua

    What it does:
    1. Detects your OS and checks for Git + Node.js
    2. Installs missing prerequisites if possible
    3. Clones ResolveLink to the standard app directory
    4. Runs the full setup (deps, build, extensions, .env)
    5. Starts the server

    Install locations:
      Windows:  %LOCALAPPDATA%\ResolveLink
      macOS:    ~/Applications/ResolveLink
      Linux:    ~/.local/share/ResolveLink
]]

local function log(msg, color)
    color = color or "white"
    print("[ResolveLink] " .. msg)
end

local function log_ok(msg)    log(msg) end
local function log_warn(msg)  log("WARN: " .. msg) end
local function log_err(msg)   log("ERROR: " .. msg) end
local function log_step(msg)  log(">>> " .. msg) end

-- ============================================================
-- OS Detection
-- ============================================================
local os_name = "unknown"
local os_flag = "unknown"

if package.config:sub(1,1) == "\\" then
    os_name = "Windows"
    os_flag = "win32"
elseif os.execute("uname -s 2>/dev/null") == 0 then
    local handle = io.popen("uname -s 2>/dev/null")
    local uname = handle:read("*a"):gsub("%s+", "")
    handle:close()
    if uname == "Darwin" then
        os_name = "macOS"
        os_flag = "darwin"
    else
        os_name = "Linux"
        os_flag = "linux"
    end
end

log_step("Detected OS: " .. os_name)

-- ============================================================
-- Install directory
-- ============================================================
local install_dir

if os_flag == "win32" then
    local localappdata = os.getenv("LOCALAPPDATA") or os.getenv("USERPROFILE") .. "\\AppData\\Local"
    install_dir = localappdata .. "\\ResolveLink"
elseif os_flag == "darwin" then
    local home = os.getenv("HOME") or os.getenv("USERPROFILE") or "~"
    install_dir = home .. "/Applications/ResolveLink"
else
    local home = os.getenv("HOME") or "~"
    install_dir = home .. "/.local/share/ResolveLink"
end

log("Install directory: " .. install_dir)

-- ============================================================
-- Helper: run command and return output
-- ============================================================
local function run(cmd)
    local handle = io.popen(cmd .. " 2>&1")
    if not handle then return nil end
    local result = handle:read("*a")
    handle:close()
    return result:gsub("%s+$", "")
end

local function file_exists(path)
    local f = io.open(path, "r")
    if f then f:close(); return true end
    return false
end

local function dir_exists(path)
    if os_flag == "win32" then
        local ok = os.execute('if exist "' .. path .. '\\." (exit /b 0) else (exit /b 1)')
        return ok == true or ok == 0
    else
        local ok = os.execute('[ -d "' .. path .. '" ]')
        return ok == true or ok == 0
    end
end

-- ============================================================
-- Step 1: Check and install Git
-- ============================================================
log_step("Checking Git...")
local has_git = run("git --version"):find("git version") ~= nil

if not has_git then
    log_warn("Git not found. Attempting install...")
    if os_flag == "win32" then
        log_err("Please install Git manually: https://git-scm.com/download/win")
        log_err("Then re-run this script.")
        return
    elseif os_flag == "darwin" then
        os.execute("xcode-select --install 2>/dev/null")
        log_warn("A macOS dialog may have appeared. Accept it, then re-run this script.")
        return
    else
        -- Try apt
        local installed = false
        for _, pkg_mgr in ipairs({"apt", "dnf", "pacman", "zypper"}) do
            if os.execute("which " .. pkg_mgr .. " >/dev/null 2>&1") == 0 then
                if pkg_mgr == "apt" then
                    os.execute("sudo apt update && sudo apt install -y git")
                elseif pkg_mgr == "dnf" then
                    os.execute("sudo dnf install -y git")
                elseif pkg_mgr == "pacman" then
                    os.execute("sudo pacman -S --noconfirm git")
                elseif pkg_mgr == "zypper" then
                    os.execute("sudo zypper install -y git")
                end
                installed = run("git --version"):find("git version") ~= nil
                break
            end
        end
        if not installed then
            log_err("Could not install Git automatically.")
            log_err("Install manually and re-run this script.")
            return
        end
    end
end
log_ok("Git found: " .. run("git --version"))

-- ============================================================
-- Step 2: Check and install Node.js
-- ============================================================
log_step("Checking Node.js...")
local has_node = run("node --version"):find("^v%d") ~= nil

if not has_node then
    log_warn("Node.js not found. Attempting install...")
    if os_flag == "win32" then
        log_err("Please install Node.js manually: https://nodejs.org")
        log_err("Then re-run this script.")
        return
    elseif os_flag == "darwin" then
        -- Try brew
        if os.execute("which brew >/dev/null 2>&1") == 0 then
            os.execute("brew install node")
        else
            log_err("Install Node.js manually: https://nodejs.org")
            log_err("Or install Homebrew first: https://brew.sh")
            return
        end
    else
        -- Try nvm or direct
        local installed = false
        if os.execute("which nvm >/dev/null 2>&1") == 0 or file_exists(os.getenv("HOME") .. "/.nvm/nvm.sh") then
            os.execute('bash -c "source ~/.nvm/nvm.sh && nvm install --lts"')
            installed = run("node --version"):find("^v%d") ~= nil
        elseif os.execute("which apt >/dev/null 2>&1") == 0 then
            os.execute("curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -")
            os.execute("sudo apt install -y nodejs")
            installed = run("node --version"):find("^v%d") ~= nil
        end
        if not installed then
            log_err("Could not install Node.js automatically.")
            log_err("Install manually: https://nodejs.org")
            return
        end
    end
end
log_ok("Node.js found: " .. run("node --version"))

-- ============================================================
-- Step 3: Check npm
-- ============================================================
log_step("Checking npm...")
local has_npm = run("npm --version"):find("^%d") ~= nil
if not has_npm then
    log_err("npm not found. Please reinstall Node.js from https://nodejs.org")
    return
end
log_ok("npm found: " .. run("npm --version"))

-- ============================================================
-- Step 4: Clone or update repository
-- ============================================================
local repo = "https://github.com/OseMine/ResolveLink.git"

if dir_exists(install_dir .. "/.git") then
    log_step("ResolveLink already installed. Updating...")
    os.execute('cd "' .. install_dir .. '" && git pull')
else
    log_step("Cloning ResolveLink to " .. install_dir .. "...")
    if dir_exists(install_dir) then
        log_warn("Directory exists but is not a git repo. Removing...")
        if os_flag == "win32" then
            os.execute('rmdir /s /q "' .. install_dir .. '"')
        else
            os.execute('rm -rf "' .. install_dir .. '"')
        end
    end
    -- Spawn git clone in background, then poll for completion
    if os_flag == "win32" then
        os.execute('start "" /b cmd /c git clone "' .. repo .. '" "' .. install_dir .. '"')
    else
        os.execute('nohup git clone "' .. repo .. '" "' .. install_dir .. '" >/dev/null 2>&1 &')
    end
end

-- Wait for clone to finish (some Lua embeds don't block on io.popen)
local wait = 0
while not dir_exists(install_dir .. "/.git") and wait < 60 do
    if os_flag == "win32" then
        os.execute("timeout /t 1 /nobreak >nul 2>&1")
    else
        os.execute("sleep 1 2>/dev/null")
    end
    wait = wait + 1
    if wait % 5 == 0 then
        log("  Waiting for clone... (" .. wait .. "s)")
    end
end

if not dir_exists(install_dir .. "/.git") then
    log_err("Clone failed after " .. wait .. "s. Check your internet connection.")
    log_err("Try manually: git clone " .. repo)
    return
end
log_ok("Repository ready at " .. install_dir)

-- ============================================================
-- Step 5: Run platform-specific setup
-- ============================================================
log_step("Running setup (this may take a minute)...")

local setup_cmd
if os_flag == "win32" then
    setup_cmd = 'powershell -ExecutionPolicy Bypass -File "' .. install_dir .. '\\scripts\\setup.ps1" -NoBrowser -Force'
else
    setup_cmd = 'bash "' .. install_dir .. '/scripts/setup.sh" --force'
end

os.execute(setup_cmd)

-- ============================================================
-- Step 6: Deploy Resolve script
-- ============================================================
log_step("Deploying Resolve script...")
local resolve_scripts_dir

if os_flag == "win32" then
    local appdata = os.getenv("APPDATA") or ""
    resolve_scripts_dir = appdata .. "\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Scripts\\Utility"
elseif os_flag == "darwin" then
    local home = os.getenv("HOME") or "~"
    resolve_scripts_dir = home .. "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Support/Fusion/Scripts/Utility"
else
    local home = os.getenv("HOME") or "~"
    resolve_scripts_dir = home .. "/.local/share/DaVinci Resolve/Support/Fusion/Scripts/Utility"
end

-- Create directory
if os_flag == "win32" then
    os.execute('mkdir "' .. resolve_scripts_dir .. '" 2>nul')
else
    os.execute('mkdir -p "' .. resolve_scripts_dir .. '"')
end

-- Copy scripts
local scripts_to_deploy = {
    { src = "send-to-ae.py",      dst = "send-to-ae.py" },
    { src = "send-to-reaper.py",   dst = "send-to-reaper.py" },
    { src = "ResolveLink.lua",    dst = "ResolveLink.lua" },
}

for _, item in ipairs(scripts_to_deploy) do
    local src_script = install_dir .. "/resolve-scripts/" .. item.src
    local dst_script = resolve_scripts_dir .. "/" .. item.dst
    if file_exists(src_script) then
        if os_flag == "win32" then
            os.execute('copy /Y "' .. src_script .. '" "' .. dst_script .. '"')
        else
            os.execute('cp "' .. src_script .. '" "' .. dst_script .. '"')
        end
        log_ok("Deployed -> " .. dst_script)
    else
        log_warn(item.src .. " not found at " .. src_script)
    end
end

-- ============================================================
-- Step 7: Deploy CEP extension (AE side)
-- ============================================================
if os_flag == "win32" then
    log_step("Deploying AE CEP extension...")
    local appdata = os.getenv("APPDATA") or ""
    local cep_dir = appdata .. "\\Adobe\\CEP\\extensions\\com.resolvelink.panel"
    os.execute('mkdir "' .. cep_dir .. '" 2>nul')
    os.execute('xcopy /E /Y /I "' .. install_dir .. '\\extension\\client" "' .. cep_dir .. '\\client"')
    os.execute('xcopy /E /Y /I "' .. install_dir .. '\\extension\\CSXS" "' .. cep_dir .. '\\CSXS"')
    os.execute('xcopy /E /Y /I "' .. install_dir .. '\\extension\\host" "' .. cep_dir .. '\\host"')
    os.execute('reg add "HKCU\\Software\\Adobe\\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f 2>nul')
    log_ok("CEP extension deployed")
elseif os_flag == "darwin" then
    log_step("Deploying AE CEP extension...")
    local home = os.getenv("HOME") or "~"
    local cep_dir = home .. "/Library/Application Support/Adobe/CEP/extensions/com.resolvelink.panel"
    os.execute('mkdir -p "' .. cep_dir .. '"')
    os.execute('cp -R "' .. install_dir .. '/extension/client" "' .. cep_dir .. '/"')
    os.execute('cp -R "' .. install_dir .. '/extension/CSXS" "' .. cep_dir .. '/"')
    os.execute('cp -R "' .. install_dir .. '/extension/host" "' .. cep_dir .. '/"')
    os.execute('defaults write com.adobe.CSXS.11 PlayerDebugMode 1')
    log_ok("CEP extension deployed")
end

-- ============================================================
-- Step 8: Start server
-- ============================================================
log_step("Starting ResolveLink server...")

if os_flag == "win32" then
    os.execute('cd /d "' .. install_dir .. '" && start /b node server\\index.js')
else
    os.execute('cd "' .. install_dir .. '" && nohup node server/index.js > /dev/null 2>&1 &')
end

-- Wait for server
if os_flag == "win32" then
    os.execute("timeout /t 3 /nobreak >nul")
else
    os.execute("sleep 3")
end

-- Check health
local health_ok = false
if os_flag == "win32" then
    health_ok = os.execute('curl -sf http://localhost:3030/api/health >nul 2>&1') == 0
else
    health_ok = os.execute('curl -sf http://localhost:3030/api/health > /dev/null 2>&1') == 0
end

-- ============================================================
-- Done
-- ============================================================
print("")
print("========================================")
print("  ResolveLink installed successfully!")
print("========================================")
print("")
print("  Server:  http://localhost:3030")
print("  Install: " .. install_dir)
print("")
print("  Usage in Resolve:")
print("    Workspace > Scripts > send-to-ae.py")
print("")
print("  Useful commands:")
print("    Start:   " .. install_dir .. "/scripts/start" .. (os_flag == "win32" and ".ps1" or ".sh"))
print("    Stop:    " .. install_dir .. "/scripts/stop" .. (os_flag == "win32" and ".ps1" or ".sh"))
print("    Status:  " .. install_dir .. "/scripts/status" .. (os_flag == "win32" and ".ps1" or ".sh"))
print("    Update:  " .. install_dir .. "/scripts/setup" .. (os_flag == "win32" and ".ps1" or ".sh"))
print("")
