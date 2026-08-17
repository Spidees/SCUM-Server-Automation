-- SSAEnv — server-side tuning of WETNESS (drying / wetting / rain) and DIRTINESS via the global
-- AWetnessManager and its PhysicalSurfacesData. Every setting in env.txt is a MULTIPLIER of the
-- game's own default, applied as default*multiplier.
--   drying_multiplier          -> AWetnessManager.DryingRate
--   wetting_multiplier         -> WettingRateFromWaterImmersion + WettingRateFromWetSurfaces
--   rain_multiplier            -> WettingRateFromRainVsRainIntensity curve (scaled key values)
--   dirtiness_multiplier       -> PhysicalSurfacesData.<surface>.DirtinessFactor
--   surface_wetness_multiplier -> PhysicalSurfacesData.<surface>.WetnessFactor
--
-- THE DEFAULTS ARE WRITTEN TO DISK the first time they are read, and every later run multiplies
-- THAT file, never the live value. The previous version re-read the live value whenever it thought
-- the manager had changed — including when GetFullName() merely failed — and since the live value
-- was one it had written itself, the multiplier compounded: with drying_multiplier = 99 a single
-- hiccup took DryingRate from 99x to 9 800x to 970 000x, and from there to infinity. A wetness
-- simulation fed infinity does not behave, and it does not recover until the process restarts.
--
-- Set restore = 1 in env.txt to put the recorded defaults back (do this before disabling the mod:
-- PhysicalSurfacesData is a shared asset and keeps whatever was last written to it).

local src = (debug.getinfo(1, "S").source or ""):gsub("^@", "")
local moddir = src:match("^(.*)[/\\][Ss]cripts[/\\]") or "."
local cfgpath = moddir .. "\\env.txt"

-- The recorded defaults live NEXT TO the mod folder, not inside it. Updating a plugin deletes and
-- re-copies its payload — only the declared config file (env.txt) is carried over — so a defaults
-- file kept inside would be destroyed by every update, and the run after that would record the
-- values this mod had already written as if they were the game's own. That is precisely the failure
-- this file exists to prevent, so it has to outlive a reinstall.
local parent = moddir:match("^(.*)[/\\][^/\\]+$")
local basepath = (parent and (parent .. "\\SSAEnv.defaults.txt")) or (moddir .. "\\env.defaults.txt")
local legacypath = moddir .. "\\env.defaults.txt"

local DBG = false
local function log(s) if DBG then print("[SSAEnv] " .. tostring(s) .. "\n") end end
local function warn(s) print("[SSAEnv] " .. tostring(s) .. "\n") end

-- Run `fn` on the GAME thread. UE4SS runs LoopAsync on its own worker thread, where reading or
-- writing UObject properties races with the engine — and a Lua `pcall` cannot catch a native
-- access violation. Stand down permanently if the hook isn't available on this build.
local gameThreadOk = true
local function onGameThread(fn)
    if not gameThreadOk then return false end
    local ok = pcall(function() ExecuteInGameThread(fn) end)
    if not ok then
        gameThreadOk = false
        warn("ExecuteInGameThread unavailable on this build — standing down")
    end
    return ok
end

-- ── config ───────────────────────────────────────────────────────────────────
-- Multipliers are clamped. A value big enough to overflow a float is not a setting, it is a way
-- to break the weather simulation, and the game gives no indication that it happened.
local MAX_MULT = 50.0
local function clamp(v, name)
    if type(v) ~= "number" or v ~= v then return nil end          -- nil / NaN
    if v < 0 then v = 0 end
    if v > MAX_MULT then
        warn(string.format("%s = %.2f is above the %.0f limit — using %.0f", name, v, MAX_MULT, MAX_MULT))
        v = MAX_MULT
    end
    return v
end

local function readCfg()
    local c = { drying = 3.0, wetting = 0.5, rain = 0.5, dirtiness = 0.3, surface_wetness = 1.0,
                debug = 0, restore = 0, enabled = 1 }
    local f = io.open(cfgpath, "r"); if not f then return c end
    for line in f:lines() do
        local k, v = line:gsub("#.*$", ""):match("^%s*([%w_]+)%s*=%s*(-?[%d%.]+)")
        if k and v then
            k = k:lower(); v = tonumber(v)
            if v then
                if k == "drying_multiplier" then c.drying = clamp(v, k) or c.drying
                elseif k == "wetting_multiplier" then c.wetting = clamp(v, k) or c.wetting
                elseif k == "rain_multiplier" then c.rain = clamp(v, k) or c.rain
                elseif k == "dirtiness_multiplier" then c.dirtiness = clamp(v, k) or c.dirtiness
                elseif k == "surface_wetness_multiplier" then c.surface_wetness = clamp(v, k) or c.surface_wetness
                elseif k == "debug" then c.debug = v
                elseif k == "enabled" then c.enabled = v
                elseif k == "restore" then c.restore = v end
            end
        end
    end
    f:close(); return c
end

-- ── the recorded defaults ────────────────────────────────────────────────────
-- Written once, then treated as the truth. This file is what makes the mod idempotent across a
-- reload, a map change or a failed read — none of which can now be mistaken for "fresh values".
local defaults = nil     -- flat map: "drying" | "surf.<name>.dirt" | "rain.3" -> number
local defaultsDirty = false

local function loadDefaults()
    -- Older builds kept this inside the mod folder; still read it so an upgrade doesn't lose it.
    local d, f = {}, io.open(basepath, "r")
    if not f then f = io.open(legacypath, "r") end
    if not f then return nil end
    local n = 0
    for line in f:lines() do
        local k, v = line:match("^([%w_%.%-]+)%s*=%s*(-?[%d%.eE%+%-]+)$")
        if k and tonumber(v) then d[k] = tonumber(v); n = n + 1 end
    end
    f:close()
    if n == 0 then return nil end
    log("loaded " .. n .. " recorded defaults")
    return d
end

local function saveDefaults()
    if not (defaults and defaultsDirty) then return end
    local keys = {}
    for k in pairs(defaults) do keys[#keys + 1] = k end
    table.sort(keys)
    local f = io.open(basepath, "w")
    if not f then warn("cannot write " .. basepath .. " — defaults will be re-read next start"); return end
    -- ASCII only: this file gets opened in Notepad, and a mangled dash reads like corruption.
    f:write("# SSAEnv - the game's own values, recorded before anything was changed.\n")
    f:write("# Multipliers are applied to THESE, never to the current live value.\n")
    f:write("# Delete this file only with the mod disabled and the server restarted, or the\n")
    f:write("# numbers recorded next time will be the ones this mod already wrote.\n")
    for _, k in ipairs(keys) do f:write(string.format("%s = %.9g\n", k, defaults[k])) end
    f:close()
    defaultsDirty = false
    log("recorded defaults saved (" .. #keys .. " values)")
end

-- Record a default exactly once. `live` is only trusted the very first time.
local function baseline(key, live)
    if defaults[key] ~= nil then return defaults[key] end
    if type(live) ~= "number" or live ~= live then return nil end
    defaults[key] = live
    defaultsDirty = true
    return live
end

-- ── writing ──────────────────────────────────────────────────────────────────
local FINITE = function (v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local writeFails = 0

-- Set a property and read it back. Every write in the old version was a bare pcall, so a wrong
-- property name or a value the engine refused looked exactly like success — the mod reported
-- nothing and quietly did nothing.
--
-- The read-back doubles the number of reflected property accesses, and ALL of this runs on the
-- game thread, where UE's hang detector is watching. So it is done on the first pass — enough to
-- prove the writes land and to say so if they don't — and after that only with debug on.
local verifying = true
local function setChecked(obj, prop, value, label)
    if not FINITE(value) then warn(label .. ": refusing to write a non-finite value"); return false end
    local ok = pcall(function() obj[prop] = value end)
    if not ok then writeFails = writeFails + 1; log(label .. ": write threw"); return false end
    if not (verifying or DBG) then return true end
    local back = nil
    pcall(function() back = obj[prop] end)
    if type(back) == "number" and math.abs(back - value) > math.max(1e-4, math.abs(value) * 1e-4) then
        writeFails = writeFails + 1
        log(string.format("%s: wrote %.4g but reads back %.4g", label, value, back))
        return false
    end
    return true
end

local SURFACES = {
    "Default", "grass", "ForrestGroundCoastal", "ForrestGroundContinental", "Rock", "Stone", "Gravel",
    "GravelBeach", "Pebbles", "Snow", "Ice", "Sand", "Asphalt", "Dirt", "Water", "WaterOcean", "Cloth",
    "Metal", "Aluminium", "Concrete", "Brick", "Wood", "Plastic", "Rubber", "Glass", "Foliage", "Bark",
    "Flesh", "RoofTile", "CeramicTiles", "Scrap", "Trunk", "Leaves", "Fruit", "Cardboard", "Plaster",
    "Kevlar", "ForceField", "NoEffect", "WhiteGravel", "Mud", "RiverSand", "GrassContinental",
}

local lastSig = nil
local applied = 0

local function apply(mgr, c, restoring)
    local mult = restoring
        and { drying = 1, wetting = 1, rain = 1, dirtiness = 1, surface_wetness = 1 }
        or  c

    -- wetness scalars
    for _, e in ipairs({ { "drying", "DryingRate", mult.drying },
                         { "wetImm", "WettingRateFromWaterImmersion", mult.wetting },
                         { "wetSurf", "WettingRateFromWetSurfaces", mult.wetting } }) do
        local key, prop, m = e[1], e[2], e[3]
        local live = nil; pcall(function() live = mgr[prop] end)
        local base = baseline(key, live)
        if base then setChecked(mgr, prop, base * m, prop) end
    end

    -- dirtiness / surface wetness. PhysicalSurfacesData is a SHARED asset: what is written here
    -- outlives this actor and this map, which is why the defaults file matters and why `restore`
    -- exists at all.
    local psd = nil; pcall(function() psd = mgr.PhysicalSurfacesData end)
    if psd and psd:IsValid() then
        for _, name in ipairs(SURFACES) do
            local entry = nil; pcall(function() entry = psd[name] end)
            if entry then
                for _, e in ipairs({ { "dirt", "DirtinessFactor", mult.dirtiness },
                                     { "wet", "WetnessFactor", mult.surface_wetness } }) do
                    local key, prop, m = "surf." .. name .. "." .. e[1], e[2], e[3]
                    local live = nil; pcall(function() live = entry[prop] end)
                    local base = baseline(key, live)
                    if base then setChecked(entry, prop, base * m, name .. "." .. prop) end
                end
            end
        end
    end

    -- rain: scale the WettingRateFromRainVsRainIntensity curve's key values
    local curve = nil; pcall(function() curve = mgr.WettingRateFromRainVsRainIntensity end)
    if curve and curve:IsValid() then
        pcall(function()
            local keys = curve.FloatCurve.Keys
            for i = 1, #keys do
                local base = baseline("rain." .. i, keys[i].Value)
                if base then
                    local v = base * mult.rain
                    if FINITE(v) then keys[i].Value = v end
                end
            end
        end)
    end

    saveDefaults()
    applied = applied + 1
    -- One verified sweep is enough; keep the recurring cost on the game thread small.
    if verifying then
        verifying = false
        if writeFails > 0 then
            warn(writeFails .. " write(s) did not stick on the first pass - check the property names")
        end
    end
    log(string.format("%s drying x%.2f wetting x%.2f rain x%.2f dirt x%.2f surfWet x%.2f%s",
        restoring and "restored —" or "applied", mult.drying, mult.wetting, mult.rain,
        mult.dirtiness, mult.surface_wetness,
        writeFails > 0 and (" [" .. writeFails .. " write(s) did not stick]") or ""))
end

local function sig(c)
    return table.concat({ c.drying, c.wetting, c.rain, c.dirtiness, c.surface_wetness, c.restore, c.enabled }, "|")
end

local ticks = 0
LoopAsync(10000, function()
    ticks = ticks + 1
    local c = readCfg(); DBG = (c.debug and c.debug ~= 0)

    -- Config reading is plain file I/O and stays off the game thread; everything touching the
    -- manager runs on it.
    onGameThread(function()
        local mgr = FindFirstOf("WetnessManager")
        if not (mgr and mgr:IsValid()) then return end

        -- Load the recorded defaults once. Nothing is written before this: applying a multiplier
        -- to a value we cannot vouch for is how the old version compounded.
        if defaults == nil then
            defaults = loadDefaults() or {}
            if next(defaults) == nil then log("no recorded defaults yet — this run records them") end
        end

        local s = sig(c)
        -- Re-apply on a config change, and on a light periodic refresh in case the game reset
        -- something. There is deliberately no "the manager changed, re-read the defaults" path:
        -- the defaults live in the file now, so a new actor or a failed read changes nothing.
        if s ~= lastSig or ticks % 6 == 0 then
            -- "off" and "restore" are the same act: put the game's own values back. Turning the
            -- mod off in the panel deletes its files outright, so it cannot undo anything at that
            -- point — this is the switch that lets an admin hand the game back while it still runs.
            apply(mgr, c, c.restore ~= 0 or c.enabled == 0)
            lastSig = s
        end
    end)
    return false
end)

print("[SSAEnv] loaded — defaults are recorded to env.defaults.txt and multiplied from there\n")
