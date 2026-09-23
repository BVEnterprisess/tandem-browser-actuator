import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { toWindowsNtPath, wslMountToNtPath } = require('../../../deploy/gtx1660/windows-path.js') as {
  toWindowsNtPath: (input: string) => string;
  wslMountToNtPath: (input: string) => string;
};

describe('wslMountToNtPath', () => {
  it('converts the gtx1660 deploy root to an NT path', () => {
    expect(wslMountToNtPath('/mnt/c/Users/johnh/AppData/Local/TandemBrowser-gtx1660'))
      .toBe('C:\\Users\\johnh\\AppData\\Local\\TandemBrowser-gtx1660');
  });

  it('repairs the relative mnt\\c form PowerShell used after a failed handoff', () => {
    expect(wslMountToNtPath('mnt\\c\\Users\\johnh\\AppData\\Local\\TandemBrowser-gtx1660'))
      .toBe('C:\\Users\\johnh\\AppData\\Local\\TandemBrowser-gtx1660');
  });

  it('leaves real NT and UNC paths alone', () => {
    expect(wslMountToNtPath('C:\\Users\\johnh\\AppData\\Local\\TandemBrowser-gtx1660'))
      .toBe('C:\\Users\\johnh\\AppData\\Local\\TandemBrowser-gtx1660');
    expect(wslMountToNtPath('\\\\wsl$\\Ubuntu\\home\\jp\\.openclaw\\openclaw.json'))
      .toBe('\\\\wsl$\\Ubuntu\\home\\jp\\.openclaw\\openclaw.json');
  });
});

describe('toWindowsNtPath', () => {
  it('uses the mount conversion for /mnt/c deploy roots', () => {
    expect(toWindowsNtPath('/mnt/c/Users/johnh/AppData/Local/TandemBrowser-gtx1660'))
      .toBe('C:\\Users\\johnh\\AppData\\Local\\TandemBrowser-gtx1660');
  });
});
