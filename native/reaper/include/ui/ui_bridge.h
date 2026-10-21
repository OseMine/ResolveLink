/**
 * ResolveLink REAPER Extension - UI Bridge
 * 
 * Provides native ImGui-based UI panels for REAPER.
 * Uses reaImGui (REAPER's built-in ImGui) for professional UI.
 */

#pragma once

#include "reaper_plugin.h"
#include <string>
#include <atomic>
#include <mutex>
#include <functional>

namespace resolvelink {

class UIBridge {
public:
    UIBridge(reaper_plugin_info_t* rec);
    ~UIBridge();
    
    // Show/hide the control panel
    bool show_panel();
    void hide_panel();
    
    // Check if panel is visible
    bool is_visible() const;
    
    // Update panel with data from Lua
    void update_panel(const char* json_data);
    
    // Set panel callbacks
    void set_on_render_request(std::function<void()> callback);
    void set_on_sync_request(std::function<void()> callback);
    void set_on_import_request(std::function<void(const char* file_path)> callback);
    void set_on_settings_request(std::function<void()> callback);
    
    // Main loop - must be called from REAPER's main thread (via defer)
    void run_frame();
    
private:
    reaper_plugin_info_t* m_rec = nullptr;
    lua_State* m_lua_state = nullptr;
    
    // Panel state
    std::atomic<bool> m_visible{false};
    std::atomic<bool> m_initialized{false};
    
    // Panel data (updated from Lua)
    struct PanelData {
        bool connected = false;
        bool rendering = false;
        float render_progress = 0.0f;
        std::string status_message = "Idle";
        int jobs_completed = 0;
        bool auto_import = true;
        std::string server_url = "http://127.0.0.1:3030";
    };
    std::mutex m_data_mutex;
    PanelData m_data;
    
    // Callbacks
    std::function<void()> m_on_render;
    std::function<void()> m_on_sync;
    std::function<void(const char*)> m_on_import;
    std::function<void()> m_on_settings;
    
    // ImGui context (provided by REAPER/reaImGui)
    void* m_imgui_ctx = nullptr;
    
    // Initialize ImGui context
    bool init_imgui();
    
    // Render panel UI
    void render_panel();
    
    // Panel sections
    void render_header();
    void render_connection_status();
    void render_render_controls();
    void render_job_list();
    void render_logs();
    void render_settings_button();
    
    // Helpers
    void log(const char* fmt, ...);
};

} // namespace resolvelink