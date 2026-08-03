-- SSAExample — a minimal, SAFE reference UE4SS (Lua) mod for SCUM Server Automation.
--
-- What a UE4SS mod is: Lua that runs INSIDE the game process via the UE4SS runtime, so it can read and
-- change live Unreal objects the manager can't reach from outside. This one is deliberately read-only:
-- it finds the player (Prisoner) objects each tick and logs how many it sees. Use it as a skeleton.
--
-- Key rules (read these before you touch game objects):
--   • It DEPLOYS to the game and applies on the next SERVER RESTART (mods load when the game starts).
--   • Guard EVERY native access with pcall(...) and obj:IsValid(). A bad read can crash the server;
--     a crash in a mod is a crash of the whole server. When in doubt, read-only.
--   • Server-side only. Keep changes cosmetic/gameplay; never touch files outside your Mods folder.
--   • Pair with a manager plugin for control from Discord/the panel: the manager plugin talks to the
--     SSA Bridge (also a UE4SS mod), which runs admin commands in-game. Split the work — the mod does
--     what only in-process Lua can; the manager plugin does config, Discord, scheduling, persistence.
--
-- Full guide: https://scumsa.com/docs

-- ── locate + read our own config (next to this script) ───────────────────────
local src     = (debug.getinfo(1, "S").source or ""):gsub("^@", "")
local moddir  = src:match("^(.*)[/\\][Ss]cripts[/\\]") or "."
local cfgpath = moddir .. "\\example.txt"

local function readCfg()
    local c = { interval_ms = 10000, debug = 1 }
    local f = io.open(cfgpath, "r"); if not f then return c end
    for line in f:lines() do
        local k, v = line:gsub("#.*$", ""):match("^%s*([%w_]+)%s*=%s*(-?[%d%.]+)")
        if k then
            k = k:lower(); v = tonumber(v)
            if     k == "interval_ms" and v then c.interval_ms = v
            elseif k == "debug"       and v then c.debug = v end
        end
    end
    f:close(); return c
end

local cfg = readCfg()
local function log(s) if cfg.debug ~= 0 then print("[SSAExample] " .. tostring(s) .. "\n") end end

log("loaded — heartbeat every " .. tostring(cfg.interval_ms) .. " ms")

-- ── heartbeat loop ───────────────────────────────────────────────────────────
-- LoopAsync(ms, fn): fn runs every `ms`; return true to stop the loop, false/nil to keep going.
-- FindAllOf / FindFirstOf locate live UObjects by class. Everything is guarded so a transient
-- null/invalid object during load or shutdown can never take the server down.
LoopAsync(cfg.interval_ms, function()
    cfg = readCfg()   -- re-read so live config edits (e.g. debug=0) take effect without a restart

    local ok, count = pcall(function()
        local prisoners = FindAllOf("Prisoner") or {}
        local n = 0
        for _, p in ipairs(prisoners) do
            if p and p:IsValid() then n = n + 1 end
        end
        return n
    end)

    if ok then log("players in world: " .. tostring(count))
    else       log("read skipped (world not ready)") end

    return false   -- keep looping
end)
