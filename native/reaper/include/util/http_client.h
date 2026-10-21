/**
 * ResolveLink REAPER Extension - HTTP Client
 * 
 * Cross-platform HTTP client for communicating with ResolveLink server.
 * Uses WinHTTP on Windows, libcurl on Linux/macOS, or SWS in REAPER.
 */

#pragma once

#include <string>
#include <functional>
#include <chrono>
#include <optional>

namespace resolvelink {

class HttpClient {
public:
    HttpClient();
    ~HttpClient();
    
    // GET request
    // Returns true on success, false on error
    bool get(const std::string& url, std::string& out_response, int timeout_ms = 10000);
    
    // POST request with JSON body
    bool post(const std::string& url, const std::string& json_body, std::string& out_response, int timeout_ms = 10000);
    
    // PUT request with JSON body
    bool put(const std::string& url, const std::string& json_body, std::string& out_response, int timeout_ms = 10000);
    
    // Set default headers
    void set_header(const std::string& name, const std::string& value);
    
    // Set user agent
    void set_user_agent(const std::string& ua);
    
    // Get last error message
    std::string last_error() const;

private:
    struct Impl;
    std::unique_ptr<Impl> m_impl;
    
    std::string m_user_agent = "ResolveLink/1.0";
    std::string m_last_error;
};

} // namespace resolvelink