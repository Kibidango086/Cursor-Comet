import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Injection logic for Cursor Comet.
 * Patches VS Code's workbench.html to inject the comet cursor script.
 */

const EXT_MARKER_START = '<!-- !! CURSOR-COMET-START !! -->';
const EXT_MARKER_END = '<!-- !! CURSOR-COMET-END !! -->';
const SESSION_MARKER = '<!-- !! CURSOR-COMET-SESSION {{UUID}} !! -->';

export interface WorkbenchLoc {
  dir: string;
  htmlPath: string;
}

/**
 * Build a list of candidate workbench.html paths from an app root.
 */
function buildCandidates(appRoot: string): Array<{ dir: string; files: string[] }> {
  const htmlFiles = [
    'workbench.esm.html',
    'workbench.html',
    'workbench-dev.html',
    'workbench-apc-extension.html',
  ];
  const subPaths = [
    'resources/app/out/vs/code/electron-browser/workbench',
    'resources/app/out/vs/code/electron-browser',
    'resources/app/out/vs/code/electron-sandbox/workbench',
    'resources/app/out/vs/code/electron-sandbox',
    'out/vs/code/electron-browser/workbench',
    'out/vs/code/electron-browser',
    'out/vs/code/electron-sandbox/workbench',
    'out/vs/code/electron-sandbox',
    'vs/code/electron-browser/workbench',
    'vs/code/electron-browser',
    'vs/code/electron-sandbox/workbench',
    'vs/code/electron-sandbox',
  ];
  return subPaths.map(sp => ({
    dir: path.join(appRoot, sp),
    files: htmlFiles,
  }));
}

/**
 * Locate the workbench HTML file in VS Code's installation directory.
 * Uses vscode.env.appRoot for the most reliable path resolution.
 */
export function locateWorkbench(): WorkbenchLoc | null {
  // Primary: use vscode.env.appRoot (VS Code API — most reliable)
  const appRoot = vscode.env.appRoot;
  if (appRoot) {
    for (const c of buildCandidates(appRoot)) {
      for (const f of c.files) {
        const htmlPath = path.join(c.dir, f);
        if (fs.existsSync(htmlPath)) {
          return { dir: c.dir, htmlPath };
        }
      }
    }
  }

  // Fallback: try require.main.filename and walk up to find app root
  const mainFile = require.main ? require.main.filename : undefined;
  if (mainFile) {
    let dir = path.dirname(mainFile);
    for (let i = 0; i < 15; i++) {
      for (const c of buildCandidates(dir)) {
        for (const f of c.files) {
          const htmlPath = path.join(c.dir, f);
          if (fs.existsSync(htmlPath)) {
            return { dir: c.dir, htmlPath };
          }
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // Last resort: _VSCODE_FILE_ROOT (web/remote envs)
  const fileRoot = (globalThis as any)._VSCODE_FILE_ROOT;
  if (fileRoot) {
    for (const c of buildCandidates(fileRoot)) {
      for (const f of c.files) {
        const htmlPath = path.join(c.dir, f);
        if (fs.existsSync(htmlPath)) {
          return { dir: c.dir, htmlPath };
        }
      }
    }
  }

  vscode.window.showErrorMessage(
    'Cursor Comet: Could not find workbench.html. Unsupported VS Code version?'
  );
  return null;
}

/**
 * Read the current content of workbench.html.
 */
function readWorkbench(htmlPath: string): string {
  return fs.readFileSync(htmlPath, 'utf-8');
}

/**
 * Write content to workbench.html.
 */
function writeWorkbench(htmlPath: string, content: string): void {
  fs.writeFileSync(htmlPath, content, 'utf-8');
}

/**
 * Clear any existing Cursor Comet patches from the HTML.
 */
function clearPatches(html: string): string {
  html = html.replace(
    new RegExp(`${EXT_MARKER_START}[\\s\\S]*?${EXT_MARKER_END}\\n*`, 'g'),
    ''
  );
  html = html.replace(/<!-- !! CURSOR-COMET-SESSION [\w-]+ !! -->\n*/g, '');
  return html;
}

/**
 * Remove CSP meta tag that blocks inline scripts.
 */
function removeCSP(html: string): string {
  return html.replace(
    /<meta\s+http-equiv="Content-Security-Policy"[^>]*\/?>/i,
    ''
  );
}

/**
 * Find the most recent backup UUID.
 */
function findBackupUuid(workbenchDir: string): string | null {
  try {
    const items = fs.readdirSync(workbenchDir);
    for (const item of items) {
      const m = item.match(/^workbench\.([\w-]+)\.bak-comet$/);
      if (m) return m[1];
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Patch workbench.html to inject the comet cursor script.
 * The script content is inlined directly into the HTML.
 */
export function installScript(scriptContent: string): boolean {
  const loc = locateWorkbench();
  if (!loc) return false;

  try {
    let html = readWorkbench(loc.htmlPath);
    html = clearPatches(html);
    html = removeCSP(html);

    // Generate UUID for this session (used for backup tracking)
    const uuid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create backup of original file
    const backupPath = path.join(loc.dir, `workbench.${uuid}.bak-comet`);
    fs.copyFileSync(loc.htmlPath, backupPath);

    const sessionMarker = SESSION_MARKER.replace('{{UUID}}', uuid);

    // Inject script block right before </head>
    const injectBlock =
      `${EXT_MARKER_START}\n` +
      `${sessionMarker}\n` +
      `<script>${scriptContent}</script>\n` +
      `${EXT_MARKER_END}`;

    html = html.replace('</head>', injectBlock + '\n</head>');

    writeWorkbench(loc.htmlPath, html);

    // Update product.json checksum so the integrity check passes
    // (no "corrupted installation" warning on next startup)
    try { updateProductChecksum(loc.htmlPath, html); } catch {}

    return true;
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Cursor Comet: Failed to install — ${e.message}. Try running VS Code with admin/sudo permissions.`
    );
    return false;
  }
}

/**
 * Uninstall: clear patches and clean up backups.
 */
export function uninstallScript(): boolean {
  const loc = locateWorkbench();
  if (!loc) return false;

  try {
    let html = readWorkbench(loc.htmlPath);

    if (!html.includes(EXT_MARKER_START)) {
      // No patch found — try restoring from backup
      const uuid = findBackupUuid(loc.dir);
      if (uuid) {
        const backupPath = path.join(loc.dir, `workbench.${uuid}.bak-comet`);
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, loc.htmlPath);
        }
      }
      cleanupBackups(loc.dir);
      return false; // wasn't installed
    }

    // Remove patches
    html = clearPatches(html);
    writeWorkbench(loc.htmlPath, html);

    // Clean up backup files
    cleanupBackups(loc.dir);
    return true;
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Cursor Comet: Failed to uninstall — ${e.message}`
    );
    return false;
  }
}

/**
 * Remove all .bak-comet backup files from the workbench directory.
 */
function cleanupBackups(dir: string): void {
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      if (item.endsWith('.bak-comet')) {
        fs.unlinkSync(path.join(dir, item));
      }
    }
  } catch { /* ignore */ }
}

/**
 * Update the checksum in product.json so the integrity check passes.
 * This prevents the "corrupted installation" warning on next startup.
 */
function updateProductChecksum(workbenchPath: string, newContent: string): void {
  const appRoot = vscode.env.appRoot;
  if (!appRoot) return;

  // Try multiple product.json locations
  const candidates = [
    path.join(appRoot, 'resources', 'app', 'product.json'),
    path.join(appRoot, 'product.json'),
  ];

  // Compute the relative key path used in product.json checksums
  // The key is relative to the app root: e.g. "out/vs/code/electron-browser/workbench/workbench.html"
  const relPath = path.relative(appRoot, workbenchPath).replace(/\\/g, '/');

  for (const productPath of candidates) {
    if (!fs.existsSync(productPath)) continue;

    const raw = fs.readFileSync(productPath, 'utf-8');
    const product = JSON.parse(raw);
    if (!product.checksums || typeof product.checksums !== 'object') continue;

    // Check if our file is tracked in checksums
    const keys = Object.keys(product.checksums);
    const matchedKey = keys.find(k => k.endsWith(path.basename(workbenchPath)));

    if (matchedKey) {
      // Recalculate SHA-256 with the NEW (patched) content
      const hash = crypto.createHash('sha256').update(newContent, 'utf-8').digest('hex');
      product.checksums[matchedKey] = hash;
      fs.writeFileSync(productPath, JSON.stringify(product, null, '\t'), 'utf-8');
    }
    return; // Found product.json, done
  }
}

/**
 * Check if Cursor Comet is currently installed (patched).
 */
export function isInstalled(): boolean {
  const loc = locateWorkbench();
  if (!loc) return false;
  try {
    const html = readWorkbench(loc.htmlPath);
    return html.includes(EXT_MARKER_START);
  } catch {
    return false;
  }
}

/**
 * Restore original workbench.html from backup — no questions asked.
 * Call this to fix the "corrupted installation" warning.
 * Returns true if a backup was found and restored.
 */
export function restoreOriginal(): boolean {
  const loc = locateWorkbench();
  if (!loc) return false;

  // First try: find any .bak-comet file
  const uuid = findBackupUuid(loc.dir);
  if (uuid) {
    const backupPath = path.join(loc.dir, `workbench.${uuid}.bak-comet`);
    if (fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, loc.htmlPath);
        cleanupBackups(loc.dir);
        return true;
      } catch { /* ignore */ }
    }
  }

  // Second try: clear patches in-place (no backup needed)
  try {
    let html = readWorkbench(loc.htmlPath);
    if (html.includes(EXT_MARKER_START)) {
      html = clearPatches(html);
      writeWorkbench(loc.htmlPath, html);
      cleanupBackups(loc.dir);
      return true;
    }
  } catch { /* ignore */ }

  return false;
}
