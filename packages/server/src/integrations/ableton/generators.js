/**
 * Ableton Script Generators
 * Generates OSC payloads, Max for Live device scripts, MIDI remote scripts,
 * and Resolve import scripts for the Ableton round-trip workflow.
 */
const path = require('path');
const { createLogger } = require('../../logger');

const log = createLogger('Ableton-Gen');

/**
 * Generate the JSON payload describing the Ableton clip arrangement.
 * Converts frame-based clip data to beat-based positions using BPM.
 * @param {import('@resolink/shared').Link} link
 * @returns {object}
 */
function generateOSCPayload(link) {
  const fps = link.settings.fps || 24;
  const bpm = link.settings.bpm || 120;
  const beatsPerFrame = bpm / 60 / fps;

  const firstClipStart = link.clips.reduce((min, clip) => {
    const s = clip.start || 0;
    return s < min ? s : min;
  }, Infinity);

  const maxEnd = link.clips.reduce((max, clip) => {
    const end = (clip.start || 0) + (clip.duration || 0);
    return end > max ? end : max;
  }, 0);

  const totalDurationBeats = (maxEnd - firstClipStart) * beatsPerFrame;

  return {
    linkId: link.id,
    trackName: `ResolveLink_${link.id.slice(0, 8)}`,
    bpm,
    fps,
    beatsPerFrame,
    totalDurationBeats,
    clips: link.clips.map((clip) => ({
      name: clip.name,
      startBeats: ((clip.start || 0) - firstClipStart) * beatsPerFrame,
      durationBeats: (clip.duration || 0) * beatsPerFrame,
      sourcePath: (clip.sourcePath || '').replace(/\\/g, '/'),
      volume: clip.volume != null ? clip.volume : 1.0,
      muted: clip.muted || false,
      trackIndex: clip.trackIndex || 1,
    })),
  };
}

/**
 * Generate a Max for Live device script (.amxd) JSON description.
 * This describes the device structure that would be created on the target track.
 * The actual .amxd binary would be authored in Max MSP; this generates the
 * configuration payload that the device reads on instantiation.
 * @param {import('@resolink/shared').Link} link
 * @param {string} exportDir
 * @returns {object}
 */
function generateMaxLiveDevicePayload(link, exportDir) {
  const payload = generateOSCPayload(link);
  const compName = `ResolveLink_${link.id.slice(0, 8)}`;
  const exportPath = path.join(exportDir, `${compName}.wav`).replace(/\\/g, '/');

  return {
    deviceType: 'resolvelink_transport',
    version: '1.0.0',
    linkId: link.id,
    trackName: payload.trackName,
    bpm: payload.bpm,
    totalDurationBeats: payload.totalDurationBeats,
    exportPath,
    clips: payload.clips,
    renderSettings: {
      format: 'wav',
      sampleRate: link.settings.sampleRate || 48000,
      bitDepth: 24,
      lengthBeats: payload.totalDurationBeats,
    },
  };
}

/**
 * Generate a MIDI remote script for ResolveLink.
 * Ableton MIDI remote scripts are Python files in User Remote Scripts.
 * This generates a script that listens for OSC or MIDI messages from ResolveLink.
 * @param {import('@resolink/shared').Link} link
 * @param {string} exportDir
 * @returns {string}
 */
function generateMIDIRemoteScript(link, exportDir) {
  const payload = generateOSCPayload(link);
  const compName = `ResolveLink_${link.id.slice(0, 8)}`;
  const exportPath = path.join(exportDir, `${compName}.wav`).replace(/\\/g, '/');

  return `# ResolveLink Ableton MIDI Remote Script
# Link ID: ${link.id}
# Generated: ${new Date().toISOString()}
# User: Place this file in Ableton's User Remote Scripts folder
# Path: ~/AppData/Roaming/Ableton/Live x.x.x/Preferences/User Remote Scripts/ResolveLink/

from _Framework.Defaults import *
from _Framework.InputControlElement import *
from _Framework.SliderElement import SliderElement
from _Framework.ButtonElement import ButtonElement
from Live import *

__author__ = "ResolveLink"
__version__ = "1.0.0"
__api_version__ = (1, 1, 16)

def get_instance_capabilities():
    return (1, 1, 16)

def create_instance(c_instance):
    return ResolveLinkController(c_instance)


class ResolveLinkController(MidiChallenger):
    """MIDI Remote Script for ResolveLink audio round-trip."""

    def __init__(self, c_instance):
        self._c_instance = c_instance
        self._link_id = "${link.id}"
        self._track_name = "${payload.trackName}"
        self._bpm = ${payload.bpm}
        self._total_beats = ${payload.totalDurationBeats}
        self._export_path = r"${exportPath}"
        self._clips = ${JSON.stringify(payload.clips)}
        MidiChallenger.__init__(self)

    def application(self):
        return self._c_instance.application()

    def song(self):
        return self._c_instance.song()

    def disconnect(self):
        self._c_instance = None

    def build_midi_map(self, midi_map_handle):
        pass

    def update_display(self):
        pass

    def receive_midi_chunk(self, midi_bytes):
        pass

    def create_resolvelink_track(self):
        """Called when ResolveLink sends a /resolvelink/create message."""
        song = self.song()
        track = song.create_audio_track(-1)
        if track:
            track.name = self._track_name
        return track

    def trigger_export(self):
        """Trigger arrangement export to exportPath."""
        song = self.song()
        song.export_audio_file(
            self._export_path,
            48000,
            24,
            2,
            self._total_beats
        )
`;
}

/**
 * Generate a Lua script for Resolve to import the rendered audio file back.
 * @param {import('@resolink/shared').Link} link
 * @param {string} renderedFilePath
 * @returns {string}
 */
function generateResolveImportScript(link, renderedFilePath) {
  const compName = `ResolveLink_${link.id.slice(0, 8)}`;
  const safePath = renderedFilePath.replace(/\\/g, '/');

  return `-- ResolveLink Ableton Import Script
-- Link ID: ${link.id}
-- Generated: ${new Date().toISOString()}
--
-- Usage: Run this in Resolve Console (Python)
-- > dofile([[${path.join(process.cwd(), 'resolve-scripts', 'ResolveLink.lua').replace(/\\/g, '\\\\')]])
-- > import_audio_to_resolve([[${safePath}]], [[${compName}]])

local rendered_file = [[${safePath}]]
local clip_name = [[${compName}]]

dofile(reaper.GetResourcePath() .. "/Scripts/ResolveLink/resolve_pipeline.lua")

local success, result = pcall(function()
    return import_audio_to_resolve(rendered_file, clip_name)
end)

if success then
    reaper.ShowMessageBox("ResolveLink: Imported audio from Ableton\\n" .. rendered_file, "ResolveLink", 0)
else
    reaper.ShowMessageBox("ResolveLink: Import failed\\n" .. tostring(result), "ResolveLink", 0)
end
`;
}

/**
 * Generate an Ableton Session Information (.asd) JSON file.
 * ASD files describe clip metadata for Ableton session files.
 * @param {object} clipData - Single clip's data
 * @returns {object}
 */
function generateASDMetadata(clipData) {
  return {
    filename: clipData.sourcePath,
    name: clipData.name,
    length: clipData.durationBeats || 4.0,
    sampleRate: clipData.sampleRate || 48000,
    bitDepth: clipData.bitDepth || 24,
    channels: 2,
  };
}

/**
 * Generate an OSC command sequence as a JSON payload for external use.
 * Describes the sequence of OSC messages to send to Ableton.
 * @param {import('@resolink/shared').Link} link
 * @returns {object}
 */
function generateOSCCommandSequence(link) {
  const payload = generateOSCPayload(link);

  const commands = [];

  commands.push({
    index: 0,
    address: '/live/song/create_audio_track',
    args: [{ type: 'i', value: -1 }],
    description: 'Create audio track at end of track list',
  });

  const trackNameSafe = payload.trackName.replace(/"/g, '\\"');
  commands.push({
    index: 1,
    address: '/live/track/set_name',
    args: [{ type: 'i', value: -1 }, { type: 's', value: payload.trackName }],
    description: 'Set track name',
  });

  payload.clips.forEach((clip, i) => {
    const clipNameSafe = clip.name.replace(/"/g, '\\"');
    const sourceSafe = clip.sourcePath.replace(/\\/g, '/');

    commands.push({
      index: commands.length,
      address: '/live/clip_slot/create_clip',
      args: [
        { type: 'i', value: -1 },
        { type: 'i', value: i },
        { type: 'f', value: clip.durationBeats },
      ],
      description: `Create clip slot ${i}: ${clip.name}`,
    });

    commands.push({
      index: commands.length,
      address: '/live/clip/set_file',
      args: [
        { type: 'i', value: -1 },
        { type: 'i', value: i },
        { type: 's', value: sourceSafe },
      ],
      description: `Set clip ${i} source file: ${clip.name}`,
    });

    if (clip.startBeats > 0) {
      commands.push({
        index: commands.length,
        address: '/live/clip/set_start_marker',
        args: [
          { type: 'i', value: -1 },
          { type: 'i', value: i },
          { type: 'f', value: clip.startBeats },
        ],
        description: `Set clip ${i} start position in beats`,
      });
    }
  });

  return {
    linkId: link.id,
    trackName: payload.trackName,
    bpm: payload.bpm,
    totalDurationBeats: payload.totalDurationBeats,
    commands,
  };
}

/**
 * Generate a Max for Live device JSON config that describes the
 * transport/export device parameters.
 * @param {import('@resolvelink/shared').Link} link
 * @param {string} exportDir
 * @returns {string} JSON string of the device configuration
 */
function generateMaxLiveDeviceConfig(link, exportDir) {
  const config = generateMaxLiveDevicePayload(link, exportDir);
  return JSON.stringify(config, null, 2);
}

module.exports = {
  generateOSCPayload,
  generateMaxLiveDevicePayload,
  generateMIDIRemoteScript,
  generateResolveImportScript,
  generateASDMetadata,
  generateOSCCommandSequence,
  generateMaxLiveDeviceConfig,
};
