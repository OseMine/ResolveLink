/**
 * TransportController Implementation
 */

#include "TransportController.h"
#include "Logger.h"
#include <AbletonLive.h>
#include <chrono>

namespace resolvelink {

TransportController::TransportController(Ableton::Live::Set* liveSet) : m_liveSet(liveSet) {
}

TransportController::~TransportController() {
}

void TransportController::setLiveSet(Ableton::Live::Set* liveSet) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_liveSet = liveSet;
}

void TransportController::update() {
    // Could add periodic state synchronization here
}

Ableton::Live::Transport* TransportController::getTransport() const {
    if (!m_liveSet) return nullptr;
    return m_liveSet->GetTransport();
}

bool TransportController::play() {
    auto transport = getTransport();
    if (transport) {
        transport->Play();
        return true;
    }
    return false;
}

bool TransportController::stop() {
    auto transport = getTransport();
    if (transport) {
        transport->Stop();
        return true;
    }
    return false;
}

bool TransportController::record() {
    auto transport = getTransport();
    if (transport) {
        transport->SetRecord(true);
        return true;
    }
    return false;
}

bool TransportController::overdub() {
    auto transport = getTransport();
    if (transport) {
        transport->SetOverdub(true);
        return true;
    }
    return false;
}

bool TransportController::seek(double beatPosition) {
    auto transport = getTransport();
    if (transport) {
        transport->SetCurrentBeat(static_cast<float>(beatPosition));
        return true;
    }
    return false;
}

bool TransportController::seekByTime(double seconds) {
    auto transport = getTransport();
    if (transport && m_liveSet) {
        double bpm = m_liveSet->GetTempo();
        double beats = seconds * (bpm / 60.0);
        transport->SetCurrentBeat(static_cast<float>(beats));
        return true;
    }
    return false;
}

double TransportController::getCurrentBeat() const {
    auto transport = getTransport();
    if (transport) {
        return transport->GetCurrentBeat();
    }
    return 0.0;
}

double TransportController::getCurrentTime() const {
    auto transport = getTransport();
    if (transport) {
        return transport->GetCurrentTime();
    }
    return 0.0;
}

bool TransportController::seek(double beatPosition) {
    auto transport = getTransport();
    if (transport) {
        transport->SetCurrentBeat(static_cast<float>(beatPosition));
        return true;
    }
    return false;
}

bool TransportController::setLoop(double startBeat, double endBeat) {
    auto transport = getTransport();
    if (transport) {
        transport->SetLoopStart(static_cast<float>(startBeat));
        transport->SetLoopEnd(static_cast<float>(endBeat));
        return true;
    }
    return false;
}

bool TransportController::setLoopEnabled(bool enabled) {
    auto transport = getTransport();
    if (transport) {
        transport->SetLooping(enabled);
        return true;
    }
    return false;
}

bool TransportController::isLooping() const {
    auto transport = getTransport();
    if (transport) {
        return transport->IsLooping();
    }
    return false;
}

double TransportController::getLoopStart() const {
    auto transport = getTransport();
    if (transport) {
        return transport->GetLoopStart();
    }
    return 0.0;
}

double TransportController::getLoopEnd() const {
    auto transport = getTransport();
    if (transport) {
        return transport->GetLoopEnd();
    }
    return 0.0;
}

bool TransportController::setTempo(double bpm) {
    auto transport = getTransport();
    if (transport) {
        transport->SetTempo(static_cast<float>(bpm));
        return true;
    }
    return false;
}

double TransportController::getTempo() const {
    if (m_liveSet) {
        return m_liveSet->GetTempo();
    }
    return 120.0;
}

bool TransportController::tapTempo() {
    // Tap tempo would require multiple taps to calculate BPM
    // This is a simplified implementation
    return false;
}

bool TransportController::setTimeSignature(int32_t numerator, int32_t denominator) {
    // Time signature is typically set on the LiveSet, not transport
    return false;
}

void TransportController::getTimeSignature(int32_t& numerator, int32_t& denominator) const {
    if (m_liveSet) {
        // Would need to access LiveSet's time signature
        numerator = 4;
        denominator = 4;
    }
}

bool TransportController::setMetronomeEnabled(bool enabled) {
    // Metronome is typically controlled via transport
    return false;
}

bool TransportController::isMetronomeEnabled() const {
    return false;
}

bool TransportController::setMetronomeVolume(double volume) {
    return false;
}

bool TransportController::setCountInEnabled(bool enabled) {
    return false;
}

bool TransportController::setCountInBars(int32_t bars) {
    return false;
}

bool TransportController::isRecording() const {
    auto transport = getTransport();
    if (transport) {
        return transport->IsRecording();
    }
    return false;
}

bool TransportController::isOverdubbing() const {
    auto transport = getTransport();
    if (transport) {
        return transport->IsOverdub();
    }
    return false;
}

bool TransportController::setOverdub(bool enabled) {
    auto transport = getTransport();
    if (transport) {
        transport->SetOverdub(enabled);
        return true;
    }
    return false;
}

bool TransportController::isPlaying() const {
    auto transport = getTransport();
    if (transport) {
        return transport->IsPlaying();
    }
    return false;
}

double TransportController::getSongLength() const {
    if (m_liveSet) {
        // Would need to calculate from timeline
        return 0.0;
    }
    return 0.0;
}

bool TransportController::isArrangementRecording() const {
    auto transport = getTransport();
    if (transport) {
        return transport->IsArrangementRecording();
    }
    return false;
}

bool TransportController::startArrangementRecording() {
    auto transport = getTransport();
    if (transport) {
        transport->SetArrangementRecording(true);
        return true;
    }
    return false;
}

bool TransportController::stopArrangementRecording() {
    auto transport = getTransport();
    if (transport) {
        transport->SetArrangementRecording(false);
        return true;
    }
    return false;
}

} // namespace resolvelink