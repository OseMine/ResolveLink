/**
 * Ableton Integration - Script Generators
 *
 * Creates Lua scripts for REAPER to communicate with Ableton Live via OSC,
 * and generates import scripts for DaVinci Resolve.
 */
const path = require('path');

/**
 * Generate a Lua script for REAPER that creates a track and sends clip info to Ableton via OSC.
 * @param {import('@resolvelink/shared').Link} link
 * @param {string} exportDir
 * @returns {string}
 */
function generateReaperScript(link, exportDir) {
  const compName = `ResolveLink_${link.id.slice(0, 8)}`;
  const exportPath = path.join(exportDir, `${compName}.wav`).replace(/\\/g, '/');

  const payload = {
    trackName: compName,
    bpm: link.settings.bpm || 120,
    totalDurationBeats: Math.round((link.settings.duration || 10) * (link.settings.bpm || 120) / 60),
    exportPath,
    clips: link.clips.map((clip, i) => ({
      name: clip.name || `Clip_${i + 1}`,
      startFrames: clip.start || 0,
      durationFrames: clip.duration || 0,
      sourceIn: clip.sourceIn || 0,
      sourceOut: clip.sourceOut || 0,
    })),
  };

  return `-- ResolveLink REAPER → Ableton Script
-- Link ID: ${link.id}
-- Generated: ${new Date().toISOString()}
--
-- This script runs inside REAPER. It creates a track with the rendered audio
-- and sends clip timing information to Ableton Live via OSC.
--
-- Requirements: REAPER with SWS/S&M extensions for OSC support.

local json = require("dkjson")
local socket = require("socket")

local osc_host = "127.0.0.1"
local osc_port = 8000

function sendOSC(address, ...)
  local udp = socket.udp()
  udp:setpeername(osc_host, osc_port)
  local msg = address .. " " .. table.concat({...}, " ")
  udp:send(msg)
  udp:close()
end

local payload = {
  _link_id = "${link.id}",
  _track_name = "${payload.trackName}",
  _bpm = ${payload.bpm},
  _total_beats = ${payload.totalBeats},
  _export_path = "${payload.exportPath}",
  _clips = ${JSON.stringify(payload.clips)},
}

-- Create a new track for the rendered audio
local track = reaper.AddTrack(0)
reaper.SetTrackName(track, payload._track_name)

-- Import the rendered file as a media item
local item = reaper.AddMediaItemToTrack(track)
local take = reaper.AddTake(item, payload._export_path, false)

-- Send clip data to Ableton via OSC
sendOSC("/resolvelink/clips", json.encode(payload._clips))
sendOSC("/resolvelink/bpm", payload._bpm)
sendOSC("/resolvelink/play", 1)

print("ResolveLink: Sent " .. #payload._clips .. " clips to Ableton Live")
`;
}

/**
 * Generate a Lua script for REAPER to import the rendered audio file back to Resolve.
 * @param {import('@resolvelink/shared').Link} link
 * @param {string} renderedFilePath
 * @returns {string}
 */
function generateResolveImportScript(link, renderedFilePath) {
  const compName = `ResolveLink_${link.id.slice(0, 8)}`;
  const safePath = renderedFilePath.replace(/\\/g, '/');
  const resolveScriptPath = path.join(process.cwd(), 'resolve-scripts', 'ResolveLink.lua').replace(/\\/g, '/');

  return `-- ResolveLink Ableton Import Script
-- Link ID: ${link.id}
-- Generated: ${new Date().toISOString()}
--
-- Usage: Run this in Resolve Console (Python)
-- > dofile([[${resolveScriptPath}]])
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
  const startSec = (clipData.start || 0) / (clipData.fps || 24);
  const durationSec = (clipData.duration || 0) / (clipData.fps || 24);
  const endSec = startSec + durationSec;

  return {
    name: clipData.name || 'Clip',
    start: startSec,
    end: endSec,
    loopStart: startSec,
    loopEnd: endSec,
    warpMode: 0,
    gain: clipData.volume || 1,
    pitch: 0,
    transpose: 0,
    detune: 0,
    filePath: clipData.sourcePath || '',
  };
}

/**
 * Generate a complete Ableton Live Set (.als) XML for a link.
 * Note: .als files are gzipped XML. This returns the XML string (caller must gzip).
 * @param {import('@resolvelink/shared').Link} link
 * @param {string} exportDir
 * @returns {string}
 */
function generateALSXML(link, exportDir) {
  const compName = `ResolveLink_${link.id.slice(0, 8)}`;
  const bpm = link.settings.bpm || 120;
  const sampleRate = link.settings.sampleRate || 44100;
  const signatureNumerator = link.settings.signatureNumerator || 4;
  const signatureDenominator = link.settings.signatureDenominator || 4;

  const clips = link.clips.map((clip, i) => ({
    ...clip,
    index: i,
    startBeats: Math.round(((clip.start || 0) / (clip.fps || 24)) * (bpm / 60)),
    durationBeats: Math.round(((clip.duration || 0) / (clip.fps || 24)) * (bpm / 60)),
  }));

  const totalBeats = Math.max(
    ...clips.map((c) => c.startBeats + c.durationBeats),
    Math.round((link.settings.duration || 10) * (bpm / 60))
  );

  let trackIndex = 0;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="11" MinorVersion="2" SchemaChangeCount="41" Creator="ResolveLink">
  <LiveSet>
    <Tempo>
      <AutomationTime>
        <Manual>
          <BPM Value="${bpm}" />
        </Manual>
      </AutomationTime>
    </Tempo>
    <TimeSignature Numerator="${signatureNumerator}" Denominator="${signatureDenominator}" />
    <Tracks>
      ${clips
        .map((clip) => {
          trackIndex++;
          return `
      <AudioTrack>
        <Name>${clip.name || `Clip_${clip.index + 1}`}</Name>
        <DeviceChain />
        <ClipSlots>
          <ClipSlot>
            <Clip>
              <Name>${clip.name || `Clip_${clip.index + 1}`}</Name>
              <CurrentStart>${clip.startBeats}.0</CurrentStart>
              <LoopStart>${clip.startBeats}.0</LoopStart>
              <LoopEnd>${clip.startBeats + clip.durationBeats}.0</LoopEnd>
              <End>${clip.startBeats + clip.durationBeats}.0</End>
              <SampleRef>
                <FileRef Path="${path.join(exportDir, clip.sourcePath || '').replace(/\\/g, '/')}"/>
              </SampleRef>
            </Clip>
          </ClipSlot>
        </ClipSlots>
      </AudioTrack>`;
        })
        .join('')}
    </Tracks>
    <MasterTrack>
      <DeviceChain />
    </MasterTrack>
    <SceneList />
    <Arrangement>
      <Locators />
      <TimeSpan Start="0.0" End="${totalBeats}.0" />
    </Arrangement>
  </LiveSet>
</Ableton>`;
}

module.exports = {
  generateReaperScript,
  generateResolveImportScript,
  generateASDMetadata,
  generateALSXML,
};