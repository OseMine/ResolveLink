/**
 * ResolveLink REAPER Extension - Render Hooks
 * 
 * Hooks into REAPER's render pipeline to provide:
 * - Real-time render progress callbacks
 * - Automatic render completion detection
 * - Stem export progress tracking
 */

#pragma once

#include <atomic>
#include <functional>
#include <mutex>
#include <thread>

#include "reaper_plugin.h"

namespace resolvelink {

class RenderHooks {
public:
    RenderHooks(reaper_plugin_info_t* rec);
    ~RenderHooks();
    
    // Install render hooks
    void install();
    
    // Uninstall render hooks
    void uninstall();
    
    // Get current render progress (0.0 - 1.0)
    float get_render_progress() const;
    
    // Check if currently rendering
    bool is_rendering() const;
    
    // Register Lua callback for render events
    // callback_ref is a Lua registry reference
    bool register_callback(int lua_callback_ref);
    
    // Unregister callback
    void unregister_callback();
    
    // Stem export progress
    float get_stem_export_progress() const;
    int get_current_stem_index() const;
    int get_total_stems() const;
    
    // Called by render thread to update progress
    void update_render_progress(float progress);
    void set_rendering(bool rendering);
    
    // Stem export updates
    void update_stem_progress(float progress, int current, int total);
    void set_stem_exporting(bool exporting);

private:
    reaper_plugin_info_t* m_rec = nullptr;
    
    // Hook state
    std::atomic<bool> m_installed{false};
    std::atomic<bool> m_rendering{false};
    std::atomic<float> m_render_progress{0.0f};
    
    // Stem export state
    std::atomic<bool> m_stem_exporting{false};
    std::atomic<float> m_stem_progress{0.0f};
    std::atomic<int> m_current_stem{0};
    std::atomic<int> m_total_stems{0};
    
    // Lua callback
    std::mutex m_callback_mutex;
    int m_lua_callback_ref = LUA_NOREF;
    lua_State* m_lua_state = nullptr;
    
    // Original render function pointers (for hooking)
    // These would be obtained via REAPER's extension API
    
    // Hook implementations
    static bool render_hook_pre();
    static void render_hook_post(bool success);
    static void render_hook_progress(float progress);
    
    // Call Lua callback
    void call_lua_callback(const char* event, float progress = 0.0f);
};

} // namespace resolvelink