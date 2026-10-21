/**
 * ResolveLink REAPER Extension - Render Hooks Implementation
 * 
 * Polls REAPER's render progress and provides real-time callbacks.
 * Detects render start/completion for auto-import-back functionality.
 */

#include "render_hooks.h"
#include "util/logger.h"
#include "util/lua_util.h"
#include "util/config.h"
#include "util/http_client.h"

#include <cstdio>
#include <thread>
#include <chrono>
#include <filesystem>

namespace resolvelink {

RenderHooks::RenderHooks(reaper_plugin_info_t* rec) : m_rec(rec) {
    if (rec) {
        m_lua_state = (lua_State*)rec->GetLuaState();
    }
}

RenderHooks::~RenderHooks() {
    uninstall();
}

void RenderHooks::install() {
    if (m_installed) return;
    
    // Start background polling thread
    m_installed = true;
    m_poll_thread = std::thread(&RenderHooks::poll_loop, this);
    
    get_logger().info("Render hooks installed (polling mode)");
}

void RenderHooks::uninstall() {
    if (!m_installed) return;
    
    m_installed = false;
    m_rendering = false;
    m_stem_exporting = false;
    unregister_callback();
    
    if (m_poll_thread.joinable()) {
        m_poll_thread.join();
    }
    
    get_logger().info("Render hooks uninstalled");
}

void RenderHooks::poll_loop() {
    auto last_rendering = false;
    auto last_progress = 0.0f;
    
    while (m_installed) {
        // Check if REAPER is rendering
        bool is_rendering = false;
        float progress = 0.0f;
        
        if (m_rec && m_rec->GetRenderProgress) {
            // REAPER 6.0+ has GetRenderProgress
            is_rendering = m_rec->GetRenderProgress(&progress) != 0;
        } else {
            // Fallback: check if render dialog is open or render action is running
            // This is a heuristic - in practice we'd use SWS or JS APIs
            is_rendering = false;
        }
        
        // Detect render start
        if (is_rendering && !last_rendering) {
            m_rendering = true;
            m_render_progress = 0.0f;
            call_lua_callback("renderStart", 0.0f);
            get_logger().info("Render started");
        }
        
        // Update progress
        if (is_rendering) {
            m_rendering = true;
            if (progress != last_progress) {
                m_render_progress = progress;
                call_lua_callback("renderProgress", progress);
            }
        }
        
        // Detect render completion
        if (!is_rendering && last_rendering) {
            m_rendering = false;
            m_render_progress = 1.0f;
            call_lua_callback("renderComplete", 1.0f);
            get_logger().info("Render completed");
            
            // Auto-import-back if enabled
            if (resolvelink::get_config().get_bool("auto_import", true)) {
                trigger_auto_import_back();
            }
        }
        
        last_rendering = is_rendering;
        last_progress = progress;
        
        // Poll every 100ms during render, 1s otherwise
        std::this_thread::sleep_for(std::chrono::milliseconds(is_rendering ? 100 : 1000));
    }
}

void RenderHooks::trigger_auto_import_back() {
    get_logger().info("Auto-import-back triggered");
    
    // Find latest rendered audio file
    auto& config = resolvelink::get_config();
    std::string export_dir = config.get("export_dir", "./exports");
    
    // This would scan the export directory for the latest audio file
    // and send it to Resolve via the server
    auto& http = resolvelink::get_http_client();
    auto& thread_pool = resolvelink::get_thread_pool();
    
    thread_pool.enqueue([export_dir]() {
        // Scan for latest audio file
        // For now, just log
        resolvelink::get_logger().info("Auto-import-back: scanning %s", export_dir.c_str());
        
        // In real implementation:
        // 1. Find latest .wav/.flac/.mp3 in export_dir
        // 2. POST to /api/reaper/import-to-resolve
        // 3. Handle response
    });
}

float RenderHooks::get_render_progress() const {
    if (!m_rendering) return 0.0f;
    return m_render_progress.load();
}

bool RenderHooks::is_rendering() const {
    return m_rendering.load();
}

bool RenderHooks::register_callback(int lua_callback_ref) {
    std::lock_guard<std::mutex> lock(m_callback_mutex);
    
    if (m_lua_callback_ref != LUA_NOREF && m_lua_state) {
        luaL_unref(m_lua_state, LUA_REGISTRYINDEX, m_lua_callback_ref);
    }
    
    m_lua_callback_ref = lua_callback_ref;
    get_logger().info("Render callback registered");
    return true;
}

void RenderHooks::unregister_callback() {
    std::lock_guard<std::mutex> lock(m_callback_mutex);
    
    if (m_lua_callback_ref != LUA_NOREF && m_lua_state) {
        luaL_unref(m_lua_state, LUA_REGISTRYINDEX, m_lua_callback_ref);
        m_lua_callback_ref = LUA_NOREF;
    }
}

float RenderHooks::get_stem_export_progress() const {
    return m_stem_progress.load();
}

int RenderHooks::get_current_stem_index() const {
    return m_current_stem.load();
}

int RenderHooks::get_total_stems() const {
    return m_total_stems.load();
}

void RenderHooks::update_render_progress(float progress) {
    m_render_progress.store(progress);
    
    if (progress >= 1.0f && m_rendering) {
        set_rendering(false);
    }
    
    call_lua_callback("renderProgress", progress);
}

void RenderHooks::set_rendering(bool rendering) {
    bool was_rendering = m_rendering.exchange(rendering);
    
    if (was_rendering && !rendering) {
        call_lua_callback("renderComplete", 1.0f);
    } else if (!was_rendering && rendering) {
        m_render_progress = 0.0f;
        call_lua_callback("renderStart", 0.0f);
    }
}

void RenderHooks::update_stem_progress(float progress, int current, int total) {
    m_stem_progress.store(progress);
    m_current_stem.store(current);
    m_total_stems.store(total);
    call_lua_callback("stemProgress", progress);
}

void RenderHooks::set_stem_exporting(bool exporting) {
    m_stem_exporting.store(exporting);
    if (exporting) {
        m_stem_progress = 0.0f;
        m_current_stem = 0;
    }
    call_lua_callback(exporting ? "stemExportStart" : "stemExportComplete", 
                      exporting ? 0.0f : 1.0f);
}

void RenderHooks::call_lua_callback(const char* event, float progress) {
    std::lock_guard<std::mutex> lock(m_callback_mutex);
    
    if (m_lua_callback_ref == LUA_NOREF || !m_lua_state) return;
    
    lua_rawgeti(m_lua_state, LUA_REGISTRYINDEX, m_lua_callback_ref);
    if (!lua_isfunction(m_lua_state, -1)) {
        lua_pop(m_lua_state, 1);
        return;
    }
    
    lua_pushstring(m_lua_state, event);
    lua_pushnumber(m_lua_state, progress);
    
    int err = lua_pcall(m_lua_state, 2, 0, 0);
    if (err != LUA_OK) {
        get_logger().error("Lua render callback error: %s", lua_tostring(m_lua_state, -1));
        lua_pop(m_lua_state, 1);
    }
}

} // namespace resolvelink