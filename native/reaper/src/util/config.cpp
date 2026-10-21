/**
 * ResolveLink REAPER Extension - Configuration Implementation
 * 
 * Uses REAPER's GetExtState/SetExtState for persistence.
 */

#include "config.h"
#include "util/logger.h"

#include <vector>

namespace resolvelink {

Config::Config(reaper_plugin_info_t* rec) : m_rec(rec) {}

Config::~Config() {
    if (m_loaded) {
        save();
    }
}

void Config::load() {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    if (!m_rec || !m_rec->GetExtState) return;
    
    m_cache.clear();
    
    // We can't enumerate all keys via extstate, so we load known keys
    // In practice, we'd store a JSON blob or use a known key list
    static const std::vector<std::string> known_keys = {
        "server_url", "pipe_name", "use_tcp", "auto_connect",
        "auto_import", "render_format", "sample_rate", "bit_depth",
        "window_x", "window_y", "window_w", "window_h"
    };
    
    for (const auto& key : known_keys) {
        char value[1024] = {0};
        if (m_rec->GetExtState(m_section.c_str(), key.c_str(), value, sizeof(value))) {
            if (value[0] != '\0') {
                m_cache[key] = value;
            }
        }
    }
    
    m_loaded = true;
    get_logger().info("Configuration loaded (%zu keys)", m_cache.size());
}

void Config::save() {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    if (!m_rec || !m_rec->SetExtState) return;
    
    for (const auto& [key, value] : m_cache) {
        m_rec->SetExtState(m_section.c_str(), key.c_str(), value.c_str(), true);
    }
    
    get_logger().info("Configuration saved (%zu keys)", m_cache.size());
}

std::string Config::extstate_key(const std::string& key) const {
    return m_section + "_" + key;
}

void Config::ensure_loaded() const {
    if (!m_loaded) {
        const_cast<Config*>(this)->load();
    }
}

std::string Config::get(const std::string& key, const std::string& default_value) const {
    ensure_loaded();
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_cache.find(key);
    return it != m_cache.end() ? it->second : default_value;
}

void Config::set(const std::string& key, const std::string& value) {
    ensure_loaded();
    std::lock_guard<std::mutex> lock(m_mutex);
    m_cache[key] = value;
}

bool Config::get_bool(const std::string& key, bool default_value) const {
    std::string val = get(key, "");
    if (val.empty()) return default_value;
    return val == "1" || val == "true" || val == "yes" || val == "on";
}

void Config::set_bool(const std::string& key, bool value) {
    set(key, value ? "1" : "0");
}

int Config::get_int(const std::string& key, int default_value) const {
    std::string val = get(key, "");
    if (val.empty()) return default_value;
    try {
        return std::stoi(val);
    } catch (...) {
        return default_value;
    }
}

void Config::set_int(const std::string& key, int value) {
    set(key, std::to_string(value));
}

double Config::get_double(const std::string& key, double default_value) const {
    std::string val = get(key, "");
    if (val.empty()) return default_value;
    try {
        return std::stod(val);
    } catch (...) {
        return default_value;
    }
}

void Config::set_double(const std::string& key, double value) {
    set(key, std::to_string(value));
}

bool Config::has(const std::string& key) const {
    ensure_loaded();
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_cache.find(key) != m_cache.end();
}

void Config::remove(const std::string& key) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_cache.erase(key);
    if (m_rec && m_rec->SetExtState) {
        m_rec->SetExtState(m_section.c_str(), key.c_str(), "", true);
    }
}

void Config::clear() {
    std::lock_guard<std::mutex> lock(m_mutex);
    for (const auto& [key, _] : m_cache) {
        if (m_rec && m_rec->SetExtState) {
            m_rec->SetExtState(m_section.c_str(), key.c_str(), "", true);
        }
    }
    m_cache.clear();
}

std::vector<std::string> Config::keys() const {
    ensure_loaded();
    std::lock_guard<std::mutex> lock(m_mutex);
    std::vector<std::string> result;
    result.reserve(m_cache.size());
    for (const auto& [key, _] : m_cache) {
        result.push_back(key);
    }
    return result;
}

} // namespace resolvelink