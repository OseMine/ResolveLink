/**
 * ResolveLink Ableton Live Native Extension
 * 
 * Ableton Extension SDK integration for high-performance IPC, 
 * real-time clip management, transport control, and device automation.
 * 
 * Requires: Ableton Extension SDK (https://www.ableton.com/en/live/extensions/)
 * Compatible with Ableton Live 11.3+ (SDK v2+)
 */

#ifndef ABLETON_EXTENSION_H
#define ABLETON_EXTENSION_H

#include <cstdint>
#include <string>
#include <vector>
#include <map>
#include <functional>
#include <memory>
#include <atomic>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <chrono>
#include <cstddef>

// Ableton SDK includes
#include "Ableton.h"
#include "AbletonTypes.h"
#include "AbletonLive.h"

namespace resolvelink {

// Forward declarations
class LiveSet;
class LiveTrack;
class LiveClip;
class LiveDevice;
class LiveDeviceParameter;
class TransportController;
class ClipManager;
class DeviceManager;
class IPCServer;

// ─────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────

using ClipId = int32_t;
using TrackId = int32_t;
using DeviceId = int32_t;
using ParameterId = int32_t;
using SceneId = int32_t;

struct ClipInfo {
    ClipId id;
    std::string name;
    TrackId trackId;
    double startBeat;
    double durationBeats;
    double startTime;
    double duration;
    bool isAudioClip;
    bool isMidiClip;
    bool isLooping;
    double loopStart;
    double loopEnd;
    std::string filePath;  // For audio clips
    int32_t color;
    bool isPlaying;
    double currentPosition;
};

struct TrackInfo {
    TrackId id;
    std::string name;
    int32_t index;
    bool isAudioTrack;
    bool isMidiTrack;
    bool isReturnTrack;
    bool isMasterTrack;
    double volume;
    double pan;
    bool isMuted;
    bool isSoloed;
    bool isArmed;
    std::vector<ClipInfo> clips;
    std::vector<DeviceInfo> devices;
};

struct DeviceInfo {
    DeviceId id;
    std::string name;
    std::string className;
    bool isEnabled;
    TrackId trackId;
    int32_t chainIndex;
    std::vector<ParameterInfo> parameters;
};

struct ParameterInfo {
    ParameterId id;
    std::string name;
    double minValue;
    double maxValue;
    double currentValue;
    double defaultValue;
    std::string unit;
    bool isAutomated;
    bool isQuantized;
};

struct SceneInfo {
    SceneId id;
    std::string name;
    int32_t index;
    std::vector<ClipInfo> clips;
    double tempo;
    std::string timeSignature;
};

struct LiveSetInfo {
    std::string name;
    double tempo;
    std::string timeSignature;
    double currentBeat;
    bool isPlaying;
    bool isRecording;
    bool isOverdubbing;
    double currentTime;
    double loopStart;
    double loopEnd;
    bool isLooping;
    std::vector<TrackInfo> tracks;
    std::vector<SceneInfo> scenes;
    double sampleRate;
    int32_t blockSize;
};

// ─────────────────────────────────────────────────────────────────
// IPC Protocol
// ─────────────────────────────────────────────────────────────────

enum class IPCMessageType : uint32_t {
    // Connection
    CONNECT = 1,
    DISCONNECT = 2,
    HEARTBEAT = 3,
    
    // Live Set
    GET_LIVE_SET_INFO = 10,
    SET_TEMPO = 11,
    SET_TIME_SIGNATURE = 12,
    SET_LOOP = 13,
    
    // Transport
    PLAY = 20,
    STOP = 21,
    RECORD = 22,
    OVERDUB = 23,
    SEEK = 23,
    SET_LOOP_POINTS = 24,
    
    // Tracks
    GET_TRACKS = 30,
    CREATE_TRACK = 31,
    DELETE_TRACK = 32,
    SET_TRACK_NAME = 33,
    SET_TRACK_VOLUME = 34,
    SET_TRACK_PAN = 35,
    SET_TRACK_MUTE = 36,
    SET_TRACK_SOLO = 37,
    SET_TRACK_ARM = 38,
    
    // Clips
    GET_CLIPS = 40,
    CREATE_CLIP = 41,
    DELETE_CLIP = 42,
    LAUNCH_CLIP = 43,
    STOP_CLIP = 44,
    SET_CLIP_NAME = 45,
    SET_CLIP_POSITION = 46,
    SET_CLIP_LENGTH = 47,
    SET_CLIP_LOOP = 47,
    SET_CLIP_COLOR = 48,
    IMPORT_AUDIO_CLIP = 48,
    IMPORT_MIDI_CLIP = 49,
    
    // Scenes
    GET_SCENES = 50,
    CREATE_SCENE = 51,
    DELETE_SCENE = 52,
    LAUNCH_SCENE = 53,
    SET_SCENE_NAME = 54,
    
    // Devices
    GET_DEVICES = 60,
    ADD_DEVICE = 61,
    REMOVE_DEVICE = 62,
    SET_DEVICE_PARAMETER = 63,
    GET_DEVICE_PARAMETERS = 64,
    
    // Transport State
    TRANSPORT_STATE_CHANGED = 100,
    CLIP_LAUNCHED = 101,
    CLIP_STOPPED = 102,
    CLIP_POSITION_CHANGED = 103,
    TEMPO_CHANGED = 104,
    TRACK_ADDED = 105,
    TRACK_REMOVED = 106,
    CLIP_ADDED = 107,
    CLIP_REMOVED = 108,
    
    // Render/Export
    EXPORT_AUDIO = 200,
    EXPORT_STEMS = 201,
    GET_RENDER_PROGRESS = 202,
    CANCEL_RENDER = 203,
    
    // Error/Response
    RESPONSE = 999,
    ERROR = 998
};

struct IPCMessage {
    IPCMessageType type;
    uint32_t requestId;
    std::string payload;  // JSON
    uint64_t timestamp;
};

struct IPCResponse {
    uint32_t requestId;
    bool success;
    std::string payload;  // JSON
    std::string error;
};

// ─────────────────────────────────────────────────────────────────
// Extension Interface
// ─────────────────────────────────────────────────────────────────

class IExtensionHost {
public:
    virtual ~IExtensionHost() = default;
    
    // Called when extension is loaded
    virtual bool onLoad(Ableton::Live::Application* app) = 0;
    
    // Called when extension is unloaded
    virtual void onUnload() = 0;
    
    // Called periodically (main thread)
    virtual void onIdle() = 0;
    
    // Handle incoming IPC message
    virtual void onIPCMessage(const IPCMessage& msg) = 0;
    
    // Send IPC response
    virtual void sendIPCResponse(const IPCResponse& response) = 0;
    
    // Broadcast event to connected clients
    virtual void broadcastEvent(IPCMessageType type, const std::string& payload) = 0;
    
    // Get Live API
    virtual Ableton::Live::Application* getLiveApp() = 0;
    virtual Ableton::Live::Set* getLiveSet() = 0;
    
    // Logging
    virtual void logInfo(const std::string& msg) = 0;
    virtual void logWarn(const std::string& msg) = 0;
    virtual void logError(const std::string& msg) = 0;
};

// ─────────────────────────────────────────────────────────────────
// Extension Entry Point
// ─────────────────────────────────────────────────────────────────

// Called by Ableton when extension is loaded
extern "C" ABLETON_EXTENSION_EXPORT bool AbletonExtensionEntry(
    Ableton::Extension::IHost* host,
    Ableton::Extension::IExtension** outExtension
);

// Called by Ableton when extension is unloaded
extern "C" ABLETON_EXTENSION_EXPORT void AbletonExtensionExit(
    Ableton::Extension::IExtension* extension
);

// ─────────────────────────────────────────────────────────────────
// Version Info
// ─────────────────────────────────────────────────────────────────

extern "C" ABLETON_EXTENSION_EXPORT const char* AbletonExtensionGetVersion();
extern "C" ABLETON_EXTENSION_EXPORT const char* AbletonExtensionGetName();
extern "C" ABLETON_EXTENSION_EXPORT const char* AbletonExtensionGetDescription();

} // namespace resolvelink

#endif // ABLETON_EXTENSION_H