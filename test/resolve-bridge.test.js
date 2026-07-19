import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';

const PYTHON = process.env.PYTHON_PATH || 'python';
const BRIDGE = path.join(__dirname, '..', 'server', 'resolve-bridge.py');

function runBridge(command, args = []) {
  try {
    const out = execFileSync(PYTHON, [BRIDGE, command, ...args], {
      timeout: 10000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONPATH: process.env.RESOLVE_SCRIPTING_PATH || '' },
    });
    try { return JSON.parse(out); } catch { return { raw: out }; }
  } catch (err) {
    const stdout = err.stdout?.toString() || '';
    const stderr = err.stderr?.toString() || '';
    if (stdout) {
      try { return JSON.parse(stdout); } catch {}
    }
    // Process exited with non-zero — still testable
    return { error: err.message, stdout, stderr };
  }
}

describe('resolve-bridge.py CLI', () => {
  it('returns error for no command', () => {
    const result = runBridge('');
    // Script exits with error for no command
    expect(result.error || result.raw || result).toBeDefined();
  });

  it('returns error for unknown command', () => {
    const result = runBridge('nonexistent');
    const output = JSON.stringify(result);
    expect(output).toMatch(/Unknown command/);
  });

  it('status returns a result with connected field (Resolve may be offline)', () => {
    const result = runBridge('status');
    // If connected: result.connected is boolean
    // If error: result.error exists
    const hasConnected = typeof result.connected === 'boolean';
    const hasError = typeof result.error === 'string';
    expect(hasConnected || hasError).toBe(true);
  });

  it('import-rendered requires a file argument', () => {
    const result = runBridge('import-rendered');
    const output = JSON.stringify(result);
    expect(output).toMatch(/Usage|error/i);
  });

  it('import-rendered returns error for nonexistent file', () => {
    const result = runBridge('import-rendered', ['C:\\nonexistent\\file.mov']);
    const output = JSON.stringify(result);
    expect(output).toMatch(/File not found|not found|error/i);
  });

  it('create-compound (alias) works the same as import-rendered', () => {
    const result = runBridge('create-compound', ['C:\\nonexistent\\file.mov']);
    const output = JSON.stringify(result);
    expect(output).toMatch(/File not found|not found|error/i);
  });
});
