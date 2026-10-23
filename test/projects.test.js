import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';

let pm;
let root;
let server;
let base;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolvelink-projects-'));
  process.env.RESOLVELINK_PROJECTS_DIR = root;
  const mod = await import('../packages/server/src/services/project-manager.js');
  pm = mod.default || mod;

  // Mount the router on a throwaway Express app to exercise route wiring,
  // validation and nested :params.
  const express = (await import('express')).default;
  const router = (await import('../packages/server/src/routes/projects.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/projects', router);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/projects`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  delete process.env.RESOLVELINK_PROJECTS_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

async function call(method, route, body) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

describe('project templates', () => {
  it('lists the built-in templates', () => {
    const ids = pm.listTemplates().map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['blank', 'vfx-shot', 'audio-post', 'color-grade']));
  });

  it('creates a project from the VFX template', () => {
    const project = pm.createProject('VFX Shot 010', {
      template: 'vfx-shot',
      description: 'Explosion shot',
    });

    expect(project.template).toBe('vfx-shot');
    expect(project.metadata.tags).toContain('vfx');
    expect(project.settings.exportFormat).toBe('exr');
    expect(project.settings.description).toBeUndefined();

    const dir = pm.getProjectDir('VFX Shot 010');
    expect(fs.existsSync(path.join(dir, 'assets', 'plates'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'scripts', 'comps'))).toBe(true);
    expect(fs.existsSync(pm.getProjectFilePath('VFX Shot 010'))).toBe(true);

    // README must contain its content, not its own path.
    const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('VFX Shot');
  });

  it('creates audio-post and color-grade projects', () => {
    expect(pm.createProject('Episode 12 Audio', { template: 'audio-post' }).settings.stemExport).toBe(true);
    expect(pm.createProject('Reel Grade', { template: 'color-grade' }).metadata.tags).toContain('color');
  });

  it('rejects unknown templates', () => {
    expect(() => pm.createProject('Bad Template', { template: 'nope' })).toThrow(/Unknown project template/);
  });
});

describe('project CRUD and versions', () => {
  it('adds links and timestamps updates', () => {
    pm.createProject('CRUD Project');
    const link = pm.addLinkToProject('CRUD Project', {
      name: 'Main Comp',
      target: 'ae',
      clips: [{ name: 'clip.mov' }],
    });

    expect(link.id).toBeTruthy();
    expect(pm.loadProject('CRUD Project').links).toHaveLength(1);

    const updated = pm.updateLinkInProject('CRUD Project', link.id, { status: 'rendered' });
    expect(updated.status).toBe('rendered');

    pm.removeLinkFromProject('CRUD Project', link.id);
    expect(pm.loadProject('CRUD Project').links).toHaveLength(0);
  });

  it('creates, lists, restores and deletes versions', () => {
    pm.createProject('Versioned Project');
    const version = pm.createVersion('Versioned Project', { label: 'First cut' });

    expect(pm.listVersions('Versioned Project')).toHaveLength(1);
    expect(version.label).toBe('First cut');

    const project = pm.loadProject('Versioned Project');
    project.description = 'Changed after snapshot';
    pm.saveProject(project);

    const restored = pm.restoreVersion('Versioned Project', version.id);
    expect(restored.description).not.toBe('Changed after snapshot');

    // Restoring snapshots the pre-restore state too.
    expect(pm.listVersions('Versioned Project').length).toBeGreaterThanOrEqual(2);

    pm.deleteVersion('Versioned Project', version.id);
    expect(pm.listVersions('Versioned Project').find((v) => v.id === version.id)).toBeUndefined();
  });

  it('creates backups and prunes old ones', () => {
    pm.createProject('Backup Project');
    for (let i = 0; i < 12; i += 1) {
      pm.createBackup('Backup Project');
    }

    const backupsDir = path.join(pm.getProjectDir('Backup Project'), 'backups');
    const backups = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.rlp'));
    expect(backups.length).toBeLessThanOrEqual(10);
    expect(backups.length).toBeGreaterThan(0);
  });

  it('can re-create a project after a non-force delete', () => {
    pm.createProject('Recreated Project');
    pm.deleteProject('Recreated Project');
    expect(pm.loadProject.bind(pm, 'Recreated Project')).toThrow(/not found/);

    const recreated = pm.createProject('Recreated Project');
    expect(recreated.name).toBe('Recreated Project');
  });
});

describe('project ZIP import/export and sharing', () => {
  it('round-trips a project through a .rlzip archive', () => {
    pm.createProject('Shared Project', { template: 'color-grade' });
    pm.addTimelineToProject('Shared Project', { name: 'Grade Timeline', fps: 25 });

    const outputPath = path.join(root, 'shared-export.rlzip');
    const archivePath = pm.createShareArchive('Shared Project', outputPath);

    expect(fs.existsSync(archivePath)).toBe(true);
    const entries = new AdmZip(archivePath).getEntries().map((e) => e.entryName);
    expect(entries).toContain('Shared_Project.rlp');
    expect(entries).toContain('resolvelink-share.json');
    expect(entries.some((name) => name.startsWith('backups/'))).toBe(false);

    pm.deleteProject('Shared Project', { force: true });
    const imported = pm.importProject(archivePath);
    expect(imported.name).toBe('Shared Project');
    expect(imported.template).toBe('color-grade');
    expect(pm.loadProject('Shared Project').timelines).toHaveLength(1);
  });

  it('refuses to overwrite without the overwrite flag', () => {
    pm.createProject('Overwrite Target');
    const archivePath = pm.createShareArchive('Overwrite Target', path.join(root, 'overwrite.rlzip'));

    expect(() => pm.importProject(archivePath)).toThrow(/already exists/);
    const imported = pm.importProject(archivePath, { overwrite: true });
    expect(imported.name).toBe('Overwrite Target');
  });

  it('rejects archives with path traversal', () => {
    const evilPath = path.join(root, 'evil.zip');
    const zip = new AdmZip();
    zip.addFile('evil.rlp', Buffer.from(JSON.stringify({ name: 'Evil' })));
    zip.addFile('safe.txt', Buffer.from('nope'));
    const malicious = zip.getEntries().find((e) => e.entryName === 'safe.txt');
    malicious.entryName = '../escaped.txt';
    zip.writeZip(evilPath);

    expect(() => pm.importProject(evilPath)).toThrow(/unsafe path/);
    expect(fs.existsSync(path.join(root, 'escaped.txt'))).toBe(false);
  });
});

describe('project HTTP routes', () => {
  it('serves templates and creates a project from a template', async () => {
    const templates = await call('GET', '/templates');
    expect(templates.status).toBe(200);
    expect(templates.data.templates.map((t) => t.id)).toContain('vfx-shot');

    const created = await call('POST', '/', {
      name: 'Route Project',
      template: 'audio-post',
    });
    expect(created.status).toBe(201);
    expect(created.data.template).toBe('audio-post');
  });

  it('keeps nested route params when validating :name', async () => {
    const version = await call('POST', '/Route%20Project/versions', { label: 'v1' });
    expect(version.status).toBe(201);

    const restored = await call(
      'POST',
      `/Route%20Project/versions/${version.data.id}/restore`
    );
    expect(restored.status).toBe(200);
    expect(restored.data.project.name).toBe('Route Project');

    const deleted = await call('DELETE', `/Route%20Project/versions/${version.data.id}`);
    expect(deleted.status).toBe(200);

    const link = await call('POST', '/Route%20Project/links', { name: 'Main' });
    expect(link.status).toBe(201);

    const updated = await call('PUT', `/Route%20Project/links/${link.data.id}`, {
      status: 'rendered',
    });
    expect(updated.status).toBe(200);
    expect(updated.data.status).toBe('rendered');

    const removed = await call('DELETE', `/Route%20Project/links/${link.data.id}`);
    expect(removed.status).toBe(200);
  });

  it('exports, deletes and re-imports through the API', async () => {
    const archivePath = path.join(root, 'route-export.rlzip');
    const shared = await call('POST', '/Route%20Project/share', { outputPath: archivePath });
    expect(shared.status).toBe(200);
    expect(fs.existsSync(shared.data.archivePath)).toBe(true);

    const deleted = await call('DELETE', '/Route%20Project?force=true');
    expect(deleted.status).toBe(200);

    const imported = await call('POST', '/import', {
      archivePath,
      overwrite: true,
    });
    expect(imported.status).toBe(200);
    expect(imported.data.project.name).toBe('Route Project');
  });
});
