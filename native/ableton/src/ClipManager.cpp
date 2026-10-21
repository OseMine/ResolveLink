/**
 * ClipManager Implementation
 */

#include "ClipManager.h"
#include "Logger.h"
#include <AbletonLive.h>
#include <algorithm>

namespace resolvelink {

ClipManager::ClipManager(Ableton::Live::Set* liveSet) : m_liveSet(liveSet) {
}

ClipManager::~ClipManager() {
}

void ClipManager::setLiveSet(Ableton::Live::Set* liveSet) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_liveSet = liveSet;
}

void ClipManager::update() {
    // Could add periodic clip state updates here
}

std::vector<ClipInfo> ClipManager::getClips(TrackId trackId) const {
    std::vector<ClipInfo> clips;
    if (!m_liveSet) return clips;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    
    int32_t trackCount = m_liveSet->GetTrackCount();
    int32_t startTrack = (trackId >= 0) ? trackId : 0;
    int32_t endTrack = (trackId >= 0) ? trackId + 1 : m_liveSet->GetTrackCount();
    
    for (int32_t t = startTrack; t < endTrack && t < m_liveSet->GetTrackCount(); ++t) {
        Ableton::Live::Track* track = m_liveSet->GetTrack(t);
        if (!track) continue;
        
        int32_t clipCount = track->GetClipCount();
        for (int32_t i = 0; i < clipCount; ++i) {
            Ableton::Live::Clip* clip = track->GetClip(i);
            if (clip) {
                ClipInfo info;
                updateClipInfo(info, clip, t);
                clips.push_back(info);
            }
        }
    }
    
    return clips;
}

ClipInfo ClipManager::getClip(ClipId id) const {
    ClipInfo info;
    if (!m_liveSet) return info;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    
    int32_t trackCount = m_liveSet->GetTrackCount();
    for (int32_t t = 0; t < m_liveSet->GetTrackCount(); ++t) {
        Ableton::Live::Track* track = m_liveSet->GetTrack(t);
        if (!track) continue;
        
        int32_t clipCount = track->GetClipCount();
        for (int32_t i = 0; i < clipCount; ++i) {
            Ableton::Live::Clip* clip = track->GetClip(i);
            if (clip && clip->GetId() == id) {
                updateClipInfo(info, clip, t);
                return info;
            }
        }
    }
    
    return info;
}

Ableton::Live::Clip* ClipManager::getClip(ClipId id) const {
    if (!m_liveSet) return nullptr;
    
    int32_t trackCount = m_liveSet->GetTrackCount();
    for (int32_t t = 0; t < m_liveSet->GetTrackCount(); ++t) {
        Ableton::Live::Track* track = m_liveSet->GetTrack(t);
        if (!track) continue;
        
        int32_t clipCount = track->GetClipCount();
        for (int32_t i = 0; i < clipCount; ++i) {
            Ableton::Live::Clip* clip = track->GetClip(i);
            if (clip && clip->GetId() == id) {
                return clip;
            }
        }
    }
    
    return nullptr;
}

Ableton::Live::Track* ClipManager::getTrack(TrackId trackId) const {
    if (!m_liveSet) return nullptr;
    
    int32_t trackCount = m_liveSet->GetTrackCount();
    if (trackId >= 0 && trackId < trackCount) {
        return m_liveSet->GetTrack(trackId);
    }
    return nullptr;
}

ClipId ClipManager::createAudioClip(TrackId trackId, double startBeat, double durationBeats, const std::string& filePath) {
    if (!m_liveSet) return -1;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Track* track = getTrack(trackId);
    if (!track) return -1;
    
    // Create clip slot at the appropriate scene
    // This is a simplified implementation
    return -1;
}

ClipId ClipManager::createMidiClip(TrackId trackId, double startBeat, double durationBeats) {
    if (!m_liveSet) return -1;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Track* track = getTrack(trackId);
    if (!track) return -1;
    
    // Create MIDI clip
    return -1;
}

ClipId ClipManager::duplicateClip(ClipId clipId, double newStartBeat) {
    if (!m_liveSet) return -1;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(clipId);
    if (!clip) return -1;
    
    // Would need to duplicate the clip
    return -1;
}

bool ClipManager::deleteClip(ClipId id) {
    if (!m_liveSet) return false;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (!clip) return false;
    
    // Would need to find the clip's track and delete it
    return false;
}

bool ClipManager::setClipName(ClipId id, const std::string& name) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->SetName(name.c_str());
        return true;
    }
    return false;
}

bool ClipManager::setClipColor(ClipId id, int32_t color) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->SetColor(color);
        return true;
    }
    return false;
}

bool ClipManager::setClipPosition(ClipId id, double startBeat) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->SetStart(static_cast<float>(startBeat));
        return true;
    }
    return false;
}

bool ClipManager::setClipLength(ClipId id, double durationBeats) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->SetEnd(static_cast<float>(startBeat + durationBeats));
        return true;
    }
    return false;
}

bool ClipManager::setClipLoop(ClipId id, bool enabled, double loopStart, double loopEnd) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->SetLooping(enabled);
        if (enabled) {
            clip->SetLoopStart(static_cast<float>(loopStart));
            clip->SetLoopEnd(static_cast<float>(loopEnd));
        }
        return true;
    }
    return false;
}

bool ClipManager::setClipStartMarker(ClipId id, double beat) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->SetStartMarker(static_cast<float>(beat));
        return true;
    }
    return false;
}

bool ClipManager::setClipEndMarker(ClipId id, double beat) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->SetEndMarker(static_cast<float>(beat));
        return true;
    }
    return false;
}

bool ClipManager::launchClip(ClipId id) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->Launch();
        return true;
    }
    return false;
}

bool ClipManager::stopClip(ClipId id) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->Stop();
        return true;
    }
    return false;
}

bool ClipManager::isClipPlaying(ClipId id) const {
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        return clip->IsPlaying();
    }
    return false;
}

double ClipManager::getClipPosition(ClipId id) const {
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        return clip->GetPlayingPosition();
    }
    return 0.0;
}

bool ClipManager::setClipGain(ClipId id, double gain) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->SetGain(static_cast<float>(gain));
        return true;
    }
    return false;
}

bool ClipManager::setClipPitch(ClipId id, int32_t semitones) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->SetPitch(semitones);
        return true;
    }
    return false;
}

bool ClipManager::setClipWarpMode(ClipId id, int32_t warpMode) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Clip* clip = getClip(id);
    if (clip) {
        clip->SetWarpMode(warpMode);
        return true;
    }
    return false;
}

bool ClipManager::setClipPitchAlgorithm(ClipId id, int32_t algorithm) {
    return false;
}

bool ClipManager::addClipEnvelope(ClipId id, const std::string& parameter, const std::vector<std::pair<double, double>>& points) {
    return false;
}

bool ClipManager::clearClipEnvelopes(ClipId id) {
    return false;
}

bool ClipManager::setClipWarpMarkers(ClipId id, const std::vector<std::pair<double, double>>& markers) {
    return false;
}

bool ClipManager::setClipFade(ClipId id, double fadeIn, double fadeOut, int32_t fadeShape) {
    return false;
}

bool ClipManager::setMidiClipNotes(ClipId id, const std::vector<MidiNote>& notes) {
    return false;
}

std::vector<ClipManager::MidiNote> ClipManager::getMidiClipNotes(ClipId id) const {
    std::vector<MidiNote> notes;
    return notes;
}

bool ClipManager::quantizeMidiClip(ClipId id, double quantization, double strength) {
    return false;
}

bool ClipManager::launchClipSlot(TrackId trackId, int32_t sceneIndex) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Track* track = getTrack(trackId);
    if (!track) return false;
    
    Ableton::Live::ClipSlot* slot = track->GetClipSlot(sceneIndex);
    if (slot) {
        slot->Launch();
        return true;
    }
    return false;
}

bool ClipManager::stopClipSlot(TrackId trackId, int32_t sceneIndex) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Track* track = getTrack(trackId);
    if (!track) return false;
    
    Ableton::Live::ClipSlot* slot = track->GetClipSlot(sceneIndex);
    if (slot) {
        slot->Stop();
        return true;
    }
    return false;
}

bool ClipManager::isClipSlotPlaying(TrackId trackId, int32_t sceneIndex) const {
    Ableton::Live::Track* track = getTrack(trackId);
    if (!track) return false;
    
    Ableton::Live::ClipSlot* slot = track->GetClipSlot(sceneIndex);
    if (slot) {
        Ableton::Live::Clip* clip = slot->GetClip();
        if (clip) return clip->IsPlaying();
    }
    return false;
}

bool ClipManager::consolidateClip(ClipId id, const std::string& outputPath) {
    return false;
}

bool ClipManager::freezeClip(ClipId id) {
    return false;
}

bool ClipManager::unfreezeClip(ClipId id) {
    return false;
}

std::vector<double> ClipManager::getClipAudioData(ClipId id, int32_t channel) const {
    std::vector<double> samples;
    return samples;
}

bool ClipManager::setClipAudioData(ClipId id, const std::vector<double>& samples, int32_t channel) {
    return false;
}

void ClipManager::updateClipInfo(ClipInfo& info, Ableton::Live::Clip* clip, int32_t trackIndex) const {
    if (!clip) return;
    
    info.id = clip->GetId();
    info.name = clip->GetName().c_str();
    info.trackId = trackIndex;
    info.isAudioClip = clip->IsAudioClip();
    info.isMidiClip = clip->IsMidiClip();
    info.isLooping = clip->IsLooping();
    info.startBeat = clip->GetStart();
    info.durationBeats = clip->GetEnd() - clip->GetStart();
    info.startTime = clip->GetStart() / 120.0; // Approximate
    info.duration = info.durationBeats / 120.0; // Approximate
    info.color = clip->GetColor();
    info.isPlaying = clip->IsPlaying();
    info.currentPosition = clip->GetPlayingPosition();
    info.loopStart = clip->GetLoopStart();
    info.loopEnd = clip->GetLoopEnd();
    
    // File path for audio clips
    if (clip->IsAudioClip()) {
        info.filePath = ""; // Would need to access sample
    }
}

} // namespace resolvelink