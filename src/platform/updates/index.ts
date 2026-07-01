import type { BrowserWindow, MessageBoxOptions } from 'electron';
import { NotImplementedError, type PlatformId } from '../errors';
import type { UpdaterAdapter } from '../types';

const GITHUB_UPDATE_SOURCE = 'GitHub Releases';

let updateCheckRunning = false;

async function showMessageBox(
  mainWindow: BrowserWindow | null | undefined,
  options: MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  const { dialog } = await import('electron');
  if (mainWindow && !mainWindow.isDestroyed()) {
    return dialog.showMessageBox(mainWindow, options);
  }
  return dialog.showMessageBox(options);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createWindowsUpdaterAdapter(): UpdaterAdapter {
  return {
    isSupported: () => true,
    checkForUpdates: async ({ mainWindow } = {}) => {
      if (updateCheckRunning) {
        await showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Check',
          message: 'Tandem Browser is already checking for updates.',
          buttons: ['OK'],
        });
        return;
      }

      updateCheckRunning = true;
      try {
        const { app } = await import('electron');
        if (!app.isPackaged) {
          await showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Check',
            message: 'Update checks are available in packaged Windows builds.',
            detail: 'Source runs do not include the packaged update metadata required to check GitHub Releases.',
            buttons: ['OK'],
          });
          return;
        }

        const { autoUpdater } = await import('electron-updater');
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.allowPrerelease = false;

        const checkResult = await autoUpdater.checkForUpdates();
        if (!checkResult || !checkResult.isUpdateAvailable) {
          await showMessageBox(mainWindow, {
            type: 'info',
            title: 'No Updates Available',
            message: 'Tandem Browser is up to date.',
            detail: `Checked ${GITHUB_UPDATE_SOURCE}.`,
            buttons: ['OK'],
          });
          return;
        }

        const version = checkResult.updateInfo.version;
        const downloadChoice = await showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Available',
          message: `Tandem Browser ${version} is available.`,
          detail: `The update was found on ${GITHUB_UPDATE_SOURCE}. Download it now?`,
          buttons: ['Download Update', 'Later'],
          defaultId: 0,
          cancelId: 1,
        });
        if (downloadChoice.response !== 0) {
          return;
        }

        await autoUpdater.downloadUpdate();

        const installChoice = await showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Downloaded',
          message: `Tandem Browser ${version} is ready to install.`,
          detail: 'Install and restart Tandem Browser now, or finish your work and restart later.',
          buttons: ['Install and Restart', 'Later'],
          defaultId: 0,
          cancelId: 1,
        });
        if (installChoice.response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      } catch (error) {
        await showMessageBox(mainWindow, {
          type: 'error',
          title: 'Update Check Failed',
          message: 'Tandem Browser could not check for updates.',
          detail: getErrorMessage(error),
          buttons: ['OK'],
        });
      } finally {
        updateCheckRunning = false;
      }
    },
  };
}

export function createUnsupportedUpdaterAdapter(platform: PlatformId): UpdaterAdapter {
  return {
    isSupported: () => false,
    checkForUpdates: async () => {
      throw new NotImplementedError('Auto-update', platform, 'phase-15');
    },
  };
}
