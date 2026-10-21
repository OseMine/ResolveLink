/**
 * ResolveLink REAPER Extension - Public API Header
 * 
 * This header defines the interface between the native extension
 * and REAPER's Lua environment.
 */

#pragma once

#include "reaper_plugin.h"

// Version
#define RESOLVELINK_VERSION_MAJOR 1
#define RESOLVELINK_VERSION_MINOR 0
#define RESOLVELINK_VERSION_PATCH 0
#define RESOLVELINK_VERSION_STRING "1.0.0"

// Lua function registration
namespace resolvelink {
    void register_lua_api(reaper_plugin_info_t* rec);
    void unregister_lua_api();
    
    void register_actions(reaper_plugin_info_t* rec);
    void unregister_actions();
    
    // Core API functions called from Lua
    // These are registered as reaper.ResolveLink_* functions
    
    // IPC Functions
    int lua_Connect(lua_State* L);
    int lua_Disconnect(lua_State* L);
    int lua_SendMessage(lua_State* L);
    int lua_ReceiveMessage(lua_State* L);
    int lua_IsConnected(lua_State* L);
    
    // Render Functions
    int lua_GetRenderProgress(lua_State* L);
    int lua_IsRendering(lua_State* L);
    int lua_RegisterRenderCallback(lua_State* L);
    int lua_UnregisterRenderCallback(lua_State* L);
    
    // Timeline Sync
    int lua_GetTimelineInfo(lua_State* L);
    int lua_SyncTimeline(lua_State* L);
    int lua_GetClipPositions(lua_State* L);
    
    // Stem Export
    int lua_ExportStems(lua_State* L);
    int lua_GetStemExportProgress(lua_State* L);
    
    // Utilities
    int lua_GetVersion(lua_State* L);
    int lua_GetServerConfig(lua_State* L);
    int lua_Log(lua_State* L);
    
    // Native UI
    int lua_ShowPanel(lua_State* L);
    int lua_HidePanel(lua_State* L);
    int lua_UpdatePanel(lua_State* L);
}

// Lua function table
extern const luaL_Reg resolvelink_lua_funcs[];