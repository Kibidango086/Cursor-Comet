# Cursor Comet

Animated cursor extension for VS Code / VSCodium. Smooth vertical-line cursor movement with a glowing comet tail effect.

## Features

- **Smooth cursor** -- CSS `cubic-bezier(.22,1,.36,1)` transition for pixel-level smoothness
- **Comet trail** -- dynamic gradient tail that follows every cursor movement
- **Universal** -- works in editor, terminal, search bars, command palette, dialogs
- **Multi-cursor** -- tracks every cursor independently via `Map<nativeEl, state>`
- **Theme-aware** -- automatically picks up cursor color from VS Code theme CSS variables
- **Safe** -- hides only the specific cursor element via JS, never containers or text

## Usage

1. Install the extension
2. Reload (first-time setup prompts for permissions automatically)
3. Type away

### Commands

| Command | Description |
|---------|-------------|
| `Cursor Comet: Enable` | Enable comet cursor |
| `Cursor Comet: Disable` | Remove comet cursor, restore original |
| `Cursor Comet: Reinstall` | Fresh reinstall (good after VS Code update) |
| `Cursor Comet: Repair Installation` | Restore original workbench.html from backup |
| `Cursor Comet: Toggle` | Toggle on/off |

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorComet.enabled` | `true` | Enable on startup |
| `cursorComet.tailMaxWidth` | `120` | Max tail length (px) |
| `cursorComet.throttleMs` | `28` | Tail spawn interval (ms) |
| `cursorComet.customColor` | `""` | Custom hex color (empty = use VS Code theme accent color) |

## How It Works

```
Extension host          -> patches workbench.html -> injects JS IIFE
Renderer process (DOM)  -> rAF loop -> querySelectorAll -> Map<Cursor, State>
Each tick               -> sync position -> translate3d caret -> spawn tail divs
```

The injected script uses `requestAnimationFrame` to track every cursor element via `getBoundingClientRect()`, positions a custom caret with `translate3d`, and spawns tail `<div>` elements with `linear-gradient` backgrounds that animate and self-destruct on `animationend`.

Cursor color is read from the VS Code theme CSS variable `--vscode-editorCursor-foreground`, falling back to `--vscode-editor-foreground`, so it always matches your current theme.

## Requirements

- VS Code 1.85+ or VSCodium
- Write permission to the VS Code installation directory (for patching `workbench.html`)

## Known Issues

- VS Code shows "installation appears corrupt" warning after patching -- this is harmless. Use `Repair Installation` to restore the original file.
- VS Code updates overwrite the patch -- just run `Reinstall`.

## License

MIT
