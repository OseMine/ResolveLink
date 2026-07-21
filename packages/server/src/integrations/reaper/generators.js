/**
 * REAPER Script Generators
 * Generates Lua scripts for REAPER import and render workflows.
 */
const path = require('path');

/**
 * Generate the JSON payload for a REAPER import script.
 * @param {import('@resolvelink/shared').Link} link
 * @returns {object}
 */
function generateReaperPayload(link) {
  const fps = link.settings.fps || 24;
  const sampleRate = link.settings.sampleRate || 48000;

  const firstClipStart = link.timelineMode ? 0 : link.clips.reduce((min, clip) => {
    const s = clip.start || 0;
    return s < min ? s : min;
  }, Infinity);

  const maxEnd = link.clips.reduce((max, clip) => {
    const end = (clip.start || 0) + (clip.duration || 0);
    return end > max ? end : max;
  }, 0);

  const totalDurationSec = (maxEnd - firstClipStart) / fps;

  const trackMap = new Map();
  for (const clip of link.clips) {
    const trackIdx = clip.trackIndex || 1;
    if (!trackMap.has(trackIdx)) {
      trackMap.set(trackIdx, {
        trackIndex: trackIdx,
        name: clip.trackName || `Track ${trackIdx}`,
        items: [],
      });
    }
    trackMap.get(trackIdx).items.push({
      name: clip.name,
      filePath: (clip.sourcePath || '').replace(/\\/g, '/'),
      positionSeconds: ((clip.start || 0) - firstClipStart) / fps,
      durationSeconds: (clip.duration || 0) / fps,
      sourceOffsetSeconds: (clip.sourceIn || 0) / fps,
      volume: clip.volume != null ? clip.volume : 1.0,
      muted: clip.muted || false,
    });
  }

  return {
    linkId: link.id,
    projectName: link.projectName || `ResolveLink_Audio_${link.id.slice(0, 8)}`,
    timelineName: link.timelineName || 'Timeline',
    sampleRate,
    fps,
    totalDuration: totalDurationSec,
    tracks: Array.from(trackMap.values()),
  };
}

/**
 * Generate a REAPER import Lua script.
 * @param {import('@resolvelink/shared').Link} link
 * @param {string} tempDir
 * @returns {string}
 */
function generateReaperImportScript(link, tempDir) {
  const payload = generateReaperPayload(link);
  const payloadJSON = JSON.stringify(payload);
  const payloadPath = path.join(tempDir, `${link.id}_reaper.json`).replace(/\\/g, '/');

  return `-- ResolveLink REAPER Import Script
-- Link ID: ${link.id}
-- Generated: ${new Date().toISOString()}
--
-- Usage: Run this script inside REAPER (Actions > Show action list > Load)
-- It reads the payload from: ${payloadPath}

local json_path = "${payloadPath}"

-- Read JSON file
local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local content = f:read("*a")
    f:close()
    return content
end

-- Minimal JSON decoder (handles nested objects and arrays)
local function json_decode(str)
    local pos = 1
    local function skip_ws()
        pos = str:find("[^ \\t\\n\\r]", pos) or (#str + 1)
    end
    local function peek() skip_ws(); return str:sub(pos, pos) end
    local function advance() pos = pos + 1 end
    local parse_val

    local function parse_string()
        pos = pos + 1
        local start = pos
        while pos <= #str do
            local c = str:sub(pos, pos)
            if c == '\\\\' then pos = pos + 2
            elseif c == '"' then
                local s = str:sub(start, pos - 1)
                pos = pos + 1
                return s
            else pos = pos + 1
            end
        end
        return str:sub(start)
    end

    local function parse_number()
        local start = pos
        if str:sub(pos, pos) == '-' then pos = pos + 1 end
        while pos <= #str and str:sub(pos, pos):match("[%d%.eE%+%-]") do pos = pos + 1 end
        return tonumber(str:sub(start, pos - 1))
    end

    local function parse_array()
        pos = pos + 1
        local arr = {}
        skip_ws()
        if peek() == ']' then pos = pos + 1; return arr end
        while true do
            arr[#arr + 1] = parse_val()
            skip_ws()
            if peek() == ',' then advance()
            elseif peek() == ']' then advance(); return arr
            else break end
        end
        return arr
    end

    local function parse_object()
        pos = pos + 1
        local obj = {}
        skip_ws()
        if peek() == '}' then pos = pos + 1; return obj end
        while true do
            skip_ws()
            local key = parse_string()
            skip_ws()
            advance() -- ':'
            obj[key] = parse_val()
            skip_ws()
            if peek() == ',' then advance()
            elseif peek() == '}' then advance(); return obj
            else break end
        end
        return obj
    end

    parse_val = function()
        skip_ws()
        local c = peek()
        if c == '"' then return parse_string()
        elseif c == '{' then return parse_object()
        elseif c == '[' then return parse_array()
        elseif c == 't' then pos = pos + 4; return true
        elseif c == 'f' then pos = pos + 5; return false
        elseif c == 'n' then pos = pos + 4; return nil
        else return parse_number()
        end
    end

    return parse_val()
end

-- Main import logic
local json_str = readFile(json_path)
if not json_str then
    reaper.ShowMessageBox("Could not read payload:\\n" .. json_path, "ResolveLink", 0)
    return
end

local data = json_decode(json_str)
if not data then
    reaper.ShowMessageBox("Invalid JSON payload", "ResolveLink", 0)
    return
end

if data.sampleRate then
    reaper.SetCurrentBPM(0, data.sampleRate, false)
end

for _, trackData in ipairs(data.tracks) do
    local trackIdx = trackData.trackIndex - 1
    local track = reaper.GetTrack(0, trackIdx)

    if not track then
        local trackCount = reaper.CountTracks(0)
        while trackCount < trackData.trackIndex do
            reaper.InsertTrackAtIndex(trackCount, true)
            trackCount = reaper.CountTracks(0)
        end
        track = reaper.GetTrack(0, trackIdx)
    end

    if track then
        reaper.GetSetMediaTrackInfo_String(track, "P_NAME", trackData.name, true)

        for _, item in ipairs(trackData.items) do
            if item.filePath and item.filePath ~= "" then
                reaper.SetOnlyTrackSelected(track)
                reaper.SetEditCurPos(item.positionSeconds, false, false)
                reaper.InsertMedia(item.filePath, 0)

                local itemCount = reaper.CountTrackMediaItems(track)
                local newItem = reaper.GetTrackMediaItem(track, itemCount - 1)
                if newItem then
                    reaper.SetMediaItemInfo_Value(newItem, "D_POSITION", item.positionSeconds)
                    reaper.SetMediaItemInfo_Value(newItem, "D_LENGTH", item.durationSeconds)

                    local take = reaper.GetActiveTake(newItem)
                    if take then
                        if item.sourceOffsetSeconds then
                            reaper.SetMediaItemTakeInfo_Value(take, "D_STARTOFFS", item.sourceOffsetSeconds)
                        end
                        if item.volume then
                            reaper.SetMediaItemTakeInfo_Value(take, "D_VOL", item.volume)
                        end
                    end

                    if item.muted then
                        reaper.SetMediaItemInfo_Value(newItem, "B_MUTE", 1)
                    end

                    reaper.UpdateItemInProject(newItem)
                end
            end
        end
    end
end

reaper.Main_OnCommand(40295, 0) -- View: Zoom to selected items
reaper.UpdateArrange()

reaper.ShowMessageBox("ResolveLink: Imported " .. #data.tracks .. " track(s) from Resolve", "ResolveLink", 0)
`;
}

/**
 * Generate a REAPER render Lua script.
 * @param {import('@resolvelink/shared').Link} link
 * @param {string} exportDir
 * @returns {string}
 */
function generateReaperRenderScript(link, exportDir) {
  const compName = `ResolveLink_Audio_${link.id.slice(0, 8)}`;
  const exportDirNorm = exportDir.replace(/\\/g, '/');
  const exportPath = path.join(exportDirNorm, compName + '.wav').replace(/\\/g, '/');

  return `-- ResolveLink REAPER Render Script
-- Link ID: ${link.id}
-- Generated: ${new Date().toISOString()}

local export_dir = "${exportDirNorm}"
local export_path = "${exportPath}"
local comp_name = "${compName}"

-- Ensure export directory exists
reaper.RecursiveCreateDirectory(export_dir, 0)

-- Render master mix
reaper.Main_OnCommand(40015, 0) -- File: Render to file

-- Set render dialog fields
reaper.GetSetProjectInfo(0, "RENDER_PATTERN", export_path, true)
reaper.GetSetProjectInfo(0, "RENDER_SRATE", "48000", true)

reaper.ShowMessageBox("ResolveLink: Render configured.\\nCheck the Render dialog and click Render.\\nOutput: " .. export_path, "ResolveLink", 0)
`;
}

module.exports = {
  generateReaperPayload,
  generateReaperImportScript,
  generateReaperRenderScript,
};
