import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Auto-fix permissions for VS Code's installation directory.
 * Uses platform-native auth dialogs (PolicyKit, macOS auth dialog).
 */

const PLATFORM = process.platform;

export function platformSupportsAutoFix(): boolean {
  return PLATFORM === 'linux' || PLATFORM === 'darwin' || PLATFORM === 'win32';
}

/**
 * Resolve the real VS Code app root (follow symlinks).
 */
function resolveAppRoot(): string | null {
  const appRoot = vscode.env.appRoot;
  if (!appRoot) return null;
  try {
    return fs.realpathSync(appRoot);
  } catch {
    return appRoot;
  }
}

/**
 * Run a command and return whether it succeeded.
 */
function run(cmd: string, timeout = 120000): Promise<boolean> {
  return new Promise(resolve => {
    exec(cmd, { timeout }, err => resolve(!err));
  });
}

/**
 * Linux: try pkexec (PolicyKit GUI dialog).
 * Falls back: xterm sudo, then manual instructions.
 */
async function fixLinux(): Promise<boolean> {
  const appRoot = resolveAppRoot();
  if (!appRoot) return false;

  // Method 1: pkexec — GUI password dialog (KDE/GNOME)
  const ok = await run(
    `pkexec chown -R $(whoami) "${appRoot}" 2>/dev/null`
  );
  if (ok) return true;

  // Method 2: try parent directory (some VS Code installs are inside /usr/share)
  const parent = path.dirname(appRoot);
  if (parent !== appRoot) {
    const ok2 = await run(
      `pkexec chown -R $(whoami) "${parent}" 2>/dev/null`
    );
    if (ok2) return true;
  }

  return false;
}

/**
 * macOS: Use osascript to show native auth dialog.
 */
async function fixMac(): Promise<boolean> {
  const appRoot = resolveAppRoot();
  if (!appRoot) return false;

  const escaped = appRoot.replace(/"/g, '\\"');
  return run(
    `osascript -e 'do shell script "chown -R $(whoami) \\"${escaped}\\"" with administrator privileges' 2>/dev/null`
  );
}

/**
 * Windows: check if running as admin, show info if not.
 */
async function fixWindows(): Promise<boolean> {
  // Try to write a test file to see if we have permissions
  const appRoot = resolveAppRoot();
  if (!appRoot) return false;

  const testFile = path.join(appRoot, '.comet-perm-test');
  try {
    fs.writeFileSync(testFile, 'test', 'utf-8');
    fs.unlinkSync(testFile);
    return true; // already have permissions
  } catch {
    return false; // need admin
  }
}

/**
 * Auto-fix permissions for the current platform.
 * Shows a system authentication dialog (PolicyKit on Linux, macOS auth dialog).
 */
export async function autoFixPermissions(): Promise<boolean> {
  switch (PLATFORM) {
    case 'linux':
      return fixLinux();
    case 'darwin':
      return fixMac();
    case 'win32':
      return fixWindows();
    default:
      return false;
  }
}
