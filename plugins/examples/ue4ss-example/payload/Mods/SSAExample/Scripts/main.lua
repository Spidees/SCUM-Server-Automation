-- SSAExample: a small, safe reference UE4SS (Lua) mod for a SCUM dedicated server.
--
-- A UE4SS mod is Lua that runs INSIDE the game process, so it can read live Unreal objects that
-- nothing outside the game can reach. This one only reads: every few seconds it counts the players
-- connected to the server and prints the number to the UE4SS console when it changes. Copy it as a
-- skeleton.
--
-- Three rules this file is built around. Each one has taken a real server down when it was broken.
--
--   1. LoopAsync does NOT run on the game thread. Touching a UObject from there races the engine,
--      and pcall cannot catch the native crash that follows. Every engine touch goes through
--      ExecuteInGameThread. File reads stay outside it.
--
--   2. A lookup holds the frame. FindAllOf and FindFirstOf walk every object in the game, which
--      takes well over 100 ms on a SCUM server. FindFirstOf only stops early on an EXACT class
--      name, and the live objects are Blueprint subclasses (BP_ConZGameState_C), so asking for the
--      native name always walks everything. Look a singleton up ONCE, keep it, check it with
--      IsValid() each time, and back off while it is missing. Never walk the world on a timer.
--
--   3. A failed lookup hands back an INVALID OBJECT, not nil. Test both. And never index a TArray
--      past its length: UE4SS grows the game's own array to make the slot exist.
--
-- Changes to this file apply on the next server start. Full guide: https://scumsa.com/docs

local MOD = "SSAExample"
local function log(s) print("[" .. MOD .. "] " .. tostring(s) .. "\n") end

-- ── config, read from example.txt beside the Scripts folder ─────────────────────────────────────
local src     = (debug.getinfo(1, "S").source or ""):gsub("^@", "")
local moddir  = src:match("^(.*)[/\\][Ss]cripts[/\\]") or "."
local cfgpath = moddir .. "\\example.txt"

local MIN_INTERVAL_MS = 1000

local function readCfg()
    local c = { interval_ms = 10000, debug = 1 }
    local f = io.open(cfgpath, "r")
    if not f then return c end
    for line in f:lines() do
        local k, v = line:gsub("#.*$", ""):match("^%s*([%w_]+)%s*=%s*(-?[%d%.]+)")
        v = tonumber(v)
        if k and v then
            k = k:lower()
            if k == "interval_ms" then c.interval_ms = math.max(MIN_INTERVAL_MS, v)
            elseif k == "debug" then c.debug = v end
        end
    end
    f:close()
    return c
end

local cfg = readCfg()
local function say(s) if cfg.debug ~= 0 then log(s) end end

-- ── the game thread ──────────────────────────────────────────────────────────────────────────────
-- ExecuteInGameThread throws when UE4SS could not install its hook on this build of the game. The
-- mod then stands down for good instead of touching objects from the wrong thread.
local gameThreadOk = true
local function onGameThread(fn)
    if not gameThreadOk then return end
    local ok = pcall(function() ExecuteInGameThread(fn) end)
    if not ok then
        gameThreadOk = false
        log("ExecuteInGameThread is not available on this build; the mod stands down")
    end
end

-- A handle that is really there: not nil, and IsValid() says so without throwing.
local function isLive(o)
    if o == nil then return false end
    local live = false
    pcall(function() live = (o:IsValid() == true) end)
    return live
end

-- ── one cached lookup, with back-off ─────────────────────────────────────────────────────────────
-- The game state is looked up once and kept. While it is missing (the world is still loading) the
-- next lookup waits 5, 10, 20, then 30 seconds, so a slow start costs a few walks, not one per tick.
local RETRY = { 5, 10, 20, 30 }
local gameState = { obj = nil, misses = 0, nextTryAt = 0 }

local function getGameState(now)
    if gameState.obj ~= nil then
        if isLive(gameState.obj) then return gameState.obj end
        gameState.obj, gameState.misses, gameState.nextTryAt = nil, 0, 0   -- the world went away
    end
    if now < gameState.nextTryAt then return nil end
    local found = nil
    pcall(function() found = FindFirstOf("ConZGameState") end)
    if isLive(found) then
        gameState.obj = found       -- misses are cleared only once the list has really been read
        return found
    end
    gameState.misses = gameState.misses + 1
    gameState.nextTryAt = now + RETRY[math.min(gameState.misses, #RETRY)]
    return nil
end

-- How many players are connected, or nil when the list could not be read. Nil is not "nobody":
-- it means this pass learned nothing.
local function connectedPlayers(gs)
    local arr, n = nil, nil
    if not pcall(function() arr = gs.PlayerArray end) or arr == nil then return nil end
    if not pcall(function() n = #arr end) or type(n) ~= "number" then return nil end
    return n
end

-- ── the loop ─────────────────────────────────────────────────────────────────────────────────────
-- LoopAsync runs this every second on UE4SS's own thread. It only keeps time and reads the config
-- file; the work itself is handed to the game thread.
local nextDueAt = 0
local lastCount = nil

say("loaded, counting players every " .. tostring(cfg.interval_ms) .. " ms")

LoopAsync(1000, function()
    if not gameThreadOk then return true end   -- true stops the loop
    local now = os.time()
    if now < nextDueAt then return false end
    cfg = readCfg()                             -- picks up edits to example.txt without a restart
    nextDueAt = now + math.floor(cfg.interval_ms / 1000)

    onGameThread(function()
        local gs = getGameState(os.time())
        if not gs then return end
        local n = connectedPlayers(gs)
        if n == nil then
            -- Alive but unreadable: drop it and back off, so a build where the list cannot be read
            -- costs a few lookups rather than one per pass.
            gameState.obj = nil
            gameState.misses = gameState.misses + 1
            gameState.nextTryAt = os.time() + RETRY[math.min(gameState.misses, #RETRY)]
            return
        end
        gameState.misses = 0
        if n ~= lastCount then
            lastCount = n
            say("players connected: " .. tostring(n))
        end
    end)
    return false                                -- keep looping
end)
