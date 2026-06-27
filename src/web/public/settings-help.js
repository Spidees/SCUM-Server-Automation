/* Per-field help text for the Settings editor, keyed by the config.json dot-path.
   window.SETTINGS_HELP(path) returns a one-line description, or null. */
(function () {
  const MAP = {
    // ── Core / server ──────────────────────────────────────────────────────
    serviceName: 'Windows service name registered with NSSM. Must match the installed service.',
    appId: "Steam AppID of the SCUM dedicated server — don't change this.",
    publicIP: "Your server's public IP. Used for the connect address shown to players and on the Field Console.",
    'serverArgs.port': 'Game port the server listens on. Players connect on this port + 2.',
    'serverArgs.queryPort': 'Steam query port (server browser). Usually the game port + 1.',
    'serverArgs.maxPlayers': 'Maximum simultaneous players (slots).',
    'serverArgs.noBattleye': 'Disable the BattlEye anti-cheat. Leave off unless you have a specific reason.',
    'serverArgs.customArgs': 'Extra command-line arguments appended to the server launch.',
    serverDir: 'Folder where the SCUM server is installed.',
    savedDir: "SCUM 'Saved' folder — save files, logs and SCUM.db. Source of the log feeds and stats.",
    steamCmd: 'Path to steamcmd.exe, used to install and update the server.',
    backupRoot: 'Folder where backups are stored.',
    nssmPath: 'Path to nssm.exe, used to control the Windows service.',

    // ── Restarts / backups / updates ───────────────────────────────────────
    restartTimes: 'Daily scheduled restart times (24h HH:MM). Players are warned before each one.',
    periodicBackupEnabled: 'Take automatic backups on a schedule.',
    backupIntervalMinutes: 'Minutes between periodic backups.',
    maxBackups: 'How many backups to keep — older ones are deleted beyond this count.',
    compressBackups: 'Store backups as a .zip (smaller) instead of a plain folder copy.',
    runBackupOnStart: 'Take a backup every time the manager starts.',
    preRestartBackupEnabled: 'Take a backup right before each scheduled restart.',
    runUpdateOnStart: 'Check for and apply a Steam update when the manager starts.',
    updateCheckIntervalMinutes: 'How often to check Steam for a server update.',
    updateDelayMinutes: 'Grace period after an update is found before applying it (players are warned).',
    autoRestart: 'Automatically restart the server if it crashes or the process dies.',
    autoRestartCooldownMinutes: 'Wait this long between automatic restart attempts.',
    maxConsecutiveRestartAttempts: 'Give up auto-restarting after this many failures in a row.',
    serverStartupTimeoutMinutes: 'How long to wait for the server to come online before treating startup as failed.',
    serverShutdownTimeoutMinutes: 'How long to wait for a clean shutdown before forcing it.',

    // ── Logging / monitoring ───────────────────────────────────────────────
    enableDetailedLogging: 'Write verbose manager logs (more detail for troubleshooting).',
    maxLogFileSizeMB: 'Rotate the manager log file once it reaches this size.',
    logRotationEnabled: 'Roll over manager log files when they grow large.',
    consoleLogLevel: 'Minimum severity printed to the console (Debug / Info / Warning / Error).',
    customLogPath: 'Override where the manager writes its log file (blank = default).',
    monitoringIntervalSeconds: 'How often the manager polls server status (CPU / RAM / FPS / players).',
    logMonitoringEnabled: 'Watch the SCUM log files to drive the Discord feeds and events.',
    logMonitoringIntervalSeconds: 'How often the SCUM log files are read for new lines.',
    preventStatusRegression: 'Stop the status flickering backwards (e.g. Online → Starting) on transient reads.',
    performanceAlertThreshold: 'Lowest FPS band that triggers a performance alert (e.g. Critical).',
    performanceAlertCooldownMinutes: 'Minimum minutes between repeated performance alerts.',
    performanceLogIntervalMinutes: 'How often server performance is logged.',
    'performanceThresholds.excellent': 'Server FPS at or above this counts as Excellent.',
    'performanceThresholds.good': 'Server FPS at or above this counts as Good.',
    'performanceThresholds.fair': 'Server FPS at or above this counts as Fair.',
    'performanceThresholds.poor': 'Server FPS at or above this counts as Poor.',
    'performanceThresholds.critical': 'Server FPS at or below this counts as Critical (triggers alerts).',

    // ── Web interface ──────────────────────────────────────────────────────
    'web.port': 'Port for the web interface (admin dashboard + public Field Console).',
    'web.enabled': 'Turn the built-in web server on or off.',
    'web.publicUrl': 'Public URL of the Field Console (e.g. https://scum.example.com). Enables the links in Discord embeds.',
    'web.bindAddress': 'Network interface to listen on. 0.0.0.0 = all interfaces; 127.0.0.1 = local only.',
    'web.adminAllowlist': 'Optional IP / CIDR allowlist for /admin (one per line). Empty = allow any IP.',
    'web.trustProxy': 'Trust X-Forwarded-* headers. Enable ONLY when behind a reverse proxy.',
    'web.cookieSecure': 'Mark session cookies as Secure (HTTPS only). Enable when served over HTTPS.',
    'web.httpRedirectPort': 'With SSL on, also listen on this HTTP port and redirect it to HTTPS (blank = off).',
    'web.ssl.enabled': 'Serve the web interface over HTTPS using the certificate and key below.',
    'web.ssl.keyFile': 'Path to the TLS private-key (PEM) file.',
    'web.ssl.certFile': 'Path to the TLS certificate (PEM) file.',
    'web.fieldConsole.showOnlinePlayers': "Show the live 'Online players' list on the public Field Console overview.",
    'web.fieldConsole.tabs.leaderboards': 'Show the Leaderboards tab on the public Field Console.',
    'web.fieldConsole.tabs.squads': 'Show the Squads tab on the public Field Console.',
    'web.fieldConsole.tabs.myStats': 'Show the My Stats tab on the public Field Console.',
    'web.fieldConsole.tabs.bunkers': 'Show the Bunkers tab on the public Field Console.',
    'web.fieldConsole.tabs.economy': 'Show the Economy tab on the public Field Console.',
    'web.fieldConsole.tabs.killFeed': 'Show the Kill Feed tab on the public Field Console.',
    'web.fieldConsole.tabs.events': 'Show the Events tab on the public Field Console.',

    // ── Discord ────────────────────────────────────────────────────────────
    'Discord.GuildId': 'Your Discord server (guild) ID. Required for slash commands and embeds.',
    'Discord.Presence.Activity': "The bot's activity text shown in Discord.",
    'Discord.Presence.Status': 'Bot online status: online / idle / dnd / invisible.',
    'Discord.Presence.Type': 'Activity type: Playing / Watching / Listening / Competing.',
    'Discord.Presence.DynamicActivity': "Update the bot's activity with live player counts.",
    'Discord.Presence.OfflineActivity': 'Activity text shown while the server is offline.',
    'Discord.Presence.OnlineActivityFormat': 'Template for the online activity. {players} and {maxPlayers} are filled in.',
    'Discord.LiveEmbeds.UpdateInterval': 'Seconds between server-status embed refreshes.',
    'Discord.LiveEmbeds.PlayersUpdateInterval': 'Seconds between the players embed refreshes.',
    'Discord.LiveEmbeds.BunkerUpdateInterval': 'Seconds between the bunker embed refreshes.',
    'Discord.LiveEmbeds.LeaderboardUpdateInterval': 'Seconds between the leaderboard embed refreshes.',
    'Discord.LiveEmbeds.EconomyUpdateInterval': 'Seconds between the economy embed refreshes.',
    'Discord.Notifications.SuppressStatusChanges': "Don't post routine status-change notifications (Starting / Online / etc.).",
    'Discord.Notifications.Channels.Admin': 'Channel ID for admin notifications.',
    'Discord.Notifications.Channels.Players': 'Channel ID for player notifications.',
    'Discord.Notifications.Roles.Admin': 'Role ID pinged on admin notifications.',
    'Discord.Notifications.Roles.Players': 'Role ID pinged on player notifications.',
    'Discord.Notifications.NotificationTypes.AdminOnly': 'Notification types sent only to admins (list).',
    'Discord.Notifications.NotificationTypes.Player': 'Notification types sent to players (list).',
    'Discord.ChatRelay.Enabled': 'Relay in-game chat to and from Discord.',
    'Discord.ChatRelay.Channels.Players': 'Channel ID for the player chat relay.',
    'Discord.ChatRelay.Channels.Admin': 'Channel ID for the admin chat relay.',
    'Discord.ChatRelay.ChatTypes.global': 'Relay global in-game chat.',
    'Discord.ChatRelay.ChatTypes.squad': 'Relay squad in-game chat.',
    'Discord.ChatRelay.ChatTypes.local': 'Relay local (proximity) in-game chat.',
    'Discord.ChatRelay.MaxMessageLength': 'Trim relayed messages longer than this many characters.',
    'Discord.ChatRelay.UpdateInterval': 'Seconds between chat-relay polls.',
    'Discord.SlashCommands.AdminRoles': 'Role IDs allowed to use admin slash commands (list).',

    // ── SCUM log features ──────────────────────────────────────────────────
    'SCUMLogFeatures.UpdateInterval': 'Seconds between reads of the SCUM feature log files.',
    'SCUMLogFeatures.OwnerAlertFlagFilter.Enabled': 'Only DM base owners about events near their own flag (cuts noise).',
    'SCUMLogFeatures.OwnerAlertFlagFilter.RadiusMeters': "Distance from a flag within which owner alerts count as 'their base'.",
    'SCUMLogFeatures.OwnerAlertFlagFilter.Vehicles': 'Apply the flag-radius filter to vehicle owner alerts.',
    'SCUMLogFeatures.OwnerAlertFlagFilter.Chests': 'Apply the flag-radius filter to chest owner alerts.',
    'SCUMLogFeatures.OwnerAlertFlagFilter.Locks': 'Apply the flag-radius filter to lock owner alerts.',
    'SCUMLogFeatures.KillFeed.PlayersDelayEnabled': "Delay the public kill feed so it doesn't reveal fights in real time.",
    'SCUMLogFeatures.KillFeed.PlayersDelaySeconds': 'How long to delay the public kill feed.',
    'SCUMLogFeatures.KillFeed.PlayersShowLocation': 'Include the kill location / map link in the public kill feed.',
  };

  // What each log feed reports — used to describe its Enabled / Channel fields.
  const FEED = {
    KillFeed: 'kill events (killer, victim, weapon, distance)',
    LoginFeed: 'player login / logout events',
    AdminFeed: 'admin command usage',
    RaidProtectionFeed: 'base raid-protection scheduled / active / ended events',
    EconomyFeed: 'trader economy changes',
    GameplayFeed: 'general gameplay events',
    ChestFeed: 'chest / container ownership changes',
    QuestFeed: 'quest completions',
    FamePointsFeed: 'fame-point awards',
    VehicleFeed: 'vehicle ownership and destruction events',
    ViolationsFeed: 'anti-cheat / rule-violation events',
    EventKillFeed: 'kills during in-game events',
  };

  function lookup(path) {
    if (MAP[path]) return MAP[path];

    const feed = path.match(/^SCUMLogFeatures\.(\w+)\.(\w+)$/);
    if (feed && FEED[feed[1]]) {
      const what = FEED[feed[1]];
      const sub = feed[2];
      if (sub === 'Channel') return `Discord channel ID for the ${what} feed.`;
      if (sub === 'AdminChannel') return `Admin channel ID for the ${what} feed.`;
      if (sub === 'PlayersChannel') return `Public (players) channel ID for the ${what} feed.`;
      if (sub === 'Enabled') return `Post ${what} to Discord.`;
      if (sub === 'AdminEnabled') return `Post the full ${what} to the admin channel.`;
      if (sub === 'PlayersEnabled') return `Post a public (players) version of the ${what}.`;
    }

    if (/\.Images\.\w+$/.test(path) || /\.Images\.Leaderboards\.\w+$/.test(path)) return 'Image / thumbnail URL shown on this embed.';
    if (/Channel$/.test(path)) return 'Discord channel ID for this feature.';
    if (/\.Enabled$/.test(path)) return 'Enable this feature.';
    return null;
  }

  window.SETTINGS_HELP = lookup;
})();
