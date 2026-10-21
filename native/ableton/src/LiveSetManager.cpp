/**
 * LiveSetManager Implementation
 */

#include "LiveSetManager.h"
#include "Logger.h"
#include <AbletonLive.h>
#include <sstream>

namespace resolvelink {

LiveSetManager::LiveSetManager(Ableton::Live::Set* liveSet) : m_liveSet(liveSet) {
    m_isValid = (m_liveSet != nullptr);
}

LiveSetManager::~LiveSetManager() {
}

void LiveSetManager::setLiveSet(Ableton::Live::Set* liveSet) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_liveSet = liveSet;
    m_isValid = (m_liveSet != nullptr);
}

void LiveSetManager::update() {
    if (!m_isValid || !m_liveSet) return;
    
    // Could add periodic validation or update logic here
}

LiveSetInfo LiveSetManager::getLiveSetInfo() const {
    LiveSetInfo info;
    if (!m_isValid || !m_liveSet) return info;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    
    info.name = m_liveSet->GetName().c_str();
    info.tempo = m_liveSet->GetTempo();
    
    // Time signature
    int32_t num = 4, denom = 4;
    m_liveSet->GetTimeSignature(num, denom);
    info.timeSignature = std::to_string(num) + "/" + std::to_string(denom);
    
    // Transport state
    Ableton::Live::Transport* transport = m_liveSet->GetTransport();
    if (transport) {
        info.isPlaying = transport->IsPlaying();
        info.isRecording = transport->IsRecording();
        info.isOverdubbing = transport->IsOverdub();
        info.currentBeat = transport->GetCurrentBeat();
        info.currentTime = transport->GetCurrentTime();
        info.loopStart = transport->GetLoopStart();
        info.loopEnd = transport->GetLoopEnd();
        info.isLooping = transport->IsLooping();
    }
    
    // Sample rate and block size
    info.sampleRate = m_liveSet->GetSampleRate();
    info.blockSize = m_liveSet->GetBlockSize();
    
    // Tracks
    info.tracks = getTracks();
    
    // Scenes
    info.scenes = getScenes();
    
    return info;
}

bool LiveSetManager::isValid() const {
    return m_isValid && m_liveSet != nullptr;
}

std::vector<TrackInfo> LiveSetManager::getTracks() const {
    std::vector<TrackInfo> tracks;
    if (!m_isValid || !m_liveSet) return tracks;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    
    int32_t trackCount = m_liveSet->GetTrackCount();
    for (int32_t i = 0; i < trackCount; ++i) {
        Ableton::Live::Track* track = m_liveSet->GetTrack(i);
        if (track) {
            TrackInfo info;
            updateTrackInfo(info, track);
            tracks.push_back(info);
        }
    }
    
    return tracks;
}

TrackInfo LiveSetManager::getTrack(TrackId id) const {
    TrackInfo info;
    if (!m_isValid || !m_liveSet) return info;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Track* track = getTrack(id);
    if (track) {
        updateTrackInfo(info, track);
    }
    return info;
}

Ableton::Live::Track* LiveSetManager::getTrack(TrackId id) const {
    if (!m_liveSet) return nullptr;
    
    int32_t trackCount = m_liveSet->GetTrackCount();
    if (id >= 0 && id < trackCount) {
        return m_liveSet->GetTrack(id);
    }
    return nullptr;
}

TrackId LiveSetManager::createTrack(bool isAudioTrack, int32_t index) {
    if (!m_liveSet) return -1;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    
    Ableton::Live::Track* track = nullptr;
    if (isAudioTrack) {
        track = m_liveSet->CreateAudioTrack(index);
    } else {
        track = m_liveSet->CreateMidiTrack(index);
    }
    
    if (track) {
        return track->GetIndex();
    }
    return -1;
}

bool LiveSetManager::deleteTrack(TrackId id) {
    if (!m_liveSet) return false;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Track* track = getTrack(id);
    if (track) {
        return m_liveSet->DeleteTrack(id);
    }
    return false;
}

bool LiveSetManager::setTrackName(TrackId id, const std::string& name) {
    Ableton::Live::Track* track = getTrack(id);
    if (track) {
        track->SetName(name.c_str());
        return true;
    }
    return false;
}

bool LiveSetManager::setTrackVolume(TrackId id, double volume) {
    Ableton::Live::Track* track = getTrack(id);
    if (track) {
        track->SetVolume(static_cast<float>(volume));
        return true;
    }
    return false;
}

bool LiveSetManager::setTrackPan(TrackId id, double pan) {
    Ableton::Live::Track* track = getTrack(id);
    if (track) {
        track->SetPan(static_cast<float>(pan));
        return true;
    }
    return false;
}

bool LiveSetManager::setTrackMute(TrackId id, bool muted) {
    Ableton::Live::Track* track = getTrack(id);
    if (track) {
        track->SetMute(muted);
        return true;
    }
    return false;
}

bool LiveSetManager::setTrackSolo(TrackId id, bool solo) {
    Ableton::Live::Track* track = getTrack(id);
    if (track) {
        track->SetSolo(solo);
        return true;
    }
    return false;
}

bool LiveSetManager::setTrackArm(TrackId id, bool armed) {
    Ableton::Live::Track* track = getTrack(id);
    if (track) {
        track->SetArm(armed);
        return true;
    }
    return false;
}

bool LiveSetManager::isSessionView() const {
    if (!m_liveSet) return false;
    return m_liveSet->IsSessionView();
}

bool LiveSetManager::isArrangementView() const {
    if (!m_liveSet) return false;
    return m_liveSet->IsArrangementView();
}

std::vector<SceneInfo> LiveSetManager::getScenes() const {
    std::vector<SceneInfo> scenes;
    if (!m_liveSet) return scenes;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    int32_t sceneCount = m_liveSet->GetSceneCount();
    
    for (int32_t i = 0; i < sceneCount; ++i) {
        Ableton::Live::Scene* scene = m_liveSet->GetScene(i);
        if (scene) {
            SceneInfo info;
            updateSceneInfo(info, scene);
            scenes.push_back(info);
        }
    }
    
    return scenes;
}

SceneId LiveSetManager::createScene(int32_t index) {
    if (!m_liveSet) return -1;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Scene* scene = m_liveSet->CreateScene(index);
    if (scene) {
        return scene->GetIndex();
    }
    return -1;
}

bool LiveSetManager::deleteScene(SceneId id) {
    if (!m_liveSet) return false;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Scene* scene = getScene(id);
    if (scene) {
        return m_liveSet->DeleteScene(id);
    }
    return false;
}

bool LiveSetManager::launchScene(SceneId id) {
    Ableton::Live::Scene* scene = getScene(id);
    if (scene) {
        scene->Launch();
        return true;
    }
    return false;
}

bool LiveSetManager::stopScene(SceneId id) {
    Ableton::Live::Scene* scene = getScene(id);
    if (scene) {
        scene->Stop();
        return true;
    }
    return false;
}

TrackInfo LiveSetManager::getMasterTrack() const {
    TrackInfo info;
    if (!m_liveSet) return info;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Track* master = m_liveSet->GetMasterTrack();
    if (master) {
        updateTrackInfo(info, master);
    }
    return info;
}

bool LiveSetManager::setMasterVolume(double volume) {
    if (!m_liveSet) return false;
    Ableton::Live::Track* master = m_liveSet->GetMasterTrack();
    if (master) {
        master->SetVolume(static_cast<float>(volume));
        return true;
    }
    return false;
}

bool LiveSetManager::setMasterPan(double pan) {
    if (!m_liveSet) return false;
    Ableton::Live::Track* master = m_liveSet->GetMasterTrack();
    if (master) {
        master->SetPan(static_cast<float>(pan));
        return true;
    }
    return false;
}

bool LiveSetManager::setTempo(double bpm) {
    if (!m_liveSet) return false;
    
    Ableton::Live::Transport* transport = m_liveSet->GetTransport();
    if (transport) {
        transport->SetTempo(static_cast<float>(bpm));
        return true;
    }
    return false;
}

bool LiveSetManager::setTimeSignature(int32_t numerator, int32_t denominator) {
    if (!m_liveSet) return false;
    
    Ableton::Live::Transport* transport = m_liveSet->GetTransport();
    if (transport) {
        transport->SetTimeSignature(numerator, denominator);
        return true;
    }
    return false;
}

bool LiveSetManager::setLoop(double startBeat, double endBeat) {
    if (!m_liveSet) return false;
    
    Ableton::Live::Transport* transport = m_liveSet->GetTransport();
    if (transport) {
        transport->SetLoopStart(static_cast<float>(startBeat));
        transport->SetLoopEnd(static_cast<float>(endBeat));
        return true;
    }
    return false;
}

bool LiveSetManager::setLoopEnabled(bool enabled) {
    if (!m_liveSet) return false;
    
    Ableton::Live::Transport* transport = m_liveSet->GetTransport();
    if (transport) {
        transport->SetLooping(enabled);
        return true;
    }
    return false;
}

bool LiveSetManager::setQuantization(double quantization) {
    // Quantization is typically set on the transport or globally
    // This would require accessing Ableton's quantization settings
    return false;
}

double LiveSetManager::getQuantization() const {
    return 0.25; // Default 1/16
}

bool LiveSetManager::setRecordMode(bool enabled) {
    Ableton::Live::Transport* transport = m_liveSet ? m_liveSet->GetTransport() : nullptr;
    if (transport) {
        transport->SetRecord(enabled);
        return true;
    }
    return false;
}

bool LiveSetManager::setOverdubMode(bool enabled) {
    Ableton::Live::Transport* transport = m_liveSet ? m_liveSet->GetTransport() : nullptr;
    if (transport) {
        transport->SetOverdub(enabled);
        return true;
    }
    return false;
}

bool LiveSetManager::isRecording() const {
    Ableton::Live::Transport* transport = m_liveSet ? m_liveSet->GetTransport() : nullptr;
    if (transport) return transport->IsRecording();
    return false;
}

bool LiveSetManager::isOverdubbing() const {
    Ableton::Live::Transport* transport = m_liveSet ? m_liveSet->GetTransport() : nullptr;
    if (transport) return transport->IsOverdub();
    return false;
}

double LiveSetManager::getLatency() const {
    if (!m_liveSet) return 0.0;
    return m_liveSet->GetLatency();
}

bool LiveSetManager::setLatencyCompensation(double ms) {
    // Latency compensation is typically handled automatically
    return false;
}

std::vector<std::string> LiveSetManager::getGroovePool() const {
    std::vector<std::string> grooves;
    if (!m_liveSet) return grooves;
    
    // Would need to access Ableton's groove pool
    return grooves;
}

bool LiveSetManager::applyGroove(TrackId trackId, const std::string& grooveName) {
    // Apply groove to track
    return false;
}

bool LiveSetManager::startSessionRecording() {
    // Start recording in session view
    Ableton::Live::Transport* transport = m_liveSet ? m_liveSet->GetTransport() : nullptr;
    if (transport) {
        transport->SetRecord(true);
        return true;
    }
    return false;
}

bool LiveSetManager::stopSessionRecording() {
    Ableton::Live::Transport* transport = m_liveSet ? m_liveSet->GetTransport() : nullptr;
    if (transport) {
        transport->SetRecord(false);
        return true;
    }
    return false;
}

bool LiveSetManager::startArrangementRecording() {
    // Start recording in arrangement view
    return false;
}

bool LiveSetManager::stopArrangementRecording() {
    // Stop recording in arrangement view
    return false;
}

void LiveSetManager::updateTrackInfo(TrackInfo& info, Ableton::Live::Track* track) const {
    if (!track) return;
    
    info.id = track->GetIndex();
    info.name = track->GetName().c_str();
    info.index = track->GetIndex();
    info.isAudioTrack = track->IsAudioTrack();
    info.isMidiTrack = track->IsMidiTrack();
    info.isReturnTrack = track->IsReturnTrack();
    info.isMasterTrack = track->IsMasterTrack();
    info.volume = track->GetVolume();
    info.pan = track->GetPan();
    info.isMuted = track->IsMute();
    info.isSoloed = track->IsSolo();
    info.isArmed = track->IsArm();
    
    // Get clips on this track
    int32_t clipCount = track->GetClipCount();
    for (int32_t i = 0; i < clipCount; ++i) {
        Ableton::Live::Clip* clip = track->GetClip(i);
        if (clip) {
            ClipInfo clipInfo;
            updateClipInfo(clipInfo, clip);
            info.clips.push_back(clipInfo);
        }
    }
    
    // Get devices on this track
    int32_t deviceCount = track->GetDeviceCount();
    for (int32_t i = 0; i < deviceCount; ++i) {
        Ableton::Live::Device* device = track->GetDevice(i);
        if (device) {
            DeviceInfo devInfo;
            updateDeviceInfo(devInfo, device);
            info.devices.push_back(devInfo);
        }
    }
}

void LiveSetManager::updateClipInfo(ClipInfo& info, Ableton::Live::Clip* clip) const {
    if (!clip) return;
    
    info.id = clip->GetId();
    info.name = clip->GetName().c_str();
    info.isAudioClip = clip->IsAudioClip();
    info.isMidiClip = clip->IsMidiClip();
    info.isLooping = clip->IsLooping();
    info.startBeat = clip->GetStart();
    info.durationBeats = clip->GetEnd() - clip->GetStart();
    info.startTime = clip->GetStart() / m_liveSet->GetTempo(); // Approximate
    info.duration = info.durationBeats / m_liveSet->GetTempo();
    info.color = clip->GetColor();
    info.isPlaying = clip->IsPlaying();
    info.currentPosition = clip->GetPlayingPosition();
    
    // Loop points
    info.loopStart = clip->GetLoopStart();
    info.loopEnd = clip->GetLoopEnd();
    
    // File path for audio clips
    if (clip->IsAudioClip()) {
        // Would need to access the clip's sample to get file path
        info.filePath = "";
    }
}

void LiveSetManager::updateDeviceInfo(DeviceInfo& info, Ableton::Live::Device* device) const {
    if (!device) return;
    
    info.id = device->GetId();
    info.name = device->GetName().c_str();
    info.className = device->GetClassName().c_str();
    info.isEnabled = device->IsEnabled();
    // trackId and chainIndex would need to be determined from context
}

void LiveSetManager::updateSceneInfo(SceneInfo& info, Ableton::Live::Scene* scene) const {
    if (!scene) return;
    
    info.id = scene->GetIndex();
    info.name = scene->GetName().c_str();
    info.index = scene->GetIndex();
    
    // Get clips in this scene
    int32_t trackCount = m_liveSet->GetTrackCount();
    for (int32_t t = 0; t < trackCount; ++t) {
        Ableton::Live::Track* track = m_liveSet->GetTrack(t);
        if (track) {
            Ableton::Live::ClipSlot* slot = track->GetClipSlot(info.index);
            if (slot) {
                Ableton::Live::Clip* clip = slot->GetClip();
                if (clip) {
                    ClipInfo clipInfo;
                    updateClipInfo(clipInfo, clip);
                    info.clips.push_back(clipInfo);
                }
            }
        }
    }
}

Ableton::Live::Scene* LiveSetManager::getScene(SceneId id) const {
    if (!m_liveSet) return nullptr;
    
    int32_t sceneCount = m_liveSet->GetSceneCount();
    if (id >= 0 && id < sceneCount) {
        return m_liveSet->GetScene(id);
    }
    return nullptr;
}

} // namespace resolvelink