/**
 * ResolveLink REAPER Extension - Logger
 * 
 * Thread-safe logging to REAPER console and optional file.
 */

#pragma once

#include <string>
#include <mutex>
#include <atomic>
#include <fstream>
#include <chrono>
#include <cstdarg>

#include "reaper_plugin.h"

namespace resolvelink {

class Logger {
public:
    Logger() = default;
    ~Logger();
    
    // Initialize with REAPER plugin info
    void init(const char* name, reaper_plugin_info_t* rec);
    
    // Log levels
    void trace(const char* fmt, ...);
    void debug(const char* fmt, ...);
    void info(const char* fmt, ...);
    void warn(const char* fmt, ...);
    void error(const char* fmt, ...);
    
    // Set minimum log level
    void set_level(int level);
    
    // Enable/disable file logging
    void set_file_logging(const char* path, bool enable);
    
    // Flush file buffer
    void flush();

private:
    enum Level {
        TRACE = 0,
        DEBUG = 1,
        INFO = 2,
        WARN = 3,
        ERROR = 4
    };
    
    reaper_plugin_info_t* m_rec = nullptr;
    std::string m_name;
    std::atomic<int> m_level{INFO};
    std::mutex m_mutex;
    std::ofstream m_file;
    bool m_file_enabled = false;
    
    void log(Level level, const char* fmt, va_list args);
    const char* level_to_string(Level level) const;
    std::string current_time() const;
};

} // namespace resolvelink