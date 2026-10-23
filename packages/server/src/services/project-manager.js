/**
 * ResolveLink Project Manager
 * Handles project file (.rlp) creation, loading, versioning, backup and sharing.
 * Projects are stored in ~/Documents/ResolveLink/ProjectName/ProjectName.rlp
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createLogger } = require('../logger');

const log = createLogger('ProjectManager');

// Get the ResolveLink projects directory in Documents.
// RESOLVELINK_PROJECTS_DIR is primarily used by tests and advanced setups.
function getProjectsRoot() {
  if (process.env.RESOLVELINK_PROJECTS_DIR) {
    return path.resolve(process.env.RESOLVELINK_PROJECTS_DIR);
  }

  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, 'Documents', 'ResolveLink');
}

const PROJECTS_ROOT = getProjectsRoot();
const PROJECT_FILE_EXT = '.rlp';
const SHARE_FILE_EXT = '.rlzip';
const PROJECT_SUBDIRS = ['exports', 'temp', 'renders', 'scripts', 'assets', 'backups', 'versions'];
const MAX_BACKUPS = 10;
const MAX_VERSIONS = 50;

/**
 * Project file structure:
 * {
 *   version: "1.0",
 *   id: "proj_...",
 *   name: "ProjectName",
 *   sanitizedName: "ProjectName",
 *   created: "2024-01-15T10:30:00Z",
 *   modified: "2024-01-15T10:30:00Z",
 *   description: "Optional description",
 *   template: "vfx-shot",
 *   settings: { ... },
 *   links: [...],
 *   timelines: [...],
 *   renders: [...],
 *   metadata: { tags, notes, collaborators }
 * }
 */

/**
 * Built-in project templates. Each template seeds settings, metadata and
 * extra folders so a new project is immediately ready for its workflow.
 */
const PROJECT_TEMPLATES = {
  blank: {
    id: 'blank',
    name: 'Blank Project',
    description: 'An empty project with the standard ResolveLink folder layout.',
    settings: {},
    metadata: { tags: [], notes: '' },
    directories: [],
  },
  'vfx-shot': {
    id: 'vfx-shot',
    name: 'VFX Shot',
    description: 'Single-shot VFX round-trip with plates, comps and 16-bit exports.',
    settings: {
      autoImport: true,
      stemExport: false,
      exportFormat: 'exr',
      colorDepth: '16-bit',
    },
    metadata: {
      tags: ['vfx', 'shot'],
      notes: 'VFX shot template. Place source plates in assets/plates and comp scripts in scripts/comps.',
    },
    directories: ['assets/plates', 'scripts/comps', 'renders/vfx'],
  },
  'audio-post': {
    id: 'audio-post',
    name: 'Audio Post',
    description: 'Dialogue, music and stem export workflow for REAPER round-trips.',
    settings: {
      autoImport: true,
      stemExport: true,
      renderFormat: 'wav',
      sampleRate: 48000,
    },
    metadata: {
      tags: ['audio', 'post'],
      notes: 'Audio post template. Keep dialogue, music and effects stems in assets/audio and exports/stems.',
    },
    directories: ['assets/audio', 'exports/stems', 'renders/audio'],
  },
  'color-grade': {
    id: 'color-grade',
    name: 'Color Grade',
    description: 'Color grading workflow with LUTs and reference stills.',
    settings: {
      autoImport: true,
      stemExport: false,
      renderFormat: 'mov',
      colorDepth: '10-bit',
    },
    metadata: {
      tags: ['color', 'grade'],
      notes: 'Color grade template. Store LUTs in assets/luts and reference stills in assets/references.',
    },
    directories: ['assets/luts', 'assets/references', 'renders/grade'],
  },
};

function listTemplates() {
  return Object.values(PROJECT_TEMPLATES).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    settings: template.settings,
    metadata: template.metadata,
    directories: template.directories,
  }));
}

function getTemplate(templateId) {
  if (!templateId) return PROJECT_TEMPLATES.blank;
  const template = PROJECT_TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Unknown project template "${templateId}"`);
  }
  return template;
}

// Ensure projects directory exists
function ensureProjectsDir() {
  if (!fs.existsSync(PROJECTS_ROOT)) {
    fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
    log.info(`Created projects directory: ${PROJECTS_ROOT}`);
  }
}

// Generate a new project ID
function generateProjectId() {
  return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

// Sanitize project name for filesystem
function sanitizeProjectName(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .substring(0, 100) || 'Untitled';
}

// Get project directory path
function getProjectDir(projectName) {
  const sanitized = sanitizeProjectName(projectName);
  return path.join(PROJECTS_ROOT, sanitized);
}

// Get project file path
function getProjectFilePath(projectName) {
  const sanitized = sanitizeProjectName(projectName);
  return path.join(PROJECTS_ROOT, sanitized, sanitized + PROJECT_FILE_EXT);
}

function ensureProjectSubdirs(projectDir, extraDirs = []) {
  [...PROJECT_SUBDIRS, ...extraDirs].forEach((dir) => {
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  });
}

/**
 * Create a new project.
 *
 * @param {string} name Project name
 * @param {object} [options] Settings/metadata and an optional `template` id
 */
function createProject(name, options = {}) {
  ensureProjectsDir();

  const sanitized = sanitizeProjectName(name);
  const projectDir = getProjectDir(name);
  const projectFile = getProjectFilePath(name);

  if (fs.existsSync(projectFile)) {
    throw new Error(`Project "${name}" already exists`);
  }

  const template = getTemplate(options.template || options.templateId);

  // Create project directory and standard subdirectories. Reuse a directory
  // left behind by a non-force delete (the project file is gone, assets stay).
  fs.mkdirSync(projectDir, { recursive: true });
  ensureProjectSubdirs(projectDir, template.directories);

  const now = new Date().toISOString();
  const projectId = generateProjectId();

  const projectData = {
    version: '1.0',
    id: projectId,
    name,
    sanitizedName: sanitized,
    template: template.id,
    created: now,
    modified: now,
    description: options.description || '',
    settings: {
      exportDir: './exports',
      tempDir: './temp',
      rendersDir: './renders',
      scriptsDir: './scripts',
      assetsDir: './assets',
      backupsDir: './backups',
      versionsDir: './versions',
      serverPort: options.serverPort || 3030,
      serverHost: options.serverHost || '127.0.0.1',
      autoImport: options.autoImport !== false,
      stemExport: options.stemExport || false,
      ...template.settings,
      ...options.settings,
    },
    links: [],
    timelines: [],
    renders: [],
    metadata: {
      tags: options.tags || template.metadata.tags || [],
      notes: options.notes || template.metadata.notes || '',
      collaborators: options.collaborators || [],
      ...options.metadata,
    },
  };

  // Write project file
  fs.writeFileSync(projectFile, JSON.stringify(projectData, null, 2), 'utf8');

  // Create a default README (templates add a short workflow note).
  const readmePath = path.join(projectDir, 'README.md');
  const templateNote = template.id === 'blank' ? '' : `\n## Template\n${template.name} — ${template.description}\n`;
  const readmeContent = `# ${name}\n\nResolveLink Project\n\nCreated: ${now}\n${templateNote}\n## Description\n${options.description || 'No description provided.'}\n\n## Structure\n\`\`\`\n${sanitized}/\n├── ${sanitized}.rlp     # Project file\n├── exports/             # Rendered outputs\n├── temp/                # Temporary files\n├── renders/             # Render queue outputs\n├── scripts/             # Generated scripts\n├── assets/              # Imported assets\n├── backups/             # Automatic backups\n└── versions/            # Project version snapshots\n\`\`\`\n`;
  fs.writeFileSync(readmePath, readmeContent, 'utf8');

  log.info(`Created project: ${name} (${template.id}) at ${projectDir}`);
  return projectData;
}

/**
 * Load an existing project.
 */
function loadProject(projectName) {
  const projectFile = getProjectFilePath(projectName);

  if (!fs.existsSync(projectFile)) {
    throw new Error(`Project "${projectName}" not found`);
  }

  const content = fs.readFileSync(projectFile, 'utf8');
  const projectData = JSON.parse(content);

  // Ensure all subdirectories exist.
  ensureProjectSubdirs(getProjectDir(projectData.name || projectName));

  log.info(`Loaded project: ${projectName}`);
  return projectData;
}

/**
 * Save project data atomically.
 *
 * @param {object} projectData
 * @param {object} [options]
 * @param {boolean} [options.createVersion] Snapshot the previous file first
 * @param {string} [options.versionLabel]
 */
function saveProject(projectData, options = {}) {
  const projectFile = getProjectFilePath(projectData.name);

  if (options.createVersion && fs.existsSync(projectFile)) {
    try {
      createVersion(projectData.name, { label: options.versionLabel || 'Auto save' });
    } catch (err) {
      log.warn(`Could not create version snapshot: ${err.message}`);
    }
  }

  projectData.modified = new Date().toISOString();

  // Write atomically
  const tempFile = projectFile + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(projectData, null, 2), 'utf8');
  fs.renameSync(tempFile, projectFile);

  log.info(`Saved project: ${projectData.name}`);
  return true;
}

/**
 * Delete a project.
 */
function deleteProject(projectName, options = {}) {
  const projectDir = getProjectDir(projectName);
  const projectFile = getProjectFilePath(projectName);

  if (!fs.existsSync(projectFile)) {
    throw new Error(`Project "${projectName}" not found`);
  }

  if (options.force) {
    fs.rmSync(projectDir, { recursive: true, force: true });
    log.info(`Deleted project: ${projectName}`);
  } else {
    fs.unlinkSync(projectFile);
    log.info(`Removed project file: ${projectName} (assets preserved)`);
  }

  return true;
}

/**
 * List all projects, newest first.
 */
function listProjects() {
  ensureProjectsDir();

  const projects = [];
  const entries = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectFile = path.join(PROJECTS_ROOT, entry.name, entry.name + PROJECT_FILE_EXT);
    if (!fs.existsSync(projectFile)) continue;

    try {
      const content = fs.readFileSync(projectFile, 'utf8');
      const data = JSON.parse(content);
      projects.push({
        name: data.name,
        id: data.id,
        sanitizedName: data.sanitizedName || entry.name,
        template: data.template || 'blank',
        created: data.created,
        modified: data.modified,
        description: data.description,
        tags: data.metadata?.tags || [],
        linkCount: data.links?.length || 0,
        timelineCount: data.timelines?.length || 0,
        renderCount: data.renders?.length || 0,
        path: getProjectDir(data.name),
      });
    } catch (e) {
      log.warn(`Failed to read project ${entry.name}: ${e.message}`);
    }
  }

  return projects.sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

/**
 * Add a link to a project.
 */
function addLinkToProject(projectName, linkData) {
  const project = loadProject(projectName);

  const link = {
    id: linkData.id || 'link_' + Date.now().toString(36),
    name: linkData.name || 'Untitled Link',
    target: linkData.target || 'ae',
    status: linkData.status || 'created',
    clips: linkData.clips || [],
    settings: linkData.settings || {},
    markers: linkData.markers || [],
    timelineName: linkData.timelineName || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    exportPath: null,
    ...linkData,
  };

  project.links.push(link);
  saveProject(project);

  return link;
}

/**
 * Update a link in a project.
 */
function updateLinkInProject(projectName, linkId, updates) {
  const project = loadProject(projectName);
  const linkIndex = project.links.findIndex((l) => l.id === linkId);

  if (linkIndex === -1) {
    throw new Error(`Link ${linkId} not found in project ${projectName}`);
  }

  project.links[linkIndex] = {
    ...project.links[linkIndex],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  saveProject(project);
  return project.links[linkIndex];
}

/**
 * Remove a link from a project.
 */
function removeLinkFromProject(projectName, linkId) {
  const project = loadProject(projectName);
  const linkIndex = project.links.findIndex((l) => l.id === linkId);

  if (linkIndex === -1) {
    throw new Error(`Link ${linkId} not found in project ${projectName}`);
  }

  project.links.splice(linkIndex, 1);
  saveProject(project);
  return true;
}

/**
 * Add a timeline to a project.
 */
function addTimelineToProject(projectName, timelineData) {
  const project = loadProject(projectName);

  const timeline = {
    id: timelineData.id || 'tl_' + Date.now().toString(36),
    name: timelineData.name || 'Untitled Timeline',
    projectName: project.name,
    fps: timelineData.fps || 24,
    resolution: timelineData.resolution || { width: 1920, height: 1080 },
    clips: timelineData.clips || [],
    markers: timelineData.markers || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...timelineData,
  };

  project.timelines.push(timeline);
  saveProject(project);

  return timeline;
}

/**
 * Add a render record to a project.
 */
function addRenderToProject(projectName, renderData) {
  const project = loadProject(projectName);

  const render = {
    id: renderData.id || 'render_' + Date.now().toString(36),
    linkId: renderData.linkId,
    status: renderData.status || 'pending',
    outputPath: renderData.outputPath,
    settings: renderData.settings || {},
    startedAt: new Date().toISOString(),
    completedAt: null,
    ...renderData,
  };

  project.renders.push(render);
  saveProject(project);

  return render;
}

/**
 * Update render status.
 */
function updateRenderStatus(projectName, renderId, status, outputPath = null) {
  const project = loadProject(projectName);
  const renderIndex = project.renders.findIndex((r) => r.id === renderId);

  if (renderIndex === -1) {
    throw new Error(`Render ${renderId} not found`);
  }

  project.renders[renderIndex].status = status;
  if (outputPath) project.renders[renderIndex].outputPath = outputPath;
  if (status === 'completed' || status === 'failed') {
    project.renders[renderIndex].completedAt = new Date().toISOString();
  }

  saveProject(project);
  return project.renders[renderIndex];
}

/**
 * Create a backup of the project file (keeps the last 10).
 */
function createBackup(projectName) {
  const project = loadProject(projectName);
  const projectDir = getProjectDir(projectName);
  const backupsDir = path.join(projectDir, 'backups');

  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${project.sanitizedName || sanitizeProjectName(project.name)}_${timestamp}${PROJECT_FILE_EXT}`;
  const backupPath = path.join(backupsDir, backupName);

  fs.copyFileSync(getProjectFilePath(project.name), backupPath);

  const backups = fs.readdirSync(backupsDir)
    .filter((f) => f.endsWith(PROJECT_FILE_EXT))
    .map((f) => ({ name: f, time: fs.statSync(path.join(backupsDir, f)).mtime }))
    .sort((a, b) => b.time - a.time);

  if (backups.length > MAX_BACKUPS) {
    backups.slice(MAX_BACKUPS).forEach((f) => {
      fs.unlinkSync(path.join(backupsDir, f.name));
    });
  }

  log.info(`Created backup: ${backupName}`);
  return backupPath;
}

// --- Version history ---

function getVersionsDir(projectName) {
  return path.join(getProjectDir(projectName), 'versions');
}

function getVersionsIndexPath(projectName) {
  return path.join(getVersionsDir(projectName), 'index.json');
}

function readVersionsIndex(projectName) {
  const indexPath = getVersionsIndexPath(projectName);
  if (!fs.existsSync(indexPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(data.versions) ? data.versions : [];
  } catch (err) {
    log.warn(`Could not read version index for ${projectName}: ${err.message}`);
    return [];
  }
}

function writeVersionsIndex(projectName, versions) {
  const dir = getVersionsDir(projectName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    getVersionsIndexPath(projectName),
    JSON.stringify({ versions }, null, 2),
    'utf8'
  );
}

/**
 * Create a version snapshot of the current project file.
 *
 * @param {string} projectName
 * @param {object} [options]
 * @param {string} [options.label] Short human-readable label
 * @param {string} [options.description]
 */
function createVersion(projectName, options = {}) {
  const projectFile = getProjectFilePath(projectName);
  if (!fs.existsSync(projectFile)) {
    throw new Error(`Project "${projectName}" not found`);
  }

  const versionsDir = getVersionsDir(projectName);
  fs.mkdirSync(versionsDir, { recursive: true });

  const created = new Date().toISOString();
  const id = 'ver_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const file = `${created.replace(/[:.]/g, '-')}__${id}${PROJECT_FILE_EXT}`;
  const versionPath = path.join(versionsDir, file);

  fs.copyFileSync(projectFile, versionPath);

  const versions = readVersionsIndex(projectName);
  const entry = {
    id,
    label: options.label || 'Snapshot',
    description: options.description || '',
    created,
    size: fs.statSync(versionPath).size,
    file,
  };
  versions.unshift(entry);

  // Trim old snapshots.
  if (versions.length > MAX_VERSIONS) {
    versions.slice(MAX_VERSIONS).forEach((old) => {
      const oldPath = path.join(versionsDir, old.file);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    });
    versions.length = MAX_VERSIONS;
  }

  writeVersionsIndex(projectName, versions);
  log.info(`Created version ${id} for ${projectName}`);
  return entry;
}

/**
 * List version snapshots, newest first.
 */
function listVersions(projectName) {
  const versionsDir = getVersionsDir(projectName);
  if (!fs.existsSync(versionsDir)) return [];

  return readVersionsIndex(projectName).filter((entry) =>
    fs.existsSync(path.join(versionsDir, entry.file))
  );
}

/**
 * Restore a version snapshot. Creates a safety snapshot of the current state
 * before overwriting the project file.
 */
function restoreVersion(projectName, versionId) {
  const versionsDir = getVersionsDir(projectName);
  const version = readVersionsIndex(projectName).find((v) => v.id === versionId);

  if (!version) {
    throw new Error(`Version ${versionId} not found`);
  }

  const versionPath = path.join(versionsDir, version.file);
  if (!fs.existsSync(versionPath)) {
    throw new Error(`Version file for ${versionId} is missing`);
  }

  const projectFile = getProjectFilePath(projectName);
  if (fs.existsSync(projectFile)) {
    createVersion(projectName, {
      label: 'Before restore',
      description: `Automatic snapshot before restoring ${versionId}`,
    });
  }

  fs.copyFileSync(versionPath, projectFile);
  log.info(`Restored version ${versionId} for ${projectName}`);
  return loadProject(projectName);
}

/**
 * Delete a version snapshot.
 */
function deleteVersion(projectName, versionId) {
  const versionsDir = getVersionsDir(projectName);
  const versions = readVersionsIndex(projectName);
  const index = versions.findIndex((v) => v.id === versionId);

  if (index === -1) {
    throw new Error(`Version ${versionId} not found`);
  }

  const versionPath = path.join(versionsDir, versions[index].file);
  if (fs.existsSync(versionPath)) fs.unlinkSync(versionPath);
  versions.splice(index, 1);
  writeVersionsIndex(projectName, versions);
  return true;
}

// --- ZIP export / import / sharing ---

function addDirectoryToZip(zip, dirPath, zipPath) {
  if (!fs.existsSync(dirPath)) return;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  if (entries.length === 0) return;

  zip.addLocalFolder(dirPath, zipPath);
}

/**
 * Export a project as a ZIP archive. Passing a `.rlzip` output path produces a
 * shareable ResolveLink archive.
 *
 * @param {string} projectName
 * @param {string} [outputPath]
 * @param {object} [options]
 * @param {boolean} [options.forSharing] Omit temp/backups/versions
 * @param {boolean} [options.includeTemp]
 * @param {boolean} [options.includeBackups]
 * @param {boolean} [options.includeVersions]
 */
function exportProject(projectName, outputPath, options = {}) {
  const project = loadProject(projectName);
  const projectDir = getProjectDir(project.name);
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();

  const isShare = options.forSharing || String(outputPath || '').endsWith(SHARE_FILE_EXT);
  const finalPath = outputPath || path.join(
    PROJECTS_ROOT,
    `${project.sanitizedName || sanitizeProjectName(project.name)}_${Date.now()}${isShare ? SHARE_FILE_EXT : '.zip'}`
  );

  // Add the project file and README at the archive root.
  const projectFile = getProjectFilePath(project.name);
  const projectEntryName = `${sanitizeProjectName(project.name)}${PROJECT_FILE_EXT}`;
  zip.addLocalFile(projectFile, '', projectEntryName);

  const readmePath = path.join(projectDir, 'README.md');
  if (fs.existsSync(readmePath)) {
    zip.addLocalFile(readmePath, '', 'README.md');
  }

  const dirsToInclude = ['exports', 'renders', 'scripts', 'assets'];
  if (options.includeTemp) dirsToInclude.push('temp');
  if (options.includeBackups) dirsToInclude.push('backups');
  if (options.includeVersions) dirsToInclude.push('versions');

  dirsToInclude.forEach((dir) => {
    addDirectoryToZip(zip, path.join(projectDir, dir), dir);
  });

  // A small manifest makes shared archives self-describing.
  if (isShare) {
    zip.addFile('resolvelink-share.json', Buffer.from(JSON.stringify({
      format: 'resolvelink-project',
      version: 1,
      project: {
        name: project.name,
        id: project.id,
        template: project.template || 'blank',
        created: project.created,
        modified: project.modified,
      },
      sharedAt: new Date().toISOString(),
    }, null, 2), 'utf8'));
  }

  fs.mkdirSync(path.dirname(path.resolve(finalPath)), { recursive: true });
  zip.writeZip(finalPath);
  log.info(`Exported project to: ${finalPath}`);
  return finalPath;
}

/**
 * Create a shareable `.rlzip` archive (no temp files, backups or versions).
 */
function createShareArchive(projectName, outputPath) {
  const resolved = outputPath || path.join(
    PROJECTS_ROOT,
    `${sanitizeProjectName(projectName)}_${Date.now()}${SHARE_FILE_EXT}`
  );
  return exportProject(projectName, resolved, { forSharing: true });
}

function isSafeZipEntry(entryName) {
  const normalized = entryName.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return false;
  }
  return !normalized.split('/').some((part) => part === '..');
}

/**
 * Import a project from a `.rlzip`/`.zip` archive.
 */
function importProject(archivePath, options = {}) {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  const AdmZip = require('adm-zip');
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();

  // Reject archives containing absolute paths or traversal segments.
  const unsafe = entries.find((entry) => !isSafeZipEntry(entry.entryName));
  if (unsafe) {
    throw new Error(`Archive contains an unsafe path: ${unsafe.entryName}`);
  }

  const projectEntry = entries.find(
    (entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith(PROJECT_FILE_EXT)
  );

  if (!projectEntry) {
    throw new Error(`No project file (${PROJECT_FILE_EXT}) found in archive`);
  }

  let projectData;
  try {
    projectData = JSON.parse(projectEntry.getData().toString('utf8'));
  } catch {
    throw new Error('Project file in archive is not valid JSON');
  }

  if (!projectData.name || typeof projectData.name !== 'string') {
    throw new Error('Project file in archive has no valid name');
  }

  // If the archive wraps everything in a top-level folder, strip that prefix.
  const normalizedEntry = projectEntry.entryName.replace(/\\/g, '/');
  const slash = normalizedEntry.lastIndexOf('/');
  const rootPrefix = slash >= 0 ? normalizedEntry.slice(0, slash + 1) : '';

  if (fs.existsSync(getProjectFilePath(projectData.name)) && !options.overwrite) {
    throw new Error(`Project "${projectData.name}" already exists`);
  }

  const projectDir = getProjectDir(projectData.name);
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  fs.mkdirSync(projectDir, { recursive: true });

  for (const entry of entries) {
    let entryName = entry.entryName.replace(/\\/g, '/');
    if (rootPrefix && entryName.startsWith(rootPrefix)) {
      entryName = entryName.slice(rootPrefix.length);
    }
    if (!entryName || entryName === 'resolvelink-share.json') continue;

    // Always store the project file under its sanitized canonical name.
    if (entry === projectEntry) {
      const canonicalPath = getProjectFilePath(projectData.name);
      fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
      projectData.sanitizedName = sanitizeProjectName(projectData.name);
      fs.writeFileSync(canonicalPath, JSON.stringify(projectData, null, 2), 'utf8');
      continue;
    }

    const destination = path.join(projectDir, entryName);
    // Defense in depth: ensure the resolved path stays inside the project dir.
    if (!path.resolve(destination).startsWith(path.resolve(projectDir) + path.sep)) {
      throw new Error(`Archive contains an unsafe path: ${entry.entryName}`);
    }

    if (entry.isDirectory) {
      fs.mkdirSync(destination, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, entry.getData());
    }
  }

  ensureProjectSubdirs(projectDir);
  log.info(`Imported project: ${projectData.name}`);
  return loadProject(projectData.name);
}

module.exports = {
  PROJECTS_ROOT,
  PROJECT_FILE_EXT,
  SHARE_FILE_EXT,
  PROJECT_TEMPLATES,
  getProjectsRoot,
  ensureProjectsDir,
  listTemplates,
  getTemplate,
  createProject,
  loadProject,
  saveProject,
  deleteProject,
  listProjects,
  addLinkToProject,
  updateLinkInProject,
  removeLinkFromProject,
  addTimelineToProject,
  addRenderToProject,
  updateRenderStatus,
  createBackup,
  createVersion,
  listVersions,
  restoreVersion,
  deleteVersion,
  exportProject,
  createShareArchive,
  importProject,
  getProjectDir,
  getProjectFilePath,
  generateProjectId,
  sanitizeProjectName,
};
