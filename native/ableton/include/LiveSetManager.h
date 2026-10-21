/**
 * LiveSetManager - Manages Ableton Live Set operations
 */

#ifndef LIVE_SET_MANAGER_H
#define LIVE_SET_MANAGER_H

#include <AbletonLive.h>
#include <string>
#include <vector>
#include <memory>
#include <mutex>

#include "AbletonExtension.h"

namespace resolvelink {

class LiveSetManager {
public:
    explicit LiveSetManager(Ableton::Live::Set* liveSet = nullptr);
    ~LiveSetManager();
    
    void setLiveSet(Ableton::Live::Set* liveSet);
    void update();
    
    // LiveSet info
    LiveSetInfo getLiveSetInfo() const;
    bool isValid() const { return m_liveSet != nullptr; }
    
    // Tracks
    std::vector<TrackInfo> getTracks() const;
    TrackInfo getTrack(TrackId id) const;
    TrackId createTrack(bool isAudioTrack, int32_t index = -1);
    bool deleteTrack(TrackId id);
    bool setTrackName(TrackId id, const std::string& name);
    bool setTrackVolume(TrackId id, double volume);  // 0.0 - 1.0
    bool setTrackPan(TrackId id, double pan);        // -1.0 to 1.0
    bool setTrackMute(TrackId id, bool muted);
    bool setTrackSolo(TrackId id, bool solo);
    bool setTrackArm(TrackId id, bool armed);
    bool setTrackColor(TrackId id, int32_t color);
    
    // Session/Arrangement view
    bool isSessionView() const;
    bool isArrangementView() const;
    
    // Session view scenes
    std::vector<SceneInfo> getScenes() const;
    SceneId createScene(int32_t index = -1);
    bool deleteScene(SceneId id);
    bool launchScene(SceneId id);
    bool stopScene(SceneId id);
    
    // Master track
    TrackInfo getMasterTrack() const;
    bool setMasterVolume(double volume);
    bool setMasterPan(double pan);
    
    // Session automation
    bool setTempo(double bpm);
    bool setTimeSignature(int32_t numerator, int32_t denominator);
    bool setLoop(double startBeat, double endBeat);
    bool setLoopEnabled(bool enabled);
    
    // Grid/Quantization
    bool setQuantization(double quantization);  // in beats
    double getQuantization() const;
    
    // Recording
    bool setRecordMode(bool enabled);
    bool setOverdubMode(bool enabled);
    bool isRecording() const;
    bool isOverdubbing() const;
    
    // Latency/Compensation
    double getLatency() const;
    bool setLatencyCompensation(double ms);
    
    // Groove/Pool
    std::vector<std::string> getGroovePool() const;
    bool applyGroove(TrackId trackId, const std::string& grooveName);
    
    // Session/Arrangement recording
    bool startSessionRecording();
    bool stopSessionRecording();
    bool startArrangementRecording();
    bool stopArrangementRecording();

private:
    Ableton::Live::Set* m_liveSet = nullptr;
    mutable std::mutex m_mutex;
    bool m_isValid = false;
    
    // Helper methods
    Ableton::Live::Track* getTrack(TrackId id) const;
    Ableton::Live::Scene* getScene(SceneId id) const;
    void updateTrackInfo(TrackInfo& info, Ableton::Live::Track* track) const;
    void updateClipInfo(ClipInfo& info, Ableton::Live::Clip* clip) const;
    void updateDeviceInfo(DeviceInfo& info, Ableton::Live::Device* device) const;
    void updateSceneInfo(SceneInfo& info, Ableton::Live::Scene* scene) const;
};

} // namespace resolvelink

#endif // LIVE_SET_MANAGER_H