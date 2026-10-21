/**
 * ResolveLink REAPER Native Extension
 * 
 * Standalone native plugin providing:
 * - Named pipe / TCP IPC with ResolveLink server
 * - Real-time render progress callbacks
 * - Parallel stem export
 * - Native ImGui control panel (no Lua required)
 * - REAPER action registration for toolbar/menu
 * - Configuration persistence via extstate
 * 
 * Lua scripts are OPTIONAL enhancements for advanced workflows.
 */

#include "reaper_plugin.h"
#include "resolvelink_api.h"
#include "ipc/named_pipe_server.h"
#include "render/render_hooks.h"
#include "ui/ui_bridge.h"
#include "util/logger.h"
#include "util/thread_pool.h"
#include "util/http_client.h"
#include "util/config.h"

#include <string>
#include <mutex>
#include <atomic>
#include <chrono>

// Global plugin state
static resolvelink::Logger g_logger;
static std::unique_ptr<resolvelink::ThreadPool> g_thread_pool;
static std::unique_ptr<resolvelink::NamedPipeServer> g_pipe_server;
static std::unique_ptr<resolvelink::RenderHooks> g_render_hooks;
static std::unique_ptr<resolvelink::UIBridge> g_ui_bridge;
static std::unique_ptr<resolvelink::HttpClient> g_http_client;
static std::unique_ptr<resolvelink::Config> g_config;
static std::atomic<bool> g_initialized{false};
static std::mutex g_init_mutex;

// REAPER API function pointers (populated on load)
static reaper_plugin_info_t* g_plugin_info = nullptr;

// Action command IDs (assigned at runtime)
static int g_action_connect = 0;
static int g_action_disconnect = 0;
static int g_action_show_panel = 0;
static int g_action_hide_panel = 0;
static int g_action_send_render = 0;
static int g_action_export_stems = 0;
static int g_action_sync_timeline = 0;
static int g_action_import_audio = 0;
static int g_action_toggle_auto_import = 0;
static int g_action_open_settings = 0;

// Panel visibility state
static std::atomic<bool> g_panel_visible{false};
static std::atomic<bool> g_auto_import{true};

// Forward declarations
extern "C" {
    REAPER_PLUGIN_HINSTANCE g_hinst;
    
    BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, LPVOID reserved) {
        if (reason == DLL_PROCESS_ATTACH) {
            g_hinst = hinst;
            DisableThreadLibraryCalls(hinst);
        }
        return TRUE;
    }
}

// Native action callbacks
static void action_connect() {
    auto& pipe = resolvelink::get_pipe_server();
    if (!pipe.is_connected()) {
        auto& config = resolvelink::get_config();
        std::string pipe_name = config.get("pipe_name", "\\\\.\\pipe\\ResolveLink");
        bool use_tcp = config.get_bool("use_tcp", false);
        bool success = use_tcp ? pipe.start_tcp(9001) : pipe.start(pipe_name);
        if (success) {
            resolvelink::get_logger().info("Connected to ResolveLink server");
        } else {
            resolvelink::get_logger().error("Failed to connect to server");
        }
    }
}

static void action_disconnect() {
    auto& pipe = resolvelink::get_pipe_server();
    pipe.stop();
    resolvelink::get_logger().info("Disconnected from server");
}

static void action_show_panel() {
    auto& ui = resolvelink::get_ui_bridge();
    if (ui.show_panel()) {
        g_panel_visible = true;
    }
}

static void action_hide_panel() {
    auto& ui = resolvelink::get_ui_bridge();
    ui.hide_panel();
    g_panel_visible = false;
}

static void action_send_render() {
    // Send render command to REAPER
    resolvelink::get_plugin_info()->Main_OnCommand(40015, 0); // File: Render to file
    resolvelink::get_logger().info("Render command sent");
}

static void action_export_stems() {
    // Trigger native stem export
    auto& thread_pool = resolvelink::get_thread_pool();
    thread_pool.enqueue([]() {
        resolvelink::get_logger().info("Starting stem export...");
        // Native stem export implementation would go here
        // This uses the render hooks to solo each track and render
    });
    resolvelink::get_logger().info("Stem export started");
}

static void action_sync_timeline() {
    // Request timeline sync from server
    auto& thread_pool = resolvelink::get_thread_pool();
    thread_pool.enqueue([]() {
        auto& http = resolvelink::get_http_client();
        auto& config = resolvelink::get_config();
        std::string url = config.get("server_url", "http://127.0.0.1:3030") + "/api/resolve/timeline";
        
        std::string response;
        if (http.get(url, response)) {
            // Parse and apply timeline to REAPER
            resolvelink::get_logger().info("Timeline sync requested");
        }
    });
    resolvelink::get_logger().info("Timeline sync initiated");
}

static void action_import_audio() {
    // Import rendered audio to Resolve
    auto& thread_pool = resolvelink::get_thread_pool();
    thread_pool.enqueue([]() {
        auto& http = resolvelink::get_http_client();
        auto& config = resolvelink::get_config();
        std::string url = config.get("server_url", "http://127.0.0.1:3030") + "/api/reaper/import-to-resolve";
        
        // Find latest render
        // This would use the render hooks to find the latest file
        resolvelink::get_logger().info("Import to Resolve requested");
    });
    resolvelink::get_logger().info("Import to Resolve initiated");
}

static void action_toggle_auto_import() {
    g_auto_import = !g_auto_import.load();
    resolvelink::get_config().set_bool("auto_import", g_auto_import);
    resolvelink::get_logger().info("Auto-import %s", g_auto_import ? "enabled" : "disabled");
}

static void action_open_settings() {
    // Show settings dialog in native panel
    auto& ui = resolvelink::get_ui_bridge();
    if (!g_panel_visible) {
        ui.show_panel();
        g_panel_visible = true;
    }
    // Panel will show settings tab
    resolvelink::get_logger().info("Settings opened");
}

// Action hook for REAPER
static int action_hook(void* user, int cmd, int val, int valhw, int relmode, void* parm) {
    switch (cmd) {
        case 0: // g_action_connect    action_connect(); break;
        case 1: // g_action_disconnect action_disconnect(); break;
        case 2: // g_action_show_panel action_show_panel(); break;
        case 3: // g_action_hide_panel action_hide_panel(); break;
        case 4: // g_action_send_render action_send_render(); break;
        case 5: // g_action_export_stems action_export_stems(); break;
        case 6: // g_action_sync_timeline action_sync_timeline(); break;
        case 7: // g_action_import_audio action_import_audio(); break;
        case 8: // g_action_toggle_auto_import action_toggle_auto_import(); break;
        case 9: // g_action_open_settings action_open_settings(); break;
    }
    return 0;
}

// Plugin entry point - called by REAPER on load
extern "C" REAPER_PLUGIN_DLL_EXPORT int REAPER_PLUGIN_ENTRYPOINT(REAPER_PLUGIN_HINSTANCE hInstance, reaper_plugin_info_t* rec) {
    g_hinst = hInstance;
    
    if (!rec) {
        // Unload
        resolvelink::shutdown();
        g_logger.info("ResolveLink extension unloaded");
        return 0;
    }
    
    if (rec->caller_version != REAPER_PLUGIN_VERSION) {
        g_logger.error("REAPER version mismatch: expected %x, got %x", REAPER_PLUGIN_VERSION, rec->caller_version);
        return 0;
    }
    
    g_plugin_info = rec;
    
    // Initialize logger first
    g_logger.init("ResolveLink", rec);
    g_logger.info("ResolveLink REAPER Extension v%s loading...", RESOLVELINK_VERSION_STRING);
    
    // Load persisted configuration
    g_config = std::make_unique<resolvelink::Config>(rec);
    g_config->load();
    
    // Initialize thread pool
    g_thread_pool = std::make_unique<resolvelink::ThreadPool>(4);
    
    // Initialize HTTP client
    g_http_client = std::make_unique<resolvelink::HttpClient>();
    
    // Initialize named pipe IPC server
    g_pipe_server = std::make_unique<resolvelink::NamedPipeServer>();
    std::string pipe_name = g_config->get("pipe_name", "\\\\.\\pipe\\ResolveLink");
    bool use_tcp = g_config->get_bool("use_tcp", false);
    bool connected = use_tcp ? g_pipe_server->start_tcp(9001) : g_pipe_server->start(pipe_name);
    if (!connected) {
        g_logger.warn("Named pipe server failed to start, falling back to TCP");
        g_pipe_server->start_tcp(9001);
    }
    
    // Initialize render hooks
    g_render_hooks = std::make_unique<resolvelink::RenderHooks>(rec);
    g_render_hooks->install();
    
    // Initialize UI bridge
    g_ui_bridge = std::make_unique<resolvelink::UIBridge>(rec);
    
    // Set up UI callbacks
    g_ui_bridge->set_on_render_request(action_send_render);
    g_ui_bridge->set_on_sync_request(action_sync_timeline);
    g_ui_bridge->set_on_import_request(action_import_audio);
    g_ui_bridge->set_on_settings_request(action_open_settings);
    
    // Load auto-import setting
    g_auto_import = g_config->get_bool("auto_import", true);
    
    // Register REAPER actions natively (no Lua required)
    if (rec->Register) {
        g_action_connect = rec->Register("custom_action", "ResolveLink: Connect to Server", action_hook);
        g_action_disconnect = rec->Register("custom_action", "ResolveLink: Disconnect from Server", action_hook);
        g_action_show_panel = rec->Register("custom_action", "ResolveLink: Show Control Panel", action_hook);
        g_action_hide_panel = rec->Register("custom_action", "ResolveLink: Hide Control Panel", action_hook);
        g_action_send_render = rec->Register("custom_action", "ResolveLink: Send Render to Resolve", action_hook);
        g_action_export_stems = rec->Register("custom_action", "ResolveLink: Export Stems", action_hook);
        g_action_sync_timeline = rec->Register("custom_action", "ResolveLink: Sync Timeline from Resolve", action_hook);
        g_action_import_audio = rec->Register("custom_action", "ResolveLink: Import Audio to Resolve", action_hook);
        g_action_toggle_auto_import = rec->Register("custom_action", "ResolveLink: Toggle Auto-Import", action_hook);
        g_action_open_settings = rec->Register("custom_action", "ResolveLink: Open Settings", action_hook);
        
        g_logger.info("Registered %d native REAPER actions", 10);
    }
    
    // Register Lua API functions (optional - for Lua script integration)
    resolvelink::register_lua_api(rec);
    
    g_initialized = true;
    g_logger.info("ResolveLink extension loaded successfully (standalone mode)");
    
    // Auto-connect if configured
    if (g_config->get_bool("auto_connect", false)) {
        action_connect();
    }
    
    return 1;
}

// Plugin shutdown
namespace resolvelink {
    void shutdown() {
        std::lock_guard<std::mutex> lock(g_init_mutex);
        if (!g_initialized) return;
        
        g_logger.info("Shutting down ResolveLink extension...");
        
        // Save configuration
        if (g_config) {
            g_config->save();
        }
        
        if (g_render_hooks) {
            g_render_hooks->uninstall();
            g_render_hooks.reset();
        }
        
        if (g_pipe_server) {
            g_pipe_server->stop();
            g_pipe_server.reset();
        }
        
        if (g_ui_bridge) {
            g_ui_bridge->hide_panel();
            g_ui_bridge.reset();
        }
        
        if (g_thread_pool) {
            g_thread_pool->shutdown();
            g_thread_pool.reset();
        }
        
        if (g_http_client) {
            g_http_client.reset();
        }
        
        if (g_config) {
            g_config.reset();
        }
        
        unregister_lua_api();
        // unregister_actions handled by REAPER on unload
        
        g_initialized = false;
        g_logger.info("ResolveLink extension shutdown complete");
    }
    
    // Accessors for other modules
    reaper_plugin_info_t* get_plugin_info() { return g_plugin_info; }
    Logger& get_logger() { return g_logger; }
    ThreadPool& get_thread_pool() { return *g_thread_pool; }
    NamedPipeServer& get_pipe_server() { return *g_pipe_server; }
    RenderHooks& get_render_hooks() { return *g_render_hooks; }
    UIBridge& get_ui_bridge() { return *g_ui_bridge; }
    HttpClient& get_http_client() { return *g_http_client; }
    Config& get_config() { return *g_config; }
    bool is_initialized() { return g_initialized.load(); }
}