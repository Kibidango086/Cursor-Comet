import * as vscode from 'vscode';
import { buildJS, CometConfig } from './cursorScript';
import { installScript, uninstallScript, isInstalled, restoreOriginal } from './inject';
import { autoFixPermissions, platformSupportsAutoFix } from './permissions';

let sb: vscode.StatusBarItem | undefined;

export function activate(ctx: vscode.ExtensionContext) {
  sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  sb.command = 'cursor-comet.toggle';
  ctx.subscriptions.push(sb);
  syncSB();

  // Auto-install on startup
  if (!isInstalled()) tryInstall(false);

  // Commands
  ctx.subscriptions.push(
    vscode.commands.registerCommand('cursor-comet.enable',    () => tryInstall(true)),
    vscode.commands.registerCommand('cursor-comet.disable',   () => doRemove()),
    vscode.commands.registerCommand('cursor-comet.reinstall', () => doReinstall()),
    vscode.commands.registerCommand('cursor-comet.repair',    () => doRepair()),
    vscode.commands.registerCommand('cursor-comet.toggle',    () =>
      isInstalled() ? doRemove() : tryInstall(true)
    ),
  );

  // Config change
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('cursorComet')) return;
      const on = vscode.workspace.getConfiguration('cursorComet').get<boolean>('enabled', true);
      if (on) tryInstall(false);
      else doRemove();
    })
  );
}

async function tryInstall(manual: boolean) {
  const cfg = getCfg();
  const js = buildJS(cfg);
  let ok = installScript(js);

  if (!ok && platformSupportsAutoFix()) {
    const msg = manual
      ? 'Cursor Comet needs permission. Authenticate to continue.'
      : 'Setting up Cursor Comet...';
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: msg },
      async () => { await autoFixPermissions(); }
    );
    await sleep(600);
    ok = installScript(js);
  }

  if (ok) {
    syncSB();
    const btn = await vscode.window.showInformationMessage(
      manual ? 'Cursor Comet enabled! Reload to apply.' : 'Cursor Comet ready! Reload to activate.',
      'Reload Now'
    );
    if (btn === 'Reload Now') vscode.commands.executeCommand('workbench.action.reloadWindow');
  } else {
    if (manual) {
      vscode.window.showErrorMessage(
        'Cursor Comet needs admin access. Run VS Code as Administrator / with sudo.'
      );
    }
    syncSB();
  }
}

async function doReinstall() {
  uninstallScript();
  await sleep(300);
  const cfg = getCfg();
  const js = buildJS(cfg);
  let ok = installScript(js);

  if (!ok && platformSupportsAutoFix()) {
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Reinstalling...' },
      async () => { await autoFixPermissions(); }
    );
    await sleep(600);
    ok = installScript(js);
  }

  syncSB();
  if (ok) {
    const btn = await vscode.window.showInformationMessage(
      'Cursor Comet reinstalled! Reload to apply.', 'Reload Now'
    );
    if (btn === 'Reload Now') vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

/** Repair corrupted installation by restoring original workbench.html */
async function doRepair() {
  const ok = restoreOriginal();
  if (ok) {
    const btn = await vscode.window.showInformationMessage(
      'Original workbench.html restored! Reload to fix the installation.',
      'Reload Now'
    );
    if (btn === 'Reload Now') vscode.commands.executeCommand('workbench.action.reloadWindow');
  } else {
    vscode.window.showErrorMessage(
      'No backup found. Try reinstalling VS Code, or click "Don\'t show again" on the corruption warning.'
    );
  }
  syncSB();
}

async function doRemove() {
  const ok = uninstallScript();
  syncSB();
  if (ok) {
    const btn = await vscode.window.showInformationMessage(
      'Cursor Comet disabled. Reload to apply.', 'Reload Now'
    );
    if (btn === 'Reload Now') vscode.commands.executeCommand('workbench.action.reloadWindow');
  } else {
    vscode.window.showInformationMessage('Cursor Comet is not installed.');
  }
}

function syncSB() {
  if (!sb) return;
  const on = isInstalled();
  sb.text = on ? '✦ Comet' : '○ Comet';
  sb.tooltip = on ? 'Click to disable Cursor Comet' : 'Click to enable Cursor Comet';
  sb.color = on ? new vscode.ThemeColor('statusBarItem.prominentForeground') : undefined;
  sb.show();
}

function getCfg(): CometConfig {
  const c = vscode.workspace.getConfiguration('cursorComet');
  return {
    tailMaxWidth:  c.get('tailMaxWidth', 120),
    throttleMs:    c.get('throttleMs', 28),
    customColor:   c.get('customColor', ''),
  };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export function deactivate() { sb?.dispose(); }
