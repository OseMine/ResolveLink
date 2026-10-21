/**
 * ResolveLink Ableton Extension Implementation
 */

#include "ExtensionImpl.h"
#include "IPCServer.h"
#include "LiveSetManager.h"
#include "TransportController.h"
#include "ClipManager.h"
#include "DeviceManager.h"
#include "Logger.h"

#include <Ableton.h>
#include <AbletonLive.h>
#include <chrono>
#include <sstream>

namespace resolvelink {

ExtensionImpl::ExtensionImpl(Ableton::Extension::IHost* host)
    : m_host(host)
    , m_app(nullptr)
    , m_liveSet(nullptr)
    , m_shuttingDown(false) {
}

ExtensionImpl::~ExtensionImpl() {
    shutdown();
}

bool ExtensionImpl::initialize() {
    if (m_initialized.load()) return true;
    
    Logger::info("Initializing ResolveLink Ableton Extension...");
    
    if (!m_host) {
        Logger::error("Host is null");
        return false;
    }
    
    m_app = m_host->getApplication();
    if (!m_app) {
        Logger::error("Failed to get Ableton application");
        return false;
    }
    
    m_liveSet = m_app->getLiveSet();
    if (!m_liveSet) {
        Logger::warn("LiveSet not available yet (no project open)");
    } else {
        m_isLiveSetValid = true;
    }
    
    // Initialize managers
    m_liveSetManager = std::make_unique<LiveSetManager>(m_liveSet);
    m_transportController = std::make_unique<TransportController>(m_liveSet);
    m_clipManager = std::make_unique<ClipManager>(m_liveSet);
    m_deviceManager = std::make_unique<DeviceManager>(m_liveSet);
    
    // Initialize IPC server (named pipe + TCP fallback)
    m_ipcServer = std::make_unique<IPCServer>(this);
    if (!m_ipcServer->start()) {
        Logger::warn("Failed to start IPC server, falling back to file-based IPC");
    }
    
    // Start idle thread for background processing
    startIdleThread();
    
    m_initialized.store(true);
    Logger::info("ResolveLink Ableton Extension initialized successfully");
    
    return true;
}

void ExtensionImpl::shutdown() {
    if (m_shuttingDown.exchange(true)) return;
    
    Logger::info("Shutting down ResolveLink Ableton Extension...");
    
    m_shuttingDown.store(true);
    stopIdleThread();
    
    if (m_ipcServer) {
        m_ipcServer->stop();
        m_ipcServer.reset();
    }
    
    m_deviceManager.reset();
    m_clipManager.reset();
    m_transportController.reset();
    m_liveSetManager.reset();
    
    m_liveSet = nullptr;
    m_app = nullptr;
    m_host = nullptr;
    m_isLiveSetValid = false;
    m_initialized.store(false);
    
    Logger::info("ResolveLink Ableton Extension shutdown complete");
}

bool ExtensionImpl::onLoad(Ableton::Live::Application* app) {
    m_app = app;
    m_liveSet = app->getLiveSet();
    m_isLiveSetValid = (m_liveSet != nullptr);
    
    Logger::info("Ableton Live application loaded");
    return true;
}

void ExtensionImpl::onUnload() {
    Logger::info("Ableton Live application unloaded");
    m_isLiveSetValid = false;
    m_liveSet = nullptr;
}

void ExtensionImpl::onIdle() {
    // Called periodically from Ableton's main thread
    if (m_shuttingDown.load()) return;
    
    validateLiveSet();
    
    // Process any pending IPC messages
    if (m_ipcServer) {
        m_ipcServer->processMessages();
    }
}

void ExtensionImpl::onIPCMessage(const IPCMessage& msg) {
    if (m_shuttingDown.load()) return;
    
    // Handle message in background to not block Ableton's main thread
    std::thread([this, msg]() {
        handleIPCMessage(msg);
    }).detach();
}

void ExtensionImpl::sendIPCResponse(const IPCResponse& response) {
    sendIPCResponseInternal(response);
}

void ExtensionImpl::broadcastEvent(IPCMessageType type, const std::string& payload) {
    broadcastEventInternal(type, payload);
}

Ableton::Live::Application* ExtensionImpl::getLiveApp() {
    return m_app;
}

Ableton::Live::Set* ExtensionImpl::getLiveSet() {
    return m_liveSet;
}

void ExtensionImpl::logInfo(const std::string& msg) {
    Logger::info(msg);
}

void ExtensionImpl::logWarn(const std::string& msg) {
    Logger::warn(msg);
}

void ExtensionImpl::logError(const std::string& msg) {
    Logger::error(msg);
}

void ExtensionImpl::startIdleThread() {
    m_idleRunning.store(true);
    m_idleThread = std::thread([this]() {
        idleLoop();
    });
}

void ExtensionImpl::stopIdleThread() {
    m_idleRunning.store(false);
    if (m_idleThread.joinable()) {
        m_idleThread.join();
    }
}

void ExtensionImpl::idleLoop() {
    while (m_idleRunning.load() && !m_shuttingDown.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        
        // Background processing
        validateLiveSet();
        
        // Update managers
        if (m_liveSetManager) m_liveSetManager->update();
        if (m_transportController) m_transportController->update();
        if (m_clipManager) m_clipManager->update();
        if (m_deviceManager) m_deviceManager->update();
    }
}

void ExtensionImpl::validateLiveSet() {
    std::lock_guard<std::mutex> lock(m_liveSetMutex);
    
    if (m_app) {
        Ableton::Live::Set* currentSet = m_app->getLiveSet();
        if (currentSet != m_liveSet) {
            m_liveSet = currentSet;
            m_isLiveSetValid = (m_liveSet != nullptr);
            
            if (m_isLiveSetValid) {
                Logger::info("LiveSet changed, updating managers");
                m_liveSetManager->setLiveSet(m_liveSet);
                m_transportController->setLiveSet(m_liveSet);
                m_clipManager->setLiveSet(m_liveSet);
                m_deviceManager->setLiveSet(m_liveSet);
            } else {
                Logger::warn("LiveSet became invalid (project closed)");
                m_isLiveSetValid = false;
            }
        }
    }
}

void ExtensionImpl::handleIPCMessage(const IPCMessage& msg) {
    if (!m_ipcServer) return;
    
    IPCResponse response;
    response.requestId = msg.requestId;
    response.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    
    try {
        bool handled = m_ipcServer->handleMessage(msg, response);
        if (!handled) {
            response.success = false;
            response.error = "Unhandled message type";
        } else {
            response.success = true;
        }
    } catch (const std::exception& e) {
        Logger::error("IPC message handling error: " + std::string(e.what()));
        response.success = false;
        response.error = e.what();
    }
    
    sendIPCResponseInternal(response);
}

void ExtensionImpl::sendIPCResponseInternal(const IPCResponse& response) {
    if (m_ipcServer) {
        m_ipcServer->sendResponse(response);
    }
}

void ExtensionImpl::broadcastEventInternal(IPCMessageType type, const std::string& payload) {
    IPCMessage event;
    event.type = type;
    event.requestId = 0; // Events have no request ID
    event.payload = payload;
    event.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    
    if (m_ipcServer) {
        m_ipcServer->broadcast(event);
    }
}

} // namespace resolvelink