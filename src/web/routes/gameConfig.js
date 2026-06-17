'use strict';

const fs = require('fs');
const express = require('express');
const gc = require('../../server/gameConfig');

const router = express.Router();

// --- INI files ---------------------------------------------------------------

router.get('/ini/:key', (req, res) => {
  const filePath = gc.resolveIniPath(req.params.key);
  if (!filePath) return res.status(404).json({ error: 'Unknown INI file key' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try {
    const { values } = gc.readIni(filePath);
    res.json({ values });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ini/:key', (req, res) => {
  const filePath = gc.resolveIniPath(req.params.key);
  if (!filePath) return res.status(404).json({ error: 'Unknown INI file key' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try {
    const { lines } = gc.readIni(filePath);
    gc.writeIni(filePath, lines, req.body || {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- User list files ---------------------------------------------------------

router.get('/list/:key', (req, res) => {
  const filePath = gc.resolveListPath(req.params.key);
  if (!filePath) return res.status(404).json({ error: 'Unknown list file key' });
  try {
    const { lines } = gc.readLines(filePath);
    res.json({ lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/list/:key', (req, res) => {
  const filePath = gc.resolveListPath(req.params.key);
  if (!filePath) return res.status(404).json({ error: 'Unknown list file key' });
  try {
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    gc.writeLines(filePath, lines);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Raw JSON files (EconomyOverride.json, RaidTimes.json, Notifications.json) ---

router.get('/json/:key', (req, res) => {
  const filePath = gc.resolveJsonPath(req.params.key);
  if (!filePath) return res.status(404).json({ error: 'Unknown JSON file key' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try {
    res.json(gc.readJson(filePath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/json/:key', (req, res) => {
  const filePath = gc.resolveJsonPath(req.params.key);
  if (!filePath) return res.status(404).json({ error: 'Unknown JSON file key' });
  try {
    gc.writeJson(filePath, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
