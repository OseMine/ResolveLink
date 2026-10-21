/**
 * Logger - Thread-safe logging for the extension
 */

#ifndef LOGGER_H
#define LOGGER_H

#include <string>
#include <mutex>
#include <fstream>
#include <chrono>
#include <iostream>
#include <sstream>

namespace resolvelink {

enum class LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4
};

class Logger {
public:
    static void init(const std::string& name, Ableton::Extension::IHost* host = nullptr);
    static void shutdown();
    
    static void setLevel(LogLevel level);
    static void setFileLogging(const std::string& path, bool enable);
    
    static void trace(const char* fmt, ...);
    static void debug(const char* fmt, ...);
    static void info(const char* fmt, ...);
    static void warn(const char* fmt, ...);
    static void error(const char* fmt, ...);
    
    static void trace(const std::string& msg);
    static void debug(const std::string& msg);
    static void info(const std::string& msg);
    static void warn(const std::string& msg);
    static void error(const std::string& msg);

private:
    static LogLevel s_level;
    static std::mutex s_mutex;
    static std::ofstream s_file;
    static bool s_fileEnabled;
    static Ableton::Extension::IHost* s_host;
    static std::string s_name;
    
    static void log(LogLevel level, const std::string& msg);
    static std::string currentTime();
    static std::string levelToString(LogLevel level);
    static void logToConsole(LogLevel level, const std::string& msg);
    static void logToFile(LogLevel level, const std::string& msg);
    static void logToAbleton(LogLevel level, const std::string& msg);
};

} // namespace resolvelink

#endif // LOGGER_H