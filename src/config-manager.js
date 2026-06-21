const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
  debounceDelayMs: 10000,
  monitoredRoots: ['E:\\'],
  ignoredPatterns: ['.git', '.agents', 'sync.log', 'node_modules']
};

let currentConfig = null;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(data);
      
      // Ensure all fields are present, otherwise merge with defaults
      currentConfig = {
        debounceDelayMs: typeof parsed.debounceDelayMs === 'number' ? parsed.debounceDelayMs : DEFAULT_CONFIG.debounceDelayMs,
        monitoredRoots: Array.isArray(parsed.monitoredRoots) ? parsed.monitoredRoots : DEFAULT_CONFIG.monitoredRoots,
        ignoredPatterns: Array.isArray(parsed.ignoredPatterns) ? parsed.ignoredPatterns : DEFAULT_CONFIG.ignoredPatterns
      };
    } else {
      currentConfig = { ...DEFAULT_CONFIG };
      saveConfig(currentConfig);
    }
  } catch (err) {
    logger.warn(`Failed to read config.json, using defaults: ${err.message}`);
    currentConfig = { ...DEFAULT_CONFIG };
  }
  return currentConfig;
}

function getConfig() {
  if (!currentConfig) {
    loadConfig();
  }
  return currentConfig;
}

function saveConfig(config) {
  try {
    const data = JSON.stringify(config, null, 2);
    fs.writeFileSync(CONFIG_FILE, data, 'utf8');
    currentConfig = { ...config };
    logger.info('Configuration saved successfully to config.json');
    return true;
  } catch (err) {
    logger.error(`Failed to save config.json: ${err.message}`);
    return false;
  }
}

module.exports = {
  getConfig,
  saveConfig,
  loadConfig,
  DEFAULT_CONFIG
};
