'use strict';

const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const logger = require('../core/logger');
const events = require('../core/events');
const { config, paths } = require('../core/config');
const { convertToHumanReadableSize } = require('../core/common');
const { schedulingState } = require('../core/state');

const BACKUP_PREFIX = 'SCUM_Saved_BACKUP_';

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * True if a path (relative to the saved-game dir) is the live SCUM.log file,
 * which is excluded from backups because it's locked while the server runs.
 */
function isExcludedFromBackup(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized === 'Logs/SCUM.log' || normalized.endsWith('/Logs/SCUM.log');
}

/**
 * Create a backup of the saved-game directory (zipped or plain copy),
 * excluding the live SCUM.log, and enforce maxBackups retention.
 * Mirrors Invoke-GameBackup.
 */
async function createBackup(type = 'manual', opts = {}) {
  const sourcePath = opts.sourcePath || paths.savedDir;
  const backupRoot = opts.backupRoot || paths.backupRoot;
  const maxBackups = opts.maxBackups ?? config.maxBackups ?? 10;
  const compress = opts.compressBackups ?? (config.compressBackups !== false);

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Saved directory not found: ${sourcePath}`);
  }

  fsExtra.ensureDirSync(backupRoot);

  const backupName = `${BACKUP_PREFIX}${timestampForFilename()}`;
  const startTime = Date.now();

  events.emit('notification', { type: 'backup.started', data: { type } });
  logger.info(`[Backup] Starting ${type} backup: ${backupName}`);

  try {
    let finalPath;
    let sizeBytes;

    if (compress) {
      finalPath = path.join(backupRoot, `${backupName}.zip`);
      sizeBytes = await createZipBackup(sourcePath, finalPath);
    } else {
      finalPath = path.join(backupRoot, backupName);
      sizeBytes = await copyDirectoryBackup(sourcePath, finalPath);
    }

    const durationMs = Date.now() - startTime;
    const sizeText = convertToHumanReadableSize(sizeBytes);
    const durationText = formatDuration(durationMs);

    logger.info(`[Backup] Completed ${type} backup: ${path.basename(finalPath)} (${sizeText} in ${durationText})`);

    events.emit('notification', {
      type: 'backup.completed',
      data: { type, size: sizeText, duration: durationText },
    });

    schedulingState.lastBackup = new Date();

    await removeOldBackups(backupRoot, maxBackups);

    return { success: true, fileName: path.basename(finalPath) };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error(`[Backup] ${type} backup failed: ${err.message}`);
    events.emit('notification', {
      type: 'backup.failed',
      data: { error: err.message, duration: formatDuration(durationMs) },
    });
    return { success: false, error: err.message };
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Zip the saved-game directory (excluding Logs/SCUM.log) to destPath.
 * Returns the resulting zip size in bytes.
 */
function createZipBackup(sourcePath, destPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(archive.pointer()));
    archive.on('warning', (err) => logger.warn(`[Backup] Archiver warning: ${err.message}`));
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourcePath, false, (entry) => {
      if (isExcludedFromBackup(entry.name)) return false;
      return entry;
    });
    archive.finalize();
  });
}

/**
 * Recursively copy the saved-game directory to destDir (excluding Logs/SCUM.log).
 * Returns the total copied size in bytes. Skips individual files that fail to
 * copy (e.g. locked files), mirroring the manual-copy fallback's error tolerance.
 */
async function copyDirectoryBackup(sourcePath, destDir) {
  fsExtra.ensureDirSync(destDir);
  let totalSize = 0;

  async function walk(srcDir, relBase) {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const relPath = relBase ? path.join(relBase, entry.name) : entry.name;

      if (entry.isDirectory()) {
        fsExtra.ensureDirSync(path.join(destDir, relPath));
        await walk(srcPath, relPath);
      } else if (entry.isFile()) {
        if (isExcludedFromBackup(relPath)) continue;
        try {
          const destPath = path.join(destDir, relPath);
          fsExtra.ensureDirSync(path.dirname(destPath));
          fs.copyFileSync(srcPath, destPath);
          totalSize += fs.statSync(destPath).size;
        } catch (err) {
          logger.warn(`[Backup] Skipping locked/unreadable file ${relPath}: ${err.message}`);
        }
      }
    }
  }

  await walk(sourcePath, '');
  return totalSize;
}

/**
 * Remove old backups beyond maxBackups, keeping the newest by creation time.
 * Mirrors Remove-OldBackups.
 */
async function removeOldBackups(backupRoot = paths.backupRoot, maxBackups = config.maxBackups || 10) {
  if (!fs.existsSync(backupRoot)) return;

  const items = fs.readdirSync(backupRoot)
    .filter((f) => f.startsWith(BACKUP_PREFIX))
    .map((name) => {
      const full = path.join(backupRoot, name);
      const stat = fs.statSync(full);
      return { name, full, isDir: stat.isDirectory(), birthtime: stat.birthtime || stat.ctime, size: stat };
    })
    .sort((a, b) => b.birthtime - a.birthtime);

  if (items.length <= maxBackups) {
    logger.info(`[Backup] No cleanup needed (${items.length}/${maxBackups} backups)`);
    return;
  }

  const toRemove = items.slice(maxBackups);
  let freedBytes = 0;

  for (const item of toRemove) {
    try {
      if (item.isDir) {
        freedBytes += getDirectorySize(item.full);
        fsExtra.removeSync(item.full);
      } else {
        freedBytes += item.size.size;
        fs.unlinkSync(item.full);
      }
    } catch (err) {
      logger.warn(`[Backup] Failed to remove old backup ${item.name}: ${err.message}`);
    }
  }

  logger.info(`[Backup] Removed ${toRemove.length} old backup(s), freed ${convertToHumanReadableSize(freedBytes)}`);
}

function getDirectorySize(dirPath) {
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) total += getDirectorySize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

/**
 * List existing backups, newest first.
 */
function listBackups(backupRoot = paths.backupRoot) {
  if (!fs.existsSync(backupRoot)) return [];
  return fs.readdirSync(backupRoot)
    .filter((f) => f.startsWith(BACKUP_PREFIX))
    .map((name) => {
      const full = path.join(backupRoot, name);
      const stat = fs.statSync(full);
      const size = stat.isDirectory() ? getDirectorySize(full) : stat.size;
      return { name, size, created: stat.birthtime || stat.ctime, isDirectory: stat.isDirectory() };
    })
    .sort((a, b) => b.created - a.created);
}

/**
 * Mirrors Get-BackupStatistics.
 */
function getBackupStatistics(backupRoot = paths.backupRoot) {
  try {
    const items = listBackups(backupRoot);
    if (items.length === 0) {
      return { BackupCount: 0, TotalSize: 0, TotalSizeText: '0 B', LatestBackup: null, OldestBackup: null };
    }

    const totalSize = items.reduce((sum, i) => sum + i.size, 0);
    const byDate = items.slice().sort((a, b) => a.created - b.created);

    return {
      BackupCount: items.length,
      TotalSize: totalSize,
      TotalSizeText: convertToHumanReadableSize(totalSize),
      LatestBackup: byDate[byDate.length - 1].name,
      OldestBackup: byDate[0].name,
    };
  } catch (err) {
    return { BackupCount: 0, TotalSize: 0, TotalSizeText: '0 B', LatestBackup: null, OldestBackup: null, Error: err.message };
  }
}

/**
 * Mirrors Test-BackupIntegrity.
 */
function testBackupIntegrity(backupPath) {
  try {
    if (backupPath.endsWith('.zip')) {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(backupPath);
      const entries = zip.getEntries();
      logger.info(`[Backup] Integrity check OK: ${path.basename(backupPath)} (${entries.length} entries)`);
      return true;
    }

    if (fs.existsSync(backupPath) && fs.statSync(backupPath).isDirectory()) {
      let count = 0;
      const countAll = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          count++;
          if (entry.isDirectory()) countAll(path.join(dir, entry.name));
        }
      };
      countAll(backupPath);
      logger.info(`[Backup] Integrity check OK: ${path.basename(backupPath)} (${count} items)`);
      return true;
    }

    return false;
  } catch (err) {
    logger.warn(`[Backup] Integrity check failed for ${backupPath}: ${err.message}`);
    return false;
  }
}

module.exports = {
  createBackup,
  listBackups,
  removeOldBackups,
  getBackupStatistics,
  testBackupIntegrity,
};
