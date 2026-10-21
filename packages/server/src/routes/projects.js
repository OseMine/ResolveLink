/**
 * Project Routes
 * Handles project CRUD operations, backups, import/export
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { store } = require('../state');
const projectManager = require('../services/project-manager');
const { createLogger } = require('../logger');
const { validate } = require('../middleware/validation');
const { z } = require('zod');

const log = createLogger('Projects');
const router = express.Router();

// Validation schemas
const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100),
  description: z.string().optional(),
  settings: z.object({
    exportDir: z.string().optional(),
    tempDir: z.string().optional(),
    rendersDir: z.string().optional(),
    serverPort: z.number().int().positive().optional(),
    serverHost: z.string().optional(),
    autoImport: z.boolean().optional(),
    stemExport: z.boolean().optional(),
  }).optional(),
  metadata: z.object({
    tags: z.array(z.string()).optional(),
    notes: z.string().optional(),
    collaborators: z.array(z.string()).optional(),
  }).optional(),
});

const UpdateProjectSchema = z.object({
  description: z.string().optional(),
  settings: z.object({
    exportDir: z.string().optional(),
    tempDir: z.string().optional(),
    rendersDir: z.string().optional(),
    serverPort: z.number().int().positive().optional(),
    serverHost: z.string().optional(),
    autoImport: z.boolean().optional(),
    stemExport: z.boolean().optional(),
  }).optional(),
  metadata: z.object({
    tags: z.array(z.string()).optional(),
    notes: z.string().optional(),
    collaborators: z.array(z.string()).optional(),
  }).optional(),
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
});

const RenderUpdateSchema = z.object({
  status: z.enum(['pending', 'rendering', 'completed', 'failed']),
  outputPath: z.string().optional(),
});

const ExportProjectSchema = z.object({
  outputPath: z.string().min(1),
});

const ImportProjectSchema = z.object({
  archivePath: z.string().min(1),
  overwrite: z.boolean().optional(),
});

// GET /api/projects — List all projects
router.get('/', (_req, res) => {
  try {
    const projects = projectManager.listProjects();
    res.json({ projects });
  } catch (err) {
    log.error(`Failed to list projects: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:name — Get a single project
router.get('/:name', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const project = projectManager.loadProject(req.params.name);
    res.json(project);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    log.error(`Failed to load project: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects — Create a new project
router.post('/', validate(CreateProjectSchema), (req, res) => {
  try {
    const project = projectManager.createProject(req.body.name, req.body);
    res.status(201).json(project);
  } catch (err) {
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    log.error(`Failed to create project: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:name — Update project settings
router.put('/:name', validate(ProjectNameParamSchema, 'params'), validate(UpdateProjectSchema), (req, res) => {
  try {
    const project = projectManager.loadProject(req.params.name);
    Object.assign(project, req.body);
    projectManager.saveProject(project);
    res.json(project);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    log.error(`Failed to update project: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:name — Delete a project
router.delete('/:name', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const force = req.query.force === 'true';
    projectManager.deleteProject(req.params.name, { force });
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    log.error(`Failed to delete project: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:name/backup — Create a backup
router.post('/:name/backup', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const backupPath = projectManager.createBackup(req.params.name);
    res.json({ success: true, backupPath });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    log.error(`Failed to create backup: ${err.message}`);
    res.status(500).json({ error: err.message });
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
      .filter(f => f.endsWith('.rlp'))
      .map(f => {
        const filePath = path.join(projectDir, 'backups', f);
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
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    log.error(`Failed to list backups: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:name/restore/:backupName — Restore from backup
router.post('/:name/restore/:backupName', 
  validate(ProjectNameParamSchema, 'params'),
  (req, res) => {
    try {
      const projectDir = projectManager.getProjectDir(req.params.name);
      const backupPath = path.join(projectDir, 'backups', req.params.backupName);
      
      if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ error: 'Backup not found' });
      }
      
      // Copy backup to main project file
      const projectFile = path.join(projectDir, path.basename(projectDir) + '.rlp');
      fs.copyFileSync(backupPath, projectFile);
      
      const project = projectManager.loadProject(req.params.name);
      res.json({ success: true, project });
    } catch (err) {
      log.error(`Failed to restore backup: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

// POST /api/projects/:name/export — Export project as zip
router.post('/:name/export', 
  validate(ProjectNameParamSchema, 'params'), 
  validate(ExportProjectSchema), 
  (req, res) => {
  try {
    const outputPath = req.body.outputPath || path.join(
      projectManager.getProjectsRoot(), 
      `${req.params.name}_${Date.now()}.zip`
    );
    
    const outputPath = projectManager.exportProject(req.params.name, outputPath);
    res.json({ success: true, outputPath });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    log.error(`Failed to export project: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/import — Import project from archive
router.post('/import', validate(ImportProjectSchema), (req, res) => {
  try {
    const project = projectManager.importProject(req.body.archivePath, {
      overwrite: req.body.overwrite
    });
    res.json({ success: true, project });
  } catch (err) {
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    log.error(`Failed to import project: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:name/links — Add link to project
router.post('/:name/links', 
  validate(ProjectNameParamSchema, 'params'), 
  validate(LinkSchema), 
  (req, res) => {
  try {
    const link = projectManager.addLinkToProject(req.params.name, req.body);
    res.status(201).json(link);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    log.error(`Failed to add link: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:name/links — List links in project
router.get('/:name/links', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const project = projectManager.loadProject(req.params.name);
    res.json({ links: project.links });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:name/links/:linkId — Update link
router.put('/:name/links/:linkId', 
  validate(ProjectNameParamSchema, 'params'), 
  (req, res) => {
  try {
    const link = projectManager.updateLinkInProject(
      req.params.name, 
      req.params.linkId, 
      req.body
    );
    res.json(link);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:name/links/:linkId — Remove link
router.delete('/:name/links/:linkId', 
  validate(ProjectNameParamSchema, 'params'), 
  (req, res) => {
  try {
    projectManager.removeLinkFromProject(req.params.name, req.params.linkId);
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:name/timelines — Add timeline
router.post('/:name/timelines', 
  validate(ProjectNameParamSchema, 'params'), 
  (req, res) => {
  try {
    const timeline = projectManager.addTimelineToProject(req.params.name, req.body);
    res.status(201).json(timeline);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:name/timelines — List timelines
router.get('/:name/timelines', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const project = projectManager.loadProject(req.params.name);
    res.json({ timelines: project.timelines });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:name/renders — Add render record
router.post('/:name/renders', 
  validate(ProjectNameParamSchema, 'params'), 
  (req, res) => {
  try {
    const render = projectManager.addRenderToProject(req.params.name, req.body);
    res.status(201).json(render);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:name/renders — List renders
router.get('/:name/renders', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const project = projectManager.loadProject(req.params.name);
    res.json({ renders: project.renders });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:name/renders/:renderId — Update render status
router.put('/:name/renders/:renderId', 
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
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:name/settings — Get project settings
router.get('/:name/settings', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const project = projectManager.loadProject(req.params.name);
    res.json({ settings: project.settings, metadata: project.metadata });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:name/settings — Update project settings
router.put('/:name/settings', 
  validate(ProjectNameParamSchema, 'params'), 
  (req, res) => {
  try {
    const project = projectManager.loadProject(req.params.name);
    project.settings = { ...project.settings, ...req.body };
    projectManager.saveProject(project);
    res.json({ settings: project.settings });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:name/backup — Create backup
router.post('/:name/backup', validate(ProjectNameParamSchema, 'params'), (req, res) => {
  try {
    const backupPath = projectManager.createBackup(req.params.name);
    res.json({ success: true, backupPath });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
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
      .filter(f => f.endsWith('.rlp'))
      .map(f => {
        const filePath = path.join(projectDir, 'backups', f);
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
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:name/restore/:backupName — Restore from backup
router.post('/:name/restore/:backupName', 
  (req, res) => {
  try {
    const projectDir = projectManager.getProjectDir(req.params.name);
    const backupPath = path.join(projectDir, 'backups', req.params.backupName);
    
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    
    const projectFile = path.join(projectDir, path.basename(projectDir) + '.rlp');
    fs.copyFileSync(backupPath, projectFile);
    
    const project = projectManager.loadProject(req.params.name);
    res.json({ success: true, project });
  } catch (err) {
    log.error(`Failed to restore backup: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.initProjectRoutes = (tempDir, exportDir) => {
  // Initialize project manager with directories
  // The project manager uses its own directories
};