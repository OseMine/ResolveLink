/**
 * ClipManager - Manages clips in Ableton Live
 */

#ifndef CLIP_MANAGER_H
#define CLIP_MANAGER_H

#include <AbletonLive.h>
#include <string>
#include <vector>
#include <memory>
#include <mutex>

#include "AbletonExtension.h"

namespace resolvelink {

class ClipManager {
public:
    explicit ClipManager(Ableton::Live::Set* liveSet = nullptr);
    ~ClipManager();
    
    void setLiveSet(Ableton::Live::Set* liveSet);
    void update();
    
    // Clip operations
    std::vector<ClipInfo> getClips(TrackId trackId = -1) const;
    ClipInfo getClip(ClipId id) const;
    
    // Clip creation
    ClipId createAudioClip(TrackId trackId, double startBeat, double durationBeats, const std::string& filePath);
    ClipId createMidiClip(TrackId trackId, double startBeat, double durationBeats);
    ClipId duplicateClip(ClipId clipId, double newStartBeat = -1);
    bool deleteClip(ClipId id);
    
    // Clip properties
    bool setClipName(ClipId id, const std::string& name);
    bool setClipColor(ClipId id, int32_t color);
    bool setClipPosition(ClipId id, double startBeat);
    bool setClipLength(ClipId id, double durationBeats);
    bool setClipLoop(ClipId id, bool enabled, double loopStart = 0, double loopEnd = 0);
    bool setClipStartMarker(ClipId id, double beat);
    bool setClipEndMarker(ClipId id, double beat);
    
    // Clip playback
    bool launchClip(ClipId id);
    bool stopClip(ClipId id);
    bool isClipPlaying(ClipId id) const;
    double getClipPosition(ClipId id) const;  // Current playback position in beats
    
    // Clip properties
    bool setClipGain(ClipId id, double gain);        // 0.0 - 1.0+
    bool setClipPitch(ClipId id, int32_t semitones); // -48 to +48
    bool setClipWarpMode(ClipId id, int32_t warpMode);
    bool setClipPitchAlgorithm(ClipId id, int32_t algorithm);
    
    // Clip envelopes/automation
    bool addClipEnvelope(ClipId id, const std::string& parameter, const std::vector<std::pair<double, double>>& points);
    bool clearClipEnvelopes(ClipId id);
    
    // Audio clip specific
    bool setClipWarpMarkers(ClipId id, const std::vector<std::pair<double, double>>& markers);
    bool setClipFade(ClipId id, double fadeIn, double fadeOut, int32_t fadeShape = 0);
    
    // MIDI clip specific
    bool setMidiClipNotes(ClipId id, const std::vector<MidiNote>& notes);
    std::vector<MidiNote> getMidiClipNotes(ClipId id) const;
    bool quantizeMidiClip(ClipId id, double quantization, double strength = 1.0);
    
    // Clip slot / Scene
    bool launchClipSlot(TrackId trackId, int32_t sceneIndex);
    bool stopClipSlot(TrackId trackId, int32_t sceneIndex);
    bool isClipSlotPlaying(TrackId trackId, int32_t sceneIndex) const;
    
    // Audio processing
    bool consolidateClip(ClipId id, const std::string& outputPath);
    bool freezeClip(ClipId id);
    bool unfreezeClip(ClipId id);
    
    // Clip content
    std::vector<double> getClipAudioData(ClipId id, int32_t channel = 0) const;  // Returns audio samples
    bool setClipAudioData(ClipId id, const std::vector<double>& samples, int32_t channel = 0);

private:
    Ableton::Live::Set* m_liveSet = nullptr;
    mutable std::mutex m_mutex;
    
    Ableton::Live::Clip* getClip(ClipId id) const;
    Ableton::Live::Track* getTrack(TrackId trackId) const;
    void updateClipInfo(ClipInfo& info, Ableton::Live::Clip* clip) const;
};

struct MidiNote {
    int32_t pitch;
    double startBeat;
    double durationBeats;
    int32_t velocity;
    bool muted;
};

} // namespace resolvelink

#endif // CLIP_MANAGER_H