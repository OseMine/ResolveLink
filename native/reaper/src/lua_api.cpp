/**
 * ResolveLink REAPER Extension - Lua API Registration
 * 
 * Registers all native functions as reaper.ResolveLink_* in Lua.
 */

#include "resolvelink_api.h"
#include "util/lua_util.h"
#include "ipc/named_pipe_server.h"
#include "render/render_hooks.h"
#include "ui/ui_bridge.h"
#include "util/logger.h"

#include <string>

namespace resolvelink {

// Lua function implementations

int lua_Connect(lua_State* L) {
    const char* server_address = luaL_optstring(L, 1, "\\\\.\\pipe\\ResolveLink");
    bool use_tcp = lua_toboolean(L, 2);
    
    auto& pipe_server = get_pipe_server();
    bool success = use_tcp ? pipe_server.start_tcp(9001) : pipe_server.start(server_address);
    
    lua_pushboolean(L, success);
    return 1;
}

int lua_Disconnect(lua_State* L) {
    auto& pipe_server = get_pipe_server();
    pipe_server.stop();
    lua_pushboolean(L, true);
    return 1;
}

int lua_SendMessage(lua_State* L) {
    const char* message = luaL_checkstring(L, 1);
    size_t len = lua_rawlen(L, 1);
    
    auto& pipe_server = get_pipe_server();
    bool success = pipe_server.send(message, len);
    
    lua_pushboolean(L, success);
    return 1;
}

int lua_ReceiveMessage(lua_State* L) {
    int timeout_ms = luaL_optinteger(L, 1, 0);
    
    auto& pipe_server = get_pipe_server();
    std::string message;
    bool success = pipe_server.receive(message, timeout_ms);
    
    if (success) {
        lua_pushstring(L, message.c_str());
    } else {
        lua_pushnil(L);
    }
    return 1;
}

int lua_IsConnected(lua_State* L) {
    auto& pipe_server = get_pipe_server();
    lua_pushboolean(L, pipe_server.is_connected());
    return 1;
}

int lua_GetRenderProgress(lua_State* L) {
    auto& render_hooks = get_render_hooks();
    float progress = render_hooks.get_render_progress();
    bool is_rendering = render_hooks.is_rendering();
    
    lua_newtable(L);
    lua_pushstring(L, "progress");
    lua_pushnumber(L, progress);
    lua_settable(L, -3);
    lua_pushstring(L, "rendering");
    lua_pushboolean(L, is_rendering);
    lua_settable(L, -3);
    
    return 1;
}

int lua_IsRendering(lua_State* L) {
    auto& render_hooks = get_render_hooks();
    lua_pushboolean(L, render_hooks.is_rendering());
    return 1;
}

int lua_RegisterRenderCallback(lua_State* L) {
    // Store Lua callback function reference
    luaL_checktype(L, 1, LUA_TFUNCTION);
    int callback_ref = luaL_ref(L, LUA_REGISTRYINDEX);
    
    auto& render_hooks = get_render_hooks();
    bool success = render_hooks.register_callback(callback_ref);
    
    lua_pushboolean(L, success);
    return 1;
}

int lua_UnregisterRenderCallback(lua_State* L) {
    auto& render_hooks = get_render_hooks();
    render_hooks.unregister_callback();
    lua_pushboolean(L, true);
    return 1;
}

int lua_GetTimelineInfo(lua_State* L) {
    // Get current project timeline info
    auto* rec = get_plugin_info();
    if (!rec) {
        lua_pushnil(L);
        return 1;
    }
    
    double project_length = 0.0;
    int num_markers = 0;
    int num_regions = 0;
    
    // Use REAPER API to get timeline info
    // This would call reaper.GetProjectLength, reaper.EnumProjectMarkers, etc.
    
    lua_newtable(L);
    lua_pushstring(L, "length");
    lua_pushnumber(L, project_length);
    lua_settable(L, -3);
    lua_pushstring(L, "markers");
    lua_pushinteger(L, num_markers);
    lua_settable(L, -3);
    lua_pushstring(L, "regions");
    lua_pushinteger(L, num_regions);
    lua_settable(L, -3);
    
    return 1;
}

int lua_SyncTimeline(lua_State* L) {
    // Sync REAPER timeline with Resolve timeline
    // This would fetch from server and update REAPER
    auto& thread_pool = get_thread_pool();
    
    auto future = thread_pool.enqueue([]() {
        // Async timeline sync
        return true;
    });
    
    lua_pushboolean(L, true); // Started successfully
    return 1;
}

int lua_GetClipPositions(lua_State* L) {
    // Get all clip positions in current project
    lua_newtable(L);
    // Implementation would iterate tracks and items
    return 1;
}

int lua_ExportStems(lua_State* L) {
    // Native stem export with progress callbacks
    const char* output_dir = luaL_optstring(L, 1, "");
    int sample_rate = luaL_optinteger(L, 2, 48000);
    int bit_depth = luaL_optinteger(L, 3, 24);
    bool include_master = lua_toboolean(L, 4);
    
    auto& thread_pool = get_thread_pool();
    auto& render_hooks = get_render_hooks();
    
    auto future = thread_pool.enqueue([=]() {
        // Native stem export implementation
        // Returns progress via render_hooks callbacks
        return true;
    });
    
    lua_pushboolean(L, true);
    return 1;
}

int lua_GetStemExportProgress(lua_State* L) {
    auto& render_hooks = get_render_hooks();
    float progress = render_hooks.get_stem_export_progress();
    int current_stem = render_hooks.get_current_stem_index();
    int total_stems = render_hooks.get_total_stems();
    
    lua_newtable(L);
    lua_pushstring(L, "progress");
    lua_pushnumber(L, progress);
    lua_settable(L, -3);
    lua_pushstring(L, "currentStem");
    lua_pushinteger(L, current_stem);
    lua_settable(L, -3);
    lua_pushstring(L, "totalStems");
    lua_pushinteger(L, total_stems);
    lua_settable(L, -3);
    
    return 1;
}

int lua_GetVersion(lua_State* L) {
    lua_pushstring(L, RESOLVELINK_VERSION_STRING);
    return 1;
}

int lua_GetServerConfig(lua_State* L) {
    // Fetch config from ResolveLink server
    // Returns as Lua table
    lua_newtable(L);
    lua_pushstring(L, "url");
    lua_pushstring(L, "http://127.0.0.1:3030");
    lua_settable(L, -3);
    lua_pushstring(L, "pipeName");
    lua_pushstring(L, "\\\\.\\pipe\\ResolveLink");
    lua_settable(L, -3);
    return 1;
}

int lua_Log(lua_State* L) {
    int level = luaL_optinteger(L, 1, 0); // 0=info, 1=warn, 2=error
    const char* message = luaL_checkstring(L, 2);
    
    auto& logger = get_logger();
    switch (level) {
        case 0: logger.info("%s", message); break;
        case 1: logger.warn("%s", message); break;
        case 2: logger.error("%s", message); break;
    }
    
    lua_pushboolean(L, true);
    return 1;
}

int lua_ShowPanel(lua_State* L) {
    auto& ui_bridge = get_ui_bridge();
    bool success = ui_bridge.show_panel();
    lua_pushboolean(L, success);
    return 1;
}

int lua_HidePanel(lua_State* L) {
    auto& ui_bridge = get_ui_bridge();
    ui_bridge.hide_panel();
    lua_pushboolean(L, true);
    return 1;
}

int lua_UpdatePanel(lua_State* L) {
    const char* data = luaL_optstring(L, 1, "{}");
    auto& ui_bridge = get_ui_bridge();
    ui_bridge.update_panel(data);
    lua_pushboolean(L, true);
    return 1;
}

// Lua function registry
const luaL_Reg resolvelink_lua_funcs[] = {
    {"Connect", lua_Connect},
    {"Disconnect", lua_Disconnect},
    {"SendMessage", lua_SendMessage},
    {"ReceiveMessage", lua_ReceiveMessage},
    {"IsConnected", lua_IsConnected},
    {"GetRenderProgress", lua_GetRenderProgress},
    {"IsRendering", lua_IsRendering},
    {"RegisterRenderCallback", lua_RegisterRenderCallback},
    {"UnregisterRenderCallback", lua_UnregisterRenderCallback},
    {"GetTimelineInfo", lua_GetTimelineInfo},
    {"SyncTimeline", lua_SyncTimeline},
    {"GetClipPositions", lua_GetClipPositions},
    {"ExportStems", lua_ExportStems},
    {"GetStemExportProgress", lua_GetStemExportProgress},
    {"GetVersion", lua_GetVersion},
    {"GetServerConfig", lua_GetServerConfig},
    {"Log", lua_Log},
    {"ShowPanel", lua_ShowPanel},
    {"HidePanel", lua_HidePanel},
    {"UpdatePanel", lua_UpdatePanel},
    {nullptr, nullptr}
};

void register_lua_api(reaper_plugin_info_t* rec) {
    if (!rec || !rec->Register) return;
    
    // Register the ResolveLink library
    lua_State* L = (lua_State*)rec->GetLuaState();
    if (!L) return;
    
    // Create ResolveLink table
    lua_newtable(L);
    
    // Register all functions
    for (const luaL_Reg* func = resolvelink_lua_funcs; func->name; ++func) {
        lua_pushstring(L, func->name);
        lua_pushcfunction(L, func->func);
        lua_settable(L, -3);
    }
    
    // Set as global reaper.ResolveLink
    lua_setglobal(L, "ResolveLink");
    
    // Also register in package.loaded for require()
    lua_getglobal(L, "package");
    lua_getfield(L, -1, "loaded");
    lua_pushstring(L, "resolvelink");
    lua_pushvalue(L, -3); // ResolveLink table
    lua_settable(L, -3);
    lua_pop(L, 2);
    
    get_logger().info("Lua API registered: %d functions", 
        sizeof(resolvelink_lua_funcs) / sizeof(luaL_Reg) - 1);
}

void unregister_lua_api() {
    lua_State* L = g_plugin_info ? (lua_State*)g_plugin_info->GetLuaState() : nullptr;
    if (!L) return;
    
    lua_pushnil(L);
    lua_setglobal(L, "ResolveLink");
    
    // Remove from package.loaded
    lua_getglobal(L, "package");
    lua_getfield(L, -1, "loaded");
    lua_pushstring(L, "resolvelink");
    lua_pushnil(L);
    lua_settable(L, -3);
    lua_pop(L, 2);
}

void register_actions(reaper_plugin_info_t* rec) {
    if (!rec || !rec->Register) return;
    
    // Register custom actions that appear in REAPER's action list
    static const char* action_names[] = {
        "ResolveLink: Connect to Server",
        "ResolveLink: Disconnect from Server",
        "ResolveLink: Show Control Panel",
        "ResolveLink: Export Stems",
        "ResolveLink: Sync Timeline from Resolve",
        "ResolveLink: Import Audio to Resolve",
        "ResolveLink: Toggle Auto-Import",
        "ResolveLink: Open Settings",
        nullptr
    };
    
    for (int i = 0; action_names[i]; ++i) {
        char command_id[64];
        snprintf(command_id, sizeof(command_id), "RESOLVELINK_ACTION_%d", i);
        
        // Register with REAPER's action system
        // This would use rec->Register("custom_action", command_id, action_names[i])
    }
}

void unregister_actions() {
    // Unregister custom actions
}

} // namespace resolvelink