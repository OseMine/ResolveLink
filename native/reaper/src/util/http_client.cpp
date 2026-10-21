/**
 * ResolveLink REAPER Extension - HTTP Client Implementation
 * 
 * Platform-specific implementations:
 * - Windows: WinHTTP
 * - Linux/macOS: libcurl (if available) or native sockets
 * - Fallback: REAPER SWS extension (SNM_CreateFastHTTPRequest)
 */

#include "http_client.h"
#include "util/logger.h"

#if defined(_WIN32)
    #include <windows.h>
    #include <winhttp.h>
    #pragma comment(lib, "winhttp.lib")
#elif defined(__APPLE__) || defined(__linux__)
    // Check for libcurl at compile time
    #if defined(HAVE_CURL)
        #include <curl/curl.h>
    #endif
#endif

namespace resolvelink {

struct HttpClient::Impl {
    std::string last_error;
    
    bool get(const std::string& url, std::string& out_response, int timeout_ms) {
        last_error.clear();
        
        #if defined(_WIN32)
        return winhttp_request("GET", url, "", out_response, timeout_ms);
        #elif defined(HAVE_CURL)
        return curl_request("GET", url, "", out_response, timeout_ms);
        #else
        return sws_request("GET", url, "", out_response, timeout_ms);
        #endif
    }
    
    bool post(const std::string& url, const std::string& body, std::string& out_response, int timeout_ms) {
        last_error.clear();
        
        #if defined(_WIN32)
        return winhttp_request("POST", url, body, out_response, timeout_ms);
        #elif defined(HAVE_CURL)
        return curl_request("POST", url, body, out_response, timeout_ms);
        #else
        return sws_request("POST", url, body, out_response, timeout_ms);
        #endif
    }
    
    bool put(const std::string& url, const std::string& body, std::string& out_response, int timeout_ms) {
        last_error.clear();
        
        #if defined(_WIN32)
        return winhttp_request("PUT", url, body, out_response, timeout_ms);
        #elif defined(HAVE_CURL)
        return curl_request("PUT", url, body, out_response, timeout_ms);
        #else
        return sws_request("PUT", url, body, out_response, timeout_ms);
        #endif
    }
    
    #if defined(_WIN32)
    bool winhttp_request(const std::string& method, const std::string& url, const std::string& body, std::string& out_response, int timeout_ms) {
        // Parse URL
        URL_COMPONENTSA url_comp = {0};
        url_comp.dwStructSize = sizeof(url_comp);
        url_comp.dwSchemeLength = 1;
        url_comp.dwHostNameLength = 1;
        url_comp.dwUrlPathLength = 1;
        url_comp.dwExtraInfoLength = 1;
        
        char scheme[16], host[256], path[1024], extra[1024];
        url_comp.lpszScheme = scheme;
        url_comp.dwSchemeLength = sizeof(scheme);
        url_comp.lpszHostName = host;
        url_comp.dwHostNameLength = sizeof(host);
        url_comp.lpszUrlPath = path;
        url_comp.dwUrlPathLength = sizeof(path);
        url_comp.lpszExtraInfo = extra;
        url_comp.dwExtraInfoLength = sizeof(extra);
        
        if (!WinHttpCrackUrl(url.c_str(), 0, ICU_ESCAPE, &url_comp)) {
            last_error = "Invalid URL";
            return false;
        }
        
        // Open session
        HINTERNET session = WinHttpOpen("ResolveLink/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (!session) {
            last_error = "WinHttpOpen failed: " + std::to_string(GetLastError());
            return false;
        }
        
        // Connect
        HINTERNET connect = WinHttpConnect(session, host, url_comp.nPort, 0);
        if (!connect) {
            last_error = "WinHttpConnect failed: " + std::to_string(GetLastError());
            WinHttpCloseHandle(session);
            return false;
        }
        
        // Open request
        const char* accept_types[] = {"application/json", "*/*", nullptr};
        HINTERNET request = WinHttpOpenRequest(connect, method.c_str(), path, nullptr, WINHTTP_NO_REFERER, accept_types, 
            (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0);
        if (!request) {
            last_error = "WinHttpOpenRequest failed: " + std::to_string(GetLastError());
            WinHttpCloseHandle(connect);
            WinHttpCloseHandle(session);
            return false;
        }
        
        // Set timeouts
        DWORD timeout = static_cast<DWORD>(timeout_ms);
        WinHttpSetTimeouts(request, timeout, timeout, timeout, timeout);
        
        // Set headers
        std::string headers = "Content-Type: application/json\r\n";
        if (!body.empty()) {
            headers += "Content-Length: " + std::to_string(body.size()) + "\r\n";
        }
        
        // Send request
        BOOL sent = WinHttpSendRequest(request, headers.c_str(), -1, 
            const_cast<char*>(body.c_str()), body.size(), body.size(), 0);
        if (!sent) {
            last_error = "WinHttpSendRequest failed: " + std::to_string(GetLastError());
            WinHttpCloseHandle(request);
            WinHttpCloseHandle(connect);
            WinHttpCloseHandle(session);
            return false;
        }
        
        // Receive response
        if (!WinHttpReceiveResponse(request, nullptr)) {
            last_error = "WinHttpReceiveResponse failed: " + std::to_string(GetLastError());
            WinHttpCloseHandle(request);
            WinHttpCloseHandle(connect);
            WinHttpCloseHandle(session);
            return false;
        }
        
        // Read response
        out_response.clear();
        char buffer[8192];
        DWORD bytes_read = 0;
        while (WinHttpReadData(request, buffer, sizeof(buffer) - 1, &bytes_read) && bytes_read > 0) {
            buffer[bytes_read] = '\0';
            out_response += buffer;
        }
        
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connect);
        WinHttpCloseHandle(session);
        
        return true;
    }
    #endif
    
    #if defined(HAVE_CURL)
    static size_t curl_write_callback(void* contents, size_t size, size_t nmemb, std::string* out) {
        size_t total = size * nmemb;
        out->append(static_cast<char*>(contents), total);
        return total;
    }
    
    bool curl_request(const std::string& method, const std::string& url, const std::string& body, std::string& out_response, int timeout_ms) {
        CURL* curl = curl_easy_init();
        if (!curl) {
            last_error = "curl_easy_init failed";
            return false;
        }
        
        out_response.clear();
        
        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curl_write_callback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &out_response);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeout_ms);
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
        curl_easy_setopt(curl, CURLOPT_USERAGENT, "ResolveLink/1.0");
        
        if (method == "POST") {
            curl_easy_setopt(curl, CURLOPT_POST, 1L);
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
            curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, body.size());
        } else if (method == "PUT") {
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
            curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, body.size());
        }
        
        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "Content-Type: application/json");
        headers = curl_slist_append(headers, "Accept: application/json");
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        
        CURLcode res = curl_easy_perform(curl);
        
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
        
        if (res != CURLE_OK) {
            last_error = "curl error: " + std::string(curl_easy_strerror(res));
            return false;
        }
        
        return true;
    }
    #endif
    
    bool sws_request(const std::string& method, const std::string& url, const std::string& body, std::string& out_response, int timeout_ms) {
        // Try REAPER SWS extension
        // This requires reaper_plugin_info_t which we don't have here
        // Fallback: use external curl or return error
        last_error = "No HTTP backend available (need WinHTTP, libcurl, or SWS)";
        return false;
    }
};

HttpClient::HttpClient() : m_impl(std::make_unique<Impl>()) {}

HttpClient::~HttpClient() = default;

bool HttpClient::get(const std::string& url, std::string& out_response, int timeout_ms) {
    return m_impl->get(url, out_response, timeout_ms);
}

bool HttpClient::post(const std::string& url, const std::string& json_body, std::string& out_response, int timeout_ms) {
    return m_impl->post(url, json_body, out_response, timeout_ms);
}

bool HttpClient::put(const std::string& url, const std::string& json_body, std::string& out_response, int timeout_ms) {
    return m_impl->put(url, json_body, out_response, timeout_ms);
}

void HttpClient::set_header(const std::string& name, const std::string& value) {
    // Not implemented for all backends
    (void)name;
    (void)value;
}

void HttpClient::set_user_agent(const std::string& ua) {
    m_user_agent = ua;
}

std::string HttpClient::last_error() const {
    return m_impl->last_error;
}

} // namespace resolvelink