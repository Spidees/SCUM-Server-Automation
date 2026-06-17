'use strict';

// Shared in-memory state, mirroring $script:ServerState / $script:SchedulingState
// from modules/server/monitoring/monitoring.psm1.

const serverState = {
  ServiceStatus: 'Unknown',
  ProcessId: null,
  ProcessName: null,
  IsRunning: false,
  OnlinePlayers: 0,
  MaxPlayers: 64,
  LastUpdate: null,

  Performance: {
    CPU: 0,
    Memory: 0,
    MemoryTotal: 0,
    FPS: 0,
    Entities: 0,
    LastUpdate: null,
  },

  LastPerformanceAlert: null,
  LastNotificationType: null,
  LastNotificationTime: null,
  LastNotifiedServiceStatus: null,
  LastServerLifecycleNotification: null,
};

const schedulingState = {
  lastBackup: null,
  lastUpdateCheck: null,
  nextScheduledRestart: null,
  consecutiveRestartAttempts: 0,
  restartWarningState: null,
  updateWarningState: null,
  updateStatus: null,
  updateInProgress: false,
  // Pending manual operations triggered by /server-restart|stop|update with a delay.
  // Keyed by type -> { at: Date, timer, warningTimers: [] }. Shared so the web
  // dashboard and Discord both see the same pending restart.
  pendingManual: {},
};

module.exports = {
  serverState,
  schedulingState,
};
