/**
 * DeviceManager - Manages devices (instruments, effects) on tracks
 */

#ifndef DEVICE_MANAGER_H
#define DEVICE_MANAGER_H

#include <AbletonLive.h>
#include <string>
#include <vector>
#include <memory>
#include <mutex>
#include <map>

#include "AbletonExtension.h"

namespace resolvelink {

class DeviceManager {
public:
    explicit DeviceManager(Ableton::Live::Set* liveSet = nullptr);
    ~DeviceManager();
    
    void setLiveSet(Ableton::Live::Set* liveSet);
    void update();
    
    // Device operations
    std::vector<DeviceInfo> getDevices(TrackId trackId = -1) const;
    DeviceInfo getDevice(DeviceId id) const;
    
    // Device management
    DeviceId addDevice(TrackId trackId, const std::string& deviceClass, int32_t position = -1);
    DeviceId addAudioEffect(TrackId trackId, const std::string& effectName, int32_t position = -1);
    DeviceId addMidiEffect(TrackId trackId, const std::string& effectName, int32_t position = -1);
    DeviceId addInstrument(TrackId trackId, const std::string& instrumentName, int32_t position = -1);
    DeviceId loadDevicePreset(TrackId trackId, const std::string& presetPath, int32_t position = -1);
    
    bool deleteDevice(DeviceId id);
    bool moveDevice(DeviceId id, int32_t newPosition);
    bool copyDevice(DeviceId id, TrackId targetTrackId, int32_t position = -1);
    
    // Device properties
    bool setDeviceName(DeviceId id, const std::string& name);
    bool setDeviceEnabled(DeviceId id, bool enabled);
    bool getDeviceEnabled(DeviceId id) const;
    
    // Device parameters
    std::vector<ParameterInfo> getDeviceParameters(DeviceId id) const;
    ParameterInfo getParameter(DeviceId deviceId, ParameterId paramId) const;
    bool setParameterValue(DeviceId deviceId, ParameterId paramId, double value);
    bool setParameterAutomated(DeviceId deviceId, ParameterId paramId, bool automated);
    bool getParameterAutomated(DeviceId deviceId, ParameterId paramId) const;
    
    // Parameter automation
    bool addParameterAutomation(DeviceId deviceId, ParameterId paramId, 
                                 const std::vector<std::pair<double, double>>& points);  // (beat, value)
    bool clearParameterAutomation(DeviceId deviceId, ParameterId paramId);
    std::vector<std::pair<double, double>> getParameterAutomation(DeviceId deviceId, ParameterId paramId) const;
    
    // Device chains (Audio Effect Rack, MIDI Effect Rack, Instrument Rack, Drum Rack)
    DeviceId createRack(TrackId trackId, const std::string& rackType, int32_t position = -1);
    DeviceId addChainToRack(DeviceId rackId, const std::string& chainName = "");
    bool deleteChainFromRack(DeviceId rackId, int32_t chainIndex);
    bool reorderChainsInRack(DeviceId rackId, const std::vector<int32_t>& chainOrder);
    
    // Drum Rack specific
    DeviceId createDrumRack(TrackId trackId, int32_t position = -1);
    bool addDrumChain(DeviceId drumRackId, int32_t note, const std::string& chainName = "");
    bool removeDrumChain(DeviceId drumRackId, int32_t note);
    bool setDrumChainReceiveNote(DeviceId drumRackId, int32_t chainIndex, int32_t note);
    bool setDrumChainChokeGroup(DeviceId drumRackId, int32_t chainIndex, int32_t chokeGroup);
    
    // Audio Effect Rack
    bool setRackMacroMapping(DeviceId rackId, int32_t macroIndex, DeviceId targetDevice, ParameterId paramId);
    bool removeRackMacroMapping(DeviceId rackId, int32_t macroIndex);
    
    // MIDI Effect Rack
    bool setRackKeyZone(DeviceId rackId, int32_t chainIndex, int32_t zoneStart, int32_t zoneEnd, int32_t fadeStart, int32_t fadeEnd);
    bool setRackVelocityZone(DeviceId rackId, int32_t chainIndex, int32_t zoneStart, int32_t zoneEnd, int32_t fadeStart, int32_t fadeEnd);
    
    // Instrument Rack
    bool setRackKeyZone(DeviceId rackId, int32_t chainIndex, int32_t zoneStart, int32_t zoneEnd, int32_t fadeStart, int32_t fadeEnd);
    bool setRackVelocityZone(DeviceId rackId, int32_t chainIndex, int32_t zoneStart, int32_t zoneEnd, int32_t fadeStart, int32_t fadeEnd);
    
    // Preset management
    bool saveDevicePreset(DeviceId deviceId, const std::string& presetPath);
    bool loadDevicePreset(DeviceId deviceId, const std::string& presetPath);
    
    // Hot-swap
    bool hotSwapDevice(DeviceId deviceId, const std::string& newDeviceClass);
    
    // Utility
    std::vector<std::string> getAvailableAudioEffects() const;
    std::vector<std::string> getAvailableMidiEffects() const;
    std::vector<std::string> getAvailableInstruments() const;
    std::vector<std::string> getAvailableMaxForLiveDevices() const;

private:
    Ableton::Live::Set* m_liveSet = nullptr;
    mutable std::mutex m_mutex;
    
    Ableton::Live::Device* getDevice(DeviceId id) const;
    Ableton::Live::Track* getTrack(TrackId trackId) const;
    Ableton::Live::Device* findDeviceInTrack(Ableton::Live::Track* track, DeviceId id) const;
    Ableton::Live::Device* findDeviceInChain(Ableton::Live::Device* device, DeviceId id) const;
    void updateDeviceInfo(DeviceInfo& info, Ableton::Live::Device* device) const;
    void updateParameterInfo(ParameterInfo& info, Ableton::Live::Parameter* param) const;
};

} // namespace resolvelink

#endif // DEVICE_MANAGER_H