-- ResolveLink File Locking Utility
-- Provides cross-platform file locking for Lua scripts to prevent
-- concurrent read/write conflicts in file-based IPC.
-- Usage: local lock = require("lock"); lock.acquire("file.json"); ... lock.release("file.json")

local lock = {}

-- Lock state tracking
local active_locks = {}

-- Platform detection
local is_windows = package.config:sub(1,1) == '\\'

-- Generate lock file path
local function get_lock_path(filepath)
    return filepath .. ".lock"
end

-- Acquire exclusive lock with timeout
-- Returns: true if acquired, false if timeout
function lock.acquire(filepath, timeout_ms)
    timeout_ms = timeout_ms or 5000
    local lock_path = get_lock_path(filepath)
    local start_time = os.clock()
    
    while true do
        -- Try to create lock file exclusively
        local lock_file = io.open(lock_path, "r")
        if not lock_file then
            -- Lock file doesn't exist, try to create it
            lock_file = io.open(lock_path, "w")
            if lock_file then
                lock_file:write(tostring(os.time()))
                lock_file:close()
                active_locks[filepath] = true
                return true
            end
        else
            lock_file:close()
        end
        
        -- Check timeout
        if (os.clock() - start_time) * 1000 >= timeout_ms then
            return false
        end
        
        -- Wait a bit before retry
        if is_windows then
            -- Windows: use ping for sub-second sleep
            os.execute("ping -n 1 127.0.0.1 >nul 2>&1")
        else
            -- Unix: use sleep
            os.execute("sleep 0.01")
        end
    end
end

-- Release lock
function lock.release(filepath)
    local lock_path = get_lock_path(filepath)
    os.remove(lock_path)
    active_locks[filepath] = nil
    return true
end

-- Check if we hold the lock
function lock.is_locked_by_us(filepath)
    return active_locks[filepath] == true
end

-- Safe read with lock
-- Reads file content while holding lock
function lock.read_file_locked(filepath, timeout_ms)
    if lock.acquire(filepath, timeout_ms) then
        local f = io.open(filepath, "r")
        if f then
            local content = f:read("*a")
            f:close()
            lock.release(filepath)
            return content
        end
        lock.release(filepath)
    end
    return nil, "Could not acquire lock or read file"
end

-- Safe write with lock
-- Writes file content while holding lock (atomic: temp + rename)
function lock.write_file_locked(filepath, content, timeout_ms)
    if lock.acquire(filepath, timeout_ms) then
        local tmp_path = filepath .. ".tmp." .. os.time() .. "." .. math.random(1000, 9999)
        local f = io.open(tmp_path, "w")
        if f then
            f:write(content)
            f:close()
            -- Atomic rename
            local ok, err = os.rename(tmp_path, filepath)
            lock.release(filepath)
            if ok then
                return true
            else
                os.remove(tmp_path)
                return false, "Rename failed: " .. (err or "unknown")
            end
        end
        lock.release(filepath)
        os.remove(tmp_path)
    end
    return false, "Could not acquire lock or write file"
end

-- Safe JSON read with lock
function lock.read_json_locked(filepath, timeout_ms)
    local content, err = lock.read_file_locked(filepath, timeout_ms)
    if not content then return nil, err end
    
    local json = require("json")
    return json.decode(content)
end

-- Safe JSON write with lock
function lock.write_json_locked(filepath, data, timeout_ms)
    local json = require("json")
    -- We need to encode - for now just use basic serialization
    -- In practice you'd want a proper JSON encoder
    local content = json_encode(data)
    return lock.write_file_locked(filepath, content, timeout_ms)
end

-- Simple JSON encoder for basic types
function json_encode(val)
    local t = type(val)
    if t == "string" then
        return '"' .. val:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n') .. '"'
    elseif t == "number" then
        return tostring(val)
    elseif t == "boolean" then
        return val and "true" or "false"
    elseif t == "table" then
        local is_array = #val > 0
        local parts = {}
        if is_array then
            for i, v in ipairs(val) do
                parts[i] = json_encode(v)
            end
            return "[" .. table.concat(parts, ",") .. "]"
        else
            for k, v in pairs(val) do
                table.insert(parts, json_encode(k) .. ":" .. json_encode(v))
            end
            return "{" .. table.concat(parts, ",") .. "}"
        end
    else
        return "null"
    end
end

return lock