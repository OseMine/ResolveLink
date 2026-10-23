/**
 * Project Routes
 * Project CRUD, templates, version history, backups, ZIP import/export and
 * shareable .rlzip archives.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const projectManager = require('../services/project-manager');
const discord = require('../services/discord-rpc');
const { createLogger } = require('../logger');
const { validate } = require('../middleware/validation');
const { z } = require('zod');

const log = createLogger('Projects');
const router = express.Router();

// --- Validation schemas ---

const ProjectSettingsSchema = z.object({
  exportDir: z.string().optional(),
  tempDir: z.string().optional(),
  rendersDir: z.string().optional(),
  scriptsDir: z.string().optional(),
  assetsDir: z.string().optional(),
  backupsDir: z.string().optional(),
  versionsDir: z.string().optional(),
  serverPort: z.number().int().positive().optional(),
  serverHost: z.string().optional(),
  autoImport: z.boolean().optional(),
  stemExport: z.boolean().optional(),
}).passthrough();

const ProjectMetadataSchema = z.object({
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  collaborators: z.array(z.string()).optional(),
}).passthrough();

const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100),
  template: z.string().optional(),
  description: z.string().optional(),
  settings: ProjectSettingsSchema.optional(),
  metadata: ProjectMetadataSchema.optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  collaborators: z.array(z.string()).optional(),
  serverPort: z.number().int().positive().optional(),
  serverHost: z.string().optional(),
  autoImport: z.boolean().optional(),
  stemExport: z.boolean().optional(),
});

const UpdateProjectSchema = z.object({
  description: z.string().optional(),
  settings: ProjectSettingsSchema.optional(),
  metadata: ProjectMetadataSchema.optional(),
});

const ProjectNameParamSchema = z.object({
  name: z.string().min(1),
});

const LinkSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).optional(),
  target: z.enum(['ae', 'reaper', 'ableton']).optional(),
  status: z.enum(['created', 'linked', 'sending', 'queued', 'rendering', 'rendered', 'imported', 'error', 'completed', 'sent']).optional(),
  clips: z.array(z.any()).optional(),
  settings: z.record(z.any()).optional(),
  markers: z.array(z.any()).optional(),
  timelineName: z.string().optional(),
}).passthrough();

const TimelineSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).optional(),
  fps: z.number().positive().optional(),
  resolution: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),
  clips: z.array(z.any()).optional(),
  markers: z.array(z.any()).optional(),
}).passthrough();

const RenderSchema = z.object({
  id: z.string().optional(),
  linkId: z.string().optional(),
  status: z.enum(['pending', 'rendering', 'completed', 'failed']).optional(),
  outputPath: z.string().optional(),
  settings: z.record(z.any()).optional(),
}).passthrough();

const RenderUpdateSchema = z.object({
  status: z.enum(['pending', 'rendering', 'completed', 'failed']),
  outputPath: z.string().optional(),
});

const ExportProjectSchema = z.object({
  outputPath: z.string().min(1).optional(),
  includeTemp: z.boolean().optional(),
  includeBackups: z.boolean().optional(),
  includeVersions: z.boolean().optional(),
  forSharing: z.boolean().optional(),
});

const ShareProjectSchema = z.object({
  outputPath: z.string().min(1).optional(),
  download: z.boolean().optional(),
});

const ImportProjectSchema = z.object({
  archivePath: z.string().min(1),
  overwrite: z.boolean().optional(),
});

const VersionSchema = z.object({
  label: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
});

// --- Helpers ---

function handleError(res, err, context) {
  if (err.message.includes('not found') || err.message.includes('not found in archive')) {
    return res.status(404).json({ error: err.message });
  }
  if (err.message.includes('already exists')) {
    return res.status(409).json({ error: err.message });
  }
  if (err.message.includes('Unknown project template') || err.message.includes('unsafe path')) {
    return res.status(400).json({ error: err.message });
  }
  log.error(`${context}: ${err.message}`);
  res.status(500).json({ error: err.message });
}

function createTempArchivePath(projectName, ext = projectManager.SHARE_FILE_EXT) {
  const safe = projectManager.sanitizeProjectName(projectName);
  return path.join(
    os.tmpdir(),
    `resolvelink_${safe}_${Date.now()}${ext}`
  );
}

// --- Static routes (must precede /:name) ---

// GET /api/projects/templates — List built-in project templates
router.get('/templates', (_req, res) => {
  res.json({ templates: projectManager.listTemplates() });
});

// POST /api/projects/import — Import project from .rlzip/.zip archive
router.post('/import', validate(ImportProjectSchema), (req, res) => {
  try {
    const project = projectManager.importProject(req.body.archivePath, {
      overwrite: req.body.overwrite,
    });
    discord.setProject(project.name).catch(() => {});
    res.json({ success: true, project });
  } catch (err) {
    handleError(res, err, 'Failed to import project');
  }
});

// --- Project CRUD ---

// GET /api/projects — List all projects
router.get('/', (_req, res) => {
  try {
    res.json({ projects: projectManager.listProjects() });
  } catch (err) {
    handleError(res, err, 'Failed to list projects');
  }
});

// POST /api/projects — Create a new project (optionally from a template)
router.post('/', validate(CreateProjectSchema), (req, res) => {
  try {
    const project = projectManager.createProject(req.body.name, req.body);
    discord.setProject(project.name).catch(() => {});
    res.status(201).json(project);
  } catch (err) {
    handleError(res, err, 'Failed to create project');
  }
});

// GET /api/projects/:name — Get a single project
router.get('/:name', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const project = projectManager.loadProject(req.params.name);
    discord.setProject(project.name).catch(() => {});
    res.json(project);
  } catch (err) {
    handleError(res, err, 'Failed to load project');
  }
});

// PUT /api/projects/:name — Update project description/settings/metadata
router.put(
  '/:name',
  validate(ProjectNameParamSchema, 'params'),
  validate(UpdateProjectSchema),
  (req, res) => {
    try {
      const project = projectManager.loadProject(req.params.name);
      if (req.body.description !== undefined) project.description = req.body.description;
      if (req.body.settings) {
        project.settings = { ...project.settings, ...req.body.settings };
      }
      if (req.body.metadata) {
        project.metadata = { ...project.metadata, ...req.body.metadata };
      }
      projectManager.saveProject(project);
      res.json(project);
    } catch (err) {
      handleError(res, err, 'Failed to update project');
    }
  }
);

// DELETE /api/projects/:name — Delete a project
router.delete('/:name', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const force = req.query.force === 'true';
    projectManager.deleteProject(req.params.name, { force });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err, 'Failed to delete project');
  }
});

// --- Backups ---

// POST /api/projects/:name/backup — Create a backup
router.post('/:name/backup', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const backupPath = projectManager.createBackup(req.params.name);
    res.json({ success: true, backupPath });
  } catch (err) {
    handleError(res, err, 'Failed to create backup');
  }
});

// GET /api/projects/:name/backups — List backups
router.get('/:name/backups', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const projectDir = projectManager.getProjectDir(req.params.name);
    const backupsDir = path.join(projectDir, 'backups');

    if (!fs.existsSync(backupsDir)) {
      return res.json({ backups: [] });
    }

    const backups = fs.readdirSync(backupsDir)
      .filter((f) => f.endsWith(projectManager.PROJECT_FILE_EXT))
      .map((f) => {
        const filePath = path.join(backupsDir, f);
        const stats = fs.statSync(filePath);
        return {
          name: f,
          path: filePath,
          size: stats.size,
          created: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json({ backups });
  } catch (err) {
    handleError(res, err, 'Failed to list backups');
  }
});

// POST /api/projects/:name/restore/:backupName — Restore from backup
router.post(
  '/:name/restore/:backupName',
  validate(ProjectNameParamSchema, 'params'),
  (req, res) => {
    try {
      projectManager.loadProject(req.params.name);

      const projectDir = projectManager.getProjectDir(req.params.name);
      const backupsDir = path.resolve(projectDir, 'backups');
      const backupPath = path.resolve(backupsDir, path.basename(req.params.backupName));

      if (!backupPath.startsWith(backupsDir + path.sep) || !fs.existsSync(backupPath)) {
        return res.status(404).json({ error: 'Backup not found' });
      }

      // Snapshot the current state before restoring.
      try {
        projectManager.createVersion(req.params.name, {
          label: 'Before backup restore',
          description: `Automatic snapshot before restoring ${path.basename(backupPath)}`,
        });
      } catch (err) {
        log.warn(`Could not snapshot before restore: ${err.message}`);
      }

      const projectFile = projectManager.getProjectFilePath(req.params.name);
      fs.copyFileSync(backupPath, projectFile);

      res.json({ success: true, project: projectManager.loadProject(req.params.name) });
    } catch (err) {
      handleError(res, err, 'Failed to restore backup');
    }
  }
);

// --- Version history ---

// GET /api/projects/:name/versions — List version snapshots
router.get('/:name/versions', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    projectManager.loadProject(req.params.name);
    res.json({ versions: projectManager.listVersions(req.params.name) });
  } catch (err) {
    handleError(res, err, 'Failed to list versions');
  }
});

// POST /api/projects/:name/versions — Create a version snapshot
router.post(
  '/:name/versions',
  validate(ProjectNameParamSchema, 'params'),
  validate(VersionSchema),
  (req, res) => {
    try {
      const version = projectManager.createVersion(req.params.name, req.body);
      res.status(201).json(version);
    } catch (err) {
      handleError(res, err, 'Failed to create version');
    }
  }
);

// POST /api/projects/:name/versions/:versionId/restore — Restore a version
router.post(
  '/:name/versions/:versionId/restore',
  validate(ProjectNameParamSchema, 'params'),
  (req, res) => {
    try {
      const project = projectManager.restoreVersion(req.params.name, req.params.versionId);
      res.json({ success: true, project });
    } catch (err) {
      handleError(res, err, 'Failed to restore version');
    }
  }
);

// DELETE /api/projects/:name/versions/:versionId — Delete a version
router.delete(
  '/:name/versions/:versionId',
  validate(ProjectNameParamSchema, 'params'),
  (req, res) => {
    try {
      projectManager.deleteVersion(req.params.name, req.params.versionId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err, 'Failed to delete version');
    }
  }
);

// --- Import / export / sharing ---

// POST /api/projects/:name/export — Export project as a ZIP archive
router.post(
  '/:name/export',
  validate(ProjectNameParamSchema, 'params'),
  validate(ExportProjectSchema),
  (req, res) => {
    try {
      const outputPath = req.body.outputPath || path.join(
        projectManager.getProjectsRoot(),
        `${projectManager.sanitizeProjectName(req.params.name)}_${Date.now()}.zip`
      );

      const finalPath = projectManager.exportProject(req.params.name, outputPath, req.body);
      res.json({ success: true, outputPath: finalPath });
    } catch (err) {
      handleError(res, err, 'Failed to export project');
    }
  }
);

// POST /api/projects/:name/share — Create a shareable .rlzip archive
router.post(
  '/:name/share',
  validate(ProjectNameParamSchema, 'params'),
  validate(ShareProjectSchema),
  (req, res) => {
    try {
      const outputPath = req.body.outputPath || createTempArchivePath(req.params.name);
      const archivePath = projectManager.createShareArchive(req.params.name, outputPath);

      if (req.body.download) {
        return res.download(archivePath, path.basename(archivePath), (err) => {
          if (err) log.error(`Share download failed: ${err.message}`);
          if (!req.body.outputPath) {
            fs.rm(archivePath, { force: true }, () => {});
          }
        });
      }

      res.json({ success: true, archivePath });
    } catch (err) {
      handleError(res, err, 'Failed to create share archive');
    }
  }
);

// GET /api/projects/:name/share — Download a shareable .rlzip archive
router.get('/:name/share', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const archivePath = createTempArchivePath(req.params.name);
    projectManager.createShareArchive(req.params.name, archivePath);

    res.download(archivePath, path.basename(archivePath), (err) => {
      if (err) log.error(`Share download failed: ${err.message}`);
      fs.rm(archivePath, { force: true }, () => {});
    });
  } catch (err) {
    handleError(res, err, 'Failed to create share archive');
  }
});

// --- Links ---

// POST /api/projects/:name/links — Add link to project
router.post(
  '/:name/links',
  validate(ProjectNameParamSchema, 'params'),
  validate(LinkSchema),
  (req, res) => {
    try {
      const link = projectManager.addLinkToProject(req.params.name, req.body);
      res.status(201).json(link);
    } catch (err) {
      handleError(res, err, 'Failed to add link');
    }
  }
);

// GET /api/projects/:name/links — List links in project
router.get('/:name/links', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    res.json({ links: projectManager.loadProject(req.params.name).links });
  } catch (err) {
    handleError(res, err, 'Failed to list links');
  }
});

// PUT /api/projects/:name/links/:linkId — Update link
router.put(
  '/:name/links/:linkId',
  validate(ProjectNameParamSchema, 'params'),
  validate(LinkSchema),
  (req, res) => {
    try {
      const link = projectManager.updateLinkInProject(
        req.params.name,
        req.params.linkId,
        req.body
      );
      res.json(link);
    } catch (err) {
      handleError(res, err, 'Failed to update link');
    }
  }
);

// DELETE /api/projects/:name/links/:linkId — Remove link
router.delete('/:name/links/:linkId', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    projectManager.removeLinkFromProject(req.params.name, req.params.linkId);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err, 'Failed to remove link');
  }
});

// --- Timelines ---

// POST /api/projects/:name/timelines — Add timeline
router.post(
  '/:name/timelines',
  validate(ProjectNameParamSchema, 'params'),
  validate(TimelineSchema),
  (req, res) => {
    try {
      const timeline = projectManager.addTimelineToProject(req.params.name, req.body);
      res.status(201).json(timeline);
    } catch (err) {
      handleError(res, err, 'Failed to add timeline');
    }
  }
);

// GET /api/projects/:name/timelines — List timelines
router.get('/:name/timelines', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    res.json({ timelines: projectManager.loadProject(req.params.name).timelines });
  } catch (err) {
    handleError(res, err, 'Failed to list timelines');
  }
});

// --- Renders ---

// POST /api/projects/:name/renders — Add render record
router.post(
  '/:name/renders',
  validate(ProjectNameParamSchema, 'params'),
  validate(RenderSchema),
  (req, res) => {
    try {
      const render = projectManager.addRenderToProject(req.params.name, req.body);
      res.status(201).json(render);
    } catch (err) {
      handleError(res, err, 'Failed to add render');
    }
  }
);

// GET /api/projects/:name/renders — List renders
router.get('/:name/renders', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    res.json({ renders: projectManager.loadProject(req.params.name).renders });
  } catch (err) {
    handleError(res, err, 'Failed to list renders');
  }
});

// PUT /api/projects/:name/renders/:renderId — Update render status
router.put(
  '/:name/renders/:renderId',
  validate(ProjectNameParamSchema, 'params'),
  validate(RenderUpdateSchema),
  (req, res) => {
    try {
      const render = projectManager.updateRenderStatus(
        req.params.name,
        req.params.renderId,
        req.body.status,
        req.body.outputPath
      );
      res.json(render);
    } catch (err) {
      handleError(res, err, 'Failed to update render');
    }
  }
);

// --- Settings ---

// GET /api/projects/:name/settings — Get project settings
router.get('/:name/settings', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const project = projectManager.loadProject(req.params.name);
    res.json({ settings: project.settings, metadata: project.metadata });
  } catch (err) {
    handleError(res, err, 'Failed to load settings');
  }
});

// PUT /api/projects/:name/settings — Update project settings
router.put(
  '/:name/settings',
  validate(ProjectNameParamSchema, 'params'),
  validate(ProjectSettingsSchema),
  (req, res) => {
    try {
      const project = projectManager.loadProject(req.params.name);
      project.settings = { ...project.settings, ...req.body };
      projectManager.saveProject(project);
      res.json({ settings: project.settings });
    } catch (err) {
      handleError(res, err, 'Failed to update settings');
    }
  }
);

module.exports = router;
