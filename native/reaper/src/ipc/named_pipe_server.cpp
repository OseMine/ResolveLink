/**
 * ResolveLink REAPER Extension - Named Pipe IPC Server Implementation
 * 
 * Windows: Uses named pipes (\\.\pipe\ResolveLink)
 * Linux/macOS: Uses Unix domain sockets or TCP fallback
 */

#include "named_pipe_server.h"
#include "util/logger.h"

#include <cstring>
#include <chrono>

namespace resolvelink {

NamedPipeServer::NamedPipeServer() = default;

NamedPipeServer::~NamedPipeServer() {
    stop();
}

bool NamedPipeServer::start(const std::string& pipe_name) {
    if (m_running) return true;
    
    #if defined(_WIN32)
    return create_pipe(pipe_name);
    #else
    return create_unix_socket(pipe_name);
    #endif
}

bool NamedPipeServer::start_tcp(uint16_t port) {
    if (m_running) return true;
    
    #if defined(_WIN32)
    // Windows: create TCP socket
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        get_logger().error("WSAStartup failed");
        return false;
    }
    #endif
    
    return create_tcp_socket(port);
}

void NamedPipeServer::stop() {
    if (!m_running) return;
    
    m_running = false;
    m_client_connected = false;
    
    #if defined(_WIN32)
    if (m_pipe_handle != INVALID_HANDLE_VALUE) {
        CancelIoEx(m_pipe_handle, nullptr);
        FlushFileBuffers(m_pipe_handle);
        DisconnectNamedPipe(m_pipe_handle);
        CloseHandle(m_pipe_handle);
        m_pipe_handle = INVALID_HANDLE_VALUE;
    }
    if (m_listen_thread) {
        WaitForSingleObject(m_listen_thread, 1000);
        CloseHandle(m_listen_thread);
        m_listen_thread = nullptr;
    }
    #else
    if (m_client_fd >= 0) {
        close(m_client_fd);
        m_client_fd = -1;
    }
    if (m_server_fd >= 0) {
        close(m_server_fd);
        m_server_fd = -1;
    }
    if (m_accept_thread.joinable()) {
        m_accept_thread.join();
    }
    #endif
    
    if (m_io_thread.joinable()) {
        m_io_thread.join();
    }
    
    get_logger().info("Named pipe server stopped");
}

bool NamedPipeServer::is_connected() const {
    return m_client_connected.load();
}

bool NamedPipeServer::send(const void* data, size_t size) {
    if (!m_client_connected || !data || size == 0) return false;
    
    // Queue message for async send
    QueuedMessage msg;
    msg.data.assign(static_cast<const uint8_t*>(data), 
                    static_cast<const uint8_t*>(data) + size);
    
    {
        std::lock_guard<std::mutex> lock(m_send_mutex);
        m_send_queue.push(std::move(msg));
    }
    m_send_cv.notify_one();
    return true;
}

bool NamedPipeServer::send(const std::string& message) {
    return send(message.c_str(), message.size());
}

bool NamedPipeServer::receive(std::string& out_message, int timeout_ms) {
    // For sync receive, we'd need a receive queue
    // This is a simplified version - in practice, use message handler callback
    (void)out_message;
    (void)timeout_ms;
    return false;
}

void NamedPipeServer::set_message_handler(std::function<void(const std::string&)> handler) {
    std::lock_guard<std::mutex> lock(m_handler_mutex);
    m_message_handler = std::move(handler);
}

NamedPipeServer::Stats NamedPipeServer::get_stats() const {
    std::lock_guard<std::mutex> lock(m_stats_mutex);
    Stats s = m_stats;
    s.connected = m_client_connected.load();
    return s;
}

// Platform-specific implementations
#if defined(_WIN32)

bool NamedPipeServer::create_pipe(const std::string& pipe_name) {
    m_pipe_handle = CreateNamedPipeA(
        pipe_name.c_str(),
        PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
        PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
        PIPE_UNLIMITED_INSTANCES,
        65536,  // Output buffer size
        65536,  // Input buffer size
        5000,   // Default timeout
        nullptr // Security attributes
    );
    
    if (m_pipe_handle == INVALID_HANDLE_VALUE) {
        get_logger().error("CreateNamedPipe failed: %lu", GetLastError());
        return false;
    }
    
    m_running = true;
    m_listen_thread = CreateThread(
        nullptr, 0,
        [](LPVOID param) -> DWORD {
            static_cast<NamedPipeServer*>(param)->pipe_listen_loop();
            return 0;
        },
        this, 0, nullptr
    );
    
    if (!m_listen_thread) {
        get_logger().error("Failed to create listen thread");
        return false;
    }
    
    get_logger().info("Named pipe server started: %s", pipe_name.c_str());
    return true;
}

void NamedPipeServer::pipe_listen_loop() {
    while (m_running) {
        BOOL connected = ConnectNamedPipe(m_pipe_handle, &m_read_overlapped);
        DWORD error = GetLastError();
        
        if (connected || error == ERROR_IO_PENDING) {
            // Wait for connection
            DWORD bytes = 0;
            if (GetOverlappedResult(m_pipe_handle, &m_read_overlapped, &bytes, TRUE)) {
                m_client_connected = true;
                get_logger().info("Client connected to named pipe");
                
                // Start IO loop
                pipe_io_loop();
                
                // Client disconnected, prepare for next
                DisconnectNamedPipe(m_pipe_handle);
                m_client_connected = false;
                ZeroMemory(&m_read_overlapped, sizeof(OVERLAPPED));
                ZeroMemory(&m_write_overlapped, sizeof(OVERLAPPED));
            }
        } else if (error != ERROR_PIPE_CONNECTED) {
            get_logger().error("ConnectNamedPipe failed: %lu", error);
            Sleep(100);
        }
    }
}

void NamedPipeServer::pipe_io_loop() {
    std::vector<uint8_t> read_buffer(65536);
    
    while (m_running && m_client_connected) {
        // Process send queue
        process_send_queue();
        
        // Read from pipe
        DWORD bytes_read = 0;
        BOOL result = ReadFile(
            m_pipe_handle,
            read_buffer.data(),
            static_cast<DWORD>(read_buffer.size()),
            &bytes_read,
            &m_read_overlapped
        );
        
        if (!result) {
            DWORD error = GetLastError();
            if (error == ERROR_IO_PENDING) {
                if (GetOverlappedResult(m_pipe_handle, &m_read_overlapped, &bytes_read, TRUE)) {
                    if (bytes_read > 0) {
                        std::string message(reinterpret_cast<char*>(read_buffer.data()), bytes_read);
                        handle_received_message(message);
                        update_stats_received(bytes_read);
                    } else {
                        break; // Client disconnected
                    }
                } else {
                    error = GetLastError();
                    if (error != ERROR_IO_INCOMPLETE) {
                        break;
                    }
                }
            } else if (error == ERROR_BROKEN_PIPE || error == ERROR_PIPE_NOT_CONNECTED) {
                break;
            }
        } else if (bytes_read > 0) {
            std::string message(reinterpret_cast<char*>(read_buffer.data()), bytes_read);
            handle_received_message(message);
            update_stats_received(bytes_read);
        }
        
        Sleep(1); // Yield
    }
}

#else // Linux/macOS

bool NamedPipeServer::create_unix_socket(const std::string& path) {
    m_server_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (m_server_fd < 0) {
        get_logger().error("Failed to create Unix socket: %s", strerror(errno));
        return false;
    }
    
    // Remove existing socket file
    unlink(path.c_back());
    
    struct sockaddr_un addr = {};
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, path.c_str(), sizeof(addr.sun_path) - 1);
    
    if (bind(m_server_fd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        get_logger().error("Unix socket bind failed: %s", strerror(errno));
        close(m_server_fd);
        return false;
    }
    
    if (listen(m_server_fd, 5) < 0) {
        get_logger().error("Unix socket listen failed: %s", strerror(errno));
        close(m_server_fd);
        return false;
    }
    
    // Set non-blocking
    fcntl(m_server_fd, F_SETFL, O_NONBLOCK);
    
    m_running = true;
    m_accept_thread = std::thread(&NamedPipeServer::socket_accept_loop, this);
    
    get_logger().info("Unix domain socket server started: %s", path.c_str());
    return true;
}

bool NamedPipeServer::create_tcp_socket(uint16_t port) {
    m_server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (m_server_fd < 0) {
        get_logger().error("Failed to create TCP socket: %s", strerror(errno));
        return false;
    }
    
    int opt = 1;
    setsockopt(m_server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    
    struct sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(port);
    
    if (bind(m_server_fd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        get_logger().error("TCP socket bind failed: %s", strerror(errno));
        close(m_server_fd);
        return false;
    }
    
    if (listen(m_server_fd, 5) < 0) {
        get_logger().error("TCP socket listen failed: %s", strerror(errno));
        close(m_server_fd);
        return false;
    }
    
    fcntl(m_server_fd, F_SETFL, O_NONBLOCK);
    
    m_running = true;
    m_accept_thread = std::thread(&NamedPipeServer::socket_accept_loop, this);
    
    get_logger().info("TCP server started on port %d", port);
    return true;
}

void NamedPipeServer::socket_accept_loop() {
    while (m_running) {
        struct sockaddr_storage client_addr;
        socklen_t client_len = sizeof(client_addr);
        
        int client_fd = accept(m_server_fd, (struct sockaddr*)&client_addr, &client_len);
        if (client_fd < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                continue;
            }
            if (m_running) {
                get_logger().error("Accept failed: %s", strerror(errno));
            }
            break;
        }
        
        if (m_client_connected) {
            // Only one client at a time for simplicity
            close(client_fd);
            continue;
        }
        
        m_client_fd = client_fd;
        fcntl(m_client_fd, F_SETFL, O_NONBLOCK);
        m_client_connected = true;
        get_logger().info("Client connected via socket");
        
        m_io_thread = std::thread(&NamedPipeServer::socket_io_loop, this);
        break; // Single client
    }
}

void NamedPipeServer::socket_io_loop() {
    std::vector<uint8_t> read_buffer(65536);
    
    while (m_running && m_client_connected && m_client_fd >= 0) {
        // Process send queue
        process_send_queue();
        
        // Read from socket
        ssize_t bytes_read = read(m_client_fd, read_buffer.data(), read_buffer.size());
        if (bytes_read > 0) {
            std::string message(reinterpret_cast<char*>(read_buffer.data()), bytes_read);
            handle_received_message(message);
            update_stats_received(bytes_read);
        } else if (bytes_read == 0) {
            get_logger().info("Client disconnected");
            break;
        } else {
            if (errno == EAGAIN || errno == EWOULDBLOCK) {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
                continue;
            }
            get_logger().error("Socket read error: %s", strerror(errno));
            break;
        }
    }
    
    m_client_connected = false;
    if (m_client_fd >= 0) {
        close(m_client_fd);
        m_client_fd = -1;
    }
}

#endif

void NamedPipeServer::process_send_queue() {
    QueuedMessage msg;
    {
        std::lock_guard<std::mutex> lock(m_send_mutex);
        if (m_send_queue.empty()) return;
        msg = std::move(m_send_queue.front());
        m_send_queue.pop();
    }
    
    if (msg.data.empty()) return;
    
    #if defined(_WIN32)
    DWORD bytes_written = 0;
    BOOL result = WriteFile(
        m_pipe_handle,
        msg.data.data(),
        static_cast<DWORD>(msg.data.size()),
        &bytes_written,
        &m_write_overlapped
    );
    
    if (!result) {
        DWORD error = GetLastError();
        if (error == ERROR_IO_PENDING) {
            GetOverlappedResult(m_pipe_handle, &m_write_overlapped, &bytes_written, TRUE);
        } else {
            get_logger().error("WriteFile failed: %lu", error);
            m_client_connected = false;
            return;
        }
    }
    update_stats_sent(bytes_written);
    #else
    if (m_client_fd >= 0) {
        ssize_t written = write(m_client_fd, msg.data.data(), msg.data.size());
        if (written > 0) {
            update_stats_sent(written);
        } else if (written < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
            get_logger().error("Socket write error: %s", strerror(errno));
            m_client_connected = false;
        }
    }
    #endif
}

void NamedPipeServer::handle_received_message(const std::string& message) {
    std::function<void(const std::string&)> handler;
    {
        std::lock_guard<std::mutex> lock(m_handler_mutex);
        handler = m_message_handler;
    }
    
    if (handler) {
        handler(message);
    }
}

void NamedPipeServer::update_stats_sent(size_t bytes) {
    std::lock_guard<std::mutex> lock(m_stats_mutex);
    m_stats.messages_sent++;
    m_stats.bytes_sent += bytes;
}

void NamedPipeServer::update_stats_received(size_t bytes) {
    std::lock_guard<std::mutex> lock(m_stats_mutex);
    m_stats.messages_received++;
    m_stats.bytes_received += bytes;
}

// NamedPipeClient implementation
NamedPipeClient::NamedPipeClient() = default;

NamedPipeClient::~NamedPipeClient() {
    disconnect();
}

bool NamedPipeClient::connect(const std::string& pipe_name, int timeout_ms) {
    #if defined(_WIN32)
    auto start = std::chrono::steady_clock::now();
    
    while (m_running) {
        m_pipe_handle = CreateFileA(
            pipe_name.c_str(),
            GENERIC_READ | GENERIC_WRITE,
            0, nullptr, OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED, nullptr
        );
        
        if (m_pipe_handle != INVALID_HANDLE_VALUE) {
            m_connected = true;
            get_logger().info("Connected to named pipe: %s", pipe_name.c_str());
            return true;
        }
        
        DWORD error = GetLastError();
        if (error != ERROR_PIPE_BUSY) {
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - start).count();
            if (elapsed >= timeout_ms) break;
        }
        
        if (!WaitNamedPipeA(pipe_name.c_str(), 100)) {
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - start).count();
            if (elapsed >= timeout_ms) break;
        }
    }
    
    return false;
    #else
    // Unix domain socket
    m_socket_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (m_socket_fd < 0) return false;
    
    struct sockaddr_un addr = {};
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, pipe_name.c_str(), sizeof(addr.sun_path) - 1);
    
    // Set timeout
    struct timeval tv = {timeout_ms / 1000, (timeout_ms % 1000) * 1000};
    setsockopt(m_socket_fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(m_socket_fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    
    if (::connect(m_socket_fd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        close(m_socket_fd);
        m_socket_fd = -1;
        return false;
    }
    
    m_connected = true;
    return true;
    #endif
}

bool NamedPipeClient::connect_tcp(const std::string& host, uint16_t port, int timeout_ms) {
    #if defined(_WIN32)
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);
    #endif
    
    m_socket_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (m_socket_fd < 0) return false;
    
    struct sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, host.c_str(), &addr.sin_addr);
    
    // Set timeout
    #if defined(_WIN32)
    DWORD timeout = timeout_ms;
    setsockopt(m_socket_fd, SOL_SOCKET, SO_RCVTIMEO, (char*)&timeout, sizeof(timeout));
    setsockopt(m_socket_fd, SOL_SOCKET, SO_SNDTIMEO, (char*)&timeout, sizeof(timeout));
    #else
    struct timeval tv = {timeout_ms / 1000, (timeout_ms % 1000) * 1000};
    setsockopt(m_socket_fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(m_socket_fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    #endif
    
    if (::connect(m_socket_fd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        close(m_socket_fd);
        m_socket_fd = -1;
        return false;
    }
    
    m_connected = true;
    return true;
}

void NamedPipeClient::disconnect() {
    if (m_connected) {
        #if defined(_WIN32)
        if (m_pipe_handle != INVALID_HANDLE_VALUE) {
            CloseHandle(m_pipe_handle);
            m_pipe_handle = INVALID_HANDLE_VALUE;
        }
        #else
        if (m_socket_fd >= 0) {
            close(m_socket_fd);
            m_socket_fd = -1;
        }
        #endif
        m_connected = false;
    }
}

bool NamedPipeClient::is_connected() const {
    return m_connected;
}

bool NamedPipeClient::send(const std::string& message) {
    if (!m_connected) return false;
    
    #if defined(_WIN32)
    DWORD written = 0;
    return WriteFile(m_pipe_handle, message.c_str(), (DWORD)message.size(), &written, nullptr);
    #else
    return write(m_socket_fd, message.c_str(), message.size()) == (ssize_t)message.size();
    #endif
}

bool NamedPipeClient::receive(std::string& out_message, int timeout_ms) {
    if (!m_connected) return false;
    
    std::vector<char> buffer(65536);
    
    #if defined(_WIN32)
    DWORD read = 0;
    BOOL result = ReadFile(m_pipe_handle, buffer.data(), (DWORD)buffer.size(), &read, nullptr);
    if (result && read > 0) {
        out_message.assign(buffer.data(), read);
        return true;
    }
    return false;
    #else
    ssize_t read = recv(m_socket_fd, buffer.data(), buffer.size(), 0);
    if (read > 0) {
        out_message.assign(buffer.data(), read);
        return true;
    }
    return false;
    #endif
}

} // namespace resolvelink