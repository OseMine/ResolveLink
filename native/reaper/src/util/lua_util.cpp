/**
 * ResolveLink REAPER Extension - Lua Utilities Implementation
 */

#include "lua_util.h"
#include "util/logger.h"

namespace resolvelink {

bool lua_call_global(lua_State* L, const char* func_name, int nargs, int nresults) {
    if (!L || !func_name) return false;
    
    lua_getglobal(L, func_name);
    if (!lua_isfunction(L, -1)) {
        lua_pop(L, 1);
        get_logger().error("Lua global '%s' is not a function", func_name);
        return false;
    }
    
    // Move function below arguments
    lua_insert(L, -(nargs + 1));
    
    int err = lua_pcall(L, nargs, nresults, 0);
    if (err != LUA_OK) {
        get_logger().error("Lua call to '%s' failed: %s", func_name, lua_tostring(L, -1));
        lua_pop(L, 1);
        return false;
    }
    
    return true;
}

bool lua_call_ref(lua_State* L, int ref, int nargs, int nresults) {
    if (!L || ref == LUA_NOREF) return false;
    
    lua_rawgeti(L, LUA_REGISTRYINDEX, ref);
    if (!lua_isfunction(L, -1)) {
        lua_pop(L, 1);
        get_logger().error("Lua registry ref %d is not a function", ref);
        return false;
    }
    
    lua_insert(L, -(nargs + 1));
    
    int err = lua_pcall(L, nargs, nresults, 0);
    if (err != LUA_OK) {
        get_logger().error("Lua call_ref failed: %s", lua_tostring(L, -1));
        lua_pop(L, 1);
        return false;
    }
    
    return true;
}

int lua_store_callback(lua_State* L, int index) {
    if (!L || !lua_isfunction(L, index)) {
        return LUA_NOREF;
    }
    
    // Move to top if not already
    if (index != -1) {
        lua_pushvalue(L, index);
    }
    
    return luaL_ref(L, LUA_REGISTRYINDEX);
}

void lua_release_callback(lua_State* L, int ref) {
    if (L && ref != LUA_NOREF) {
        luaL_unref(L, LUA_REGISTRYINDEX, ref);
    }
}

std::string lua_table_to_json(lua_State* L, int index) {
    // This would require a JSON library like cJSON
    // For now, return placeholder
    (void)L;
    (void)index;
    return "{}";
}

bool lua_json_to_table(lua_State* L, const char* json) {
    // This would require a JSON library like cJSON
    (void)L;
    (void)json;
    return false;
}

int lua_safe_pcall(lua_State* L, int nargs, int nresults, int errfunc) {
    if (!L) return LUA_ERRRUN;
    
    int err = lua_pcall(L, nargs, nresults, errfunc);
    if (err != LUA_OK) {
        get_logger().error("Lua pcall failed: %s", lua_tostring(L, -1));
        lua_pop(L, 1);
    }
    return err;
}

} // namespace resolvelink