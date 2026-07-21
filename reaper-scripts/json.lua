-- ResolveLink JSON Decoder
-- Minimal JSON parser for REAPER Lua scripts.
-- Usage: local json = require("json"); local data = json.decode(jsonString)

local json = {}

-- ── Decoder ───────────────────────────────────────────────
function json.decode(s)
    if type(s) ~= "string" or s == "" then return nil, "empty input" end

    local pos = 1
    local len = #s

    local function skip_ws()
        pos = s:find("[^ \t\n\r]", pos) or (len + 1)
    end

    local function peek()
        skip_ws()
        return s:sub(pos, pos)
    end

    local function advance() pos = pos + 1 end

    local parse_val

    local function parse_string()
        pos = pos + 1
        local start = pos
        while pos <= len do
            local c = s:sub(pos, pos)
            if c == '\\' then pos = pos + 2
            elseif c == '"' then
                local str = s:sub(start, pos - 1)
                pos = pos + 1
                return str
            else pos = pos + 1 end
        end
        return s:sub(start)
    end

    local function parse_number()
        local start = pos
        if s:sub(pos, pos) == '-' then pos = pos + 1 end
        while pos <= len and s:sub(pos, pos):match("[%d%.eE%+%-]") do pos = pos + 1 end
        return tonumber(s:sub(start, pos - 1))
    end

    local function parse_array()
        pos = pos + 1
        local arr = {}
        skip_ws()
        if peek() == ']' then pos = pos + 1; return arr end
        while true do
            arr[#arr + 1] = parse_val()
            skip_ws()
            if peek() == ',' then advance()
            elseif peek() == ']' then advance(); return arr
            else break end
        end
        return arr
    end

    local function parse_object()
        pos = pos + 1
        local obj = {}
        skip_ws()
        if peek() == '}' then pos = pos + 1; return obj end
        while true do
            skip_ws()
            local key = parse_string()
            skip_ws()
            advance() -- ':'
            obj[key] = parse_val()
            skip_ws()
            if peek() == ',' then advance()
            elseif peek() == '}' then advance(); return obj
            else break end
        end
        return obj
    end

    parse_val = function()
        skip_ws()
        local c = peek()
        if c == '"' then return parse_string()
        elseif c == '{' then return parse_object()
        elseif c == '[' then return parse_array()
        elseif c == 't' then pos = pos + 4; return true
        elseif c == 'f' then pos = pos + 5; return false
        elseif c == 'n' then pos = pos + 4; return nil
        else return parse_number() end
    end

    local ok, result = pcall(parse_val)
    if not ok then return nil, result end
    return result
end

return json
