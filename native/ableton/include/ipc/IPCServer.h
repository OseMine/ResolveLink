/**
 * IPC Server - Handles communication between Ableton Extension and ResolveLink Server
 * Supports named pipes (Windows), Unix domain sockets (Unix), and TCP fallback
 */

#ifndef IPC_SERVER_H
#define IPC_SERVER_H

#include <string>
#include <functional>
#include <atomic>
#include <thread>
#include <mutex>
#include <queue>
#include <condition_variable>
#include <memory>
#include <cstdint>
#include <vector>

#include "AbletonExtension.h"

namespace resolvelink {

class ExtensionImpl;

class IPCServer {
public:
    explicit IPCServer(ExtensionImpl* extension);
    ~IPCServer();
    
    // Start the IPC server
    bool start(const std::string& pipeName = "");
    void stop();
    
    // Send response to client
    void sendResponse(const IPCResponse& response);
    
    // Broadcast event to all connected clients
    void broadcast(const IPCMessage& event);
    
    // Process incoming messages (call from main thread)
    void processMessages();
    
    // Handle incoming message, populate response
    bool handleMessage(const IPCMessage& msg, IPCResponse& response);
    
    // Check if server is running
    bool isRunning() const { return m_running.load(); }
    
    // Get connected client count
    size_t getClientCount() const { return m_clients.size(); }

private:
    ExtensionImpl* m_extension;
    
    std::atomic<bool> m_running{false};
    std::string m_pipeName;
    
    // Platform-specific handles
    #ifdef _WIN32
    HANDLE m_pipeHandle = INVALID_HANDLE_VALUE;
    HANDLE m_listenThread = nullptr;
    #else
    int m_serverFd = -1;
    int m_clientFd = -1;
    std::thread m_acceptThread;
    #endif
    
    std::thread m_ioThread;
    std::atomic<bool> m_clientConnected{false};
    
    // Message queue for thread-safe communication
    struct QueuedMessage {
        IPCMessage msg;
        std::chrono::steady_clock::time_point timestamp;
    };
    std::mutex m_queueMutex;
    std::queue<QueuedMessage> m_messageQueue;
    std::condition_variable m_queueCV;
    
    // Client management
    struct ClientInfo {
        #ifdef _WIN32
        HANDLE pipeHandle;
        #else
        int socketFd;
        #endif
        std::thread ioThread;
        bool connected = true;
    };
    std::mutex m_clientsMutex;
    std::vector<std::unique_ptr<ClientInfo>> m_clients;
    
    // Platform-specific implementations
    #ifdef _WIN32
    bool createNamedPipe(const std::string& pipeName);
    void pipeListenLoop();
    void pipeIOLoop();
    #else
    bool createUnixSocket(const std::string& path);
    bool createTCPSocket(uint16_t port);
    void socketAcceptLoop();
    void socketIOLoop();
    #endif
    
    void processSendQueue(ClientInfo* client);
    void handleClientMessage(ClientInfo* client, const std::string& message);
    void handleClientDisconnect(ClientInfo* client);
    void updateStatsSent(size_t bytes);
    void updateStatsReceived(size_t bytes);
    
    // Message handlers
    bool handleConnect(const IPCMessage& msg, IPCResponse& response);
    bool handleDisconnect(const IPCMessage& msg, IPCResponse& response);
    bool handleGetLiveSetInfo(const IPCMessage& msg, IPCResponse& response);
    bool handleSetTempo(const IPCMessage& msg, IPCResponse& response);
    bool handleTransportControl(const IPCMessage& msg, IPCResponse& response);
    bool handleTrackOperation(const IPCMessage& msg, IPCResponse& response);
    bool handleClipOperation(const IPCMessage& msg, IPCResponse& response);
    bool handleDeviceOperation(const IPCMessage& msg, IPCResponse& response);
    bool handleRenderOperation(const IPCMessage& msg, IPCResponse& response);
};

} // namespace resolvelink

#endif // IPC_SERVER_H