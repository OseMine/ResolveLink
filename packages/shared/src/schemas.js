/**
 * ResolveLink Shared Validation Schemas
 * Runtime validation for all API request/response payloads.
 */
const { z } = require('zod');

// --- Clip & Link Schemas ---

const ClipDataSchema = z.object({
  name: z.string().min(1),
  start: z.number().min(0),
  duration: z.number().min(0),
  sourcePath: z.string().min(1),
  sourceIn: z.number().optional(),
  sourceOut: z.number().optional(),
  trackIndex: z.number().int().positive().optional(),
  trackName: z.string().optional(),
  volume: z.number().min(0).max(2).optional(),
  muted: z.boolean().optional(),
});

const LinkSettingsSchema = z.object({
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  fps: z.number().positive().default(24),
  duration: z.number().positive().default(10),
  renderQueue: z.string().optional(),
  sampleRate: z.number().int().positive().optional(),
});

const LinkClipStatusSchema = z.enum(['pending', 'linked', 'rendering', 'rendered', 'error']);
const LinkStatusSchema = z.enum(['created', 'linked', 'sending', 'queued', 'rendering', 'rendered', 'imported', 'error', 'completed', 'sent']);

// --- Request Schemas ---

const LinkClipRequestSchema = z.object({
  clipData: z.array(ClipDataSchema).min(1, 'At least one clip is required'),
  settings: LinkSettingsSchema.partial().optional(),
});

const ReaperLinkClipRequestSchema = z.object({
  clipData: z.array(ClipDataSchema).min(1, 'At least one clip is required'),
  settings: z.object({
    fps: z.number().positive().optional(),
    sampleRate: z.number().int().positive().optional(),
    duration: z.number().positive().optional(),
  }).optional(),
  timelineMode: z.boolean().optional(),
  projectName: z.string().optional(),
  timelineName: z.string().optional(),
});

const JobStatusRequestSchema = z.object({
  status: z.string().min(1),
  result: z.any().optional(),
  error: z.string().optional(),
});

const LinkStatusUpdateSchema = z.object({
  status: z.string().min(1),
  exportPath: z.string().optional(),
});

const SetupRequestSchema = z.object({
  pythonPath: z.string().optional(),
  aePath: z.string().optional(),
  reaperPath: z.string().optional(),
  exportDir: z.string().optional(),
  tempDir: z.string().optional(),
  port: z.number().int().positive().optional(),
  host: z.string().optional(),
  scriptingPath: z.string().optional(),
});

const PresetRequestSchema = z.object({
  name: z.string().min(1, 'Preset name is required'),
  template: z.string().optional(),
  outputModule: z.string().optional(),
  settings: z.record(z.any()).optional(),
});

const BatchExportRequestSchema = z.object({
  timelineNames: z.array(z.string().min(1)).min(1, 'At least one timeline name is required'),
});

const ClearRequestSchema = z.object({
  target: z.enum(['exports', 'temp'], {
    errorMap: () => ({ message: 'target must be "exports" or "temp"' }),
  }),
});

const ClipPropertiesRequestSchema = z.object({
  clipPath: z.string().min(1, 'clipPath is required'),
});

const ImportBackRequestSchema = z.object({
  renderedPath: z.string().min(1, 'renderedPath is required'),
});

const EditingRequestSchema = z.object({
  compName: z.string().nullable().optional(),
  status: z.enum(['editing', 'idle']),
});

const ReaperImportRequestSchema = z.object({
  filePath: z.string().min(1, 'filePath is required'),
  trackName: z.string().optional(),
  positionFrames: z.number().optional(),
});

// --- Response Schemas ---

const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  links: z.number().int().nonnegative(),
});

const SuccessResponseSchema = z.object({
  success: z.literal(true),
});

module.exports = {
  // Schemas
  ClipDataSchema,
  LinkSettingsSchema,
  LinkClipStatusSchema,
  LinkStatusSchema,
  LinkClipRequestSchema,
  ReaperLinkClipRequestSchema,
  JobStatusRequestSchema,
  LinkStatusUpdateSchema,
  SetupRequestSchema,
  PresetRequestSchema,
  BatchExportRequestSchema,
  ClearRequestSchema,
  ClipPropertiesRequestSchema,
  ImportBackRequestSchema,
  EditingRequestSchema,
  ReaperImportRequestSchema,
  HealthResponseSchema,
  SuccessResponseSchema,
};
