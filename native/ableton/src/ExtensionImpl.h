/**
 * ResolveLink Ableton Extension Implementation
 */

#ifndef EXTENSION_IMPL_H
#define EXTENSION_IMPL_H

#include "AbletonExtension.h"
#include "IPCServer.h"
#include "LiveSetManager.h"
#include "TransportController.h"
#include "ClipManager.h"
#include "DeviceManager.h"
#include "Logger.h"

#include <memory>
#include <string>
#include <thread>
#include <atomic>
#include <mutex>

namespace resolvelink {

class ExtensionImpl : public Ableton::Extension::IExtension {
public:
    explicit ExtensionImpl(Ableton::Extension::IHost* host);
    ~ExtensionImpl() override;
    
    bool initialize();
    void shutdown();
    
    // IExtension interface
    bool onLoad(Ableton::Live::Application* app) override;
    void onUnload() override;
    void onIdle() override;
    void onIPCMessage(const IPCMessage& msg) override;
    void sendIPCResponse(const IPCResponse& response) override;
    void broadcastEvent(IPCMessageType type, const std::string& payload) override;
    
    Ableton::Live::Application* getLiveApp() override;
    Ableton::Live::Set* getLiveSet() override;
    
    void logInfo(const std::string& msg) override;
    void logWarn(const std::string& msg) override;
    void logError(const std::string& msg) override;
    
private:
    Ableton::Extension::IHost* m_host = nullptr;
    Ableton::Live::Application* m_app = nullptr;
    Ableton::Live::Set* m_liveSet = nullptr;
    
    std::unique_ptr<IPCServer> m_ipcServer;
    std::unique_ptr<LiveSetManager> m_liveSetManager;
    std::unique_ptr<TransportController> m_transportController;
    std::unique_ptr<ClipManager> m_clipManager;
    std::unique_ptr<DeviceManager> m_deviceManager;
    
    std::atomic<bool> m_initialized{false};
    std::atomic<bool> m_shuttingDown{false};
    
    std::thread m_idleThread;
    std::atomic<bool> m_idleRunning{false};
    std::mutex m_idleMutex;
    
    bool m_isLiveSetValid = false;
    std::mutex m_liveSetMutex;
    
    void startIdleThread();
    void stopIdleThread();
    void idleLoop();
    void validateLiveSet();
    void handleIPCMessage(const IPCMessage& msg);
    void sendIPCResponseInternal(const IPCResponse& response);
    void broadcastEventInternal(IPCMessageType type, const std::string& payload);
};

} // namespace resolvelink

#endif // EXTENSION_IMPL_H