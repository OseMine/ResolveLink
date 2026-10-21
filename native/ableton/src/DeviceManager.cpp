/**
 * DeviceManager Implementation
 */

#include "DeviceManager.h"
#include "Logger.h"
#include <AbletonLive.h>
#include <algorithm>

namespace resolvelink {

DeviceManager::DeviceManager(Ableton::Live::Set* liveSet) : m_liveSet(liveSet) {
}

DeviceManager::~DeviceManager() {
}

void DeviceManager::setLiveSet(Ableton::Live::Set* liveSet) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_liveSet = liveSet;
}

void DeviceManager::update() {
    // Could add periodic device state updates here
}

std::vector<DeviceInfo> DeviceManager::getDevices(TrackId trackId) const {
    std::vector<DeviceInfo> devices;
    if (!m_liveSet) return devices;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    
    int32_t startTrack = (trackId >= 0) ? trackId : 0;
    int32_t endTrack = (trackId >= 0) ? trackId + 1 : m_liveSet->GetTrackCount();
    
    for (int32_t t = startTrack; t < endTrack && t < m_liveSet->GetTrackCount(); ++t) {
        Ableton::Live::Track* track = m_liveSet->GetTrack(t);
        if (!track) continue;
        
        int32_t deviceCount = track->GetDeviceCount();
        for (int32_t i = 0; i < deviceCount; ++i) {
            Ableton::Live::Device* device = track->GetDevice(i);
            if (device) {
                DeviceInfo info;
                updateDeviceInfo(info, device, t);
                devices.push_back(info);
            }
        }
    }
    
    return devices;
}

DeviceInfo DeviceManager::getDevice(DeviceId id) const {
    DeviceInfo info;
    if (!m_liveSet) return info;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(id);
    if (device) {
        updateDeviceInfo(info, device, -1);
    }
    return info;
}

Ableton::Live::Device* DeviceManager::findDeviceById(DeviceId id) const {
    if (!m_liveSet) return nullptr;
    
    int32_t trackCount = m_liveSet->GetTrackCount();
    for (int32_t t = 0; t < trackCount; ++t) {
        Ableton::Live::Track* track = m_liveSet->GetTrack(t);
        if (!track) continue;
        
        Ableton::Live::Device* device = findDeviceInTrack(track, id);
        if (device) return device;
    }
    return nullptr;
}

Ableton::Live::Device* DeviceManager::findDeviceInTrack(Ableton::Live::Track* track, DeviceId id) const {
    if (!track) return nullptr;
    
    int32_t deviceCount = track->GetDeviceCount();
    for (int32_t i = 0; i < deviceCount; ++i) {
        Ableton::Live::Device* device = track->GetDevice(i);
        if (device && device->GetId() == id) {
            return device;
        }
        
        // Check nested devices (racks)
        device = findDeviceInChain(device, id);
        if (device) return device;
    }
    return nullptr;
}

Ableton::Live::Device* DeviceManager::findDeviceInChain(Ableton::Live::Device* device, DeviceId id) const {
    if (!device) return nullptr;
    
    // Check if device is a rack
    if (device->CanHaveChains()) {
        int32_t chainCount = device->GetChainCount();
        for (int32_t i = 0; i < chainCount; ++i) {
            // Would need to access chain's devices
            // This is a simplified implementation
        }
    }
    return nullptr;
}

DeviceId DeviceManager::addDevice(TrackId trackId, const std::string& deviceClass, int32_t position) {
    if (!m_liveSet) return -1;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Track* track = getTrack(trackId);
    if (!track) return -1;
    
    // Add device to track
    Ableton::Live::Device* device = track->AddDevice(deviceClass.c_str(), position);
    if (device) {
        return device->GetId();
    }
    return -1;
}

DeviceId DeviceManager::addAudioEffect(TrackId trackId, const std::string& effectName, int32_t position) {
    return addDevice(trackId, "AudioEffect", position);
}

DeviceId DeviceManager::addMidiEffect(TrackId trackId, const std::string& effectName, int32_t position) {
    return addDevice(trackId, "MidiEffect", position);
}

DeviceId DeviceManager::addInstrument(TrackId trackId, const std::string& instrumentName, int32_t position) {
    return addDevice(trackId, "Instrument", position);
}

DeviceId DeviceManager::loadDevicePreset(TrackId trackId, const std::string& presetPath, int32_t position) {
    if (!m_liveSet) return -1;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Track* track = getTrack(trackId);
    if (!track) return -1;
    
    // Load device from preset file
    Ableton::Live::Device* device = track->LoadDevicePreset(presetPath.c_str(), position);
    if (device) {
        return device->GetId();
    }
    return -1;
}

bool DeviceManager::deleteDevice(DeviceId id) {
    if (!m_liveSet) return false;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(id);
    if (!device) return false;
    
    // Find the track containing the device
    int32_t trackCount = m_liveSet->GetTrackCount();
    for (int32_t t = 0; t < trackCount; ++t) {
        Ableton::Live::Track* track = m_liveSet->GetTrack(t);
        if (!track) continue;
        
        int32_t deviceCount = track->GetDeviceCount();
        for (int32_t i = 0; i < deviceCount; ++i) {
            Ableton::Live::Device* d = track->GetDevice(i);
            if (d && d->GetId() == id) {
                track->DeleteDevice(i);
                return true;
            }
        }
    }
    return false;
}

bool DeviceManager::moveDevice(DeviceId id, int32_t newPosition) {
    if (!m_liveSet) return false;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(id);
    if (!device) return false;
    
    // Find track containing device
    int32_t trackCount = m_liveSet->GetTrackCount();
    for (int32_t t = 0; t < trackCount; ++t) {
        Ableton::Live::Track* track = m_liveSet->GetTrack(t);
        if (!track) continue;
        
        // Check if device is in this track
        int32_t deviceCount = track->GetDeviceCount();
        for (int32_t i = 0; i < deviceCount; ++i) {
            Ableton::Live::Device* d = track->GetDevice(i);
            if (d && d->GetId() == id) {
                track->MoveDevice(i, newPosition);
                return true;
            }
        }
    }
    return false;
}

bool DeviceManager::copyDevice(DeviceId id, TrackId targetTrackId, int32_t position) {
    if (!m_liveSet) return false;
    
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(id);
    if (!device) return false;
    
    Ableton::Live::Track* targetTrack = getTrack(targetTrackId);
    if (!targetTrack) return false;
    
    // Copy device to target track
    Ableton::Live::Device* newDevice = targetTrack->CopyDevice(device, position);
    return newDevice != nullptr;
}

bool DeviceManager::setDeviceName(DeviceId id, const std::string& name) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(id);
    if (device) {
        device->SetName(name.c_str());
        return true;
    }
    return false;
}

bool DeviceManager::setDeviceEnabled(DeviceId id, bool enabled) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(id);
    if (device) {
        device->SetEnabled(enabled);
        return true;
    }
    return false;
}

bool DeviceManager::getDeviceEnabled(DeviceId id) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(id);
    if (device) {
        return device->IsEnabled();
    }
    return false;
}

std::vector<ParameterInfo> DeviceManager::getDeviceParameters(DeviceId id) const {
    std::vector<ParameterInfo> params;
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(id);
    if (!device) return params;
    
    int32_t paramCount = device->GetParameterCount();
    for (int32_t i = 0; i < paramCount; ++i) {
        Ableton::Live::Parameter* param = device->GetParameter(i);
        if (param) {
            ParameterInfo info;
            updateParameterInfo(info, param);
            params.push_back(info);
        }
    }
    return params;
}

ParameterInfo DeviceManager::getParameter(DeviceId deviceId, ParameterId paramId) const {
    ParameterInfo info;
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(deviceId);
    if (device) {
        Ableton::Live::Parameter* param = device->GetParameter(paramId);
        if (param) {
            updateParameterInfo(info, param);
        }
    }
    return info;
}

bool DeviceManager::setParameterValue(DeviceId deviceId, ParameterId paramId, double value) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(deviceId);
    if (!device) return false;
    
    Ableton::Live::Parameter* param = device->GetParameter(paramId);
    if (param) {
        param->SetValue(static_cast<float>(value));
        return true;
    }
    return false;
}

bool DeviceManager::setParameterAutomated(DeviceId deviceId, ParameterId paramId, bool automated) {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(deviceId);
    if (!device) return false;
    
    Ableton::Live::Parameter* param = device->GetParameter(paramId);
    if (param) {
        param->SetAutomated(automated);
        return true;
    }
    return false;
}

bool DeviceManager::getParameterAutomated(DeviceId deviceId, ParameterId paramId) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    Ableton::Live::Device* device = findDeviceById(deviceId);
    if (device) {
        Ableton::Live::Parameter* param = device->GetParameter(paramId);
        if (param) {
            return param->IsAutomated();
        }
    }
    return false;
}

bool DeviceManager::addParameterAutomation(DeviceId deviceId, ParameterId paramId, const std::vector<std::pair<double, double>>& points) {
    // Add automation points to parameter
    return false;
}

bool DeviceManager::clearParameterAutomation(DeviceId deviceId, ParameterId paramId) {
    return false;
}

std::vector<std::pair<double, double>> DeviceManager::getParameterAutomation(DeviceId deviceId, ParameterId paramId) const {
    std::vector<std::pair<double, double>> points;
    return points;
}

DeviceId DeviceManager::createRack(TrackId trackId, const std::string& rackType, int32_t position) {
    // Create rack device (AudioEffectRack, MidiEffectRack, InstrumentRack, DrumRack)
    return addDevice(trackId, rackType, position);
}

DeviceId DeviceManager::addChainToRack(DeviceId rackId, const std::string& chainName) {
    return -1;
}

bool DeviceManager::deleteChainFromRack(DeviceId rackId, int32_t chainIndex) {
    return false;
}

bool DeviceManager::reorderChainsInRack(DeviceId rackId, const std::vector<int32_t>& chainOrder) {
    return false;
}

DeviceId DeviceManager::createDrumRack(TrackId trackId, int32_t position) {
    return addDevice(trackId, "DrumRack", position);
}

bool DeviceManager::addDrumChain(DeviceId drumRackId, int32_t note, const std::string& chainName) {
    return false;
}

bool DeviceManager::removeDrumChain(DeviceId drumRackId, int32_t note) {
    return false;
}

bool DeviceManager::setDrumChainReceiveNote(DeviceId drumRackId, int32_t chainIndex, int32_t note) {
    return false;
}

bool DeviceManager::setDrumChainChokeGroup(DeviceId drumRackId, int32_t chainIndex, int32_t chokeGroup) {
    return false;
}

bool DeviceManager::setRackMacroMapping(DeviceId rackId, int32_t macroIndex, DeviceId targetDevice, ParameterId paramId) {
    return false;
}

bool DeviceManager::removeRackMacroMapping(DeviceId rackId, int32_t macroIndex) {
    return false;
}

bool DeviceManager::setRackKeyZone(DeviceId rackId, int32_t chainIndex, int32_t zoneStart, int32_t zoneEnd, int32_t fadeStart, int32_t fadeEnd) {
    return false;
}

bool DeviceManager::setRackVelocityZone(DeviceId rackId, int32_t chainIndex, int32_t zoneStart, int32_t zoneEnd, int32_t fadeStart, int32_t fadeEnd) {
    return false;
}

bool DeviceManager::hotSwapDevice(DeviceId deviceId, const std::string& newDeviceClass) {
    return false;
}

std::vector<std::string> DeviceManager::getAvailableAudioEffects() const {
    std::vector<std::string> effects;
    // Would need to query Ableton's browser
    return effects;
}

std::vector<std::string> DeviceManager::getAvailableMidiEffects() const {
    std::vector<std::string> effects;
    return effects;
}

std::vector<std::string> DeviceManager::getAvailableInstruments() const {
    std::vector<std::string> instruments;
    return instruments;
}

std::vector<std::string> DeviceManager::getAvailableMaxForLiveDevices() const {
    std::vector<std::string> devices;
    return devices;
}

Ableton::Live::Track* DeviceManager::getTrack(TrackId trackId) const {
    if (!m_liveSet) return nullptr;
    
    int32_t trackCount = m_liveSet->GetTrackCount();
    if (trackId >= 0 && trackId < trackCount) {
        return m_liveSet->GetTrack(trackId);
    }
    return nullptr;
}

Ableton::Live::Device* DeviceManager::findDeviceInTrack(Ableton::Live::Track* track, DeviceId id) const {
    if (!track) return nullptr;
    
    int32_t deviceCount = track->GetDeviceCount();
    for (int32_t i = 0; i < deviceCount; ++i) {
        Ableton::Live::Device* device = track->GetDevice(i);
        if (device && device->GetId() == id) {
            return device;
        }
        
        // Check nested devices (racks)
        Ableton::Live::Device* nested = findDeviceInChain(track->GetDevice(i), id);
        if (nested) return nested;
    }
    return nullptr;
}

Ableton::Live::Device* DeviceManager::findDeviceInChain(Ableton::Live::Device* device, DeviceId id) const {
    if (!device) return nullptr;
    
    // Check if device is a rack
    if (device->CanHaveChains()) {
        int32_t chainCount = device->GetChainCount();
        for (int32_t i = 0; i < chainCount; ++i) {
            // Would need to access chain's devices
            // This is a simplified implementation
        }
    }
    return nullptr;
}

void DeviceManager::updateDeviceInfo(DeviceInfo& info, Ableton::Live::Device* device, int32_t trackIndex) const {
    if (!device) return;
    
    info.id = device->GetId();
    info.name = device->GetName().c_str();
    info.className = device->GetClassName().c_str();
    info.isEnabled = device->IsEnabled();
    info.trackId = trackIndex;
    info.chainIndex = -1; // Would need to determine from context
}

void DeviceManager::updateParameterInfo(ParameterInfo& info, Ableton::Live::Parameter* param) const {
    if (!param) return;
    
    info.id = param->GetId();
    info.name = param->GetName().c_str();
    info.minValue = param->GetMinValue();
    info.maxValue = param->GetMaxValue();
    info.currentValue = param->GetValue();
    info.defaultValue = param->GetDefaultValue();
    info.unit = param->GetUnit().c_str();
    info.isAutomated = param->IsAutomated();
    info.isQuantized = param->IsQuantized();
}

} // namespace resolvelink