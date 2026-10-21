/**
 * IPC Server Implementation - Cross-platform named pipe / TCP communication
 */

#include "IPCServer.h"
#include "ExtensionImpl.h"
#include "ExtensionImpl.h"
#include "Logger.h"
#include "LiveSetManager.h"
#include "TransportController.h"
#include "ClipManager.h"
#include "DeviceManager.h"
#include "ExtensionImpl.h"

#include <sstream>
#include <cstring>
#include <chrono>

namespace resolvelink {

IPCServer::IPCServer(ExtensionImpl* extension)
    : m_extension(extension) {
}

IPCServer::~IPCServer() {
    stop();
}

bool IPCServer::start(const std::string& pipeName) {
    if (m_running.load()) return true;
    
    m_pipeName = pipeName.empty() ? 
        ([]() {
            #ifdef _WIN32
            return std::string("\\\\.\\pipe\\ResolveLink");
            #else
            return std::string("/tmp/ResolveLink");
            #endif
        }()) : pipeName;
    
    #ifdef _WIN32
    return createNamedPipe(m_pipeName);
    #else
    // Try Unix domain socket first, fall back to TCP
    if (createUnixSocket(m_pipeName)) return true;
    return createTCPSocket(9001); // Fallback port
    #endif
}

void IPCServer::stop() {
    if (!m_running.load()) return;
    
    m_running.store(false);
    
    #ifdef _WIN32
    if (m_pipeHandle != INVALID_HANDLE_VALUE) {
        CancelIoEx(m_pipeHandle, nullptr);
        FlushFileBuffers(m_pipeHandle);
        DisconnectNamedPipe(m_pipeHandle);
        CloseHandle(m_pipeHandle);
        m_pipeHandle = INVALID_HANDLE_VALUE;
    }
    if (m_listenThread) {
        WaitForSingleObject(m_listenThread, 1000);
        CloseHandle(m_listenThread);
        m_listenThread = nullptr;
    }
    #else
    if (m_clientFd >= 0) {
        close(m_clientFd);
        m_clientFd = -1;
    }
    if (m_serverFd >= 0) {
        close(m_serverFd);
        m_serverFd = -1;
    }
    if (m_acceptThread.joinable()) {
        m_acceptThread.join();
    }
    #endif
    
    if (m_ioThread.joinable()) {
        m_ioThread.join();
    }
    
    {
        std::lock_guard<std::mutex> lock(m_clientsMutex);
        for (auto& client : m_clients) {
            client->connected = false;
        }
    }
    
    Logger::info("IPC Server stopped");
}

void IPCServer::sendResponse(const IPCResponse& response) {
    std::string json = serializeResponse(response);
    broadcastInternal(response);
}

void IPCServer::broadcast(const IPCMessage& event) {
    std::string json = serializeMessage(event);
    broadcastInternal(event);
}

void IPCServer::processMessages() {
    // Process queued messages from clients
    std::queue<QueuedMessage> processQueue;
    {
        std::lock_guard<std::mutex> lock(m_queueMutex);
        if (m_messageQueue.empty()) return;
        processQueue = std::move(m_messageQueue);
    }
    
    while (!processQueue.empty()) {
        auto& queued = processQueue.front();
        IPCResponse response;
        bool handled = handleMessage(queued.msg, processQueue.front().msg);
        if (handled) {
            // Response already sent by handler
        }
        processQueue.pop();
    }
}

bool IPCServer::handleMessage(const IPCMessage& msg, IPCResponse& response) {
    response.requestId = msg.requestId;
    response.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    
    switch (msg.type) {
        case IPCMessageType::CONNECT:
            return handleConnect(msg, response);
        case IPCMessageType::DISCONNECT:
            return handleDisconnect(msg, response);
        case IPCMessageType::GET_LIVE_SET_INFO:
            return handleGetLiveSetInfo(msg, response);
        case IPCMessageType::SET_TEMPO:
            return handleSetTempo(msg, response);
        case IPCMessageType::PLAY:
        case IPCMessageType::STOP:
        case IPCMessageType::RECORD:
        case IPCMessageType::OVERDUB:
        case IPCMessageType::SEEK:
        case IPCMessageType::SET_LOOP_POINTS:
            return handleTransportControl(msg, response);
        case IPCMessageType::GET_TRACKS:
        case IPCMessageType::CREATE_TRACK:
        case IPCMessageType::DELETE_TRACK:
        case IPCMessageType::SET_TRACK_NAME:
        case IPCMessageType::SET_TRACK_VOLUME:
        case IPCMessageType::SET_TRACK_PAN:
        case IPCMessageType::SET_TRACK_MUTE:
        case IPCMessageType::SET_TRACK_SOLO:
        case IPCMessageType::SET_TRACK_ARM:
            return handleTrackOperation(msg, response);
        case IPCMessageType::GET_CLIPS:
        case IPCMessageType::CREATE_CLIP:
        case IPCMessageType::DELETE_CLIP:
        case IPCMessageType::LAUNCH_CLIP:
        case IPCMessageType::STOP_CLIP:
        case IPCMessageType::SET_CLIP_NAME:
        case IPCMessageType::SET_CLIP_POSITION:
        case IPCMessageType::SET_CLIP_LENGTH:
        case IPCMessageType::SET_CLIP_LOOP:
        case IPCMessageType::SET_CLIP_COLOR:
        case IPCMessageType::IMPORT_AUDIO_CLIP:
        case IPCMessageType::IMPORT_MIDI_CLIP:
            return handleClipOperation(msg, response);
        case IPCMessageType::GET_DEVICES:
        case IPCMessageType::ADD_DEVICE:
        case IPCMessageType::REMOVE_DEVICE:
        case IPCMessageType::SET_DEVICE_PARAMETER:
        case IPCMessageType::GET_DEVICE_PARAMETERS:
            return handleDeviceOperation(msg, response);
        case IPCMessageType::EXPORT_AUDIO:
        case IPCMessageType::EXPORT_STEMS:
        case IPCMessageType::GET_RENDER_PROGRESS:
        case IPCMessageType::CANCEL_RENDER:
            return handleRenderOperation(msg, response);
        default:
            response.success = false;
            response.error = "Unknown message type";
            return false;
    }
}

void IPCServer::sendResponse(const IPCResponse& response) {
    std::string json = serializeResponse(response);
    broadcastInternal(response);
}

void IPCServer::broadcast(const IPCMessage& event) {
    std::string json = serializeMessage(event);
    broadcastInternal(event);
}

bool IPCServer::handleMessage(const IPCMessage& msg, IPCResponse& response) {
    response.requestId = msg.requestId;
    response.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    
    try {
        bool handled = false;
        switch (msg.type) {
            case IPCMessageType::CONNECT:
                handled = handleConnect(msg, response); break;
            case IPCMessageType::DISCONNECT:
                handled = handleDisconnect(msg, response); break;
            case IPCMessageType::GET_LIVE_SET_INFO:
                handled = handleGetLiveSetInfo(msg, response); break;
            case IPCMessageType::SET_TEMPO:
                handled = handleSetTempo(msg, response); break;
            case IPCMessageType::PLAY:
            case IPCMessageType::STOP:
            case IPCMessageType::RECORD:
            case IPCMessageType::OVERDUB:
            case IPCMessageType::SEEK:
            case IPCMessageType::SET_LOOP_POINTS:
                handled = handleTransportControl(msg, response); break;
            case IPCMessageType::GET_TRACKS:
            case IPCMessageType::CREATE_TRACK:
            case IPCMessageType::DELETE_TRACK:
            case IPCMessageType::SET_TRACK_NAME:
            case IPCMessageType::SET_TRACK_VOLUME:
            case IPCMessageType::SET_TRACK_PAN:
            case IPCMessageType::SET_TRACK_MUTE:
            case IPCMessageType::SET_TRACK_SOLO:
            case IPCMessageType::SET_TRACK_ARM:
                handled = handleTrackOperation(msg, response); break;
            case IPCMessageType::GET_CLIPS:
            case IPCMessageType::CREATE_CLIP:
            case IPCMessageType::DELETE_CLIP:
            case IPCMessageType::LAUNCH_CLIP:
            case IPCMessageType::STOP_CLIP:
            case IPCMessageType::SET_CLIP_NAME:
            case IPCMessageType::SET_CLIP_POSITION:
            case IPCMessageType::SET_CLIP_LENGTH:
            case IPCMessageType::SET_CLIP_LOOP:
            case IPCMessageType::SET_CLIP_COLOR:
            case IPCMessageType::IMPORT_AUDIO_CLIP:
            case IPCMessageType::IMPORT_MIDI_CLIP:
                handled = handleClipOperation(msg, response); break;
            case IPCMessageType::GET_DEVICES:
            case IPCMessageType::ADD_DEVICE:
            case IPCMessageType::REMOVE_DEVICE:
            case IPCMessageType::SET_DEVICE_PARAMETER:
            case IPCMessageType::GET_DEVICE_PARAMETERS:
                handled = handleDeviceOperation(msg, response); break;
            case IPCMessageType::EXPORT_AUDIO:
            case IPCMessageType::EXPORT_STEMS:
            case IPCMessageType::GET_RENDER_PROGRESS:
            case IPCMessageType::CANCEL_RENDER:
                handled = handleRenderOperation(msg, response); break;
            default:
                response.success = false;
                response.error = "Unknown message type";
                return false;
        }
        
        if (!handled) {
            response.success = false;
            response.error = "Unhandled message type";
        }
        
        return handled;
    } catch (const std::exception& e) {
        Logger::error("Message handling error: " + std::string(e.what()));
        response.success = false;
        response.error = e.what();
        return false;
    }
}

bool IPCServer::handleConnect(const IPCMessage& msg, IPCResponse& response) {
    // Send config info
    std::stringstream ss;
    ss << "{\"serverUrl\":\"http://127.0.0.1:3030\",\"pipeName\":\"";
    #ifdef _WIN32
    ss << "\\\\.\\pipe\\ResolveLink";
    #else
    ss << "/tmp/ResolveLink";
    #endif
    ss << "\",\"protocolVersion\":1}";
    response.payload = ss.str();
    response.success = true;
    return true;
}

bool IPCServer::handleDisconnect(const IPCMessage& msg, IPCResponse& response) {
    response.success = true;
    return true;
}

bool IPCServer::handleGetLiveSetInfo(const IPCMessage& msg, IPCResponse& response) {
    if (!m_extension || !m_extension->getLiveSet()) {
        response.success = false;
        response.error = "No LiveSet available";
        return false;
    }
    
    auto liveSet = m_extension->getLiveSetManager();
    if (!liveSet) {
        response.success = false;
        response.error = "LiveSetManager not available";
        return false;
    }
    
    auto info = liveSet->getLiveSetInfo();
    response.payload = serializeLiveSetInfo(info);
    response.success = true;
    return true;
}

bool IPCServer::handleSetTempo(const IPCMessage& msg, IPCResponse& response) {
    // Parse tempo from payload
    // Implementation depends on JSON parsing
    response.success = true;
    return true;
}

bool IPCServer::handleTransportControl(const IPCMessage& msg, IPCResponse& response) {
    if (!m_extension || !m_extension->getTransportController()) {
        response.success = false;
        response.error = "TransportController not available";
        return false;
    }
    
    auto transport = m_extension->getTransportController();
    bool success = false;
    
    switch (msg.type) {
        case IPCMessageType::PLAY:
            success = transport->play();
            break;
        case IPCMessageType::STOP:
            success = transport->stop();
            break;
        case IPCMessageType::RECORD:
            success = transport->record();
            break;
        case IPCMessageType::OVERDUB:
            success = transport->overdub();
            break;
        case IPCMessageType::SEEK:
            // Parse position from payload
            break;
        case IPCMessageType::SET_LOOP_POINTS:
            // Parse loop points from payload
            break;
    }
    
    response.success = success;
    if (!success) response.error = "Transport control failed";
    return true;
}

bool IPCServer::handleTrackOperation(const IPCMessage& msg, IPCResponse& response) {
    if (!m_extension || !m_extension->getLiveSetManager()) {
        response.success = false;
        response.error = "LiveSetManager not available";
        return false;
    }
    
    auto liveSet = m_extension->getLiveSetManager();
    bool success = false;
    
    switch (msg.type) {
        case IPCMessageType::GET_TRACKS: {
            auto tracks = liveSet->getTracks();
            response.payload = serializeTracks(tracks);
            success = true;
            break;
        }
        case IPCMessageType::CREATE_TRACK:
            // Parse track type from payload
            break;
        case IPCMessageType::SET_TRACK_VOLUME:
        case IPCMessageType::SET_TRACK_PAN:
        case IPCMessageType::SET_TRACK_MUTE:
        case IPCMessageType::SET_TRACK_SOLO:
        case IPCMessageType::SET_TRACK_ARM:
        case IPCMessageType::SET_TRACK_NAME:
            // Parse track ID and value from payload
            break;
    }
    
    response.success = success;
    return true;
}

bool IPCServer::handleClipOperation(const IPCMessage& msg, IPCResponse& response) {
    if (!m_extension || !m_extension->getClipManager()) {
        response.success = false;
        response.error = "ClipManager not available";
        return false;
    }
    
    auto clipManager = m_extension->getClipManager();
    bool success = false;
    
    switch (msg.type) {
        case IPCMessageType::GET_CLIPS: {
            auto clips = clipManager->getClips();
            response.payload = serializeClips(clips);
            success = true;
            break;
        }
        case IPCMessageType::CREATE_CLIP:
            // Parse clip data from payload
            break;
        case IPCMessageType::DELETE_CLIP:
            // Parse clip ID from payload
            break;
        case IPCMessageType::LAUNCH_CLIP:
            // Parse clip ID from payload
            break;
        case IPCMessageType::STOP_CLIP:
            break;
        case IPCMessageType::SET_CLIP_POSITION:
        case IPCMessageType::SET_CLIP_LENGTH:
        case IPCMessageType::SET_CLIP_LOOP:
        case IPCMessageType::SET_CLIP_COLOR:
            break;
        case IPCMessageType::IMPORT_AUDIO_CLIP:
        case IPCMessageType::IMPORT_MIDI_CLIP:
            // Parse import data from payload
            break;
    }
    
    response.success = success;
    return true;
}

bool IPCServer::handleDeviceOperation(const IPCMessage& msg, IPCResponse& response) {
    if (!m_extension || !m_extension->getDeviceManager()) {
        response.success = false;
        response.error = "DeviceManager not available";
        return false;
    }
    
    auto deviceManager = m_extension->getDeviceManager();
    bool success = false;
    
    switch (msg.type) {
        case IPCMessageType::GET_DEVICES: {
            auto devices = deviceManager->getDevices();
            response.payload = serializeDevices(devices);
            success = true;
            break;
        }
        case IPCMessageType::ADD_DEVICE:
            // Parse device info from payload
            break;
        case IPCMessageType::REMOVE_DEVICE:
            break;
        case IPCMessageType::SET_DEVICE_PARAMETER:
            // Parse device ID, parameter ID, value
            break;
        case IPCMessageType::GET_DEVICE_PARAMETERS:
            // Parse device ID
            break;
    }
    
    response.success = success;
    return true;
}

bool IPCServer::handleRenderOperation(const IPCMessage& msg, IPCResponse& response) {
    // Implementation for render operations
    response.success = true;
    return true;
}

std::string IPCServer::serializeResponse(const IPCResponse& response) {
    std::stringstream ss;
    ss << "{";
    ss << "\"requestId\":" << response.requestId << ",";
    ss << "\"success\":" << (response.success ? "true" : "false") << ",";
    if (!response.payload.empty()) {
        ss << "\"payload\":" << response.payload << ",";
    }
    if (!response.error.empty()) {
        ss << "\"error\":\"" << escapeJson(response.error) << "\",";
    }
    ss << "\"timestamp\":" << response.timestamp;
    ss << "}";
    return ss.str();
}

std::string IPCServer::serializeMessage(const IPCMessage& msg) {
    std::stringstream ss;
    ss << "{";
    ss << "\"type\":" << static_cast<int>(msg.type) << ",";
    ss << "\"requestId\":" << msg.requestId << ",";
    if (!msg.payload.empty()) {
        ss << "\"payload\":" << msg.payload << ",";
    }
    ss << "\"timestamp\":" << msg.timestamp;
    ss << "}";
    return ss.str();
}

std::string IPCServer::serializeLiveSetInfo(const LiveSetInfo& info) {
    std::stringstream ss;
    ss << "{";
    ss << "\"name\":\"" << escapeJson(info.name) << "\",";
    ss << "\"tempo\":" << info.tempo << ",";
    ss << "\"timeSignature\":\"" << escapeJson(info.timeSignature) << "\",";
    ss << "\"currentBeat\":" << info.currentBeat << ",";
    ss << "\"isPlaying\":" << (info.isPlaying ? "true" : "false") << ",";
    ss << "\"isRecording\":" << (info.isRecording ? "true" : "false") << ",";
    ss << "\"isOverdubbing\":" << (info.isOverdubbing ? "true" : "false") << ",";
    ss << "\"currentTime\":" << info.currentTime << ",";
    ss << "\"loopStart\":" << info.loopStart << ",";
    ss << "\"loopEnd\":" << info.loopEnd << ",";
    ss << "\"isLooping\":" << (info.isLooping ? "true" : "false") << ",";
    ss << "\"sampleRate\":" << info.sampleRate << ",";
    ss << "\"blockSize\":" << info.blockSize << ",";
    ss << "\"tracks\":" << serializeTracks(info.tracks) << ",";
    ss << "\"scenes\":" << serializeScenes(info.scenes);
    ss << "}";
    return ss.str();
}

std::string IPCServer::serializeTracks(const std::vector<TrackInfo>& tracks) {
    std::stringstream ss;
    ss << "[";
    for (size_t i = 0; i < tracks.size(); ++i) {
        if (i > 0) ss << ",";
        ss << "{";
        ss << "\"id\":" << tracks[i].id << ",";
        ss << "\"name\":\"" << escapeJson(tracks[i].name) << "\",";
        ss << "\"index\":" << tracks[i].index << ",";
        ss << "\"isAudioTrack\":" << (tracks[i].isAudioTrack ? "true" : "false") << ",";
        ss << "\"isMidiTrack\":" << (tracks[i].isMidiTrack ? "true" : "false") << ",";
        ss << "\"isReturnTrack\":" << (tracks[i].isReturnTrack ? "true" : "false") << ",";
        ss << "\"isMasterTrack\":" << (tracks[i].isMasterTrack ? "true" : "false") << ",";
        ss << "\"volume\":" << tracks[i].volume << ",";
        ss << "\"pan\":" << tracks[i].pan << ",";
        ss << "\"isMuted\":" << (tracks[i].isMuted ? "true" : "false") << ",";
        ss << "\"isSoloed\":" << (tracks[i].isSoloed ? "true" : "false") << ",";
        ss << "\"isArmed\":" << (tracks[i].isArmed ? "true" : "false") << ",";
        ss << "\"clips\":" << serializeClips(tracks[i].clips) << ",";
        ss << "\"devices\":" << serializeDevices(tracks[i].devices);
        ss << "}";
    }
    ss << "]";
    return ss.str();
}

std::string IPCServer::serializeClips(const std::vector<ClipInfo>& clips) {
    std::stringstream ss;
    ss << "[";
    for (size_t i = 0; i < clips.size(); ++i) {
        if (i > 0) ss << ",";
        ss << "{";
        ss << "\"id\":" << clips[i].id << ",";
        ss << "\"name\":\"" << escapeJson(clips[i].name) << "\",";
        ss << "\"trackId\":" << clips[i].trackId << ",";
        ss << "\"startBeat\":" << clips[i].startBeat << ",";
        ss << "\"durationBeats\":" << clips[i].durationBeats << ",";
        ss << "\"startTime\":" << clips[i].startTime << ",";
        ss << "\"duration\":" << clips[i].duration << ",";
        ss << "\"isAudioClip\":" << (clips[i].isAudioClip ? "true" : "false") << ",";
        ss << "\"isMidiClip\":" << (clips[i].isMidiClip ? "true" : "false") << ",";
        ss << "\"isLooping\":" << (clips[i].isLooping ? "true" : "false") << ",";
        ss << "\"loopStart\":" << clips[i].loopStart << ",";
        ss << "\"loopEnd\":" << clips[i].loopEnd << ",";
        ss << "\"filePath\":\"" << escapeJson(clips[i].filePath) << "\",";
        ss << "\"color\":" << clips[i].color << ",";
        ss << "\"isPlaying\":" << (clips[i].isPlaying ? "true" : "false") << ",";
        ss << "\"currentPosition\":" << clips[i].currentPosition;
        ss << "}";
    }
    ss << "]";
    return ss.str();
}

std::string IPCServer::serializeDevices(const std::vector<DeviceInfo>& devices) {
    std::stringstream ss;
    ss << "[";
    for (size_t i = 0; i < devices.size(); ++i) {
        if (i > 0) ss << ",";
        ss << "{";
        ss << "\"id\":" << devices[i].id << ",";
        ss << "\"name\":\"" << escapeJson(devices[i].name) << "\",";
        ss << "\"className\":\"" << escapeJson(devices[i].className) << "\",";
        ss << "\"isEnabled\":" << (devices[i].isEnabled ? "true" : "false") << ",";
        ss << "\"trackId\":" << devices[i].trackId << ",";
        ss << "\"chainIndex\":" << devices[i].chainIndex << ",";
        ss << "\"parameters\":" << serializeParameters(devices[i].parameters);
        ss << "}";
    }
    ss << "]";
    return ss.str();
}

std::string IPCServer::serializeParameters(const std::vector<ParameterInfo>& params) {
    std::stringstream ss;
    ss << "[";
    for (size_t i = 0; i < params.size(); ++i) {
        if (i > 0) ss << ",";
        ss << "{";
        ss << "\"id\":" << params[i].id << ",";
        ss << "\"name\":\"" << escapeJson(params[i].name) << "\",";
        ss << "\"minValue\":" << params[i].minValue << ",";
        ss << "\"maxValue\":" << params[i].maxValue << ",";
        ss << "\"currentValue\":" << params[i].currentValue << ",";
        ss << "\"defaultValue\":" << params[i].defaultValue << ",";
        ss << "\"unit\":\"" << escapeJson(params[i].unit) << "\",";
        ss << "\"isAutomated\":" << (params[i].isAutomated ? "true" : "false") << ",";
        ss << "\"isQuantized\":" << (params[i].isQuantized ? "true" : "false");
        ss << "}";
    }
    ss << "]";
    return ss.str();
}

std::string IPCServer::serializeScenes(const std::vector<SceneInfo>& scenes) {
    std::stringstream ss;
    ss << "[";
    for (size_t i = 0; i < scenes.size(); ++i) {
        if (i > 0) ss << ",";
        ss << "{";
        ss << "\"id\":" << scenes[i].id << ",";
        ss << "\"name\":\"" << escapeJson(scenes[i].name) << "\",";
        ss << "\"index\":" << scenes[i].index << ",";
        ss << "\"clips\":" << serializeClips(scenes[i].clips) << ",";
        ss << "\"tempo\":" << scenes[i].tempo << ",";
        ss << "\"timeSignature\":\"" << escapeJson(scenes[i].timeSignature) << "\"";
        ss << "}";
    }
    ss << "]";
    return ss.str();
}

std::string IPCServer::escapeJson(const std::string& str) {
    std::string result;
    result.reserve(str.size() * 2);
    for (char c : str) {
        switch (c) {
            case '"': result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\b': result += "\\b"; break;
            case '\f': result += "\\f"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[7];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
                    result += buf;
                } else {
                    result += c;
                }
        }
    }
    return result;
}

} // namespace resolvelink