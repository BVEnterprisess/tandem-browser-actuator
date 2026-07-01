export type ShortcutLabelPlatform = 'darwin' | 'win32' | 'linux' | 'unsupported' | string;

export function commandOrControlAccelerator(keys: string): string {
  return `CommandOrControl+${keys}`;
}

export function getCommandOrControlLabel(platform: ShortcutLabelPlatform): 'Cmd' | 'Ctrl' {
  return platform === 'darwin' ? 'Cmd' : 'Ctrl';
}

export function labelShortcutText(text: string, platform: ShortcutLabelPlatform): string {
  const modifier = getCommandOrControlLabel(platform);
  let labelled = text
    .replace(/CommandOrControl\+/gi, `${modifier}+`)
    .replace(/CmdOrCtrl\+/gi, `${modifier}+`)
    .replace(/Command\+/gi, `${modifier}+`)
    .replace(/Cmd\+/gi, `${modifier}+`);

  if (platform !== 'darwin') {
    labelled = labelled
      .replace(/⌘⇧/g, `${modifier}+Shift+`)
      .replace(/⌘/g, `${modifier}+`);
  }

  return labelled;
}
