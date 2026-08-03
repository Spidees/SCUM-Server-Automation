-- SSAEnv — server-side tuning of WETNESS (drying / wetting / rain) and DIRTINESS via the global
-- AWetnessManager and its PhysicalSurfacesData. All settings in env.txt are multipliers of the game
-- defaults; base values are captured once and re-applied as base*multiplier so live edits never compound.
--   drying_multiplier          -> AWetnessManager.DryingRate
--   wetting_multiplier         -> WettingRateFromWaterImmersion + WettingRateFromWetSurfaces
--   rain_multiplier            -> WettingRateFromRainVsRainIntensity curve (scaled key values)
--   dirtiness_multiplier       -> PhysicalSurfacesData.<surface>.DirtinessFactor
--   surface_wetness_multiplier -> PhysicalSurfacesData.<surface>.WetnessFactor
-- Optimized: only re-applies when the config (or the manager) actually changes, plus a light periodic
-- safety refresh. Silent by default; set debug=1 in env.txt to log.

local src = (debug.getinfo(1, "S").source or ""):gsub("^@", "")
local moddir = src:match("^(.*)[/\\][Ss]cripts[/\\]") or "."
local cfgpath = moddir .. "\\env.txt"

local DBG = false
local function log(s) if DBG then print("[SSAEnv] " .. tostring(s) .. "\n") end end

local function readCfg()
    local c = { drying = 3.0, wetting = 0.5, rain = 0.5, dirtiness = 0.3, surface_wetness = 1.0, debug = 0 }
    local f = io.open(cfgpath, "r"); if not f then return c end
    for line in f:lines() do
        local k, v = line:gsub("#.*$", ""):match("^%s*([%w_]+)%s*=%s*(-?[%d%.]+)")
        if k and v then
            k = k:lower(); v = tonumber(v)
            if v then
                if k == "drying_multiplier" then c.drying = v
                elseif k == "wetting_multiplier" then c.wetting = v
                elseif k == "rain_multiplier" then c.rain = v
                elseif k == "dirtiness_multiplier" then c.dirtiness = v
                elseif k == "surface_wetness_multiplier" then c.surface_wetness = v
                elseif k == "debug" then c.debug = v end
            end
        end
    end
    f:close(); return c
end

local SURFACES = {
    "Default", "grass", "ForrestGroundCoastal", "ForrestGroundContinental", "Rock", "Stone", "Gravel",
    "GravelBeach", "Pebbles", "Snow", "Ice", "Sand", "Asphalt", "Dirt", "Water", "WaterOcean", "Cloth",
    "Metal", "Aluminium", "Concrete", "Brick", "Wood", "Plastic", "Rubber", "Glass", "Foliage", "Bark",
    "Flesh", "RoofTile", "CeramicTiles", "Scrap", "Trunk", "Leaves", "Fruit", "Cardboard", "Plaster",
    "Kevlar", "ForceField", "NoEffect", "WhiteGravel", "Mud", "RiverSand", "GrassContinental",
}

local baseWet = nil      -- {drying, wetImm, wetSurf}
local baseSurf = {}      -- name -> {dirt, wet}
local baseRain = nil     -- array of default rain-curve key values
local curMgrName = nil
local lastSig = nil

local function apply(mgr, c)
    -- wetness scalars
    if not baseWet then
        baseWet = {}
        pcall(function() baseWet.drying = mgr.DryingRate end)
        pcall(function() baseWet.wetImm = mgr.WettingRateFromWaterImmersion end)
        pcall(function() baseWet.wetSurf = mgr.WettingRateFromWetSurfaces end)
    end
    if baseWet.drying then pcall(function() mgr.DryingRate = baseWet.drying * c.drying end) end
    if baseWet.wetImm then pcall(function() mgr.WettingRateFromWaterImmersion = baseWet.wetImm * c.wetting end) end
    if baseWet.wetSurf then pcall(function() mgr.WettingRateFromWetSurfaces = baseWet.wetSurf * c.wetting end) end

    -- dirtiness / surface wetness
    local psd = nil; pcall(function() psd = mgr.PhysicalSurfacesData end)
    if psd and psd:IsValid() then
        for _, name in ipairs(SURFACES) do
            if not baseSurf[name] then
                local d, w = nil, nil
                pcall(function() d = psd[name].DirtinessFactor end)
                pcall(function() w = psd[name].WetnessFactor end)
                if d ~= nil or w ~= nil then baseSurf[name] = { dirt = d, wet = w } end
            end
            local b = baseSurf[name]
            if b then
                if b.dirt ~= nil then pcall(function() psd[name].DirtinessFactor = b.dirt * c.dirtiness end) end
                if b.wet ~= nil then pcall(function() psd[name].WetnessFactor = b.wet * c.surface_wetness end) end
            end
        end
    end

    -- rain: scale the WettingRateFromRainVsRainIntensity curve's key values
    local curve = nil; pcall(function() curve = mgr.WettingRateFromRainVsRainIntensity end)
    if curve and curve:IsValid() then
        pcall(function()
            local keys = curve.FloatCurve.Keys
            local n = #keys
            if not baseRain then
                baseRain = {}
                for i = 1, n do baseRain[i] = keys[i].Value end
            end
            for i = 1, n do if baseRain[i] ~= nil then keys[i].Value = baseRain[i] * c.rain end end
        end)
    end

    log(string.format("applied drying x%.2f wetting x%.2f rain x%.2f dirt x%.2f surfWet x%.2f",
        c.drying, c.wetting, c.rain, c.dirtiness, c.surface_wetness))
end

local function sig(c)
    return table.concat({ c.drying, c.wetting, c.rain, c.dirtiness, c.surface_wetness }, "|")
end

local ticks = 0
LoopAsync(10000, function()
    ticks = ticks + 1
    local c = readCfg(); DBG = (c.debug and c.debug ~= 0)

    local mgr = FindFirstOf("WetnessManager")
    if not (mgr and mgr:IsValid()) then return false end

    local name = nil; pcall(function() name = mgr:GetFullName() end)
    if name ~= curMgrName then                       -- new manager (map change) → recapture defaults
        curMgrName = name; baseWet = nil; baseSurf = {}; baseRain = nil; lastSig = nil
    end

    local s = sig(c)
    if s ~= lastSig or ticks % 6 == 0 then           -- apply on config/manager change + a ~60s safety refresh
        apply(mgr, c)
        lastSig = s
    end
    return false
end)
