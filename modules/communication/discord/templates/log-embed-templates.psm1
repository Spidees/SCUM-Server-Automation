# ===============================================================
# SCUM Server Automation - Log Embed Templates
# ===============================================================
# Unified embed system for all log modules
# ===============================================================

# Import required modules
try {
    $itemManagerPath = Join-Path $PSScriptRoot "..\..\..\core\item-manager.psm1"
    if (Test-Path $itemManagerPath) {
        Import-Module $itemManagerPath -Force
    }
} catch {
    Write-Host "[WARNING] Could not load item-manager module: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Color constants for different action types
$script:EmbedColors = @{
    # Login/Connection Actions
    Login = 65280      # Green (positive connection)
    Logout = 16711680  # Red (disconnection)
    
    # Combat/Violence Actions  
    Kill = 16711680    # Red (violence)
    Vehicle = 16776960 # Yellow (vehicle events)
    Violation = 16753920 # Orange (rule violations)
    
    # Administrative Actions
    AdminPositive = 65280     # Green (spawning, giving items)
    AdminNeutral = 3447003    # Blue (info, teleport, location)
    AdminNegative = 16711680  # Red (kill, ban, penalties)
    AdminCommand = 15844367   # Gold (general commands)
    
    # Chest/Storage Actions
    ChestClaim = 65280        # Green (claiming/gaining)
    ChestUnclaim = 16711680   # Red (unclaiming/losing)
    ChestTransfer = 3447003   # Blue (transferring)
    ChestGeneral = 10181046   # Purple (general chest actions)
    
    # Fame Points Actions  
    FameGain = 65280          # Green (gaining fame)
    FameLoss = 16711680       # Red (losing fame)
    FameAward = 16766720      # Gold (awards/bonuses)
    FameSkill = 3447003       # Blue (skill-based)
    FameCombat = 16753920     # Orange (combat-related)
    
    # Gameplay Activity Actions
    GameplaySuccess = 65280   # Green (successful actions)
    GameplayFailed = 16711680 # Red (failed actions)
    GameplayNeutral = 3447003 # Blue (neutral activities)
    GameplaySystem = 8421504  # Gray-blue (system events)
    GameplayMinigame = 10181046 # Purple (minigames)
    GameplayLockpick = 16776960 # Yellow (lockpicking)
    
    # Economy Actions (keeping the detailed economy colors)
    EconomySell = 65280        # Green (earning money)
    EconomyBuy = 16711680      # Red (spending money)  
    EconomyDeposit = 3447003   # Blue (bank deposit)
    EconomyWithdraw = 16776960 # Yellow/Orange (bank withdrawal)
    EconomyCard = 10181046     # Purple (card operations)
    EconomyDestroy = 16753920  # Orange (destructive actions)
    EconomyExchange = 15844367 # Gold (currency conversion)
    EconomyPenalty = 8388608   # Dark red (penalties)
    EconomyMechanic = 8421504  # Gray-blue (services)
    
    # Event Kill Actions
    EventKillRanged = 16711680    # Red (ranged kills in events)
    EventKillMelee = 16753920     # Orange (melee kills in events)
    EventKillGeneral = 8388608    # Dark red (general event kills)
    
    # Kill Log Actions
    KillPvP = 16711680            # Red (PvP kills)
    KillSuicide = 8388608         # Dark red (suicides)
    KillMelee = 16753920          # Orange (melee kills)
    KillRanged = 16711680         # Red (ranged kills)
    KillExplosive = 16776960      # Yellow (explosive kills)
    
    # Quest Actions
    QuestComplete = 65280         # Green (quest completed)
    QuestFailed = 16711680        # Red (quest failed/abandoned)
    QuestStart = 3447003          # Blue (quest started)
    QuestNeutral = 10181046       # Purple (neutral quest events)
    
    # Raid Protection Actions
    RaidProtectionSet = 16776960      # Yellow/Orange (protection scheduled)
    RaidProtectionActive = 65280      # Green (protection active/started)
    RaidProtectionEnded = 16753920    # Orange (protection ended by login)
    RaidProtectionExpired = 8421504   # Gray-blue (protection expired naturally)
    
    # Vehicle Actions
    VehicleDestroyed = 16711680       # Red (vehicle destroyed)
    VehicleDisappeared = 8421504      # Gray-blue (vehicle disappeared)
    VehicleExpired = 16776960         # Yellow/Orange (vehicle expired/inactive)
    VehicleForbidden = 16753920       # Orange (forbidden zone expiry)
    
    # Violations Actions
    ViolationBan = 8388608            # Dark red (permanent ban)
    ViolationKick = 16753920          # Orange (temporary kick)
    ViolationAmmo = 16711680          # Red (ammo violation)
    ViolationInteraction = 16776960   # Yellow (interaction violation)
    ViolationGeneral = 16753920       # Orange (general violations)
}

# Standard footer for all embeds
$script:StandardFooter = @{
    text = "SCUM Server Automation"
    icon_url = "https://playhub.cz/scum/manager/server_automation_discord.png"
}

# Standard timestamp function for all embeds
function Get-StandardTimestamp {
    return (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

# ===============================================================
# LOGIN/LOGOUT EMBEDS
# ===============================================================
function Send-LoginEmbed {
    param(
        [hashtable]$LoginEvent
    )
    
    $color = if ($LoginEvent.Type -eq "LOGIN") { $script:EmbedColors.Login } else { $script:EmbedColors.Logout }
    $emoji = if ($LoginEvent.Type -eq "LOGIN") { ":green_circle:" } else { ":red_circle:" }
    
    $fields = @(
        @{
            name = "Player"
            value = "$($LoginEvent.PlayerName)"
            inline = $true
        }
    )

    if ($LoginEvent.PlayerId) {
        $fields += @{
            name = "Player ID"
            value = "$($LoginEvent.PlayerId)"
            inline = $true
        }
    } else {
        $fields += @{
            name = "Player ID"
            value = "N/A"
            inline = $true
        }
    }

    $fields += @(
        @{
            name = "SteamID"
            value = "$($LoginEvent.SteamId)"
            inline = $true
        },
        @{
            name = "IP Address"
            value = "$($LoginEvent.IpAddress)"
            inline = $true
        }
    )

    if ($LoginEvent.Coordinates) {
        $fields += @{
            name = "Location"
            value = "X=$($LoginEvent.Coordinates.X) Y=$($LoginEvent.Coordinates.Y) Z=$($LoginEvent.Coordinates.Z)"
            inline = $true
        }
    }

    if ($LoginEvent.IsDrone) {
        $fields += @{
            name = "Drone Mode"
            value = "Yes"
            inline = $false
        }
    }
    
    return @{
        title = "$emoji Player $($LoginEvent.Type.ToLower())"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# CHEST EMBEDS
# ===============================================================
function Send-ChestEmbed {
    param(
        [hashtable]$ChestAction
    )
    
    # Get emoji, title and color based on chest action type
    $emoji = ":package:"
    $title = "Chest Activity"
    $color = $script:EmbedColors.ChestGeneral  # Default
    
    switch ($ChestAction.Type) {
        "claim" { 
            $emoji = ":inbox_tray:"
            $title = "Chest Claimed"
            $color = $script:EmbedColors.ChestClaim
        }
        "transfer" { 
            $emoji = ":arrows_counterclockwise:"
            $title = "Chest Transferred"
            $color = $script:EmbedColors.ChestTransfer
        }
        "claim_unclaimed" { 
            $emoji = ":new:"
            $title = "Unclaimed Chest Claimed"
            $color = $script:EmbedColors.ChestClaim
        }
        "unclaim" { 
            $emoji = ":outbox_tray:"
            $title = "Chest Unclaimed"
            $color = $script:EmbedColors.ChestUnclaim
        }
        default { 
            $emoji = ":package:"
            $title = "Chest Activity"
            $color = $script:EmbedColors.ChestGeneral
        }
    }
    
    $fields = @(
        @{
            name = "Player"
            value = "$($ChestAction.PlayerName)"
            inline = $true
        }
    )

    if ($ChestAction.PlayerId) {
        $fields += @{
            name = "Player ID"
            value = "$($ChestAction.PlayerId)"
            inline = $true
        }
    } else {
        $fields += @{
            name = "Player ID"
            value = "N/A"
            inline = $true
        }
    }

    $fields += @(
        @{
            name = "SteamID"
            value = "$($ChestAction.SteamId)"
            inline = $true
        },
        @{
            name = "Entity ID"
            value = "$($ChestAction.EntityId)"
            inline = $true
        }
    )

    if ($ChestAction.Action) {
        $fields += @{
            name = "Action"
            value = "$($ChestAction.Action)"
            inline = $true
        }
    }

    if ($ChestAction.Location) {
        $fields += @{
            name = "Location"
            value = "$($ChestAction.Location)"
            inline = $false
        }
    }
    
    return @{
        title = "$emoji $title"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# FAMEPOINTS EMBEDS
# ===============================================================
function Send-FamePointsEmbed {
    param(
        [hashtable]$FamePointsAction
    )
    
    # Get emoji, title and color based on famepoints action type  
    $emoji = ":star2:"
    $title = "Fame Points"
    $color = $script:EmbedColors.FameGain  # Default
    
    switch ($FamePointsAction.Type) {
        "admin" { 
            $emoji = ":crown:"
            $title = "Admin Fame Award"
            $color = $script:EmbedColors.FameAward
        }
        "skill" { 
            $emoji = ":muscle:"
            $title = "Skill Fame Points"
            $color = $script:EmbedColors.FameSkill
        }
        "deathmatch" { 
            $emoji = ":trophy:"
            $title = "Deathmatch Fame"
            $color = $script:EmbedColors.FameAward
        }
        "kill" { 
            $emoji = ":crossed_swords:"
            $title = "Kill Fame Points"
            $color = $script:EmbedColors.FameCombat
        }
        "zombie" { 
            $emoji = ":zombie:"
            $title = "Zombie Kill Fame"
            $color = $script:EmbedColors.FameCombat
        }
        "firearm" { 
            $emoji = ":gun:"
            $title = "Firearm Fame"
            $color = $script:EmbedColors.FameCombat
        }
        "melee" { 
            $emoji = ":dagger:"
            $title = "Melee Fame"
            $color = $script:EmbedColors.FameCombat
        }
        "craft" { 
            $emoji = ":hammer_pick:"
            $title = "Crafting Fame"
            $color = $script:EmbedColors.FameSkill
        }
        "loot" { 
            $emoji = ":package:"
            $title = "Looting Fame"
            $color = $script:EmbedColors.FameGain
        }
        "fishing" { 
            $emoji = ":fishing_pole_and_fish:"
            $title = "Fishing Fame"
            $color = $script:EmbedColors.FameSkill
        }
        "recovery" { 
            $emoji = ":green_heart:"
            $title = "Recovery Fame"
            $color = $script:EmbedColors.FameSkill
        }
        "farming" { 
            $emoji = ":herb:"
            $title = "Farming Fame"
            $color = $script:EmbedColors.FameSkill
        }
        "lockpick" { 
            $emoji = ":key:"
            $title = "Lockpicking Fame"
            $color = $script:EmbedColors.FameSkill
        }
        "minigame" { 
            $emoji = ":video_game:"
            $title = "Minigame Fame"
            $color = $script:EmbedColors.FameSkill
        }
        "periodic" { 
            $emoji = ":clock3:"
            $title = "Periodic Fame"
            $color = $script:EmbedColors.FameAward
        }
        "award" { 
            $emoji = ":star:"
            $title = "Fame Award"
            $color = $script:EmbedColors.FameAward
        }
        default { 
            $emoji = ":star2:"
            $title = "Fame Points"
            # Determine color based on amount (positive/negative)
            if ($FamePointsAction.Amount -and $FamePointsAction.Amount -lt 0) {
                $color = $script:EmbedColors.FameLoss
            } else {
                $color = $script:EmbedColors.FameGain
            }
        }
    }
    
    $fields = @(
        @{
            name = "Player"
            value = "$($FamePointsAction.PlayerName)"
            inline = $true
        }
    )

    $fields += @(
        @{
            name = "SteamID"
            value = "$($FamePointsAction.SteamId)"
            inline = $true
        }
    )

    if ($FamePointsAction.Amount) {
        $fields += @{
            name = "Amount"
            value = "$($FamePointsAction.Amount) fame points"
            inline = $true
        }
    }

    if ($FamePointsAction.Action) {
        $fields += @{
            name = "Action"
            value = "$($FamePointsAction.Action)"
            inline = $true
        }
    }

    if ($FamePointsAction.Reason) {
        $fields += @{
            name = "Reason"
            value = "$($FamePointsAction.Reason)"
            inline = $true
        }
    }

    # Add details breakdown for periodic awards
    if ($FamePointsAction.Details -and $FamePointsAction.Details.Count -gt 0) {
        $detailsText = ""
        foreach ($detail in $FamePointsAction.Details) {
            $detailName = switch ($detail.DetailType) {
                "BaseFameInflux" { "Base Fame" }
                "OnlineFlagOwnersAwardAwarded" { "Flag Ownership" }
                "DistanceTraveledOnFoot" { "Walking Distance" }
                "DistanceTraveledWhileMounted" { "Vehicle Distance" }
                "PuppetKill" { "Zombie Kills" }
                "FirearmKill" { "Firearm Kills" }
                "MeleeKill" { "Melee Kills" }
                "ItemLooted" { "Items Looted" }
                "RecoveredFromInfection" { "Infection Recovery" }
                "MinigameCompleted" { "Minigames" }
                "LockPicked" { "Lockpicking" }
                "BandageApplied" { "Bandages Applied" }
                "LandedWithParachute" { "Parachute Landings" }
                "BlueprintBuilt" { "Blueprints Built" }
                "BaseElementBuilt" { "Base Elements" }
                "ItemCrafted" { "Items Crafted" }
                "KillClaimed" { "Kills Claimed" }
                default { $detail.DetailType }
            }
            $detailsText += "**$detailName**: $($detail.Amount)`n"
        }
        
        $fields += @{
            name = "Breakdown"
            value = $detailsText.Trim()
            inline = $false
        }
    }
    
    return @{
        title = "$emoji $title"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# GAMEPLAY EMBEDS
# ===============================================================
function Send-GameplayEmbed {
    param(
        [hashtable]$GameplayActivity
    )
    
    # Get emoji, title and color based on gameplay activity type
    $emoji = ":gear:"
    $title = "Gameplay Activity"
    $color = $script:EmbedColors.GameplayNeutral  # Default
    
    switch ($GameplayActivity.Type) {
        "bunker" { 
            $emoji = ":bank:"
            $title = "Bunker Activity"
            $color = $script:EmbedColors.GameplayNeutral
        }
        "explosive" { 
            $emoji = ":bomb:"
            $title = "Explosive Activity"
            $color = $script:EmbedColors.GameplayFailed  # Red for explosives
        }
        "trap" { 
            $emoji = ":mouse_trap:"
            $title = "Trap Activity"
            $color = $script:EmbedColors.GameplayFailed  # Red for traps
        }
        "lockpicking" { 
            $emoji = ":key:"
            $title = "Lockpicking Activity"
            $color = $script:EmbedColors.GameplayLockpick
        }
        "quest" { 
            $emoji = ":scroll:"
            $title = "Quest Activity"
            $color = $script:EmbedColors.GameplayNeutral
        }
        "bunker_minigame" { 
            $emoji = ":electric_plug:"
            $title = "Bunker Minigame"
            $color = $script:EmbedColors.GameplayMinigame
        }
        "dialpad" { 
            $emoji = ":1234:"
            $title = "Dialpad Activity"
            $color = $script:EmbedColors.GameplayMinigame
        }
        "flag" { 
            $emoji = ":triangular_flag_on_post:"
            $title = "Base Activity"
            $color = $script:EmbedColors.GameplayNeutral
        }
        "minigame" { 
            $emoji = ":video_game:"
            $title = "Minigame Activity"
            $color = $script:EmbedColors.GameplayMinigame
        }
        "dialpad_attempt" { 
            $emoji = ":1234:"
            $title = "Dialpad Attempt"
            $color = $script:EmbedColors.GameplayNeutral
        }
        "bomb_defusal" { 
            $emoji = ":bomb:"
            $title = "Bomb Defusal"
            $color = $script:EmbedColors.GameplaySuccess
        }
    }
    
    # Override color based on success/failure if available
    if ($null -ne $GameplayActivity.Success) {
        if ($GameplayActivity.Success) {
            $color = $script:EmbedColors.GameplaySuccess
        } else {
            $color = $script:EmbedColors.GameplayFailed
        }
    }
    
    # Special case for SYSTEM events
    if ($GameplayActivity.PlayerName -eq "SYSTEM") {
        $color = $script:EmbedColors.GameplaySystem
    }
    
    $fields = @()
    
    # Handle SYSTEM vs Player activities
    if ($GameplayActivity.PlayerName -eq "SYSTEM") {
        $fields += @{
            name = "Source"
            value = "SYSTEM"
            inline = $true
        }
        
        $fields += @{
            name = "Event"
            value = "System Event"
            inline = $true
        }
        
        # For bunker activities, show bunker info
        if ($GameplayActivity.BunkerName) {
            $fields += @{
                name = "Bunker"
                value = "$($GameplayActivity.BunkerName)"
                inline = $true
            }
        }
        
        if ($GameplayActivity.Status) {
            $fields += @{
                name = "Status"
                value = "$($GameplayActivity.Status)"
                inline = $true
            }
        }
        
    } else {
        # Player activity
        $fields += @{
            name = "Player"
            value = "$($GameplayActivity.PlayerName)"
            inline = $true
        }
        
        # Player ID
        if ($GameplayActivity.PlayerId) {
            $fields += @{
                name = "Player ID"
                value = "$($GameplayActivity.PlayerId)"
                inline = $true
            }
        } else {
            $fields += @{
                name = "Player ID"
                value = "N/A"
                inline = $true
            }
        }
        
        # SteamID
        $fields += @{
            name = "SteamID"
            value = if ($GameplayActivity.SteamId) { "$($GameplayActivity.SteamId)" } else { "N/A" }
            inline = $true
        }
    }

    # Activity description - simplified for structured fields
    if ($GameplayActivity.Activity) {
        # For trap activities, use simplified description since we have structured fields
        if ($GameplayActivity.Type -eq "trap") {
            $activityValue = switch ($GameplayActivity.Action) {
                "Crafted" { "Crafted Trap" }
                "Armed" { "Armed Trap" }
                "Triggered" { "triggered Trap" }
                "Disarmed" { "disarmed Trap" }
                default { "$($GameplayActivity.Action.ToLower()) trap" }
            }
        } else {
            # For other activities, use full description
            $activityValue = "$($GameplayActivity.Activity)"
        }
        
        $fields += @{
            name = "Activity"
            value = $activityValue
            inline = $true
        }
    }

    # Specific fields based on activity type
    
    # For minigames
    if ($GameplayActivity.MinigameType) {
        # Clean up minigame type name - remove Blueprint prefixes and make readable
        $cleanMinigameType = $GameplayActivity.MinigameType -replace "^BP_?", "" -replace "_C$", "" -replace "Minigame", "" -replace "_", " "
        $cleanMinigameType = $cleanMinigameType.Trim()
        
        # Handle specific cases for better readability
        if ($cleanMinigameType -match "DialLock") {
            $cleanMinigameType = "Dial Lock"
        } elseif ($cleanMinigameType -match "Lockpicking") {
            $cleanMinigameType = "Lockpicking"
        } elseif ($cleanMinigameType -match "AbandonedBunkerVoltageMatching") {
            $cleanMinigameType = "Bunker Voltage Puzzle"
        } elseif ($cleanMinigameType -match "AbandonedBunkerMasterSwitchboard") {
            $cleanMinigameType = "Bunker Switchboard"
        } elseif ($cleanMinigameType -match "AbandonedBunkerDialPad") {
            $cleanMinigameType = "Bunker Dial Pad"
        } elseif ($cleanMinigameType -match "QuestBook") {
            $cleanMinigameType = "Quest Book"
        }
        
        $fields += @{
            name = "Minigame"
            value = "$cleanMinigameType"
            inline = $true
        }
    }
    
    if ($null -ne $GameplayActivity.Success) {
        $fields += @{
            name = "Success"
            value = if ($GameplayActivity.Success) { ":white_check_mark: Yes" } else { ":x: No" }
            inline = $true
        }
    }

    if ($GameplayActivity.ElapsedTime) {
        $fields += @{
            name = "Time"
            value = "$($GameplayActivity.ElapsedTime)s"
            inline = $true
        }
    }
    
    if ($GameplayActivity.FailedAttempts -and $GameplayActivity.FailedAttempts -gt 0) {
        $fields += @{
            name = "Failed Attempts"
            value = "$($GameplayActivity.FailedAttempts)"
            inline = $true
        }
    }
    
    # For lockpicking
    if ($GameplayActivity.TargetObject) {
        $fields += @{
            name = "Target"
            value = "$($GameplayActivity.TargetObject)"
            inline = $true
        }
    }
    
    if ($GameplayActivity.LockType) {
        $fields += @{
            name = "Lock Type"
            value = "$($GameplayActivity.LockType)"
            inline = $true
        }
    }
    
    
    # Owner information (split into multiple fields like Player info)
    if ($GameplayActivity.UserOwnerName) {
        $fields += @{
            name = "Owner"
            value = "$($GameplayActivity.UserOwnerName)"
            inline = $true
        }
        
        if ($GameplayActivity.UserOwnerPlayerId) {
            $fields += @{
                name = "Owner ID"
                value = "$($GameplayActivity.UserOwnerPlayerId)"
                inline = $true
            }
        }
        
        if ($GameplayActivity.UserOwnerSteamId) {
            $fields += @{
                name = "Owner SteamID"
                value = "$($GameplayActivity.UserOwnerSteamId)"
                inline = $true
            }
        }
    }
    
    # For explosives/traps - add structured fields
    if ($GameplayActivity.ItemName) {
        $fields += @{
            name = "Item/Weapon"
            value = "$($GameplayActivity.ItemName)"
            inline = $true
        }
    }
    
    # For traps - add trap name field
    if ($GameplayActivity.TrapName) {
        $fields += @{
            name = "Trap Name"
            value = "$($GameplayActivity.TrapName)"
            inline = $true
        }
    }
    
    # For traps - add action field
    if ($GameplayActivity.Action -and $GameplayActivity.Type -eq "trap") {
        $fields += @{
            name = "Action"
            value = "$($GameplayActivity.Action)"
            inline = $true
        }
    }
    
    # For traps - parse owner info if embedded in TrapOwner field
    if ($GameplayActivity.TrapOwner) {
        # Try to parse "OwnerName (ID, SteamID)" format
        if ($GameplayActivity.TrapOwner -match '^(.+?)\s*\((\d+),\s*(\d+)\)') {
            $trapOwnerName = $matches[1].Trim()
            $trapOwnerPlayerId = $matches[2]
            $trapOwnerSteamId = $matches[3]
            
            $fields += @{
                name = "Owner"
                value = "$trapOwnerName"
                inline = $true
            }
            
            $fields += @{
                name = "Owner ID"
                value = "$trapOwnerPlayerId"
                inline = $true
            }
            
            $fields += @{
                name = "Owner SteamID"
                value = "$trapOwnerSteamId"
                inline = $true
            }
        } else {
            # Fallback to simple display
            $fields += @{
                name = "Owner"
                value = "$($GameplayActivity.TrapOwner)"
                inline = $true
            }
        }
    }
    
    # Use direct trap owner fields if available (new format)
    if ($GameplayActivity.TrapOwnerName -and -not $GameplayActivity.TrapOwner) {
        $fields += @{
            name = "Owner"
            value = "$($GameplayActivity.TrapOwnerName)"
            inline = $true
        }
        
        if ($GameplayActivity.TrapOwnerPlayerId) {
            $fields += @{
                name = "Owner ID" 
                value = "$($GameplayActivity.TrapOwnerPlayerId)"
                inline = $true
            }
        }
        
        if ($GameplayActivity.TrapOwnerSteamId) {
            $fields += @{
                name = "Owner SteamID"
                value = "$($GameplayActivity.TrapOwnerSteamId)"
                inline = $true
            }
        }
    }
    
    # For explosive activities - structured fields
    if ($GameplayActivity.ExplosiveAction) {
        $fields += @{
            name = "Action"
            value = $GameplayActivity.ExplosiveAction
            inline = $true
        }
    }
    
    if ($GameplayActivity.ExplosiveType) {
        $fields += @{
            name = "Explosive Type"
            value = $GameplayActivity.ExplosiveType
            inline = $true
        }
    }
    
    # For bunker activities - structured fields
    if ($GameplayActivity.BunkerCode) {
        $fields += @{
            name = "Bunker"
            value = $GameplayActivity.BunkerCode
            inline = $true
        }
    }
    
    if ($GameplayActivity.BunkerStatus) {
        $fields += @{
            name = "Status"
            value = $GameplayActivity.BunkerStatus
            inline = $true
        }
    }
    
    if ($GameplayActivity.ActivationTime) {
        $fields += @{
            name = "Activation Time"
            value = $GameplayActivity.ActivationTime
            inline = $true
        }
    }
    
    # For dialpad activities - structured fields
    if ($GameplayActivity.Combination) {
        $fields += @{
            name = "Combination"
            value = "$($GameplayActivity.Combination)"
            inline = $true
        }
    }
    
    if ($GameplayActivity.AttemptType) {
        $fields += @{
            name = "Attempt"
            value = $GameplayActivity.AttemptType
            inline = $true
        }
    }
    
    if ($GameplayActivity.RoomId) {
        $fields += @{
            name = "Room"
            value = $GameplayActivity.RoomId
            inline = $true
        }
    }
    
    # For bomb defusal - structured fields
    if ($GameplayActivity.DefusalResult) {
        $fields += @{
            name = "Defusal Result"
            value = $GameplayActivity.DefusalResult
            inline = $true
        }
    }
    
    if ($GameplayActivity.BombType) {
        $fields += @{
            name = "Bomb Type"
            value = $GameplayActivity.BombType
            inline = $true
        }
    }
    
    # For bomb defusal - parse bomb owner if available
    if ($GameplayActivity.BombOwner) {
        # Parse "OwnerName (ID, SteamID)" format or just ID
        if ($GameplayActivity.BombOwner -match "^([^(]+)\s*\((\d+),\s*(\d+)\)") {
            $bombOwnerName = $matches[1].Trim()
            $bombOwnerId = $matches[2].Trim()
            $bombOwnerSteamId = $matches[3].Trim()
            
            $fields += @{
                name = "Owner"
                value = $bombOwnerName
                inline = $true
            }
            
            $fields += @{
                name = "Owner ID"
                value = "$bombOwnerId"
                inline = $true
            }
            
            $fields += @{
                name = "Owner SteamID"
                value = "$bombOwnerSteamId"
                inline = $true
            }
        } elseif ($GameplayActivity.BombOwner -match "^(\d+)\(\)$") {
            # Handle format like "0()" for system/unknown owner
            $bombOwnerId = $matches[1]
            
            $fields += @{
                name = "Owner"
                value = if ($bombOwnerId -eq "0") { "System/Unknown" } else { "Player ID $bombOwnerId" }
                inline = $true
            }
        }
    }
    
    # For flags - structured flag information
    if ($GameplayActivity.FlagId) {
        $fields += @{
            name = "Flag ID"
            value = "$($GameplayActivity.FlagId)"
            inline = $true
        }
    }
    
    # For flag owner - parse similar to trap owner
    if ($GameplayActivity.FlagOwner) {
        if ($GameplayActivity.FlagOwner -match '^(.+?)\s*\((\d+),\s*(\d+)\)') {
            $flagOwnerName = $matches[1].Trim()
            $flagOwnerPlayerId = $matches[2]
            $flagOwnerSteamId = $matches[3]
            
            $fields += @{
                name = "Owner"
                value = "$flagOwnerName"
                inline = $true
            }
            
            $fields += @{
                name = "Owner ID"
                value = "$flagOwnerPlayerId"
                inline = $true
            }
            
            $fields += @{
                name = "Owner SteamID"
                value = "$flagOwnerSteamId"
                inline = $true
            }
        } else {
            $fields += @{
                name = "Owner"
                value = "$($GameplayActivity.FlagOwner)"
                inline = $true
            }
        }
    }

    # Location (always last field if present)
    if ($GameplayActivity.Location) {
        $fields += @{
            name = "Location"
            value = "$($GameplayActivity.Location)"
            inline = $false
        }
    }
    
    return @{
        title = "$emoji $title"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# ADMIN EMBEDS
# ===============================================================
function Send-AdminEmbed {
    param(
        [hashtable]$AdminAction
    )
    
    # Get emoji, title and color based on action type
    $emoji = ":shield:"
    $title = "Admin Action"
    $color = $script:EmbedColors.AdminCommand  # Default
    
    switch ($AdminAction.Type) {
        "spawn" { 
            $emoji = ":package:"
            $title = "Item Spawn"
            $color = $script:EmbedColors.AdminPositive
        }
        "vehicle" { 
            $emoji = ":red_car:"
            $title = "Vehicle Spawn"
            $color = $script:EmbedColors.AdminPositive
        }
        "zombie" { 
            $emoji = ":zombie:"
            $title = "Zombie Spawn"
            $color = $script:EmbedColors.AdminNeutral
        }
        "teleport" { 
            $emoji = ":round_pushpin:"
            $title = "Player Teleport"
            $color = $script:EmbedColors.AdminNeutral
        }
        "kill" { 
            $emoji = ":skull:"
            $title = "Player Kill"
            $color = $script:EmbedColors.AdminNegative
        }
        "ban" { 
            $emoji = ":hammer:"
            $title = "Player Ban"
            $color = $script:EmbedColors.AdminNegative
        }
        "location" { 
            $emoji = ":mag:"
            $title = "Location Check"
            $color = $script:EmbedColors.AdminNeutral
        }
        "currency" { 
            $emoji = ":coin:"
            $title = "Currency Adjustment"
            $color = $script:EmbedColors.AdminPositive
        }
        "fame" { 
            $emoji = ":star:"
            $title = "Fame Points"
            $color = $script:EmbedColors.AdminPositive
        }
        "time" { 
            $emoji = ":clock:"
            $title = "Time Control"
            $color = $script:EmbedColors.AdminNeutral
        }
        "weather" { 
            $emoji = ":cloud:"
            $title = "Weather Change"
            $color = $script:EmbedColors.AdminNeutral
        }
        "announce" { 
            $emoji = ":loudspeaker:"
            $title = "Server Announcement"
            $color = $script:EmbedColors.AdminCommand
        }
        "cleanup" { 
            $emoji = ":broom:"
            $title = "Server Cleanup"
            $color = $script:EmbedColors.AdminCommand
        }
        "info" { 
            $emoji = ":information_source:"
            $title = "Info Request"
            $color = $script:EmbedColors.AdminNeutral
        }
        "event" { 
            $emoji = ":trophy:"
            $title = "Event Management"
            $color = $script:EmbedColors.AdminPositive
        }
        "give" { 
            $emoji = ":gift:"
            $title = "Item Give"
            $color = $script:EmbedColors.AdminPositive
        }
        "command" { 
            $emoji = ":zap:"
            $title = "Admin Command"
            $color = $script:EmbedColors.AdminCommand
        }
        default { 
            $emoji = ":shield:"
            $title = "Admin Action"
            $color = $script:EmbedColors.AdminCommand
        }
    }
    
    $fields = @(
        @{
            name = "Admin"
            value = "$($AdminAction.AdminName)"
            inline = $true
        },
        @{
            name = "Player ID"
            value = "$($AdminAction.PlayerId)"
            inline = $true
        },
        @{
            name = "SteamID"
            value = "$($AdminAction.SteamId)"
            inline = $true
        }
    )
    
    if ($AdminAction.Command) {
        $fields += @{
            name = "Command"
            value = "$($AdminAction.Command)"
            inline = $false
        }
    }
    
    return @{
        title = "$emoji $title"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# ECONOMY EMBED FUNCTION
# ===============================================================
function Send-EconomyEmbed {
    param(
        [hashtable]$EconomyAction
    )
    
    # Get emoji, title and color based on economy action type
    $emoji = ":moneybag:"
    $title = "Economy Activity"
    $color = $script:EmbedColors.EconomySell  # Default
    
    switch ($EconomyAction.Type) {
        "sell" { 
            $emoji = ":moneybag:"
            $title = "Item Sale"
            $color = $script:EmbedColors.EconomySell
        }
        "buy" { 
            $emoji = ":shopping_cart:"
            $title = "Item Purchase"
            $color = $script:EmbedColors.EconomyBuy
        }
        "mechanic" { 
            $emoji = ":wrench:"
            $title = "Mechanic Service"
            $color = $script:EmbedColors.EconomyMechanic
        }
        "bank_deposit" { 
            $emoji = ":bank:"
            $title = "Bank Deposit"
            $color = $script:EmbedColors.EconomyDeposit
        }
        "bank_withdraw" { 
            $emoji = ":atm:"
            $title = "Bank Withdrawal"
            $color = $script:EmbedColors.EconomyWithdraw
        }
        "bank_card" { 
            $emoji = ":credit_card:"
            $title = "Bank Card Purchase"
            $color = $script:EmbedColors.EconomyCard
        }
        "bank_card_destroy" { 
            $emoji = ":wastebasket:"
            $title = "Card Destroyed"
            $color = $script:EmbedColors.EconomyDestroy
        }
        "currency_conversion" { 
            $emoji = ":scales:"
            $title = "Currency Exchange"
            $color = $script:EmbedColors.EconomyExchange
        }
        "gold_sale" { 
            $emoji = ":coin:"
            $title = "Gold Sale"
            $color = $script:EmbedColors.EconomyExchange
        }
        "squad_penalty" { 
            $emoji = ":warning:"
            $title = "Squad Penalty"
            $color = $script:EmbedColors.EconomyPenalty
        }
    }
    
    $fields = @(
        @{
            name = "Player"
            value = "$($EconomyAction.PlayerName)"
            inline = $true
        }
    )

    if ($EconomyAction.SteamId) {
        $fields += @{
            name = "SteamID"
            value = "$($EconomyAction.SteamId)"
            inline = $true
        }
    } else {
        $fields += @{
            name = "SteamID"
            value = "N/A"
            inline = $true
        }
    }

    # Type-specific structured fields
    switch ($EconomyAction.Type) {
        "sell" {
            $fields += @{
                name = "Transaction"
                value = "Sold"
                inline = $true
            }
            
            # Handle multiple items or single item
            if ($EconomyAction.Items) {
                # Multiple items
                $itemList = @()
                foreach ($itemInfo in $EconomyAction.Items) {
                    $cleanItemId = $itemInfo.Item -replace " \(x\d+\)", ""
                    $quantity = 1
                    if ($itemInfo.Item -match " \(x(\d+)\)") {
                        $quantity = [int]$matches[1]
                    }
                    
                    $displayName = Get-ItemDisplayName -ItemId $cleanItemId
                    $itemDisplay = if ($quantity -gt 1) {
                        "$displayName (x$quantity)"
                    } else {
                        $displayName
                    }
                    $itemList += "$itemDisplay - $($itemInfo.Amount) credits"
                }
                
                $fields += @{
                    name = "Items Sold"
                    value = $itemList -join "`n"
                    inline = $false
                }
                
                $fields += @{
                    name = "Total Credits"
                    value = "$($EconomyAction.TotalAmount)"
                    inline = $true
                }
            } else {
                # Single item (backward compatibility)
                if ($EconomyAction.Item) {
                    # Clean up item ID and extract quantity
                    $cleanItemId = $EconomyAction.Item -replace " \(x\d+\)", ""
                    $quantity = 1
                    if ($EconomyAction.Item -match " \(x(\d+)\)") {
                        $quantity = [int]$matches[1]
                    }
                    
                    # Get display name from JSON
                    $displayName = Get-ItemDisplayName -ItemId $cleanItemId
                    
                    $itemDisplay = if ($quantity -gt 1) {
                        "$displayName (x$quantity)"
                    } else {
                        $displayName
                    }
                    
                    $fields += @{
                        name = "Item"
                        value = "$itemDisplay"
                        inline = $true
                    }
                    
                    # Add ItemID field showing original SCUM item ID
                    $itemIdDisplay = if ($quantity -gt 1) {
                        "$cleanItemId (x$quantity)"
                    } else {
                        $cleanItemId
                    }
                    
                    $fields += @{
                        name = "ItemID"
                        value = "$itemIdDisplay"
                        inline = $true
                    }
                }
                
                if ($EconomyAction.Amount) {
                    $fields += @{
                        name = "Credits"
                        value = "$($EconomyAction.Amount)"
                        inline = $true
                    }
                }
            }

            # Financial states (Before/After transaction)
            if ($EconomyAction.BeforeCash -ne $null -and $EconomyAction.AfterCash -ne $null) {
                $fields += @{
                    name = "Player Cash"
                    value = "$($EconomyAction.BeforeCash) -> $($EconomyAction.AfterCash)"
                    inline = $true
                }
            }
            
            if ($EconomyAction.BeforeAccount -ne $null -and $EconomyAction.AfterAccount -ne $null) {
                $fields += @{
                    name = "Bank Account"
                    value = "$($EconomyAction.BeforeAccount) -> $($EconomyAction.AfterAccount)"
                    inline = $true
                }
            }            
            
            if ($EconomyAction.Trader) {
                # Parse trader information
                $traderDisplay = $EconomyAction.Trader
                if ($traderDisplay -match "^([A-Z])_(\d+)_(.+)$") {
                    $sector = $matches[1] + $matches[2]
                    $traderType = $matches[3]
                    $readableType = switch ($traderType) {
                        "Mechanic" { "Mechanic" }
                        "Trader" { "General Store" }
                        "Armory" { "Armory" }
                        "BoatShop" { "Boat Shop" }
                        "TradeSaloon" { "Trade Saloon" }
                        "Bunker" { "Bunker Trader" }
                        default { $traderType }
                    }
                    $traderDisplay = "$readableType ($sector)"
                }
                
                $fields += @{
                    name = "Trader"
                    value = "$traderDisplay"
                    inline = $true
                }
            }
            
            if ($EconomyAction.BeforeTraderFunds -ne $null -and $EconomyAction.AfterTraderFunds -ne $null) {
                $fields += @{
                    name = "Trader Funds"
                    value = "$($EconomyAction.BeforeTraderFunds) -> $($EconomyAction.AfterTraderFunds)"
                    inline = $true
                }
            }
        }
        
        "buy" {
            $fields += @{
                name = "Transaction"
                value = "Purchased"
                inline = $true
            }
            
            # Handle multiple items or single item
            if ($EconomyAction.Items) {
                # Multiple items
                $itemList = @()
                foreach ($itemInfo in $EconomyAction.Items) {
                    $cleanItemId = $itemInfo.Item -replace " \(x\d+\)", ""
                    $quantity = 1
                    if ($itemInfo.Item -match " \(x(\d+)\)") {
                        $quantity = [int]$matches[1]
                    }
                    
                    $displayName = Get-ItemDisplayName -ItemId $cleanItemId
                    $itemDisplay = if ($quantity -gt 1) {
                        "$displayName (x$quantity)"
                    } else {
                        $displayName
                    }
                    $itemList += "$itemDisplay - $($itemInfo.Amount) credits"
                }
                
                $fields += @{
                    name = "Items Purchased"
                    value = $itemList -join "`n"
                    inline = $false
                }
                
                $fields += @{
                    name = "Total Credits"
                    value = "$($EconomyAction.TotalAmount)"
                    inline = $true
                }
            } else {
                # Single item (backward compatibility)
                if ($EconomyAction.Item) {
                    # Clean up item ID and extract quantity
                    $cleanItemId = $EconomyAction.Item -replace " \(x\d+\)", ""
                    $quantity = 1
                    if ($EconomyAction.Item -match " \(x(\d+)\)") {
                        $quantity = [int]$matches[1]
                    }
                    
                    # Get display name from JSON
                    $displayName = Get-ItemDisplayName -ItemId $cleanItemId
                    
                    $itemDisplay = if ($quantity -gt 1) {
                        "$displayName (x$quantity)"
                    } else {
                        $displayName
                    }
                    
                    $fields += @{
                        name = "Item"
                        value = "$itemDisplay"
                        inline = $true
                    }
                    
                    # Add ItemID field showing original SCUM item ID
                    $itemIdDisplay = if ($quantity -gt 1) {
                        "$cleanItemId (x$quantity)"
                    } else {
                        $cleanItemId
                    }
                    
                    $fields += @{
                        name = "ItemID"
                        value = "$itemIdDisplay"
                        inline = $true
                    }
                }
                
                if ($EconomyAction.Amount) {
                    $fields += @{
                        name = "Credits"
                        value = "$($EconomyAction.Amount)"
                        inline = $true
                    }
                }
            }

            # Financial states (Before/After transaction)
            if ($null -ne $EconomyAction.BeforeCash -and $null -ne $EconomyAction.AfterCash) {
                $fields += @{
                    name = "Player Cash"
                    value = "$($EconomyAction.BeforeCash) -> $($EconomyAction.AfterCash)"
                    inline = $true
                }
            }
            
            if ($null -ne $EconomyAction.BeforeAccount -and $null -ne $EconomyAction.AfterAccount) {
                $fields += @{
                    name = "Bank Account"
                    value = "$($EconomyAction.BeforeAccount) -> $($EconomyAction.AfterAccount)"
                    inline = $true
                }
            }            
            
            if ($EconomyAction.Trader) {
                $traderDisplay = $EconomyAction.Trader
                if ($traderDisplay -match "^([A-Z])_(\d+)_(.+)$") {
                    $sector = $matches[1] + $matches[2]
                    $traderType = $matches[3]
                    $readableType = switch ($traderType) {
                        "Mechanic" { "Mechanic" }
                        "Trader" { "General Store" }
                        "Armory" { "Armory" }
                        "BoatShop" { "Boat Shop" }
                        "TradeSaloon" { "Trade Saloon" }
                        "Bunker" { "Bunker Trader" }
                        default { $traderType }
                    }
                    $traderDisplay = "$readableType ($sector)"
                }
                
                $fields += @{
                    name = "Trader"
                    value = "$traderDisplay"
                    inline = $true
                }
            }
            
            if ($null -ne $EconomyAction.BeforeTraderFunds -and $null -ne $EconomyAction.AfterTraderFunds) {
                $fields += @{
                    name = "Trader Funds"
                    value = "$($EconomyAction.BeforeTraderFunds) -> $($EconomyAction.AfterTraderFunds)"
                    inline = $true
                }
            }
        }
        
        "mechanic" {
            $fields += @{
                name = "Transaction"
                value = "Service"
                inline = $true
            }
            
            if ($EconomyAction.Service) {
                $fields += @{
                    name = "Service"
                    value = "$($EconomyAction.Service)"
                    inline = $true
                }
            }
            
            if ($EconomyAction.Amount) {
                $fields += @{
                    name = "Credits"
                    value = "$($EconomyAction.Amount)"
                    inline = $true
                }
            }
            
            if ($EconomyAction.Trader) {
                $traderDisplay = $EconomyAction.Trader
                if ($traderDisplay -match "^([A-Z])_(\d+)_(.+)$") {
                    $sector = $matches[1] + $matches[2]
                    $traderType = $matches[3]
                    $readableType = switch ($traderType) {
                        "Mechanic" { "Mechanic" }
                        "Trader" { "General Store" }
                        "Armory" { "Armory" }
                        "BoatShop" { "Boat Shop" }
                        "TradeSaloon" { "Trade Saloon" }
                        "Bunker" { "Bunker Trader" }
                        default { $traderType }
                    }
                    $traderDisplay = "$readableType ($sector)"
                }
                
                $fields += @{
                    name = "Trader"
                    value = "$traderDisplay"
                    inline = $true
                }
            }
        }
        
        "bank_deposit" {
            $fields += @{
                name = "Transaction"
                value = "Deposit"
                inline = $true
            }
            
            if ($EconomyAction.Amount) {
                $fields += @{
                    name = "Amount"
                    value = "$($EconomyAction.Amount) credits"
                    inline = $true
                }
            }
            
            if ($EconomyAction.NetAmount -and $EconomyAction.NetAmount -ne $EconomyAction.Amount) {
                $fields += @{
                    name = "Net Amount"
                    value = "$($EconomyAction.NetAmount) credits"
                    inline = $true
                }
            }
        }
        
        "bank_withdraw" {
            $fields += @{
                name = "Transaction"
                value = "Withdrawal"
                inline = $true
            }
            
            if ($EconomyAction.Amount) {
                $fields += @{
                    name = "Amount"
                    value = "$($EconomyAction.Amount) credits"
                    inline = $true
                }
            }
            
            if ($EconomyAction.NetAmount -and $EconomyAction.NetAmount -ne $EconomyAction.Amount) {
                $fields += @{
                    name = "Net Amount"
                    value = "$($EconomyAction.NetAmount) credits"
                    inline = $true
                }
            }
        }
        
        "bank_card" {
            $fields += @{
                name = "Transaction"
                value = "Card Purchase"
                inline = $true
            }
            
            if ($EconomyAction.CardType) {
                $fields += @{
                    name = "Card Type"
                    value = "$($EconomyAction.CardType)"
                    inline = $true
                }
            }
            
            if ($EconomyAction.Balance) {
                $fields += @{
                    name = "New Balance"
                    value = "$($EconomyAction.Balance) credits"
                    inline = $true
                }
            }
        }
        
        "bank_card_destroy" {
            $fields += @{
                name = "Transaction"
                value = "Card Destroyed"
                inline = $true
            }
            
            if ($EconomyAction.CardType) {
                $fields += @{
                    name = "Card Type"
                    value = "$($EconomyAction.CardType)"
                    inline = $true
                }
            }
        }
        
        "currency_conversion" {
            $fields += @{
                name = "Transaction"
                value = "Currency Exchange"
                inline = $true
            }
            
            # Determine transaction direction from Action text
            $isCreditsToGold = $EconomyAction.Action -match "credits to.*gold"
            $isGoldToCredits = $EconomyAction.Action -match "gold to.*credits"
            
            if ($isCreditsToGold) {
                # Credits → Gold (Purchase)
                if ($EconomyAction.CreditsAmount) {
                    $fields += @{
                        name = "Credits Used"
                        value = "$($EconomyAction.CreditsAmount) credits"
                        inline = $true
                    }
                }
                
                if ($EconomyAction.GoldAmount) {
                    $fields += @{
                        name = "Gold Received"
                        value = "$($EconomyAction.GoldAmount) gold"
                        inline = $true
                    }
                }
            } elseif ($isGoldToCredits) {
                # Gold → Credits (Sale)
                if ($EconomyAction.GoldAmount) {
                    $fields += @{
                        name = "Gold Used"
                        value = "$($EconomyAction.GoldAmount) gold"
                        inline = $true
                    }
                }
                
                if ($EconomyAction.CreditsAmount) {
                    $fields += @{
                        name = "Credits Received"
                        value = "$($EconomyAction.CreditsAmount) credits"
                        inline = $true
                    }
                }
            } else {
                # Fallback for unknown direction
                if ($EconomyAction.CreditsAmount) {
                    $fields += @{
                        name = "Credits Amount"
                        value = "$($EconomyAction.CreditsAmount) credits"
                        inline = $true
                    }
                }
                
                if ($EconomyAction.GoldAmount) {
                    $fields += @{
                        name = "Gold Amount"
                        value = "$($EconomyAction.GoldAmount) gold"
                        inline = $true
                    }
                }
            }
            
            # Financial states (Before/After transaction)
            if ($null -ne $EconomyAction.BeforeCash -and $null -ne $EconomyAction.AfterCash) {
                $fields += @{
                    name = "Player Cash"
                    value = "$($EconomyAction.BeforeCash) -> $($EconomyAction.AfterCash)"
                    inline = $true
                }
            }
            
            if ($null -ne $EconomyAction.BeforeAccount -and $null -ne $EconomyAction.AfterAccount) {
                $fields += @{
                    name = "Bank Account"
                    value = "$($EconomyAction.BeforeAccount) -> $($EconomyAction.AfterAccount)"
                    inline = $true
                }
            }
            
            if ($null -ne $EconomyAction.BeforeGold -and $null -ne $EconomyAction.AfterGold) {
                $fields += @{
                    name = "Gold Balance"
                    value = "$($EconomyAction.BeforeGold) -> $($EconomyAction.AfterGold)"
                    inline = $true
                }
            }
        }
        
        "gold_sale" {
            $fields += @{
                name = "Transaction"
                value = "Gold Sale"
                inline = $true
            }
            
            if ($EconomyAction.GoldAmount) {
                $fields += @{
                    name = "Gold Sold"
                    value = "$($EconomyAction.GoldAmount) gold"
                    inline = $true
                }
            }
            
            if ($EconomyAction.CreditsAmount) {
                $fields += @{
                    name = "Credits Received"
                    value = "$($EconomyAction.CreditsAmount) credits"
                    inline = $true
                }
            }
            
            # Financial states (Before/After transaction)
            if ($null -ne $EconomyAction.BeforeCash -and $null -ne $EconomyAction.AfterCash) {
                $fields += @{
                    name = "Player Cash"
                    value = "$($EconomyAction.BeforeCash) -> $($EconomyAction.AfterCash)"
                    inline = $true
                }
            }
            
            if ($null -ne $EconomyAction.BeforeAccount -and $null -ne $EconomyAction.AfterAccount) {
                $fields += @{
                    name = "Bank Account"
                    value = "$($EconomyAction.BeforeAccount) -> $($EconomyAction.AfterAccount)"
                    inline = $true
                }
            }
            
            if ($null -ne $EconomyAction.BeforeGold -and $null -ne $EconomyAction.AfterGold) {
                $fields += @{
                    name = "Gold Balance"
                    value = "$($EconomyAction.BeforeGold) -> $($EconomyAction.AfterGold)"
                    inline = $true
                }
            }
        }
        
        "squad_penalty" {
            $fields += @{
                name = "Transaction"
                value = "Squad Penalty"
                inline = $true
            }
            
            if ($EconomyAction.PenaltyAmount) {
                $fields += @{
                    name = "Penalty"
                    value = "$($EconomyAction.PenaltyAmount) credits"
                    inline = $true
                }
            }
        }
        
        default {
            # Fallback - show full action description
            if ($EconomyAction.Action) {
                $fields += @{
                    name = "Transaction"
                    value = "$($EconomyAction.Action)"
                    inline = $true
                }
            }
        }
    }
    
    # Location if available
    if ($EconomyAction.Location) {
        $fields += @{
            name = "Location"
            value = "$($EconomyAction.Location)"
            inline = $false
        }
    }

    return @{
        title = "$emoji $title"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# EVENT KILL EMBEDS
# ===============================================================
function Send-EventKillEmbed {
    param(
        [hashtable]$EventKillAction
    )
    
    # Get emoji, title and color based on event kill type
    $emoji = ":crossed_swords:"
    $title = "Event Kill"
    $color = $script:EmbedColors.EventKillGeneral  # Default
    
    switch ($EventKillAction.Type) {
        "ranged" { 
            $emoji = ":gun:"
            $title = "Event Ranged Kill"
            $color = $script:EmbedColors.EventKillRanged
        }
        "melee" { 
            $emoji = ":dagger:"
            $title = "Event Melee Kill"
            $color = $script:EmbedColors.EventKillMelee
        }
        "event_kill" { 
            $emoji = ":crossed_swords:"
            $title = "Event Kill"
            $color = $script:EmbedColors.EventKillGeneral
        }
        default { 
            $emoji = ":skull:"
            $title = "Event Kill"
            $color = $script:EmbedColors.EventKillGeneral
        }
    }
    
    $fields = @(
        @{
            name = "Killer"
            value = "$($EventKillAction.KillerName)"
            inline = $true
        },
        @{
            name = "Victim"
            value = "$($EventKillAction.VictimName)"
            inline = $true
        }
    )

    # Killer SteamID
    if ($EventKillAction.KillerSteamId) {
        $fields += @{
            name = "Killer SteamID"
            value = "$($EventKillAction.KillerSteamId)"
            inline = $true
        }
    } else {
        $fields += @{
            name = "Killer SteamID"
            value = "N/A"
            inline = $true
        }
    }

    # Victim SteamID
    if ($EventKillAction.VictimSteamId) {
        $fields += @{
            name = "Victim SteamID"
            value = "$($EventKillAction.VictimSteamId)"
            inline = $true
        }
    } else {
        $fields += @{
            name = "Victim SteamID"
            value = "N/A"
            inline = $true
        }
    }

    # Weapon information
    if ($EventKillAction.WeaponName) {
        # Convert weapon ID to display name if it's an item ID
        $displayWeaponName = Get-ItemDisplayName -ItemId $EventKillAction.WeaponName
        
        $fields += @{
            name = "Weapon"
            value = "$displayWeaponName"
            inline = $true
        }
        
        # Add weapon ID if different from display name
        if ($displayWeaponName -ne $EventKillAction.WeaponName) {
            $fields += @{
                name = "Weapon ID"
                value = "$($EventKillAction.WeaponName)"
                inline = $true
            }
        }
    }

    # Weapon type
    if ($EventKillAction.WeaponType) {
        $fields += @{
            name = "Weapon Type"
            value = "$($EventKillAction.WeaponType)"
            inline = $true
        }
    }

    # Distance (if available) - but not for explosions since they occur at point of contact
    if ($EventKillAction.Distance -and $EventKillAction.Distance -gt 0 -and $EventKillAction.WeaponType -ne "explosion") {
        $fields += @{
            name = "Distance"
            value = "$($EventKillAction.Distance)m"
            inline = $true
        }
    }

    # Action description
    if ($EventKillAction.Action) {
        $fields += @{
            name = "Event Action"
            value = "$($EventKillAction.Action)"
            inline = $true
        }
    }

    # Location if available
    if ($EventKillAction.Location) {
        $fields += @{
            name = "Location"
            value = "$($EventKillAction.Location)"
            inline = $false
        }
    }

    # Event marker
    $fields += @{
        name = "Event Type"
        value = "Game Event Kill"
        inline = $true
    }

    return @{
        title = "$emoji $title"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# KILL LOG EMBEDS
# ===============================================================
function Send-KillEmbed {
    param(
        [hashtable]$KillAction
    )
    
    # Handle suicide vs PvP kills differently
    if ($KillAction.Type -eq "suicide") {
        # Suicide embed
        $emoji = ":skull:"
        $title = "Suicide"
        $color = $script:EmbedColors.KillSuicide
        
        $fields = @(
            @{
                name = "Player"
                value = "$($KillAction.VictimName)"
                inline = $true
            }
        )

        if ($KillAction.VictimPlayerId) {
            $fields += @{
                name = "Player ID"
                value = "$($KillAction.VictimPlayerId)"
                inline = $true
            }
        }        

        if ($KillAction.VictimSteamId) {
            $fields += @{
                name = "SteamID"
                value = "$($KillAction.VictimSteamId)"
                inline = $true
            }
        } else {
            $fields += @{
                name = "SteamID"
                value = "N/A"
                inline = $true
            }
        }

        if ($KillAction.Squad) {
            $fields += @{
                name = "Squad"
                value = "$($KillAction.Squad)"
                inline = $true
            }
        }

        if ($KillAction.Location) {
            $fields += @{
                name = "Location"
                value = "$($KillAction.Location)"
                inline = $false
            }
        }

        return @{
            title = "$emoji $title"
            color = $color
            fields = $fields
            footer = $script:StandardFooter
            timestamp = Get-StandardTimestamp
        }
    } else {
        # PvP Kill embed
        $emoji = ":crossed_swords:"
        $title = "PvP Kill"
        $color = $script:EmbedColors.KillPvP  # Default
        
        # Determine color, emoji and title based on weapon type
        if ($KillAction.WeaponType) {
            switch ($KillAction.WeaponType.ToLower()) {
                "projectile" { 
                    $emoji = ":gun:"
                    $title = "Ranged Kill"
                    $color = $script:EmbedColors.KillRanged
                }
                "melee" { 
                    $emoji = ":dagger:"
                    $title = "Melee Kill"
                    $color = $script:EmbedColors.KillMelee
                }
                "explosion" { 
                    $emoji = ":boom:"
                    $title = "Explosive Kill"
                    $color = $script:EmbedColors.KillExplosive
                }
                default { 
                    $emoji = ":crossed_swords:"
                    $title = "PvP Kill"
                    $color = $script:EmbedColors.KillPvP
                }
            }
        }
        
        $fields = @(
            @{
                name = "Killer"
                value = "$($KillAction.KillerName)"
                inline = $true
            },
            @{
                name = "Victim"
                value = "$($KillAction.VictimName)"
                inline = $true
            }
        )

        # Killer SteamID
        if ($KillAction.KillerSteamId) {
            $fields += @{
                name = "Killer SteamID"
                value = "$($KillAction.KillerSteamId)"
                inline = $true
            }
        } else {
            $fields += @{
                name = "Killer SteamID"
                value = "N/A"
                inline = $true
            }
        }

        # Victim SteamID
        if ($KillAction.VictimSteamId) {
            $fields += @{
                name = "Victim SteamID"
                value = "$($KillAction.VictimSteamId)"
                inline = $true
            }
        } else {
            $fields += @{
                name = "Victim SteamID"
                value = "N/A"
                inline = $true
            }
        }

        # Weapon information with item conversion
        if ($KillAction.WeaponName) {
            # Convert weapon ID to display name if it's an item ID
            $displayWeaponName = Get-ItemDisplayName -ItemId $KillAction.WeaponName
            
            $fields += @{
                name = "Weapon"
                value = "$displayWeaponName"
                inline = $true
            }
            
            # Add weapon ID if different from display name
            if ($displayWeaponName -ne $KillAction.WeaponName) {
                $fields += @{
                    name = "Weapon ID"
                    value = "$($KillAction.WeaponName)"
                    inline = $true
                }
            }
        }

        # Weapon type
        if ($KillAction.WeaponType) {
            $fields += @{
                name = "Weapon Type"
                value = "$($KillAction.WeaponType)"
                inline = $true
            }
        }

        # Distance (if available) - but not for explosions since they occur at point of contact
        if ($KillAction.Distance -and $KillAction.Distance -gt 0 -and $KillAction.WeaponType -ne "explosion") {
            $fields += @{
                name = "Distance"
                value = "$($KillAction.Distance)m"
                inline = $true
            }
        }

        # Action description (if available)
        if ($KillAction.Action) {
            $fields += @{
                name = "Kill Action"
                value = "$($KillAction.Action)"
                inline = $true
            }
        }

        # Location if available
        if ($KillAction.Location) {
            $fields += @{
                name = "Location"
                value = "$($KillAction.Location)"
                inline = $false
            }
        }

        return @{
            title = "$emoji $title"
            color = $color
            fields = $fields
            footer = $script:StandardFooter
            timestamp = Get-StandardTimestamp
        }
    }
}

# ===============================================================
# QUEST EMBEDS
# ===============================================================
function Send-QuestEmbed {
    param(
        [hashtable]$QuestAction
    )

    # Determine action type and colors
    $emoji = ":scroll:"
    $title = "Quest Activity"
    $color = $script:EmbedColors.QuestNeutral

    if ($QuestAction.Action) {
        switch ($QuestAction.Action.ToLower()) {
            "completed" { 
                $emoji = ":white_check_mark:"
                $title = "Quest Completed"
                $color = $script:EmbedColors.QuestComplete
            }
            "abandoned" { 
                $emoji = ":x:"
                $title = "Quest Abandoned"
                $color = $script:EmbedColors.QuestFailed
            }
            "started" { 
                $emoji = ":arrow_forward:"
                $title = "Quest Started"
                $color = $script:EmbedColors.QuestStart
            }
            "failed" { 
                $emoji = ":no_entry:"
                $title = "Quest Failed"
                $color = $script:EmbedColors.QuestFailed
            }
            default {
                $emoji = ":scroll:"
                $title = "Quest Activity"
                $color = $script:EmbedColors.QuestNeutral
            }
        }
    }

    # Build fields
    $fields = @()

    # Player info
    $fields += @{
        name = "Player"
        value = "$($QuestAction.PlayerName)"
        inline = $true
    }

    if ($QuestAction.PlayerSteamId) {
        $fields += @{
            name = "Steam ID"
            value = "$($QuestAction.PlayerSteamId)"
            inline = $true
        }
    }

    # Quest info
    if ($QuestAction.QuestId) {
        $questName = $QuestAction.QuestId
        
        # Clean quest name for display
        $cleanQuestName = $questName -replace "^T\d+_", "" -replace "_", " "
        $cleanQuestName = (Get-Culture).TextInfo.ToTitleCase($cleanQuestName.ToLower())
        
        $fields += @{
            name = "Quest"
            value = "$cleanQuestName"
            inline = $true
        }

        $fields += @{
            name = "Quest ID"
            value = "$($QuestAction.QuestId)"
            inline = $true
        }
    }

    # Action type
    if ($QuestAction.Action) {
        $fields += @{
            name = "Action"
            value = "$($QuestAction.Action)"
            inline = $true
        }
    }

    # Rewards (if completed)
    if ($QuestAction.Action -eq "completed" -and $QuestAction.Rewards) {
        $rewardText = ""
        foreach ($reward in $QuestAction.Rewards) {
            if ($reward.ItemId -and (Get-Command "Get-ItemDisplayName" -ErrorAction SilentlyContinue)) {
                $itemName = Get-ItemDisplayName -ItemId $reward.ItemId
                $rewardText += "$($reward.Quantity)x $itemName`n"
            } else {
                $rewardText += "$($reward.Quantity)x $($reward.ItemId)`n"
            }
        }
        
        if ($rewardText) {
            $fields += @{
                name = "Rewards"
                value = $rewardText.Trim()
                inline = $true
            }
        }
    }

    # Location if available
    if ($QuestAction.Location) {
        $fields += @{
            name = "Location"
            value = "$($QuestAction.Location)"
            inline = $false
        }
    }

    # Quest tier info (based on ID pattern)
    if ($QuestAction.QuestId -and $QuestAction.QuestId -match "^T(\d+)_") {
        $tier = $matches[1]
        $fields += @{
            name = "Tier"
            value = "Tier $tier"
            inline = $true
        }
    }

    return @{
        title = "$emoji $title"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# RAID PROTECTION EMBEDS
# ===============================================================
function Send-RaidProtectionEmbed {
    param(
        [hashtable]$RaidProtectionAction
    )

    # Determine action type and colors
    $emoji = ":shield:"
    $title = "Raid Protection Activity"
    $color = $script:EmbedColors.RaidProtectionSet  # Default

    switch ($RaidProtectionAction.EventType) {
        "ProtectionScheduled" { 
            $emoji = ":clock1:"
            $title = "Protection Scheduled"
            $color = $script:EmbedColors.RaidProtectionSet
        }
        "ProtectionActivated" { 
            $emoji = ":shield:"
            $title = "Protection Activated"
            $color = $script:EmbedColors.RaidProtectionActive
        }
        "ProtectionEnded" { 
            $emoji = ":unlock:"
            $title = "Protection Ended"
            $color = $script:EmbedColors.RaidProtectionEnded
        }
        "ProtectionExpired" { 
            $emoji = ":hourglass:"
            $title = "Protection Expired"
            $color = $script:EmbedColors.RaidProtectionExpired
        }
        default { 
            $emoji = ":flag_white:"
            $title = "Raid Protection Activity"
            $color = $script:EmbedColors.RaidProtectionSet
        }
    }

    # Build fields
    $fields = @()

    # Flag info
    $fields += @{
        name = "Flag ID"
        value = "$($RaidProtectionAction.FlagId)"
        inline = $true
    }

    if ($RaidProtectionAction.OwnerId) {
        $fields += @{
            name = "Owner ID"
            value = "$($RaidProtectionAction.OwnerId)"
            inline = $true
        }
    }

    # Action description
    if ($RaidProtectionAction.Action) {
        $fields += @{
            name = "Event"
            value = "$($RaidProtectionAction.Action)"
            inline = $true
        }
    }

    # Duration info
    if ($RaidProtectionAction.Duration) {
        $durationHours = [math]::Round([double]$RaidProtectionAction.Duration / 3600, 1)
        $fields += @{
            name = "Duration"
            value = "${durationHours} hours"
            inline = $true
        }
    }

    # Start delay (for scheduled protection)
    if ($RaidProtectionAction.StartDelay) {
        $delayMinutes = [math]::Round([double]$RaidProtectionAction.StartDelay / 60, 0)
        $fields += @{
            name = "Starts In"
            value = "${delayMinutes} minutes"
            inline = $true
        }
    }

    # User info (for ended protection)
    if ($RaidProtectionAction.UserId) {
        $fields += @{
            name = "Triggered By"
            value = "Player ID $($RaidProtectionAction.UserId)"
            inline = $true
        }
    }

    # Reason
    if ($RaidProtectionAction.Reason) {
        $reasonText = switch ($RaidProtectionAction.Reason) {
            "player_login" { "Player Login" }
            "duration_expired" { "Duration Expired" }
            "server_shutdown" { "Server Shutdown" }
            "scheduled" { "Scheduled Activation" }
            default { $RaidProtectionAction.Reason }
        }
        
        $fields += @{
            name = "Reason"
            value = "$reasonText"
            inline = $true
        }
    }

    # Location info
    if ($RaidProtectionAction.LocationX -and $RaidProtectionAction.LocationY -and $RaidProtectionAction.LocationZ) {
        $x = [math]::Round([double]$RaidProtectionAction.LocationX, 0)
        $y = [math]::Round([double]$RaidProtectionAction.LocationY, 0) 
        $z = [math]::Round([double]$RaidProtectionAction.LocationZ, 0)
        
        $fields += @{
            name = "Location"
            value = "X: $x, Y: $y, Z: $z"
            inline = $false
        }
    }

    return @{
        title = "$emoji $title"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# VEHICLE EMBEDS
# ===============================================================
function Send-VehicleEmbed {
    param(
        [hashtable]$VehicleAction
    )

    # Determine action type and colors
    $emoji = ":car:"
    $title = "Vehicle Activity"
    $color = $script:EmbedColors.Vehicle  # Default

    switch ($VehicleAction.EventType) {
        "Destroyed" { 
            $emoji = ":boom:"
            $title = "Vehicle Destroyed"
            $color = $script:EmbedColors.VehicleDestroyed
        }
        "Disappeared" { 
            $emoji = ":ghost:"
            $title = "Vehicle Disappeared"
            $color = $script:EmbedColors.VehicleDisappeared
        }
        "VehicleInactiveTimerReached" { 
            $emoji = ":alarm_clock:"
            $title = "Vehicle Expired"
            $color = $script:EmbedColors.VehicleExpired
        }
        "ForbiddenZoneTimerExpired" { 
            $emoji = ":no_entry_sign:"
            $title = "Vehicle Forbidden Zone"
            $color = $script:EmbedColors.VehicleForbidden
        }
        default { 
            $emoji = ":car:"
            $title = "Vehicle Activity"
            $color = $script:EmbedColors.Vehicle
        }
    }

    # Build fields
    $fields = @()

    # Vehicle info
    $fields += @{
        name = "Vehicle"
        value = "$($VehicleAction.VehicleName)"
        inline = $true
    }

    if ($VehicleAction.VehicleId) {
        $fields += @{
            name = "Vehicle ID"
            value = "$($VehicleAction.VehicleId)"
            inline = $true
        }
    }

    # Owner information
    if ($VehicleAction.OwnerName) {
        $fields += @{
            name = "Owner"
            value = "$($VehicleAction.OwnerName)"
            inline = $true
        }
    }

    if ($VehicleAction.OwnerPlayerId) {
        $fields += @{
            name = "Player ID"
            value = "$($VehicleAction.OwnerPlayerId)"
            inline = $true
        }
    }

    if ($VehicleAction.OwnerSteamId) {
        $fields += @{
            name = "Steam ID"
            value = "$($VehicleAction.OwnerSteamId)"
            inline = $true
        }
    }

    # Action description
    if ($VehicleAction.Action) {
        $fields += @{
            name = "Event"
            value = "$($VehicleAction.Action)"
            inline = $true
        }
    }

    # Event type details
    $eventDescription = switch ($VehicleAction.EventType) {
        "Destroyed" { "Vehicle was destroyed by damage or other means" }
        "Disappeared" { "Vehicle disappeared from the world" }
        "VehicleInactiveTimerReached" { "Vehicle was removed due to inactivity timeout" }
        "ForbiddenZoneTimerExpired" { "Vehicle was removed from forbidden zone" }
        default { "Vehicle event: $($VehicleAction.EventType)" }
    }
    
    $fields += @{
        name = "Details"
        value = "$eventDescription"
        inline = $true
    }

    # Location info
    if ($VehicleAction.LocationX -and $VehicleAction.LocationY -and $VehicleAction.LocationZ) {
        $x = [math]::Round([double]$VehicleAction.LocationX, 0)
        $y = [math]::Round([double]$VehicleAction.LocationY, 0) 
        $z = [math]::Round([double]$VehicleAction.LocationZ, 0)
        
        $fields += @{
            name = "Location"
            value = "X: $x, Y: $y, Z: $z"
            inline = $false
        }
    }

    return @{
        title = "$emoji $title"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# VIOLATIONS EMBEDS
# ===============================================================
function Send-ViolationsEmbed {
    param(
        [hashtable]$ViolationAction
    )

    # Determine action type and colors
    $emoji = ":exclamation:"
    $title = "Violation Activity"
    $color = $script:EmbedColors.ViolationGeneral  # Default

    switch ($ViolationAction.Type) {
        "BAN" { 
            $emoji = ":hammer:"
            $title = "Player Ban"
            $color = $script:EmbedColors.ViolationBan
        }
        "KICK" { 
            $emoji = ":boot:"
            $title = "Player Kick"
            $color = $script:EmbedColors.ViolationKick
        }
        "VIOLATION" { 
            switch ($ViolationAction.Reason) {
                { $_ -match "AmmoCount" } {
                    $emoji = ":gun:"
                    $title = "Ammo Violation"
                    $color = $script:EmbedColors.ViolationAmmo
                }
                { $_ -match "InteractionRange" } {
                    $emoji = ":no_entry:"
                    $title = "Interaction Violation"
                    $color = $script:EmbedColors.ViolationInteraction
                }
                default {
                    $emoji = ":warning:"
                    $title = "Game Violation"
                    $color = $script:EmbedColors.ViolationGeneral
                }
            }
        }
        default { 
            $emoji = ":exclamation:"
            $color = $script:EmbedColors.ViolationGeneral
        }
    }

    # Build fields
    $fields = @()

    # Player info
    if ($ViolationAction.PlayerName) {
        $fields += @{
            name = "Player"
            value = "$($ViolationAction.PlayerName)"
            inline = $true
        }
    } else {
        $fields += @{
            name = "Player"
            value = "Unknown Player"
            inline = $true
        }
    }

    if ($ViolationAction.PlayerId) {
        $fields += @{
            name = "Player ID"
            value = "$($ViolationAction.PlayerId)"
            inline = $true
        }
    }

    if ($ViolationAction.SteamId) {
        $fields += @{
            name = "Steam ID"
            value = "$($ViolationAction.SteamId)"
            inline = $true
        }
    }

    # Action description
    if ($ViolationAction.Action) {
        $fields += @{
            name = "Action"
            value = "$($ViolationAction.Action)"
            inline = $true
        }
    }

    # Violation reason/type
    if ($ViolationAction.Reason) {
        $fields += @{
            name = "Reason"
            value = "$($ViolationAction.Reason)"
            inline = $true
        }
    }

    # Additional details based on violation type
    if ($ViolationAction.Weapon) {
        $fields += @{
            name = "Weapon"
            value = "$($ViolationAction.Weapon)"
            inline = $true
        }
    }

    if ($ViolationAction.Distance) {
        $fields += @{
            name = "Distance"
            value = "$($ViolationAction.Distance)"
            inline = $true
        }
    }

    # Location info
    if ($ViolationAction.LocationX -and $ViolationAction.LocationY -and $ViolationAction.LocationZ) {
        $x = [math]::Round([double]$ViolationAction.LocationX, 0)
        $y = [math]::Round([double]$ViolationAction.LocationY, 0)
        $z = [math]::Round([double]$ViolationAction.LocationZ, 0)
        
        $fields += @{
            name = "Location"
            value = "X: $x, Y: $y, Z: $z"
            inline = $false
        }
    }

    return @{
        title = "$emoji $title"
        color = $color
        fields = $fields
        footer = $script:StandardFooter
        timestamp = Get-StandardTimestamp
    }
}

# ===============================================================
# EXPORTS
# ===============================================================
Export-ModuleMember -Function @(
    'Send-LoginEmbed',
    'Send-AdminEmbed',
    'Send-ChestEmbed',
    'Send-FamePointsEmbed',
    'Send-GameplayEmbed',
    'Send-EconomyEmbed',
    'Send-EventKillEmbed',
    'Send-KillEmbed',
    'Send-QuestEmbed',
    'Send-RaidProtectionEmbed',
    'Send-VehicleEmbed',
    'Send-ViolationsEmbed',
    'Get-StandardTimestamp'
)
