import { execFile } from 'node:child_process';

export interface DialogCommand {
  file: string;
  args: string[];
  env?: Record<string, string>;
}

export type RunCommand = (command: DialogCommand) => Promise<string>;

const WINDOWS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$owner = New-Object System.Windows.Forms.Form',
  '$owner.TopMost = $true',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  'if ($env:GUILDCRAFT_START) { $dialog.SelectedPath = $env:GUILDCRAFT_START }',
  "if ($dialog.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($dialog.SelectedPath) }",
].join('; ');

const MAC_SCRIPT = [
  'on run argv',
  'if (count of argv) > 0 then',
  'return POSIX path of (choose folder default location (POSIX file (item 1 of argv)))',
  'end if',
  'return POSIX path of (choose folder)',
  'end run',
];

export function dialogCommands(platform: NodeJS.Platform, initial: string | null): DialogCommand[] {
  if (platform === 'win32') {
    return [
      {
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT],
        env: initial === null ? {} : { GUILDCRAFT_START: initial },
      },
    ];
  }
  if (platform === 'darwin') {
    const start = initial === null ? [] : [initial];
    return [{ file: 'osascript', args: [...MAC_SCRIPT.flatMap((line) => ['-e', line]), ...start] }];
  }
  const start = initial === null ? [] : [initial.endsWith('/') ? initial : `${initial}/`];
  return [
    {
      file: 'zenity',
      args: ['--file-selection', '--directory', ...start.map((path) => `--filename=${path}`)],
    },
    { file: 'kdialog', args: ['--getexistingdirectory', ...start] },
  ];
}

export function parseSelection(output: string): string | null {
  const path = output.trim();
  if (path === '') return null;
  const isRoot = path.length === 1 || /^[A-Za-z]:[\\/]$/.test(path);
  return !isRoot && /[\\/]$/.test(path) ? path.slice(0, -1) : path;
}

export function runCommand(command: DialogCommand): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command.file,
      command.args,
      { env: { ...process.env, ...command.env }, encoding: 'utf8', windowsHide: true },
      (error, stdout) => {
        if (error) reject(Object.assign(new Error(error.message), { code: error.code }));
        else resolve(stdout);
      },
    );
  });
}

export async function pickFolder(
  platform: NodeJS.Platform,
  initial: string | null,
  run: RunCommand = runCommand,
): Promise<string | null> {
  for (const command of dialogCommands(platform, initial)) {
    try {
      return parseSelection(await run(command));
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') continue;
      return null;
    }
  }
  throw new Error('no native folder dialog available');
}
