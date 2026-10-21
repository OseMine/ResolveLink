/**
 * ResolveLink REAPER Extension - Configuration
 * 
 * Persistent configuration using REAPER's extstate API.
 * Works without Lua scripts.
 */

#pragma once

#include "reaper_plugin.h"
#include <string>
#include <unordered_map>
#include <mutex>
#include <optional>

namespace resolvelink {

class Config {
public:
    explicit Config(reaper_plugin_info_t* rec);
    ~Config();
    
    // Load configuration from REAPER extstate
    void load();
    
    // Save configuration to REAPER extstate
    void save();
    
    // Get string value with default
    std::string get(const std::string& key, const std::string& default_value = "") const;
    
    // Set string value
    void set(const std::string& key, const std::string& value);
    
    // Get bool value with default
    bool get_bool(const std::string& key, bool default_value = false) const;
    
    // Set bool value
    void set_bool(const std::string& key, bool value);
    
    // Get int value with default
    int get_int(const std::string& key, int default_value = 0) const;
    
    // Set int value
    void set_int(const std::string& key, int value);
    
    // Get double value with default
    double get_double(const std::string& key, double default_value = 0.0) const;
    
    // Set double value
    void set_double(const std::string& key, double value);
    
    // Check if key exists
    bool has(const std::string& key) const;
    
    // Remove key
    void remove(const std::string& key);
    
    // Clear all config
    void clear();
    
    // Get all keys
    std::vector<std::string> keys() const;

private:
    reaper_plugin_info_t* m_rec = nullptr;
    std::string m_section = "ResolveLink";
    mutable std::mutex m_mutex;
    std::unordered_map<std::string, std::string> m_cache;
    bool m_loaded = false;
    
    std::string extstate_key(const std::string& key) const;
    void ensure_loaded() const;
};

} // namespace resolvelink