/**
 * ResolveLink REAPER Extension - Logger Implementation
 */

#include "logger.h"
#include <ctime>
#include <cstdio>

namespace resolvelink {

Logger::~Logger() {
    if (m_file.is_open()) {
        m_file.flush();
        m_file.close();
    }
}

void Logger::init(const char* name, reaper_plugin_info_t* rec) {
    m_name = name;
    m_rec = rec;
}

void Logger::set_level(int level) {
    m_level.store(level);
}

void Logger::set_file_logging(const char* path, bool enable) {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    if (m_file.is_open()) {
        m_file.flush();
        m_file.close();
    }
    
    m_file_enabled = enable;
    if (enable && path) {
        m_file.open(path, std::ios::app);
        if (!m_file.is_open()) {
            // Fallback to console only
            m_file_enabled = false;
        }
    }
}

void Logger::flush() {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_file.is_open()) {
        m_file.flush();
    }
}

void Logger::trace(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    log(TRACE, fmt, args);
    va_end(args);
}

void Logger::debug(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    log(DEBUG, fmt, args);
    va_end(args);
}

void Logger::info(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    log(INFO, fmt, args);
    va_end(args);
}

void Logger::warn(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    log(WARN, fmt, args);
    va_end(args);
}

void Logger::error(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    log(ERROR, fmt, args);
    va_end(args);
}

void Logger::log(Level level, const char* fmt, va_list args) {
    if (level < m_level.load()) return;
    
    char buffer[2048];
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    
    std::string message = "[" + m_name + "] [" + level_to_string(level) + "] " + current_time() + "  " + buffer + "\n";
    
    // Log to REAPER console
    if (m_rec && m_rec->ShowConsoleMsg) {
        m_rec->ShowConsoleMsg(message.c_str());
    }
    
    // Log to file
    if (m_file_enabled && m_file.is_open()) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_file << message;
        m_file.flush();
    }
}

const char* Logger::level_to_string(Level level) const {
    switch (level) {
        case TRACE: return "TRACE";
        case DEBUG: return "DEBUG";
        case INFO:  return "INFO";
        case WARN:  return "WARN";
        case ERROR: return "ERROR";
        default:    return "UNKNOWN";
    }
}

std::string Logger::current_time() const {
    auto now = std::chrono::system_clock::now();
    auto time_t = std::chrono::system_clock::to_time_t(now);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()) % 1000;
    
    char buffer[32];
    std::strftime(buffer, sizeof(buffer), "%H:%M:%S", std::localtime(&time_t));
    
    char result[64];
    snprintf(result, sizeof(result), "%s.%03lld", buffer, (long long)ms.count());
    return result;
}

} // namespace resolvelink