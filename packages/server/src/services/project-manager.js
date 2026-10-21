/**
 * ResolveLink Project Manager
 * Handles project file (.rl) creation, loading, and management.
 * Projects are stored in ~/Documents/ResolveLink/ProjectName/ProjectName.rl
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../logger');

const log = createLogger('ProjectManager');

// Get the ResolveLink projects directory in Documents
function getProjectsRoot() {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  if (process.platform === 'win32') {
    return path.join(process.env.USERPROFILE, 'Documents', 'ResolveLink');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Documents', 'ResolveLink');
  } else {
    return path.join(home, 'Documents', 'ResolveLink');
  }
}

const PROJECTS_ROOT = getProjectsRoot();
const PROJECT_FILE_EXT = '.rlp';

/**
 * Project file structure:
 * {
 *   version: "1.0",
 *   name: "ProjectName",
 *   created: "2024-01-15T10:30:00Z",
 *   modified: "2024-01-15T10:30:00Z",
 *   description: "Optional description",
 *   settings: {
 *     exportDir: "./exports",
 *     tempDir: "./temp",
 *     serverPort: 3030,
 *     serverHost: "127.0.0.1",
 *     autoImport: true,
 *     stemExport: false,
 *   },
 *   links: [
 *     {
 *       id: "uuid",
 *       name: "Link Name",
 *       target: "ae" | "reaper" | "ableton",
 *       status: "created" | "sent" | "rendering" | "completed" | "error",
 *       clips: [...],
 *       settings: {...},
 *       createdAt: "2024-01-15T10:30:00Z",
 *       updatedAt: "2024-01-15T10:30:00Z",
 *       exportPath: "./exports/render_123.mov",
 *       markers: [...],
 *       timelineName: "Timeline 1",
 *     }
 *   ],
 *   timelines: [
 *     {
 *       id: "uuid",
 *       name: "Timeline 1",
 *       projectName: "ProjectName",
 *       fps: 24,
 *       resolution: { width: 1920, height: 1080 },
 *       clips: [...],
 *       markers: [...],
 *       createdAt: "2024-01-15T10:30:00Z",
 *     }
 *   ],
 *   renders: [
 *     {
 *       id: "uuid",
 *       linkId: "uuid",
 *       status: "pending" | "rendering" | "completed" | "failed",
 *       outputPath: "./exports/render_123.mov",
 *       startedAt: "2024-01-15T10:30:00Z",
 *       completedAt: "2024-01-15T10:35:00Z",
 *       settings: {...}
 *     }
 *   ],
 *   metadata: {
 *     tags: ["vfx", "color-grade"],
 *     notes: "Project notes...",
 *     collaborators: []
 *   }
 * }
 */

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
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
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

/**
 * Create a new project
 */
function createProject(name, options = {}) {
  ensureProjectsDir();
  
  const sanitized = sanitizeProjectName(name);
  const projectDir = getProjectDir(name);
  const projectFile = getProjectFilePath(name);
  
  if (fs.existsSync(projectDir)) {
    throw new Error(`Project "${name}" already exists`);
  }
  
  // Create project directory
  fs.mkdirSync(projectDir, { recursive: true });
  
  // Create subdirectories
  const subdirs = ['exports', 'temp', 'renders', 'scripts', 'assets', 'backups'];
  subdirs.forEach(dir => {
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  }
  
  const now = new Date().toISOString();
  const projectId = generateProjectId();
  
  const projectData = {
    version: "1.0",
    id: projectId,
    name: name,
    sanitizedName: sanitized,
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
      serverPort: options.serverPort || 3030,
      serverHost: options.serverHost || '127.0.0.1',
      autoImport: options.autoImport !== false,
      stemExport: options.stemExport || false,
      ...options.settings
    },
    links: [],
    timelines: [],
    renders: [],
    metadata: {
      tags: options.tags || [],
      notes: options.notes || '',
      collaborators: options.collaborators || [],
      ...options.metadata
    }
  };
  
  // Write project file
  fs.writeFileSync(projectFile, JSON.stringify(projectData, null, 2), 'utf8');
  
  // Create a default README
  const readmePath = path.join(projectDir, 'README.md');
  const readmeContent = `# ${name}\n\nResolveLink Project\n\nCreated: ${now}\n\n## Description\n${options.description || 'No description provided.'}\n\n## Structure\n\`\`\n${sanitized}/\n├── ${name}.rl          # Project file\n├── exports/            # Rendered outputs\n├── temp/               # Temporary files\n├── renders/            # Render queue outputs\n├── scripts/            # Generated scripts\n├── assets/             # Imported assets\n└── backups/            # Automatic backups\n\`\`\`;
  fs.writeFileSync(readmePath, readmePath, 'utf8');
  
  log.info(`Created project: ${name} at ${projectDir}`);
  return projectData;
}

/**
 * Load an existing project
 */
function loadProject(projectName) {
  const projectFile = getProjectFilePath(projectName);
  
  if (!fs.existsSync(projectFile)) {
    throw new Error(`Project "${projectName}" not found`);
  }
  
  const content = fs.readFileSync(projectFile, 'utf8');
  const projectData = JSON.parse(content);
  
  // Ensure all subdirectories exist
  const projectDir = getProjectDir(projectData.name || projectName);
  const subdirs = ['exports', 'temp', 'renders', 'scripts', 'assets', 'backups'];
  subdirs.forEach(dir => {
    const dirPath = path.join(projectDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  
  log.info(`Loaded project: ${projectName}`);
  return projectData;
}

/**
 * Save project data
 */
function saveProject(projectData) {
  const projectFile = getProjectFilePath(projectData.name);
  
  // Update modified timestamp
  projectData.modified = new Date().toISOString();
  
  // Write atomically
  const tempFile = projectFile + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(projectData, null, 2), 'utf8');
  fs.renameSync(tempFile, projectFile);
  
  log.info(`Saved project: ${projectData.name}`);
  return true;
}

/**
 * Delete a project
 */
function deleteProject(projectName, options = {}) {
  const projectDir = getProjectDir(projectName);
  const projectFile = getProjectFilePath(projectName);
  
  if (!fs.existsSync(projectFile)) {
    throw new Error(`Project "${projectName}" not found`);
  }
  
  if (options.force) {
    // Remove entire directory
    fs.rmSync(projectDir, { recursive: true, force: true });
    log.info(`Deleted project: ${projectName}`);
  } else {
    // Just remove the .rl file, keep assets
    fs.unlinkSync(projectFile);
    log.info(`Removed project file: ${projectName} (assets preserved)`);
  }
  
  return true;
}

/**
 * List all projects
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
        sanitizedName: data.sanitizedName,
        created: data.created,
        modified: data.modified,
        description: data.description,
        tags: data.metadata?.tags || [],
        linkCount: data.links?.length || 0,
        timelineCount: data.timelines?.length || 0,
        renderCount: data.renders?.length || 0,
        path: getProjectDir(data.name)
      });
    } catch (e) {
      log.warn(`Failed to read project ${entry.name}: ${e.message}`);
    }
  }
  
  // Sort by modified date, newest first
  return projects.sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

/**
 * Add a link to a project
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
    ...linkData
  };
  
  project.links.push(link);
  saveProject(project);
  
  return link;
}

/**
 * Update a link in a project
 */
function updateLinkInProject(projectName, linkId, updates) {
  const project = loadProject(projectName);
  const linkIndex = project.links.findIndex(l => l.id === linkId);
  
  if (linkIndex === -1) {
    throw new Error(`Link ${linkId} not found in project ${projectName}`);
  }
  
  project.links[linkIndex] = {
    ...project.links[linkIndex],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  
  saveProject(project);
  return project.links[linkIndex];
}

/**
 * Remove a link from a project
 */
function removeLinkFromProject(projectName, linkId) {
  const project = loadProject(projectName);
  const linkIndex = project.links.findIndex(l => l.id === linkId);
  
  if (linkIndex === -1) {
    throw new Error(`Link ${linkId} not found in project ${projectName}`);
  }
  
  project.links.splice(linkIndex, 1);
  saveProject(project);
  return true;
}

/**
 * Add a timeline to a project
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
    ...timelineData
  };
  
  project.timelines.push(timeline);
  saveProject(project);
  
  return timeline;
}

/**
 * Add a render record to a project
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
    ...renderData
  };
  
  project.renders.push(render);
  saveProject(project);
  
  return render;
}

/**
 * Update render status
 */
function updateRenderStatus(projectName, renderId, status, outputPath = null) {
  const project = loadProject(projectName);
  const renderIndex = project.renders.findIndex(r => r.id === renderId);
  
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
 * Create a backup of the project
 */
function createBackup(projectName) {
  const project = loadProject(projectName);
  const projectDir = getProjectDir(projectName);
  const backupsDir = path.join(projectDir, 'backups');
  
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${project.name}_${timestamp}.rl`;
  const backupPath = path.join(backupsDir, backupName);
  
  const projectFile = getProjectFilePath(project.name);
  fs.copyFileSync(getProjectFilePath(project.name), backupPath);
  
  // Keep only last 10 backups
  const backups = fs.readdirSync(backupsDir)
    .filter(f => f.endsWith('.rlp'))
    .map(f => ({ name: f, time: fs.statSync(path.join(backupsDir, f)).mtime }))
    .sort((a, b) => b.time - a.time);
  
  if (backups.length > 10) {
    backups.slice(10).forEach(f => {
      fs.unlinkSync(path.join(backupsDir, f.name));
    });
  }
  
  log.info(`Created backup: ${backupName}`);
  return backupPath;
}

/**
 * Export project as archive
 */
function exportProject(projectName, outputPath) {
  const project = loadProject(projectName);
  const projectDir = getProjectDir(projectName);
  
  // Use a simple zip approach (could use archiver in production)
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  
  // Add project file
  const projectFile = getProjectFilePath(project.name);
  zip.addLocalFile(projectFile, '', project.name + '.rlp');
  
  // Add exports, renders, scripts, assets
  const dirsToInclude = ['exports', 'renders', 'scripts', 'assets'];
  dirsToInclude.forEach(dir => {
    const dirPath = path.join(projectDir, dir);
    if (fs.existsSync(dirPath)) {
      zip.addLocalFolder(dirPath, dir);
    }
  }
  
  zip.writeZip(outputPath);
  log.info(`Exported project to: ${outputPath}`);
  return outputPath;
}

/**
 * Import project from archive
 */
function importProject(archivePath, options = {}) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(archivePath);
  
  // Extract to temp location
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolvelink-import-'));
  zip.extractAllTo(tempDir, true);
  
  // Find the .rl file
  const entries = zip.getEntries();
  const rlEntry = entries.find(e => e.entryName.endsWith('.rlp'));
  
  if (!rlEntry) {
    throw new Error('No project file (.rl) found in archive');
  }
  
  const projectData = JSON.parse(rlEntry.getData().toString('utf8'));
  
  // Check if project already exists
  if (fs.existsSync(getProjectFilePath(projectData.name)) && !options.overwrite) {
    throw new Error(`Project "${projectData.name}" already exists`);
  }
  
  // Create project directory
  const projectDir = getProjectDir(projectData.name);
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  fs.mkdirSync(projectDir, { recursive: true });
  
  // Extract all files
  zip.extractAllTo(projectDir, true);
  
  log.info(`Imported project: ${projectData.name}`);
  return loadProject(projectData.name);
}

module.exports = {
  PROJECTS_ROOT,
  PROJECT_FILE_EXT,
  getProjectsRoot,
  ensureProjectsDir,
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
  exportProject,
  importProject,
  getProjectDir,
  getProjectFilePath,
  generateProjectId,
  sanitizeProjectName,
  PROJECTS_ROOT,
  PROJECT_FILE_EXT
};