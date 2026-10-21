/**
 * ResolveLink REAPER Extension - Named Pipe IPC Server
 * 
 * Provides high-performance inter-process communication between
 * REAPER and the ResolveLink server (Node.js).
 * Supports both Windows named pipes and cross-platform TCP fallback.
 */

#pragma once

#include <string>
#include <atomic>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <functional>
#include <memory>

#if defined(_WIN32)
    #include <windows.h>
    #include <namedpipeapi.h>
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <unistd.h>
    #include <fcntl.h>
#endif

namespace resolvelink {

class NamedPipeServer {
public:
    NamedPipeServer();
    ~NamedPipeServer();
    
    // Start named pipe server (Windows) or Unix domain socket (Linux/macOS)
    bool start(const std::string& pipe_name);
    
    // Start TCP server (cross-platform fallback)
    bool start_tcp(uint16_t port);
    
    // Stop server
    void stop();
    
    // Check if client connected
    bool is_connected() const;
    
    // Send message to connected client
    bool send(const void* data, size_t size);
    bool send(const std::string& message);
    
    // Receive message (blocking with optional timeout)
    // Returns false on timeout/disconnect
    bool receive(std::string& out_message, int timeout_ms = 0);
    
    // Set message handler callback
    void set_message_handler(std::function<void(const std::string&)> handler);
    
    // Get connection stats
    struct Stats {
        uint64_t messages_sent = 0;
        uint64_t messages_received = 0;
        uint64_t bytes_sent = 0;
        uint64_t bytes_received = 0;
        bool connected = false;
    };
    Stats get_stats() const;

private:
    // Platform-specific handle
    #if defined(_WIN32)
    HANDLE m_pipe_handle = INVALID_HANDLE_VALUE;
    HANDLE m_listen_thread = nullptr;
    OVERLAPPED m_read_overlapped = {};
    OVERLAPPED m_write_overlapped = {};
    #else
    int m_server_fd = -1;
    int m_client_fd = -1;
    std::thread m_accept_thread;
    #endif
    
    std::thread m_io_thread;
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_client_connected{false};
    
    // Message queue for async sends
    struct QueuedMessage {
        std::vector<uint8_t> data;
    };
    std::mutex m_send_mutex;
    std::queue<QueuedMessage> m_send_queue;
    std::condition_variable m_send_cv;
    
    // Message handler
    std::mutex m_handler_mutex;
    std::function<void(const std::string&)> m_message_handler;
    
    // Stats
    mutable std::mutex m_stats_mutex;
    Stats m_stats;
    
    // Platform-specific implementations
    #if defined(_WIN32)
    bool create_pipe(const std::string& pipe_name);
    void pipe_listen_loop();
    void pipe_io_loop();
    #else
    bool create_unix_socket(const std::string& path);
    bool create_tcp_socket(uint16_t port);
    void socket_accept_loop();
    void socket_io_loop();
    #endif
    
    void process_send_queue();
    void handle_received_message(const std::string& message);
    void update_stats_sent(size_t bytes);
    void update_stats_received(size_t bytes);
};

// Cross-platform pipe client for Node.js to connect
class NamedPipeClient {
public:
    NamedPipeClient();
    ~NamedPipeClient();
    
    bool connect(const std::string& pipe_name, int timeout_ms = 5000);
    bool connect_tcp(const std::string& host, uint16_t port, int timeout_ms = 5000);
    void disconnect();
    
    bool is_connected() const;
    bool send(const std::string& message);
    bool receive(std::string& out_message, int timeout_ms = 0);
    
private:
    #if defined(_WIN32)
    HANDLE m_pipe_handle = INVALID_HANDLE_VALUE;
    #else
    int m_socket_fd = -1;
    #endif
    std::atomic<bool> m_connected{false};
};

} // namespace resolvelink