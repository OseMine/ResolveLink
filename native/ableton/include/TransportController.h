/**
 * TransportController - Manages Ableton Live transport (play, stop, record, seek, loop)
 */

#ifndef TRANSPORT_CONTROLLER_H
#define TRANSPORT_CONTROLLER_H

#include <AbletonLive.h>
#include <string>
#include <mutex>

#include "AbletonExtension.h"

namespace resolvelink {

class TransportController {
public:
    explicit TransportController(Ableton::Live::Set* liveSet = nullptr);
    ~TransportController();
    
    void setLiveSet(Ableton::Live::Set* liveSet);
    void update();
    
    // Basic transport
    bool play();
    bool stop();
    bool record();
    bool overdub();
    
    // Seek/Position
    bool seek(double beatPosition);
    bool seekByTime(double seconds);
    double getCurrentBeat() const;
    double getCurrentTime() const;
    
    // Loop
    bool setLoop(double startBeat, double endBeat);
    bool setLoopEnabled(bool enabled);
    bool isLooping() const;
    double getLoopStart() const;
    double getLoopEnd() const;
    
    // Tempo
    bool setTempo(double bpm);
    double getTempo() const;
    bool tapTempo();
    
    // Time signature
    bool setTimeSignature(int32_t numerator, int32_t denominator);
    void getTimeSignature(int32_t& numerator, int32_t& denominator) const;
    
    // Metronome
    bool setMetronomeEnabled(bool enabled);
    bool isMetronomeEnabled() const;
    bool setMetronomeVolume(double volume);  // 0.0 - 1.0
    
    // Count-in
    bool setCountInEnabled(bool enabled);
    bool setCountInBars(int32_t bars);
    
    // Recording
    bool isRecording() const;
    bool isOverdubbing() const;
    bool setOverdub(bool enabled);
    
    // State
    bool isPlaying() const;
    double getCurrentBeat() const;
    double getCurrentTime() const;
    double getSongLength() const;
    
    // Arrangement view
    bool isArrangementRecording() const;
    bool startArrangementRecording();
    bool stopArrangementRecording();

private:
    Ableton::Live::Set* m_liveSet = nullptr;
    mutable std::mutex m_mutex;
    
    // Helper methods
    Ableton::Live::Transport* getTransport() const;
};

} // namespace resolvelink

#endif // TRANSPORT_CONTROLLER_H