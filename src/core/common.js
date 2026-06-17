'use strict';

/**
 * Shared small helpers ported from modules/core/common/common.psm1.
 */

/**
 * Convert a byte count to a human-readable string (e.g. "12.34 MB").
 * Mirrors ConvertTo-HumanReadableSize.
 */
function convertToHumanReadableSize(bytes) {
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Number(bytes);
  let index = 0;

  while (size >= 1024 && index < sizes.length - 1) {
    size /= 1024;
    index++;
  }

  return `${size.toFixed(2)} ${sizes[index]}`;
}

/**
 * Compute the next scheduled restart Date from an array of "HH:mm" strings.
 * Mirrors Get-NextScheduledRestart.
 */
function getNextScheduledRestart(restartTimes, now = new Date()) {
  if (!Array.isArray(restartTimes) || restartTimes.length === 0) {
    return null;
  }

  const todayCandidates = [];
  for (const t of restartTimes) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) continue;
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    const scheduled = new Date(now);
    scheduled.setHours(hours, minutes, 0, 0);
    if (scheduled.getTime() > now.getTime()) {
      todayCandidates.push(scheduled);
    }
  }

  if (todayCandidates.length > 0) {
    todayCandidates.sort((a, b) => a - b);
    return todayCandidates[0];
  }

  // No remaining restart today - use tomorrow's earliest configured time.
  let earliest = null;
  for (const t of restartTimes) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) continue;
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    if (!earliest || hours < earliest.hours || (hours === earliest.hours && minutes < earliest.minutes)) {
      earliest = { hours, minutes };
    }
  }

  if (!earliest) return null;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(earliest.hours, earliest.minutes, 0, 0);
  return tomorrow;
}

module.exports = {
  convertToHumanReadableSize,
  getNextScheduledRestart,
};
