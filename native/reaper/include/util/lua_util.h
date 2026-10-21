/**
 * ResolveLink REAPER Extension - Lua Utilities
 * 
 * Helper functions for working with REAPER's Lua state.
 */

#pragma once

#include "reaper_plugin.h"

namespace resolvelink {

// Push a C++ string as Lua string
inline void lua_push_string(lua_State* L, const std::string& str) {
    lua_pushlstring(L, str.c_str(), str.size());
}

// Push a C string as Lua string
inline void lua_push_cstring(lua_State* L, const char* str) {
    if (str) lua_pushstring(L, str);
    else lua_pushnil(L);
}

// Get string from Lua stack (with default)
inline std::string lua_get_string(lua_State* L, int index, const std::string& def = "") {
    if (lua_isstring(L, index)) {
        size_t len;
        const char* str = lua_tolstring(L, index, &len);
        return std::string(str, len);
    }
    return def;
}

// Get integer from Lua stack (with default)
inline long long lua_get_integer(lua_State* L, int index, long long def = 0) {
    if (lua_isinteger(L, index)) {
        return lua_tointeger(L, index);
    } else if (lua_isnumber(L, index)) {
        return (long long)lua_tonumber(L, index);
    }
    return def;
}

// Get number from Lua stack (with default)
inline double lua_get_number(lua_State* L, int index, double def = 0.0) {
    if (lua_isnumber(L, index)) {
        return lua_tonumber(L, index);
    }
    return def;
}

// Get boolean from Lua stack (with default)
inline bool lua_get_boolean(lua_State* L, int index, bool def = false) {
    return lua_toboolean(L, index) != 0;
}

// Check if value at index is a table
inline bool lua_is_table(lua_State* L, int index) {
    return lua_istable(L, index);
}

// Get table field as string
inline std::string lua_get_table_string(lua_State* L, int table_index, const char* key, const std::string& def = "") {
    lua_getfield(L, table_index, key);
    std::string result = lua_get_string(L, -1, def);
    lua_pop(L, 1);
    return result;
}

// Get table field as integer
inline long long lua_get_table_integer(lua_State* L, int table_index, const char* key, long long def = 0) {
    lua_getfield(L, table_index, key);
    long long result = lua_get_integer(L, -1, def);
    lua_pop(L, 1);
    return result;
}

// Get table field as number
inline double lua_get_table_number(lua_State* L, int table_index, const char* key, double def = 0.0) {
    lua_getfield(L, table_index, key);
    double result = lua_get_number(L, -1, def);
    lua_pop(L, 1);
    return result;
}

// Get table field as boolean
inline bool lua_get_table_boolean(lua_State* L, int table_index, const char* key, bool def = false) {
    lua_getfield(L, table_index, key);
    bool result = lua_get_boolean(L, -1, def);
    lua_pop(L, 1);
    return result;
}

// Push a table with key-value pairs from a map
template<typename Map>
void lua_push_map(lua_State* L, const Map& map) {
    lua_newtable(L);
    for (const auto& [key, value] : map) {
        lua_push_string(L, key);
        lua_push_string(L, value);
        lua_settable(L, -3);
    }
}

// Create a new table and set fields from variadic arguments
// Usage: lua_create_table(L, "key1", value1, "key2", value2, ..., nullptr);
template<typename... Args>
void lua_create_table(lua_State* L, Args&&... args) {
    lua_newtable(L);
    (void)std::initializer_list<int>{(lua_push_string(L, std::forward<Args>(args).first), 
                                     lua_push_string(L, std::forward<Args>(args).second), 
                                     lua_settable(L, -3), 0)...};
}

// Call a Lua function by global name
// Returns true on success, false on error
bool lua_call_global(lua_State* L, const char* func_name, int nargs, int nresults);

// Call a Lua function from registry reference
// Returns true on success, false on error
bool lua_call_ref(lua_State* L, int ref, int nargs, int nresults);

// Store a Lua function in registry and return reference
// Returns LUA_NOREF on error
int lua_store_callback(lua_State* L, int index);

// Release a stored callback reference
void lua_release_callback(lua_State* L, int ref);

// Convert Lua table at index to JSON string (requires cJSON or similar)
// Returns empty string on error
std::string lua_table_to_json(lua_State* L, int index);

// Parse JSON string and push as Lua table
// Returns true on success
bool lua_json_to_table(lua_State* L, const char* json);

// Safe pcall wrapper that logs errors
int lua_safe_pcall(lua_State* L, int nargs, int nresults, int errfunc);

} // namespace resolvelink