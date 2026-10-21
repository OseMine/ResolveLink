/**
 * Logger Implementation
 */

#include "Logger.h"
#include "AbletonExtension.h"
#include <Ableton.h>
#include <cstdarg>
#include <cstdio>

namespace resolvelink {

Logger::LogLevel Logger::s_level = Logger::INFO;
std::mutex Logger::s_mutex;
std::ofstream Logger::s_file;
bool Logger::s_fileEnabled = false;
Ableton::Extension::IHost* Logger::s_host = nullptr;
std::string Logger::s_name = "ResolveLink";

void Logger::init(const std::string& name, Ableton::Extension::IHost* host) {
    std::lock_guard<std::mutex> lock(s_mutex);
    s_name = name;
    s_host = host;
}

void Logger::shutdown() {
    std::lock_guard<std::mutex> lock(s_mutex);
    if (s_file.is_open()) {
        s_file.flush();
        s_file.close();
    }
    s_fileEnabled = false;
}

void Logger::setLevel(LogLevel level) {
    std::lock_guard<std::mutex> lock(s_mutex);
    s_level = level;
}

void Logger::setFileLogging(const std::string& path, bool enable) {
    std::lock_guard<std::mutex> lock(s_mutex);
    if (s_file.is_open()) {
        s_file.flush();
        s_file.close();
    }
    s_fileEnabled = enable;
    if (enable && !path.empty()) {
        s_file.open(path, std::ios::app);
    }
}

void Logger::log(LogLevel level, const std::string& msg) {
    if (level < s_level) return;
    
    std::lock_guard<std::mutex> lock(s_mutex);
    
    std::string formatted = "[" + currentTime() + "][" + levelToString(level) + "][" + s_name + "] " + msg;
    
    // Log to console
    logToConsole(level, formatted);
    
    // Log to file
    if (s_fileEnabled && s_file.is_open()) {
        s_file << formatted << std::endl;
        s_file.flush();
    }
    
    // Log to Ableton console
    if (s_host && s_host->ShowConsoleMsg) {
        logToAbleton(level, formatted);
    }
}

void Logger::trace(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    char buffer[2048];
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);
    log(TRACE, buffer);
}

void Logger::debug(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    char buffer[2048];
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);
    log(DEBUG, buffer);
}

void Logger::info(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    char buffer[2048];
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);
    log(INFO, buffer);
}

void Logger::warn(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    char buffer[2048];
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);
    log(WARN, buffer);
}

void Logger::error(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    char buffer[2048];
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);
    log(ERROR, buffer);
}

void Logger::trace(const std::string& msg) { log(TRACE, msg); }
void Logger::debug(const std::string& msg) { log(DEBUG, msg); }
void Logger::info(const std::string& msg) { log(INFO, msg); }
void Logger::warn(const std::string& msg) { log(WARN, msg); }
void Logger::error(const std::string& msg) { log(ERROR, msg); }

std::string Logger::currentTime() {
    auto now = std::chrono::system_clock::now();
    auto time_t = std::chrono::system_clock::to_time_t(now);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ) % 1000;
    
    std::tm tm = *std::localtime(&time_t);
    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%02d:%02d:%02d.%03d",
                  tm.tm_hour, tm.tm_min, tm.tm_sec, static_cast<int>(ms.count()));
    return buffer;
}

const char* Logger::levelToString(LogLevel level) {
    switch (level) {
        case TRACE: return "TRACE";
        case DEBUG: return "DEBUG";
        case INFO:  return "INFO";
        case WARN:  return "WARN";
        case ERROR: return "ERROR";
        default:    return "UNKNOWN";
    }
}

void Logger::logToConsole(LogLevel level, const std::string& msg) {
    // Color codes for console output
    const char* color = "";
    const char* reset = "\033[0m";
    
    switch (level) {
        case TRACE: color = "\033[90m"; break;  // Gray
        case DEBUG: color = "\033[36m"; break;  // Cyan
        case INFO:  color = "\033[32m"; break;  // Green
        case WARN:  color = "\033[33m"; break;  // Yellow
        case ERROR: color = "\033[31m"; break;  // Red
        default:    color = "\033[0m";  break;
    }
    
    std::cout << color << msg << reset << std::endl;
}

void Logger::logToAbleton(LogLevel level, const std::string& msg) {
    if (!s_host || !s_host->ShowConsoleMsg) return;
    
    std::string prefix;
    switch (level) {
        case TRACE: prefix = "[TRACE]"; break;
        case DEBUG: prefix = "[DEBUG]"; break;
        case INFO:  prefix = "[INFO]";  break;
        case WARN:  prefix = "[WARN]";  break;
        case ERROR: prefix = "[ERROR]"; break;
        default:    prefix = "[LOG]";   break;
    }
    
    s_host->ShowConsoleMsg(("[" + s_name + "] " + prefix + " " + msg + "\n").c_str());
}

} // namespace resolvelink