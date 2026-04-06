import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ODRConfig } from "@reviewradar/shared";
import { DEFAULT_CONFIG } from "@reviewradar/shared";

const LEGACY_CONFIG_DIR = resolve(process.env.HOME || "~", ".config", "odr");
const LEGACY_CONFIG_PATH = resolve(LEGACY_CONFIG_DIR, "config.json");
const CONFIG_DIR = resolve(process.env.HOME || "~", ".config", "reviewradar");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.json");

export { CONFIG_DIR };

export function loadConfig(): ODRConfig {
  try {
    // Try new path first
    if (existsSync(CONFIG_PATH)) {
      return parseConfigFile(CONFIG_PATH);
    }
    // Migrate from legacy ODR config
    if (existsSync(LEGACY_CONFIG_PATH)) {
      const config = parseConfigFile(LEGACY_CONFIG_PATH);
      saveConfig(config);
      return config;
    }
    return { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function parseConfigFile(path: string): ODRConfig {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    agentModels: {
      ...DEFAULT_CONFIG.agentModels,
      ...(parsed.agentModels || {}),
    },
  };
}

export function saveConfig(config: ODRConfig): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  } catch (err) {
    console.error("Failed to save config:", err);
  }
}

export function mergeConfig(current: ODRConfig, partial: Partial<ODRConfig>): ODRConfig {
  return {
    ...current,
    ...partial,
    agentModels: {
      ...current.agentModels,
      ...(partial.agentModels || {}),
    },
  };
}
