#!/usr/bin/env node

/**
 * StockVault CLI (sv / stockvault)
 * 股票持仓管理与分析系统命令行工具
 * 
 * 零运行时依赖 ESM 脚本（仅依赖 Node.js 内置模块）
 * 遵循 CLI-DESIGN.md 规范与 Agent API v1 契约
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import process from 'node:process';

// ────────────────────────────────────────────────────────────
// 常量与版本契约
// ────────────────────────────────────────────────────────────

const CLI_VERSION = '0.1.0';
const SCHEMA_VERSION = 1;
const SUPPORTED_API_VERSIONS = ['v1'];
const DEFAULT_BASE_URL = 'https://finance.snowyegret.top';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const DEFAULT_MAX_AGE = '6h';

const EXIT_CODES = {
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  CONFIG: 3,
  AUTH: 4,
  NOT_FOUND: 5,
  NETWORK: 6,
  SERVER: 7,
  RATE_LIMITED: 8,
  PROTOCOL: 9,
  PARTIAL: 10,
};

const EXIT_CODE_NAMES = {
  0: 'OK',
  1: 'INTERNAL',
  2: 'USAGE',
  3: 'CONFIG',
  4: 'AUTH',
  5: 'NOT_FOUND',
  6: 'NETWORK',
  7: 'SERVER',
  8: 'RATE_LIMITED',
  9: 'PROTOCOL',
  10: 'PARTIAL',
};

const VALID_MARKETS = ['A_SHARE', 'HK', 'US', 'SWISS'];
const VALID_MARKETS_WITH_ALL = ['ALL', 'A_SHARE', 'HK', 'US', 'SWISS'];
const VALID_STATUSES = ['OPEN', 'CLOSED'];
const VALID_TRADE_TYPES = ['BUY', 'SELL'];
const VALID_POSITIONS_SORT = ['valueCNY', 'pnlCNY', 'pnlPercent', 'costCNY', 'symbol', 'openDate'];

// ────────────────────────────────────────────────────────────
// 异常类定义
// ────────────────────────────────────────────────────────────

class CliError extends Error {
  constructor({ type, code, message, hint, httpStatus, retryable = false, exitCode, checks, endpoint, durationMs }) {
    super(message);
    this.type = type;
    this.code = code;
    this.hint = hint;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.exitCode = exitCode ?? (EXIT_CODES[type] || 1);
    this.checks = checks;
    this.endpoint = endpoint;
    this.durationMs = durationMs;
  }
}

// ────────────────────────────────────────────────────────────
// 字符串、脱敏与宽字符工具
// ────────────────────────────────────────────────────────────

/**
 * 脱敏 API Key（仅显示 sk-…末4位）
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  if (!key) return '(未设置)';
  const str = String(key).trim();
  if (str.startsWith('sk-') && str.length >= 8) {
    return `sk-…${str.slice(-4)}`;
  }
  if (str.length > 8) {
    return `${str.slice(0, 3)}…${str.slice(-4)}`;
  }
  return '***';
}

/**
 * 计算终端中字符串的视觉列宽（处理 CJK 汉字宽度为 2 的情况）
 * @param {string} str
 * @returns {number}
 */
function stringWidth(str) {
  if (!str) return 0;
  const clean = String(str).replace(/\x1b\[[0-9;]*m/g, '');
  let width = 0;
  for (const char of clean) {
    const code = char.codePointAt(0);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x3000 && code <= 0x303f)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padEndWidth(str, targetWidth) {
  const w = stringWidth(str);
  return str + ' '.repeat(Math.max(0, targetWidth - w));
}

function padStartWidth(str, targetWidth) {
  const w = stringWidth(str);
  return ' '.repeat(Math.max(0, targetWidth - w)) + str;
}

/**
 * 格式化时间戳为 ISO-8601 UTC 带 'Z'
 * @param {string|number|Date} ts
 * @returns {string|null}
 */
function formatIsoUtc(ts) {
  if (!ts) return null;
  if (typeof ts === 'string') {
    if (ts.endsWith('Z')) return ts;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(ts)) {
      return ts.replace(' ', 'T') + 'Z';
    }
  }
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toISOString();
}

/**
 * 展开波浪号 ~ 为用户主目录
 * @param {string} p
 * @returns {string}
 */
function expandHome(p) {
  if (p && (p.startsWith('~/') || p === '~' || p.startsWith('~\\'))) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ────────────────────────────────────────────────────────────
// 格式化与颜色支持（遵守 NO_COLOR 与国内/国际红绿偏好）
// ────────────────────────────────────────────────────────────

function getColorHelper(flags) {
  const noColor = Boolean(flags['no-color']) || Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;
  if (noColor) {
    return {
      bold: (s) => String(s),
      dim: (s) => String(s),
      red: (s) => String(s),
      green: (s) => String(s),
      yellow: (s) => String(s),
      cyan: (s) => String(s),
      pnl: (num, text) => String(text),
    };
  }
  const isIntl = process.env.STOCKVAULT_COLOR_SCHEME === 'intl';
  return {
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    pnl: (num, text) => {
      if (num === null || num === undefined || isNaN(num) || Number(num) === 0) return String(text);
      if (Number(num) > 0) {
        return isIntl ? `\x1b[32m${text}\x1b[0m` : `\x1b[31m${text}\x1b[0m`;
      }
      return isIntl ? `\x1b[31m${text}\x1b[0m` : `\x1b[32m${text}\x1b[0m`;
    },
  };
}

function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(Number(num))) return '-';
  const parts = Number(num).toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function formatSignedNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(Number(num))) return '-';
  const formatted = formatNumber(num, decimals);
  if (Number(num) > 0) return '+' + formatted;
  return formatted;
}

function formatPercent(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(Number(num))) return '-';
  const formatted = Number(num).toFixed(decimals);
  if (Number(num) > 0) return `+${formatted}%`;
  return `${formatted}%`;
}

// ────────────────────────────────────────────────────────────
// 参数校验工具
// ────────────────────────────────────────────────────────────

function validateDate(dateStr, fieldName = 'date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `${fieldName} 格式错误: "${dateStr}"，必须严格符合 YYYY-MM-DD 格式`,
      exitCode: EXIT_CODES.USAGE,
    });
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  if (
    dateObj.getUTCFullYear() !== y ||
    dateObj.getUTCMonth() !== m - 1 ||
    dateObj.getUTCDate() !== d
  ) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `${fieldName} 日期非法: "${dateStr}"，并非真实有效日期`,
      exitCode: EXIT_CODES.USAGE,
    });
  }
}

function calculateLastDate(lastStr) {
  const match = String(lastStr).match(/^(\d+)([dwmy])$/);
  if (!match) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `--last 参数格式错误: "${lastStr}"，合法格式示例: 30d, 12w, 6m, 1y`,
      exitCode: EXIT_CODES.USAGE,
    });
  }
  const count = parseInt(match[1], 10);
  const unit = match[2];
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (unit === 'd') {
    d.setUTCDate(d.getUTCDate() - count);
  } else if (unit === 'w') {
    d.setUTCDate(d.getUTCDate() - count * 7);
  } else if (unit === 'm') {
    d.setUTCMonth(d.getUTCMonth() - count);
  } else if (unit === 'y') {
    d.setUTCFullYear(d.getUTCFullYear() - count);
  }
  return d.toISOString().slice(0, 10);
}

function parseMaxAgeSeconds(ageStr) {
  const match = String(ageStr).match(/^(\d+)([mhd])$/);
  if (!match) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `--max-age 参数格式错误: "${ageStr}"，合法格式示例: 30m, 6h, 2d`,
      exitCode: EXIT_CODES.USAGE,
    });
  }
  const count = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'm') return count * 60;
  if (unit === 'h') return count * 3600;
  if (unit === 'd') return count * 86400;
  return count;
}

function cleanAndValidateSymbol(sym) {
  if (!sym || typeof sym !== 'string') {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: '股票代码不能为空',
      exitCode: EXIT_CODES.USAGE,
    });
  }
  const cleaned = sym.trim().toUpperCase();
  if (!/^[A-Z0-9.^:_-]{1,32}$/.test(cleaned)) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `股票代码格式非法: "${sym}"，只允许字母、数字及 .^:_-，长度 1–32 位`,
      exitCode: EXIT_CODES.USAGE,
    });
  }
  return cleaned;
}

/**
 * 生成代码格式提示（针对 404 建议另一种格式）
 * @param {string} symbol
 * @returns {string}
 */
function getSymbolHint(symbol) {
  const upper = symbol.toUpperCase();
  let alt = null;
  if (upper.endsWith('.SHH')) alt = upper.replace('.SHH', '.SS');
  else if (upper.endsWith('.SHZ')) alt = upper.replace('.SHZ', '.SZ');
  else if (upper.endsWith('.HKG')) alt = upper.replace('.HKG', '.HK');
  else if (upper.endsWith('.SWX')) alt = upper.replace('.SWX', '.SW');
  else if (upper.endsWith('.SS')) alt = upper.replace('.SS', '.SHH');
  else if (upper.endsWith('.SZ')) alt = upper.replace('.SZ', '.SHZ');
  else if (upper.endsWith('.HK')) alt = upper.replace('.HK', '.HKG');
  else if (upper.endsWith('.SW')) alt = upper.replace('.SW', '.SWX');
  else if (upper.endsWith('.SH')) alt = upper.replace('.SH', '.SS') + ' 或 ' + upper.replace('.SH', '.SHH');

  if (alt) {
    return `该代码可能以另一种格式存储，可尝试 \`sv position ${alt}\`，或用 \`sv positions --fields symbol\` 查看全部持仓代码`;
  }
  return '请检查股票代码拼写，或用 `sv positions --fields symbol` 查看全部持仓代码';
}

function validateFields(fieldsArg, allowedFields) {
  if (!fieldsArg) return;
  const fields = fieldsArg.split(',').map((f) => f.trim()).filter(Boolean);
  if (fields.length === 0) return;

  if (allowedFields && allowedFields.length > 0) {
    const allowedSet = new Set(allowedFields);
    for (const f of fields) {
      if (!allowedSet.has(f)) {
        throw new CliError({
          type: 'USAGE',
          code: 'INVALID_ARGUMENT',
          message: `无效的投影字段: "${f}"，可用字段为: ${allowedFields.join(', ')}`,
          exitCode: EXIT_CODES.USAGE,
        });
      }
    }
  }
}

/**
 * 字段投影过滤
 * @param {object} data
 * @param {string} fieldsArg
 * @param {string[]} allowedFields
 * @returns {object}
 */
function projectFields(data, fieldsArg, allowedFields) {
  if (!fieldsArg) return data;
  const fields = fieldsArg.split(',').map((f) => f.trim()).filter(Boolean);
  if (fields.length === 0) return data;

  validateFields(fieldsArg, allowedFields);

  const pick = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const res = {};
    for (const f of fields) {
      if (f in obj) {
        res[f] = obj[f];
      }
    }
    return res;
  };

  if (data?.items && Array.isArray(data.items)) {
    return {
      ...data,
      items: data.items.map(pick),
    };
  }

  return pick(data);
}

// ────────────────────────────────────────────────────────────
// 配置加载与解析
// ────────────────────────────────────────────────────────────

function getConfigPath() {
  if (process.env.STOCKVAULT_CONFIG) {
    return path.resolve(process.env.STOCKVAULT_CONFIG);
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'stockvault', 'config.json');
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'stockvault', 'config.json');
}

function loadConfigFile(configPath, warnings) {
  if (!fs.existsSync(configPath)) {
    return null;
  }
  if (process.platform !== 'win32') {
    try {
      const stat = fs.statSync(configPath);
      const mode = stat.mode & 0o777;
      if ((mode & 0o077) !== 0) {
        warnings.push({
          code: 'INSECURE_CONFIG_PERMS',
          message: `配置文件权限比 0600 宽 (当前 0${mode.toString(8)})，建议设置为 0600 (chmod 600 ${configPath})`,
          path: configPath,
          mode: `0${mode.toString(8)}`,
        });
      }
    } catch {
      // 忽略 stat 错误
    }
  }

  let content;
  try {
    content = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new CliError({
      type: 'CONFIG',
      code: 'CONFIG_READ_ERROR',
      message: `无法读取配置文件: ${configPath} (${err.message})`,
      exitCode: EXIT_CODES.CONFIG,
    });
  }

  try {
    return JSON.parse(content);
  } catch (err) {
    throw new CliError({
      type: 'CONFIG',
      code: 'CONFIG_PARSE_ERROR',
      message: `配置文件 JSON 格式错误: ${configPath} (${err.message})`,
      hint: '请检查配置文件格式，确保为合法的 JSON 对象',
      exitCode: EXIT_CODES.CONFIG,
    });
  }
}

function resolveConfig(flags, warnings) {
  const configPath = getConfigPath();
  const configObj = loadConfigFile(configPath, warnings);

  // Profile 优先级: --profile → STOCKVAULT_PROFILE → defaultProfile → prod
  let profileName = flags.profile || process.env.STOCKVAULT_PROFILE;
  if (!profileName) {
    profileName = configObj?.defaultProfile || 'prod';
  }

  const profile = configObj?.profiles?.[profileName] || {};

  // Base URL 优先级: --base-url → STOCKVAULT_BASE_URL → profile.baseUrl → DEFAULT_BASE_URL
  let baseUrl = flags['base-url'] || process.env.STOCKVAULT_BASE_URL || profile.baseUrl || DEFAULT_BASE_URL;
  let baseUrlSource = 'default';
  if (flags['base-url']) baseUrlSource = 'flag:--base-url';
  else if (process.env.STOCKVAULT_BASE_URL) baseUrlSource = 'env:STOCKVAULT_BASE_URL';
  else if (profile.baseUrl) baseUrlSource = `config:${profileName}.baseUrl`;

  baseUrl = baseUrl.replace(/\/+$/, '');

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new CliError({
      type: 'CONFIG',
      code: 'INVALID_BASE_URL',
      message: `Base URL 格式非法: "${baseUrl}"`,
      hint: '请输入合法的 URL，例如 https://finance.snowyegret.top',
      exitCode: EXIT_CODES.CONFIG,
    });
  }

  const isLocalhost =
    parsedUrl.hostname === 'localhost' ||
    parsedUrl.hostname === '127.0.0.1' ||
    parsedUrl.hostname === '[::1]';

  if (parsedUrl.protocol !== 'https:' && !isLocalhost) {
    throw new CliError({
      type: 'CONFIG',
      code: 'INSECURE_BASE_URL',
      message: `安全约束拒绝：除 localhost/127.0.0.1 外，Base URL 必须使用 HTTPS 协议以防止密钥泄露 (当前为 ${parsedUrl.protocol})`,
      hint: '请使用 https:// 开头的安全服务地址',
      exitCode: EXIT_CODES.CONFIG,
    });
  }

  // API Key 优先级: STOCKVAULT_API_KEY → STOCKVAULT_API_KEY_FILE → profile.apiKeyFile → profile.apiKey
  let apiKey = null;
  let apiKeySource = null;

  if (process.env.STOCKVAULT_API_KEY) {
    apiKey = process.env.STOCKVAULT_API_KEY.trim();
    apiKeySource = 'env:STOCKVAULT_API_KEY';
  } else if (process.env.STOCKVAULT_API_KEY_FILE) {
    const keyFile = expandHome(process.env.STOCKVAULT_API_KEY_FILE);
    try {
      apiKey = fs.readFileSync(keyFile, 'utf8').trim();
      apiKeySource = `env_file:STOCKVAULT_API_KEY_FILE (${keyFile})`;
    } catch (err) {
      throw new CliError({
        type: 'CONFIG',
        code: 'KEY_FILE_READ_ERROR',
        message: `无法从 STOCKVAULT_API_KEY_FILE 指定的文件读取 API Key: ${keyFile} (${err.message})`,
        exitCode: EXIT_CODES.CONFIG,
      });
    }
  } else if (profile.apiKeyFile) {
    const keyFile = expandHome(profile.apiKeyFile);
    try {
      apiKey = fs.readFileSync(keyFile, 'utf8').trim();
      apiKeySource = `config_file:${profileName}.apiKeyFile (${keyFile})`;
    } catch (err) {
      throw new CliError({
        type: 'CONFIG',
        code: 'KEY_FILE_READ_ERROR',
        message: `无法从配置文件中指定的 apiKeyFile 读取 API Key: ${keyFile} (${err.message})`,
        exitCode: EXIT_CODES.CONFIG,
      });
    }
  } else if (profile.apiKey) {
    apiKey = String(profile.apiKey).trim();
    apiKeySource = `config:${profileName}.apiKey`;
  }

  const timeout = flags.timeout ? parseInt(flags.timeout, 10) : DEFAULT_TIMEOUT_MS;
  const retries = flags.retries ? parseInt(flags.retries, 10) : DEFAULT_RETRIES;
  const maxAge = flags['max-age'] || DEFAULT_MAX_AGE;
  const verbose = Boolean(flags.verbose);

  return {
    profileName,
    configPath,
    baseUrl,
    baseUrlSource,
    apiKey,
    apiKeySource,
    timeout,
    retries,
    maxAge,
    verbose,
  };
}

function requireApiKey(config) {
  if (!config.apiKey) {
    throw new CliError({
      type: 'CONFIG',
      code: 'MISSING_API_KEY',
      message: '未配置 API Key',
      hint: `请设置环境变量 STOCKVAULT_API_KEY=sk-...，或运行 sv config init 配置本地密钥。可在 Web 端「${config.baseUrl}/#/settings → OpenClaw API 密钥」中生成。`,
      exitCode: EXIT_CODES.CONFIG,
    });
  }

  if (!/^sk-[a-f0-9]{40}$/.test(config.apiKey)) {
    throw new CliError({
      type: 'CONFIG',
      code: 'INVALID_API_KEY_FORMAT',
      message: 'API Key 格式不正确，必须为 sk- 开头的 40 位十六进制字符',
      hint: '请检查 API Key 是否完整复制（共 43 个字符，如 sk-0123456789abcdef0123456789abcdef01234567）',
      exitCode: EXIT_CODES.CONFIG,
    });
  }
}

// ────────────────────────────────────────────────────────────
// HTTP 请求客户端（仅走 Authorization 头，超时与重试，退避算法）
// ────────────────────────────────────────────────────────────

function parseBackendError(status, json, requestUrl) {
  let backendCode = null;
  let backendMessage = null;

  if (typeof json?.error === 'object' && json?.error !== null) {
    backendCode = json.error.code;
    backendMessage = json.error.message;
  } else if (typeof json?.error === 'string') {
    backendMessage = json.error;
  }

  const urlObj = new URL(requestUrl);
  const pathname = urlObj.pathname;

  if (status === 400) {
    return new CliError({
      type: 'USAGE',
      code: backendCode || 'SERVER_REJECTED_ARGUMENT',
      message: backendMessage || '请求参数被服务端拒绝',
      httpStatus: 400,
      retryable: false,
      exitCode: EXIT_CODES.USAGE,
    });
  }

  if (status === 401 || status === 403) {
    return new CliError({
      type: 'AUTH',
      code: backendCode || (status === 403 ? 'FORBIDDEN' : 'INVALID_API_KEY'),
      message: backendMessage || (status === 403 ? '权限不足' : '鉴权失败'),
      hint: `API Key 无效。可能原因：①Key 已在系统设置页被重新生成或撤销；②复制不完整。请到 ${urlObj.origin}/#/settings 生成新 Key 并更新 STOCKVAULT_API_KEY。`,
      httpStatus: status,
      retryable: false,
      exitCode: EXIT_CODES.AUTH,
    });
  }

  if (status === 404) {
    if (pathname.includes('/position/')) {
      const sym = decodeURIComponent(pathname.split('/position/')[1] || '');
      return new CliError({
        type: 'NOT_FOUND',
        code: backendCode || 'POSITION_NOT_FOUND',
        message: backendMessage || `Position not found: ${sym}`,
        hint: getSymbolHint(sym),
        httpStatus: 404,
        retryable: false,
        exitCode: EXIT_CODES.NOT_FOUND,
      });
    }
    if (pathname.includes('/quotes') || pathname.includes('/quote/')) {
      return new CliError({
        type: 'NOT_FOUND',
        code: backendCode || 'SYMBOL_NOT_FOUND',
        message: backendMessage || '未找到该股票报价',
        hint: '请检查股票代码是否正确（美股如 AAPL，港股如 0700.HK，A股如 600036.SS）',
        httpStatus: 404,
        retryable: false,
        exitCode: EXIT_CODES.NOT_FOUND,
      });
    }
    return new CliError({
      type: 'PROTOCOL',
      code: backendCode || 'ENDPOINT_NOT_FOUND',
      message: backendMessage || `端点不存在 (404): ${pathname}`,
      hint: '请检查 --base-url 配置或确认服务端版本是否支持新版 Agent API',
      httpStatus: 404,
      retryable: false,
      exitCode: EXIT_CODES.PROTOCOL,
    });
  }

  if (status === 429) {
    return new CliError({
      type: 'RATE_LIMITED',
      code: backendCode || 'RATE_LIMITED',
      message: backendMessage || '请求过于频繁，触发服务端限流',
      httpStatus: 429,
      retryable: true,
      exitCode: EXIT_CODES.RATE_LIMITED,
    });
  }

  if (status === 502) {
    return new CliError({
      type: 'SERVER',
      code: backendCode || 'UPSTREAM_QUOTE_FAILED',
      message: backendMessage || '上游数据源请求失败（如 Yahoo Finance）',
      hint: '上游行情服务偶发超时，稍后重试通常可恢复',
      httpStatus: 502,
      retryable: true,
      exitCode: EXIT_CODES.SERVER,
    });
  }

  if (status === 503 || status === 504) {
    return new CliError({
      type: 'SERVER',
      code: backendCode || 'SERVICE_UNAVAILABLE',
      message: backendMessage || '服务端暂时不可用或网关超时',
      hint: '服务端正在维护或处理超时，请稍后重试',
      httpStatus: status,
      retryable: true,
      exitCode: EXIT_CODES.SERVER,
    });
  }

  if (status >= 500) {
    return new CliError({
      type: 'SERVER',
      code: backendCode || 'SERVER_ERROR',
      message: backendMessage || '服务端内部错误',
      httpStatus: status,
      retryable: false,
      exitCode: EXIT_CODES.SERVER,
    });
  }

  return new CliError({
    type: 'PROTOCOL',
    code: backendCode || 'UNEXPECTED_STATUS',
    message: backendMessage || `意外的 HTTP 状态码: ${status}`,
    httpStatus: status,
    retryable: false,
    exitCode: EXIT_CODES.PROTOCOL,
  });
}

function mapFetchError(err, timeoutMs) {
  if (err.name === 'AbortError' || err.name === 'TimeoutError') {
    return new CliError({
      type: 'NETWORK',
      code: 'TIMEOUT',
      message: `网络请求超时（超过 ${timeoutMs}ms）`,
      hint: '可通过 --timeout <ms> 增加超时时间，或检查网络连接',
      retryable: true,
      exitCode: EXIT_CODES.NETWORK,
    });
  }

  const causeCode = err.cause?.code || err.code;
  if (causeCode === 'ENOTFOUND') {
    return new CliError({
      type: 'NETWORK',
      code: 'DNS_FAILURE',
      message: `域名解析失败 (DNS_FAILURE): ${err.message}`,
      hint: '请检查网络 DNS 设置或 --base-url 主机名是否正确',
      retryable: true,
      exitCode: EXIT_CODES.NETWORK,
    });
  }

  if (causeCode === 'ECONNREFUSED') {
    return new CliError({
      type: 'NETWORK',
      code: 'CONNECTION_REFUSED',
      message: '连接被拒绝 (CONNECTION_REFUSED): 服务端未监听对应端口',
      hint: '如果是在本地开发，请确认 wrangler pages dev 已启动（通常在 http://localhost:8788）',
      retryable: true,
      exitCode: EXIT_CODES.NETWORK,
    });
  }

  if (
    causeCode === 'CERT_HAS_EXPIRED' ||
    causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    causeCode?.startsWith('ERR_TLS_') ||
    causeCode?.startsWith('TLS_')
  ) {
    return new CliError({
      type: 'NETWORK',
      code: 'TLS_ERROR',
      message: `TLS/SSL 证书校验失败: ${err.message}`,
      hint: '请检查系统证书库或服务端 SSL 证书配置',
      retryable: true,
      exitCode: EXIT_CODES.NETWORK,
    });
  }

  return new CliError({
    type: 'NETWORK',
    code: 'NETWORK_ERROR',
    message: `网络通信失败: ${err.message}`,
    hint: '请检查本地网络连接及防火墙设置',
    retryable: true,
    exitCode: EXIT_CODES.NETWORK,
  });
}

async function doFetch(url, options = {}, config) {
  const timeoutMs = options.timeout ?? config.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? config.retries ?? DEFAULT_RETRIES;
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    const startTime = Date.now();
    try {
      if (config.verbose) {
        const maskedKey = maskKey(config.apiKey);
        process.stderr.write(
          `[verbose] ${options.method || 'GET'} ${url} (attempt ${attempt + 1}/${maxRetries + 1}, key=${maskedKey})\n`
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const headers = {
        'Accept': 'application/json',
        ...(options.headers || {}),
      };
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }

      let res;
      try {
        res = await fetch(url, {
          method: options.method || 'GET',
          headers,
          redirect: 'manual',
          signal: controller.signal,
          ...(options.body ? { body: options.body } : {}),
        });
      } finally {
        clearTimeout(timer);
      }

      const durationMs = Date.now() - startTime;
      if (config.verbose) {
        process.stderr.write(`[verbose] Response: HTTP ${res.status} in ${durationMs}ms\n`);
      }

      const endpointStr = `${options.method || 'GET'} ${new URL(url).pathname}${new URL(url).search}`;

      if (res.status >= 300 && res.status < 400) {
        throw new CliError({
          type: 'PROTOCOL',
          code: 'UNEXPECTED_REDIRECT',
          message: `服务器返回意外重定向 (HTTP ${res.status})，为防止密钥泄露已终止请求`,
          httpStatus: res.status,
          retryable: false,
          exitCode: EXIT_CODES.PROTOCOL,
          endpoint: endpointStr,
          durationMs,
        });
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new CliError({
          type: 'PROTOCOL',
          code: 'NON_JSON_RESPONSE',
          message: `服务端返回非 JSON 响应 (HTTP ${res.status})`,
          hint: '可能由于路径错误或单页应用 (SPA) 回退到了 HTML。请检查 --base-url 配置及服务端版本',
          httpStatus: res.status,
          retryable: false,
          exitCode: EXIT_CODES.PROTOCOL,
          endpoint: endpointStr,
          durationMs,
        });
      }

      const json = await res.json();

      if (!res.ok) {
        const parsedErr = parseBackendError(res.status, json, url);
        parsedErr.endpoint = endpointStr;
        parsedErr.durationMs = durationMs;
        if (parsedErr.retryable && attempt < maxRetries) {
          lastError = parsedErr;
          let delay = (attempt === 0 ? 500 : 1500) + Math.floor(Math.random() * 200);
          if (res.status === 429) {
            const retryAfter = res.headers.get('retry-after');
            if (retryAfter) {
              const sec = parseInt(retryAfter, 10);
              if (!isNaN(sec) && sec > 0) {
                delay = Math.min(sec * 1000, 10000);
              }
            }
          }
          if (config.verbose) {
            process.stderr.write(`[verbose] Retrying after ${delay}ms due to ${parsedErr.code}...\n`);
          }
          await sleep(delay);
          attempt++;
          continue;
        }
        throw parsedErr;
      }

      if (json.success === false) {
        const parsedErr = parseBackendError(res.status, json, url);
        parsedErr.endpoint = endpointStr;
        parsedErr.durationMs = durationMs;
        throw parsedErr;
      }

      return { json, durationMs, status: res.status };
    } catch (err) {
      if (err instanceof CliError) {
        if (!err.endpoint) {
          err.endpoint = `${options.method || 'GET'} ${new URL(url).pathname}${new URL(url).search}`;
        }
        if (err.durationMs === undefined) {
          err.durationMs = Date.now() - startTime;
        }
        if (err.retryable && attempt < maxRetries) {
          lastError = err;
          const delay = (attempt === 0 ? 500 : 1500) + Math.floor(Math.random() * 200);
          if (config.verbose) {
            process.stderr.write(`[verbose] Retrying after ${delay}ms due to ${err.code}...\n`);
          }
          await sleep(delay);
          attempt++;
          continue;
        }
        throw err;
      }

      const netErr = mapFetchError(err, timeoutMs);
      netErr.endpoint = `${options.method || 'GET'} ${new URL(url).pathname}${new URL(url).search}`;
      netErr.durationMs = Date.now() - startTime;
      if (netErr.retryable && attempt < maxRetries) {
        lastError = netErr;
        const delay = (attempt === 0 ? 500 : 1500) + Math.floor(Math.random() * 200);
        if (config.verbose) {
          process.stderr.write(`[verbose] Retrying after ${delay}ms due to ${netErr.code}...\n`);
        }
        await sleep(delay);
        attempt++;
        continue;
      }
      throw netErr;
    }
  }

  throw lastError;
}

// ────────────────────────────────────────────────────────────
// Envelope 输出构建器
// ────────────────────────────────────────────────────────────

function printSuccess(command, data, warnings = [], meta = {}, flags = {}) {
  const envelope = {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    command,
    ...(meta.partial ? { partial: true } : {}),
    data,
    warnings: warnings || [],
    meta: {
      cliVersion: CLI_VERSION,
      apiVersion: meta.apiVersion || 'v1',
      ...(meta.baseUrl ? { baseUrl: meta.baseUrl } : {}),
      ...(meta.endpoint ? { endpoint: meta.endpoint } : {}),
      ...(meta.serverTimestamp ? { serverTimestamp: meta.serverTimestamp } : {}),
      ...(meta.dataAsOf ? { dataAsOf: meta.dataAsOf } : {}),
      durationMs: meta.durationMs ?? 0,
    },
  };

  if (flags.pretty) {
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify(envelope) + '\n');
  }

  process.exit(meta.exitCode ?? 0);
}

function printError(command, error, warnings = [], meta = {}, flags = {}) {
  const exitCode = error.exitCode ?? (EXIT_CODES[error.type] || 1);

  if (flags.human) {
    const colors = getColorHelper(flags);
    process.stdout.write(
      colors.red(`\n[错误 ${error.type || 'INTERNAL'}/${error.code || 'UNEXPECTED'}] `) +
      colors.bold(error.message || '执行失败') + '\n'
    );
    if (error.hint) {
      process.stdout.write(colors.cyan(`提示: `) + error.hint + '\n');
    }
    if (error.checks && Array.isArray(error.checks)) {
      process.stdout.write('\n自检详情:\n');
      for (const c of error.checks) {
        const mark = c.status === 'pass' ? colors.green('✔ PASS') : c.status === 'warn' ? colors.yellow('⚠ WARN') : colors.red('✖ FAIL');
        process.stdout.write(`  [${mark}] ${c.name}: ${c.detail || ''}\n`);
      }
    }
    process.stdout.write('\n');
    process.exit(exitCode);
  }

  const envelope = {
    ok: false,
    schemaVersion: SCHEMA_VERSION,
    command: command || 'unknown',
    error: {
      type: error.type || 'INTERNAL',
      code: error.code || 'UNEXPECTED',
      message: error.message || '内部错误',
      ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
      retryable: Boolean(error.retryable),
      ...(error.hint ? { hint: error.hint } : {}),
      ...(error.checks ? { checks: error.checks } : {}),
    },
    warnings: warnings || [],
    meta: {
      cliVersion: CLI_VERSION,
      ...((meta.endpoint || error.endpoint) ? { endpoint: meta.endpoint || error.endpoint } : {}),
      durationMs: meta.durationMs ?? error.durationMs ?? 0,
    },
  };

  if (flags.pretty) {
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify(envelope) + '\n');
  }

  process.exit(exitCode);
}

// ────────────────────────────────────────────────────────────
// 人类可读表格与卡片输出器 (--human)
// ────────────────────────────────────────────────────────────

function renderTable(columns, rows, flags) {
  if (!rows || rows.length === 0) {
    return '（暂无数据）\n';
  }

  const colors = getColorHelper(flags);
  const widths = columns.map((col) => {
    let max = stringWidth(col.title);
    for (const row of rows) {
      const formatted = col.format ? col.format(row[col.key], row) : String(row[col.key] ?? '-');
      const w = stringWidth(formatted);
      if (w > max) max = w;
    }
    return max;
  });

  const header = columns
    .map((col, idx) => {
      return col.align === 'right'
        ? padStartWidth(col.title, widths[idx])
        : padEndWidth(col.title, widths[idx]);
    })
    .join('   ');

  const divider = widths.map((w) => '-'.repeat(w)).join('   ');

  const body = rows
    .map((row) => {
      return columns
        .map((col, idx) => {
          const rawVal = row[col.key];
          const formatted = col.format ? col.format(rawVal, row) : String(rawVal ?? '-');
          const padded =
            col.align === 'right'
              ? padStartWidth(formatted, widths[idx])
              : padEndWidth(formatted, widths[idx]);

          if (col.isPnl) {
            return colors.pnl(rawVal, padded);
          }
          return padded;
        })
        .join('   ');
    })
    .join('\n');

  return colors.bold(header) + '\n' + colors.dim(divider) + '\n' + body + '\n';
}

// ────────────────────────────────────────────────────────────
// 各命令实现
// ────────────────────────────────────────────────────────────

async function handlePortfolio(flags, warnings) {
  const allowedFields = [
    'totalValueCNY',
    'totalCostCNY',
    'totalPnlCNY',
    'totalPnlPercent',
    'ytdPnlCNY',
    'positionCount',
    'markets',
    'lastUpdated',
  ];
  validateFields(flags.fields, allowedFields);

  const config = resolveConfig(flags, warnings);
  requireApiKey(config);

  const endpointPath = '/api/agent/portfolio';
  const endpointUrl = `${config.baseUrl}${endpointPath}`;
  const startTime = Date.now();

  const { json, durationMs } = await doFetch(endpointUrl, {}, config);
  let data = json.data || {};

  if (!flags.raw) {
    if (data.lastUpdated) {
      data.lastUpdated = formatIsoUtc(data.lastUpdated);
    }

    const maxAgeSec = parseMaxAgeSeconds(config.maxAge);
    if (data.lastUpdated) {
      const ageSec = Math.round((Date.now() - new Date(data.lastUpdated).getTime()) / 1000);
      if (ageSec > maxAgeSec) {
        warnings.push({
          code: 'STALE_QUOTES',
          message: `行情缓存距今约 ${(ageSec / 3600).toFixed(1)} 小时，超过 --max-age=${config.maxAge}；打开 Web 仪表盘可刷新`,
          dataAsOf: data.lastUpdated,
          ageSeconds: ageSec,
        });
      }
    }

    if (data.ytdPnlCNY === null || data.ytdPnlCNY === undefined) {
      warnings.push({
        code: 'YTD_UNAVAILABLE',
        message: '暂无历史快照，YTD 收益不可用',
      });
    }
  }

  data = projectFields(data, flags.fields, allowedFields);

  if (flags.human) {
    const colors = getColorHelper(flags);
    const staleWarn = warnings.find((w) => w.code === 'STALE_QUOTES');
    const staleText = staleWarn ? ` (${colors.yellow(`⚠ 行情已过期 ${(staleWarn.ageSeconds / 3600).toFixed(1)}h`)})` : '';

    let out = colors.bold('\n组合概要') + ` (行情截至: ${data.lastUpdated || '未知'}${staleText})\n`;
    out += `  总市值:   ${colors.bold('¥' + formatNumber(data.totalValueCNY))}     总成本:  ¥${formatNumber(data.totalCostCNY)}\n`;
    out += `  总盈亏:   ${colors.pnl(data.totalPnlCNY, '¥' + formatSignedNumber(data.totalPnlCNY))} (${colors.pnl(data.totalPnlPercent, formatPercent(data.totalPnlPercent))})   YTD: ¥${formatSignedNumber(data.ytdPnlCNY)}   持仓: ${data.positionCount ?? '-'} 只\n\n`;

    if (data.markets) {
      const mRows = Object.entries(data.markets).map(([market, mData]) => ({
        market,
        count: mData.count,
        valueCNY: mData.valueCNY,
        pnlCNY: mData.pnlCNY,
      }));
      out += renderTable(
        [
          { key: 'market', title: 'MARKET', align: 'left' },
          { key: 'count', title: 'COUNT', align: 'right' },
          { key: 'valueCNY', title: 'VALUE(CNY)', align: 'right', format: (v) => formatNumber(v) },
          { key: 'pnlCNY', title: 'PNL(CNY)', align: 'right', isPnl: true, format: (v) => formatSignedNumber(v) },
        ],
        mRows,
        flags
      );
    }
    process.stdout.write(out);
    process.exit(0);
  }

  printSuccess('portfolio', data, warnings, {
    apiVersion: json.meta?.version || 'v1',
    baseUrl: config.baseUrl,
    endpoint: `GET ${endpointPath}`,
    serverTimestamp: json.meta?.timestamp,
    dataAsOf: data.lastUpdated,
    durationMs,
  }, flags);
}

async function handlePositions(flags, warnings) {
  const allowedFields = [
    'symbol',
    'name',
    'market',
    'currency',
    'quantity',
    'openPrice',
    'currentPrice',
    'costCNY',
    'valueCNY',
    'pnlCNY',
    'pnlPercent',
    'openDate',
    'status',
    'closeDate',
    'closePrice',
    'realizedPnlCNY',
    'quoteUpdatedAt',
  ];
  validateFields(flags.fields, allowedFields);

  const config = resolveConfig(flags, warnings);
  requireApiKey(config);

  const status = (flags.status || 'OPEN').toUpperCase();
  if (!VALID_STATUSES.includes(status)) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `无效的 status 参数: "${flags.status}"，合法值为: OPEN, CLOSED`,
      exitCode: EXIT_CODES.USAGE,
    });
  }

  let market = null;
  if (flags.market) {
    market = flags.market.toUpperCase();
    if (!VALID_MARKETS.includes(market)) {
      throw new CliError({
        type: 'USAGE',
        code: 'INVALID_ARGUMENT',
        message: `无效的市场参数: "${flags.market}"，合法值为: ${VALID_MARKETS.join(', ')}`,
        exitCode: EXIT_CODES.USAGE,
      });
    }
  }

  if (flags.sort && !VALID_POSITIONS_SORT.includes(flags.sort)) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `无效的排序字段: "${flags.sort}"，合法值为: ${VALID_POSITIONS_SORT.join(', ')}`,
      exitCode: EXIT_CODES.USAGE,
    });
  }

  let limit = null;
  if (flags.limit !== undefined) {
    limit = parseInt(flags.limit, 10);
    if (isNaN(limit) || limit < 1) {
      throw new CliError({
        type: 'USAGE',
        code: 'INVALID_ARGUMENT',
        message: `--limit 必须为大于等于 1 的整数，实际传入: "${flags.limit}"`,
        exitCode: EXIT_CODES.USAGE,
      });
    }
  }

  const queryParams = new URLSearchParams();
  queryParams.set('status', status);
  if (market) queryParams.set('market', market);

  const endpointPath = `/api/agent/positions?${queryParams.toString()}`;
  const endpointUrl = `${config.baseUrl}${endpointPath}`;

  const { json, durationMs } = await doFetch(endpointUrl, {}, config);
  let items = json.data?.items || [];

  if (!flags.raw) {
    const missing = items.filter((i) => i.currentPrice === null).map((i) => i.symbol);
    if (missing.length > 0) {
      warnings.push({
        code: 'MISSING_QUOTES',
        message: `${missing.length} 只持仓无缓存行情，市值按开仓价估算`,
        symbols: missing,
      });
    }

    if (status === 'CLOSED') {
      warnings.push({
        code: 'CLOSED_PNL_UNRELIABLE',
        message: '已平仓持仓盈亏可能未计入平仓汇率（待服务端完善）',
      });
    }

    // 客户端排序
    if (flags.sort) {
      const sortField = flags.sort;
      const asc = Boolean(flags.asc);
      items.sort((a, b) => {
        const valA = a[sortField];
        const valB = b[sortField];
        if (typeof valA === 'string' && typeof valB === 'string') {
          return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        const numA = valA === null || valA === undefined ? (asc ? Infinity : -Infinity) : Number(valA);
        const numB = valB === null || valB === undefined ? (asc ? Infinity : -Infinity) : Number(valB);
        return asc ? numA - numB : numB - numA;
      });
    }

    // 客户端截取
    if (limit !== null && items.length > limit) {
      const totalCount = items.length;
      items = items.slice(0, limit);
      warnings.push({
        code: 'TRUNCATED',
        message: `结果已被 --limit=${limit} 截断（共 ${totalCount} 条）`,
        returned: limit,
        total: totalCount,
      });
    }
  }

  let data = {
    items,
    count: items.length,
    filter: { market: market || null, status },
  };

  data = projectFields(data, flags.fields, allowedFields);

  if (flags.human) {
    const colors = getColorHelper(flags);
    process.stdout.write(colors.bold(`\n持仓列表 (${status}${market ? `, 市场: ${market}` : ''}, 共 ${data.count} 条):\n`));
    const tableStr = renderTable(
      [
        { key: 'symbol', title: 'SYMBOL', align: 'left' },
        { key: 'name', title: 'NAME', align: 'left' },
        { key: 'market', title: 'MARKET', align: 'left' },
        { key: 'quantity', title: 'QTY', align: 'right', format: (v) => formatNumber(v, 0) },
        { key: 'openPrice', title: 'OPEN', align: 'right', format: (v) => formatNumber(v) },
        { key: 'currentPrice', title: 'PRICE', align: 'right', format: (v) => formatNumber(v) },
        { key: 'valueCNY', title: 'VALUE(CNY)', align: 'right', format: (v) => formatNumber(v) },
        { key: 'pnlCNY', title: 'PNL(CNY)', align: 'right', isPnl: true, format: (v) => formatSignedNumber(v) },
        { key: 'pnlPercent', title: 'PNL%', align: 'right', isPnl: true, format: (v) => formatPercent(v) },
      ],
      data.items,
      flags
    );
    process.stdout.write(tableStr);
    process.exit(0);
  }

  printSuccess('positions', data, warnings, {
    apiVersion: json.meta?.version || 'v1',
    baseUrl: config.baseUrl,
    endpoint: `GET ${endpointPath}`,
    durationMs,
  }, flags);
}

async function handlePosition(symbolArg, flags, warnings) {
  const allowedFields = [
    'symbol',
    'name',
    'market',
    'currency',
    'quantity',
    'openPrice',
    'openDate',
    'currentPrice',
    'costCNY',
    'valueCNY',
    'pnlCNY',
    'pnlPercent',
    'sector',
    'beta',
    'notes',
    'status',
    'trades',
  ];
  validateFields(flags.fields, allowedFields);

  const config = resolveConfig(flags, warnings);
  requireApiKey(config);

  const symbol = cleanAndValidateSymbol(symbolArg);
  const endpointPath = `/api/agent/position/${encodeURIComponent(symbol)}`;
  const endpointUrl = `${config.baseUrl}${endpointPath}`;

  const { json, durationMs } = await doFetch(endpointUrl, {}, config);
  let data = json.data || {};

  if (!flags.raw) {
    if (flags['no-trades']) {
      delete data.trades;
    }
    if (data.status === 'CLOSED') {
      warnings.push({
        code: 'AMBIGUOUS_POSITION',
        message: '查询到的持仓状态为 CLOSED（可能存在同代码的更早平仓记录）',
      });
    }
  }

  data = projectFields(data, flags.fields, allowedFields);

  if (flags.human) {
    const colors = getColorHelper(flags);
    let out = colors.bold(`\n持仓详情: ${data.symbol} ${data.name || ''}`) + ` (${data.market} / ${data.currency}) [${data.status || 'OPEN'}]\n`;
    out += `  持仓数量: ${formatNumber(data.quantity, 0)}            开仓日期: ${data.openDate || '-'}\n`;
    out += `  开仓价格: ¥${formatNumber(data.openPrice)}      当前价格: ¥${formatNumber(data.currentPrice)}\n`;
    out += `  持仓成本: ¥${formatNumber(data.costCNY)}    当前市值: ¥${formatNumber(data.valueCNY)}\n`;
    out += `  累计盈亏: ${colors.pnl(data.pnlCNY, '¥' + formatSignedNumber(data.pnlCNY))} (${colors.pnl(data.pnlPercent, formatPercent(data.pnlPercent))})\n`;
    if (data.sector || data.beta !== undefined || data.notes) {
      out += `  行业: ${data.sector || '-'}  Beta: ${data.beta ?? '-'}  备注: ${data.notes || '-'}\n`;
    }

    if (data.trades && data.trades.length > 0) {
      out += colors.bold('\n交易流水:\n');
      out += renderTable(
        [
          { key: 'date', title: 'DATE', align: 'left' },
          { key: 'type', title: 'TYPE', align: 'left' },
          { key: 'price', title: 'PRICE', align: 'right', format: (v) => formatNumber(v) },
          { key: 'quantity', title: 'QTY', align: 'right', format: (v) => formatNumber(v, 0) },
          { key: 'commission', title: 'COMMISSION', align: 'right', format: (v) => formatNumber(v) },
          { key: 'notes', title: 'NOTES', align: 'left' },
        ],
        data.trades,
        flags
      );
    }
    process.stdout.write(out);
    process.exit(0);
  }

  printSuccess('position', data, warnings, {
    apiVersion: json.meta?.version || 'v1',
    baseUrl: config.baseUrl,
    endpoint: `GET ${endpointPath}`,
    durationMs,
  }, flags);
}

async function handleTrades(flags, warnings) {
  const allowedFields = [
    'id',
    'positionId',
    'symbol',
    'name',
    'market',
    'type',
    'price',
    'quantity',
    'commission',
    'currency',
    'date',
    'tradeDate',
    'notes',
    'realizedPnl',
    'rateToCny',
  ];
  validateFields(flags.fields, allowedFields);

  const config = resolveConfig(flags, warnings);
  requireApiKey(config);

  if (flags['last'] && flags['from']) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: '--last 不能与 --from 同时使用',
      exitCode: EXIT_CODES.USAGE,
    });
  }

  if (flags['all'] && flags['offset'] !== undefined) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: '--all 不能与 --offset 同时使用',
      exitCode: EXIT_CODES.USAGE,
    });
  }

  let fromDate = flags.from || null;
  if (flags.last) {
    fromDate = calculateLastDate(flags.last);
  }
  if (fromDate) validateDate(fromDate, 'from');

  let toDate = flags.to || null;
  if (toDate) validateDate(toDate, 'to');

  if (fromDate && toDate && fromDate > toDate) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `起始日期 (${fromDate}) 不能晚于结束日期 (${toDate})`,
      exitCode: EXIT_CODES.USAGE,
    });
  }

  let symbol = null;
  if (flags.symbol) {
    symbol = cleanAndValidateSymbol(flags.symbol);
  }

  let market = null;
  if (flags.market) {
    market = flags.market.toUpperCase();
    if (!VALID_MARKETS.includes(market)) {
      throw new CliError({
        type: 'USAGE',
        code: 'INVALID_ARGUMENT',
        message: `无效的市场参数: "${flags.market}"，合法值为: ${VALID_MARKETS.join(', ')}`,
        exitCode: EXIT_CODES.USAGE,
      });
    }
  }

  let type = null;
  if (flags.type) {
    type = flags.type.toUpperCase();
    if (!VALID_TRADE_TYPES.includes(type)) {
      throw new CliError({
        type: 'USAGE',
        code: 'INVALID_ARGUMENT',
        message: `无效的交易类型: "${flags.type}"，合法值为: BUY, SELL`,
        exitCode: EXIT_CODES.USAGE,
      });
    }
  }

  let limit = flags.limit !== undefined ? parseInt(flags.limit, 10) : 100;
  if (isNaN(limit) || limit < 1 || limit > 500) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `trades 的 --limit 必须在 1 到 500 之间，实际传入: "${flags.limit}"`,
      exitCode: EXIT_CODES.USAGE,
    });
  }

  let offset = flags.offset !== undefined ? parseInt(flags.offset, 10) : 0;
  if (isNaN(offset) || offset < 0) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `trades 的 --offset 必须大于等于 0，实际传入: "${flags.offset}"`,
      exitCode: EXIT_CODES.USAGE,
    });
  }

  const maxItems = flags['max-items'] ? parseInt(flags['max-items'], 10) : 5000;
  const isAll = Boolean(flags.all);

  const fetchPage = async (pageLimit, pageOffset) => {
    const q = new URLSearchParams();
    if (symbol) q.set('symbol', symbol);
    if (market) q.set('market', market);
    if (type) q.set('type', type);
    if (fromDate) q.set('from', fromDate);
    if (toDate) q.set('to', toDate);
    q.set('limit', String(pageLimit));
    q.set('offset', String(pageOffset));

    const pathStr = `/api/agent/trades?${q.toString()}`;
    const res = await doFetch(`${config.baseUrl}${pathStr}`, {}, config);
    return { res, pathStr };
  };

  let allItems = [];
  let total = 0;
  let totalDuration = 0;
  let pagesFetched = 0;
  let lastPath = '';

  if (isAll) {
    warnings.push({
      code: 'UNSTABLE_PAGINATION',
      message: '按日分页在同一日多笔交易时可能存在轻微顺序不稳定（待服务端加 id 排序完善）',
    });

    let currentOffset = 0;
    while (currentOffset < maxItems) {
      const pageSize = Math.min(500, maxItems - currentOffset);
      const { res, pathStr } = await fetchPage(pageSize, currentOffset);
      lastPath = pathStr;
      totalDuration += res.durationMs;
      pagesFetched++;

      const pageItems = res.json.data?.items || [];
      total = res.json.data?.total ?? pageItems.length;
      allItems.push(...pageItems);

      if (pageItems.length < pageSize || allItems.length >= total) {
        break;
      }
      currentOffset += pageItems.length;
    }

    if (allItems.length >= maxItems && allItems.length < total) {
      warnings.push({
        code: 'TRUNCATED',
        message: `已达到 --max-items=${maxItems} 上限，结果已截断`,
        returned: allItems.length,
        total,
      });
    }
  } else {
    if (offset > 0) {
      warnings.push({
        code: 'UNSTABLE_PAGINATION',
        message: '按日分页在同一日多笔交易时可能存在轻微顺序不稳定（待服务端加 id 排序完善）',
      });
    }

    const { res, pathStr } = await fetchPage(limit, offset);
    lastPath = pathStr;
    totalDuration = res.durationMs;
    pagesFetched = 1;
    allItems = res.json.data?.items || [];
    total = res.json.data?.total ?? allItems.length;
  }

  const hasMore = isAll ? allItems.length < total : offset + allItems.length < total;

  let data = {
    items: allItems,
    count: allItems.length,
    total,
    pagination: {
      limit: isAll ? maxItems : limit,
      offset: isAll ? 0 : offset,
      pagesFetched,
      hasMore,
    },
    filter: {
      symbol: symbol || null,
      market: market || null,
      type: type || null,
      from: fromDate || null,
      to: toDate || null,
    },
  };

  data = projectFields(data, flags.fields, allowedFields);

  if (flags.human) {
    const colors = getColorHelper(flags);
    process.stdout.write(colors.bold(`\n交易流水 (共 ${data.total} 条，当前显示 ${data.count} 条):\n`));
    const tableStr = renderTable(
      [
        { key: 'date', title: 'DATE', align: 'left' },
        { key: 'symbol', title: 'SYMBOL', align: 'left' },
        { key: 'name', title: 'NAME', align: 'left' },
        { key: 'market', title: 'MARKET', align: 'left' },
        { key: 'type', title: 'TYPE', align: 'left' },
        { key: 'price', title: 'PRICE', align: 'right', format: (v) => formatNumber(v) },
        { key: 'quantity', title: 'QTY', align: 'right', format: (v) => formatNumber(v, 0) },
        { key: 'commission', title: 'COMMISSION', align: 'right', format: (v) => formatNumber(v) },
        { key: 'currency', title: 'CURRENCY', align: 'left' },
        { key: 'notes', title: 'NOTES', align: 'left' },
      ],
      data.items,
      flags
    );
    process.stdout.write(tableStr);
    process.exit(0);
  }

  printSuccess('trades', data, warnings, {
    apiVersion: 'v1',
    baseUrl: config.baseUrl,
    endpoint: `GET ${lastPath}`,
    durationMs: totalDuration,
  }, flags);
}

async function handleQuote(symbolsArgs, flags, warnings) {
  const allowedFields = [
    'symbol',
    'name',
    'price',
    'previousClose',
    'change',
    'changePercent',
    'currency',
    'cached',
    'updatedAt',
  ];
  validateFields(flags.fields, allowedFields);

  const config = resolveConfig(flags, warnings);
  requireApiKey(config);

  if (!symbolsArgs || symbolsArgs.length === 0) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: '缺少必需的股票代码参数',
      hint: '用法示例: sv quote AAPL 或 sv quote AAPL 0700.HK 600519.SHH',
      exitCode: EXIT_CODES.USAGE,
    });
  }

  if (symbolsArgs.length > 20) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `quote 命令单次最多支持 20 个代码，实际传入 ${symbolsArgs.length} 个`,
      exitCode: EXIT_CODES.USAGE,
    });
  }

  const cleanedSymbols = symbolsArgs.map(cleanAndValidateSymbol);
  const endpointPath = `/api/agent/quotes?symbols=${encodeURIComponent(cleanedSymbols.join(','))}`;
  const endpointUrl = `${config.baseUrl}${endpointPath}`;

  const { json, durationMs } = await doFetch(endpointUrl, {}, config);
  const resData = json.data || {};
  const items = resData.items || [];
  const errors = resData.errors || [];

  // 单代码查询模式
  if (cleanedSymbols.length === 1) {
    if (items.length === 1) {
      let quote = items[0];
      quote = projectFields(quote, flags.fields, allowedFields);

      if (flags.human) {
        const colors = getColorHelper(flags);
        let out = colors.bold(`\n实时报价: ${quote.symbol} ${quote.name || ''}\n`);
        out += `  当前现价: ${quote.currency} ${formatNumber(quote.price)}    涨跌额: ${colors.pnl(quote.change, formatSignedNumber(quote.change))} (${colors.pnl(quote.changePercent, formatPercent(quote.changePercent))})\n`;
        out += `  昨日收盘: ${formatNumber(quote.previousClose)}    更新时间: ${quote.updatedAt || '-'}${quote.cached ? ' [缓存]' : ''}\n\n`;
        process.stdout.write(out);
        process.exit(0);
      }

      printSuccess('quote', quote, warnings, {
        apiVersion: json.meta?.version || 'v1',
        baseUrl: config.baseUrl,
        endpoint: `GET ${endpointPath}`,
        durationMs,
      }, flags);
      return;
    }

    if (errors.length > 0) {
      const err = errors[0];
      const status = err.httpStatus || err.status || 404;
      const type = status === 404 ? 'NOT_FOUND' : status === 502 ? 'SERVER' : 'USAGE';
      const code = err.code || (status === 404 ? 'SYMBOL_NOT_FOUND' : 'UPSTREAM_QUOTE_FAILED');
      throw new CliError({
        type,
        code,
        message: err.message || `Symbol not found: ${cleanedSymbols[0]}`,
        hint: getSymbolHint(cleanedSymbols[0]),
        httpStatus: status,
        exitCode: EXIT_CODES[type],
      });
    }

    throw new CliError({
      type: 'NOT_FOUND',
      code: 'SYMBOL_NOT_FOUND',
      message: `未找到股票代码报价: ${cleanedSymbols[0]}`,
      hint: getSymbolHint(cleanedSymbols[0]),
      httpStatus: 404,
      exitCode: EXIT_CODES.NOT_FOUND,
    });
  }

  // 多代码查询模式
  let data = {
    items: items.map((i) => projectFields(i, flags.fields, allowedFields)),
    ...(errors.length > 0 ? { errors } : {}),
    count: items.length,
  };

  if (flags.human) {
    const colors = getColorHelper(flags);
    process.stdout.write(colors.bold(`\n实时报价 (共 ${cleanedSymbols.length} 只股票，成功 ${items.length} 只):\n`));
    process.stdout.write(
      renderTable(
        [
          { key: 'symbol', title: 'SYMBOL', align: 'left' },
          { key: 'name', title: 'NAME', align: 'left' },
          { key: 'price', title: 'PRICE', align: 'right', format: (v) => formatNumber(v) },
          { key: 'previousClose', title: 'PREV CLOSE', align: 'right', format: (v) => formatNumber(v) },
          { key: 'change', title: 'CHANGE', align: 'right', isPnl: true, format: (v) => formatSignedNumber(v) },
          { key: 'changePercent', title: 'CHANGE%', align: 'right', isPnl: true, format: (v) => formatPercent(v) },
          { key: 'currency', title: 'CURRENCY', align: 'left' },
          { key: 'updatedAt', title: 'UPDATED', align: 'left' },
        ],
        data.items,
        flags
      )
    );

    if (errors.length > 0) {
      process.stdout.write(colors.yellow(`\n查询失败的代码 (${errors.length} 只):\n`));
      for (const err of errors) {
        process.stdout.write(`  - ${err.symbol}: ${err.message || '获取失败'} [${err.code || 'ERROR'}]\n`);
      }
      process.stdout.write('\n');
    }

    if (items.length > 0 && errors.length > 0) {
      process.exit(EXIT_CODES.PARTIAL);
    }
    if (items.length === 0 && errors.length > 0) {
      process.exit(EXIT_CODES.NOT_FOUND);
    }
    process.exit(0);
  }

  if (items.length > 0 && errors.length > 0) {
    printSuccess('quote', data, warnings, {
      apiVersion: json.meta?.version || 'v1',
      baseUrl: config.baseUrl,
      endpoint: `GET ${endpointPath}`,
      durationMs,
      partial: true,
      exitCode: EXIT_CODES.PARTIAL,
    }, flags);
    return;
  }

  if (items.length === 0 && errors.length > 0) {
    const all404 = errors.every((e) => (e.httpStatus || e.status) === 404);
    const has5xx = errors.some((e) => (e.httpStatus || e.status) >= 500);
    const errType = has5xx ? 'SERVER' : all404 ? 'NOT_FOUND' : 'USAGE';
    const errCode = has5xx ? 'UPSTREAM_QUOTE_FAILED' : all404 ? 'SYMBOL_NOT_FOUND' : 'QUOTE_ERROR';

    throw new CliError({
      type: errType,
      code: errCode,
      message: `批量报价全部失败 (共 ${errors.length} 只股票)`,
      hint: '请检查代码拼写或网络上游状态',
      exitCode: EXIT_CODES[errType],
    });
  }

  printSuccess('quote', data, warnings, {
    apiVersion: json.meta?.version || 'v1',
    baseUrl: config.baseUrl,
    endpoint: `GET ${endpointPath}`,
    durationMs,
  }, flags);
}

async function handleMarkets(flags, warnings) {
  const allowedFields = [
    'positionCount',
    'totalValueCNY',
    'totalCostCNY',
    'totalPnlCNY',
    'pnlPercent',
    'ytdPnlCNY',
  ];
  validateFields(flags.fields, allowedFields);

  const config = resolveConfig(flags, warnings);
  requireApiKey(config);

  let targetMarket = null;
  if (flags.market) {
    targetMarket = flags.market.toUpperCase();
    if (!VALID_MARKETS.includes(targetMarket)) {
      throw new CliError({
        type: 'USAGE',
        code: 'INVALID_ARGUMENT',
        message: `无效的市场参数: "${flags.market}"，合法值为: ${VALID_MARKETS.join(', ')}`,
        exitCode: EXIT_CODES.USAGE,
      });
    }
  }

  const endpointPath = '/api/agent/markets';
  const endpointUrl = `${config.baseUrl}${endpointPath}`;

  const { json, durationMs } = await doFetch(endpointUrl, {}, config);
  let rawMarkets = json.data?.markets || {};

  if (targetMarket) {
    rawMarkets = targetMarket in rawMarkets ? { [targetMarket]: rawMarkets[targetMarket] } : {};
  }

  let data = { markets: rawMarkets };
  if (flags.fields) {
    const filteredMarkets = {};
    for (const [m, mData] of Object.entries(rawMarkets)) {
      filteredMarkets[m] = projectFields(mData, flags.fields, allowedFields);
    }
    data = { markets: filteredMarkets };
  }

  if (flags.human) {
    const colors = getColorHelper(flags);
    process.stdout.write(colors.bold(`\n分市场汇总:\n`));
    const rows = Object.entries(data.markets).map(([market, mData]) => ({
      market,
      count: mData.positionCount,
      valueCNY: mData.totalValueCNY,
      costCNY: mData.totalCostCNY,
      pnlCNY: mData.totalPnlCNY,
      pnlPercent: mData.pnlPercent,
      ytdPnlCNY: mData.ytdPnlCNY,
    }));
    process.stdout.write(
      renderTable(
        [
          { key: 'market', title: 'MARKET', align: 'left' },
          { key: 'count', title: 'COUNT', align: 'right' },
          { key: 'valueCNY', title: 'VALUE(CNY)', align: 'right', format: (v) => formatNumber(v) },
          { key: 'costCNY', title: 'COST(CNY)', align: 'right', format: (v) => formatNumber(v) },
          { key: 'pnlCNY', title: 'PNL(CNY)', align: 'right', isPnl: true, format: (v) => formatSignedNumber(v) },
          { key: 'pnlPercent', title: 'PNL%', align: 'right', isPnl: true, format: (v) => formatPercent(v) },
          { key: 'ytdPnlCNY', title: 'YTD(CNY)', align: 'right', isPnl: true, format: (v) => formatSignedNumber(v) },
        ],
        rows,
        flags
      )
    );
    process.exit(0);
  }

  printSuccess('markets', data, warnings, {
    apiVersion: json.meta?.version || 'v1',
    baseUrl: config.baseUrl,
    endpoint: `GET ${endpointPath}`,
    durationMs,
  }, flags);
}

async function handleSnapshots(flags, warnings) {
  const allowedFields = [
    'date',
    'totalValueCNY',
    'totalCostCNY',
    'totalPnlCNY',
    'ytdPnlCNY',
    'positionCount',
    'market',
  ];
  validateFields(flags.fields, allowedFields);

  const config = resolveConfig(flags, warnings);
  requireApiKey(config);

  if (flags['last'] && flags['from']) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: '--last 不能与 --from 同时使用',
      exitCode: EXIT_CODES.USAGE,
    });
  }

  let fromDate = flags.from || null;
  if (flags.last) {
    fromDate = calculateLastDate(flags.last);
  }
  if (fromDate) validateDate(fromDate, 'from');

  let toDate = flags.to || null;
  if (toDate) validateDate(toDate, 'to');

  if (fromDate && toDate && fromDate > toDate) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `起始日期 (${fromDate}) 不能晚于结束日期 (${toDate})`,
      exitCode: EXIT_CODES.USAGE,
    });
  }

  let market = (flags.market || 'ALL').toUpperCase();
  if (!VALID_MARKETS_WITH_ALL.includes(market)) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: `无效的市场参数: "${flags.market}"，合法值为: ${VALID_MARKETS_WITH_ALL.join(', ')}`,
      exitCode: EXIT_CODES.USAGE,
    });
  }

  const q = new URLSearchParams();
  if (fromDate) q.set('from', fromDate);
  if (toDate) q.set('to', toDate);
  q.set('market', market);

  const endpointPath = `/api/agent/snapshots?${q.toString()}`;
  const endpointUrl = `${config.baseUrl}${endpointPath}`;

  const { json, durationMs } = await doFetch(endpointUrl, {}, config);
  const items = json.data?.items || [];

  let data = {
    items,
    count: items.length,
    filter: { market, from: fromDate || null, to: toDate || null },
  };

  data = projectFields(data, flags.fields, allowedFields);

  if (flags.human) {
    const colors = getColorHelper(flags);
    process.stdout.write(colors.bold(`\n历史资产快照 (市场: ${market}, 共 ${data.count} 条记录):\n`));
    process.stdout.write(
      renderTable(
        [
          { key: 'date', title: 'DATE', align: 'left' },
          { key: 'totalValueCNY', title: 'VALUE(CNY)', align: 'right', format: (v) => formatNumber(v) },
          { key: 'totalCostCNY', title: 'COST(CNY)', align: 'right', format: (v) => formatNumber(v) },
          { key: 'totalPnlCNY', title: 'PNL(CNY)', align: 'right', isPnl: true, format: (v) => formatSignedNumber(v) },
          { key: 'ytdPnlCNY', title: 'YTD(CNY)', align: 'right', isPnl: true, format: (v) => formatSignedNumber(v) },
          { key: 'positionCount', title: 'POSITIONS', align: 'right' },
        ],
        data.items,
        flags
      )
    );
    process.exit(0);
  }

  printSuccess('snapshots', data, warnings, {
    apiVersion: json.meta?.version || 'v1',
    baseUrl: config.baseUrl,
    endpoint: `GET ${endpointPath}`,
    durationMs,
  }, flags);
}

async function handlePerformance(flags, warnings) {
  const allowedFields = [
    'dayPnlCNY',
    'mtdPnlCNY',
    'mtdPercent',
    'ytdPnlCNY',
    'ytdPercent',
    'annualizedReturn',
    'avgHoldingDays',
    'totalValueCNY',
    'totalCostCNY',
    'totalPnlCNY',
    'totalPnlPercent',
    'positionCount',
    'positions',
    'markets',
  ];
  validateFields(flags.fields, allowedFields);

  const config = resolveConfig(flags, warnings);
  requireApiKey(config);

  let market = null;
  if (flags.market) {
    market = flags.market.toUpperCase();
    if (!VALID_MARKETS_WITH_ALL.includes(market)) {
      throw new CliError({
        type: 'USAGE',
        code: 'INVALID_ARGUMENT',
        message: `无效的市场参数: "${flags.market}"，合法值为: ${VALID_MARKETS_WITH_ALL.join(', ')}`,
        exitCode: EXIT_CODES.USAGE,
      });
    }
  }

  const endpointPath = market ? `/api/agent/performance?market=${market}` : '/api/agent/performance';
  const endpointUrl = `${config.baseUrl}${endpointPath}`;

  const { json, durationMs } = await doFetch(endpointUrl, {}, config);
  let data = json.data || {};

  data = projectFields(data, flags.fields, allowedFields);

  if (flags.human) {
    const colors = getColorHelper(flags);
    let out = colors.bold('\n收益表现指标') + (market ? ` (市场: ${market})\n` : '\n');
    out += `  当日盈亏: ${colors.pnl(data.dayPnlCNY, '¥' + formatSignedNumber(data.dayPnlCNY))}     MTD 收益: ${colors.pnl(data.mtdPnlCNY, '¥' + formatSignedNumber(data.mtdPnlCNY))} (${colors.pnl(data.mtdPercent, formatPercent(data.mtdPercent))})\n`;
    out += `  YTD 收益: ${colors.pnl(data.ytdPnlCNY, '¥' + formatSignedNumber(data.ytdPnlCNY))} (${colors.pnl(data.ytdPercent, formatPercent(data.ytdPercent))})   年化收益率: ${colors.pnl(data.annualizedReturn, formatPercent(data.annualizedReturn))}\n`;
    out += `  总市值:   ¥${formatNumber(data.totalValueCNY)}     总成本: ¥${formatNumber(data.totalCostCNY)}   累计盈亏: ${colors.pnl(data.totalPnlCNY, '¥' + formatSignedNumber(data.totalPnlCNY))}\n`;
    out += `  平均持仓天数: ${data.avgHoldingDays ?? '-'} 天    持仓股票数: ${data.positionCount ?? '-'} 只\n\n`;

    if (data.markets) {
      out += colors.bold('分市场收益明细:\n');
      const mRows = Object.entries(data.markets).map(([mName, mInfo]) => ({
        market: mName,
        valueCNY: mInfo.totalValueCNY,
        dayPnlCNY: mInfo.dayPnlCNY,
        mtdPnlCNY: mInfo.mtdPnlCNY,
        ytdPnlCNY: mInfo.ytdPnlCNY,
      }));
      out += renderTable(
        [
          { key: 'market', title: 'MARKET', align: 'left' },
          { key: 'valueCNY', title: 'VALUE(CNY)', align: 'right', format: (v) => formatNumber(v) },
          { key: 'dayPnlCNY', title: 'DAY PNL', align: 'right', isPnl: true, format: (v) => formatSignedNumber(v) },
          { key: 'mtdPnlCNY', title: 'MTD PNL', align: 'right', isPnl: true, format: (v) => formatSignedNumber(v) },
          { key: 'ytdPnlCNY', title: 'YTD PNL', align: 'right', isPnl: true, format: (v) => formatSignedNumber(v) },
        ],
        mRows,
        flags
      );
    }
    process.stdout.write(out);
    process.exit(0);
  }

  printSuccess('performance', data, warnings, {
    apiVersion: json.meta?.version || 'v1',
    baseUrl: config.baseUrl,
    endpoint: `GET ${endpointPath}`,
    durationMs,
  }, flags);
}

async function handleSearch(queryArg, flags, warnings) {
  const allowedFields = ['symbol', 'name', 'type', 'region', 'currency', 'matchScore'];
  validateFields(flags.fields, allowedFields);

  const config = resolveConfig(flags, warnings);
  requireApiKey(config);

  if (!queryArg || !String(queryArg).trim()) {
    throw new CliError({
      type: 'USAGE',
      code: 'INVALID_ARGUMENT',
      message: '缺少搜索关键词参数 q',
      hint: '用法示例: sv search 腾讯 或 sv search AAPL',
      exitCode: EXIT_CODES.USAGE,
    });
  }

  const query = String(queryArg).trim();
  const endpointPath = `/api/agent/search?q=${encodeURIComponent(query)}`;
  const endpointUrl = `${config.baseUrl}${endpointPath}`;

  const { json, durationMs } = await doFetch(endpointUrl, {}, config);
  let data = json.data || {};

  data = projectFields(data, flags.fields, allowedFields);

  if (flags.human) {
    const colors = getColorHelper(flags);
    process.stdout.write(colors.bold(`\n股票搜索结果 (关键词: "${query}", 共 ${data.count ?? data.items?.length ?? 0} 条):\n`));
    process.stdout.write(
      renderTable(
        [
          { key: 'symbol', title: 'SYMBOL', align: 'left' },
          { key: 'name', title: 'NAME', align: 'left' },
          { key: 'type', title: 'TYPE', align: 'left' },
          { key: 'region', title: 'REGION', align: 'left' },
          { key: 'currency', title: 'CURRENCY', align: 'left' },
          { key: 'matchScore', title: 'SCORE', align: 'right' },
        ],
        data.items || [],
        flags
      )
    );
    process.exit(0);
  }

  printSuccess('search', data, warnings, {
    apiVersion: json.meta?.version || 'v1',
    baseUrl: config.baseUrl,
    endpoint: `GET ${endpointPath}`,
    durationMs,
  }, flags);
}

async function handleFx(flags, warnings) {
  const allowedFields = ['baseCurrency', 'rates', 'pairs'];
  validateFields(flags.fields, allowedFields);

  const config = resolveConfig(flags, warnings);
  requireApiKey(config);

  const endpointPath = '/api/agent/fx';
  const endpointUrl = `${config.baseUrl}${endpointPath}`;

  const { json, durationMs } = await doFetch(endpointUrl, {}, config);
  let data = json.data || {};

  data = projectFields(data, flags.fields, allowedFields);

  if (flags.human) {
    const colors = getColorHelper(flags);
    process.stdout.write(colors.bold(`\n汇率明细 (基准币种: ${data.baseCurrency || 'CNY'}):\n`));
    const rows = Object.entries(data.pairs || {}).map(([curr, pInfo]) => ({
      currency: curr,
      rateToCNY: pInfo.rateToCNY,
      source: pInfo.source,
      updatedAt: pInfo.updatedAt ? formatIsoUtc(pInfo.updatedAt) : '-',
    }));
    process.stdout.write(
      renderTable(
        [
          { key: 'currency', title: 'CURRENCY', align: 'left' },
          { key: 'rateToCNY', title: 'RATE TO CNY', align: 'right', format: (v) => formatNumber(v, 4) },
          { key: 'source', title: 'SOURCE', align: 'left' },
          { key: 'updatedAt', title: 'UPDATED', align: 'left' },
        ],
        rows,
        flags
      )
    );
    process.exit(0);
  }

  printSuccess('fx', data, warnings, {
    apiVersion: json.meta?.version || 'v1',
    baseUrl: config.baseUrl,
    endpoint: `GET ${endpointPath}`,
    durationMs,
  }, flags);
}

async function handleDoctor(flags, warnings) {
  const config = resolveConfig(flags, warnings);
  const checks = [];
  let firstFailure = null;

  // 1. Config 检查（Key 存在性与格式校验）
  if (!config.apiKey) {
    const failure = {
      name: 'config',
      status: 'fail',
      detail: '未找到 API Key',
      hint: `请设置环境变量 STOCKVAULT_API_KEY=sk-...，或运行 sv config init 配置本地密钥。可在 Web 端「${config.baseUrl}/#/settings」生成。`,
    };
    checks.push(failure);
    firstFailure = firstFailure || {
      type: 'CONFIG',
      code: 'MISSING_API_KEY',
      message: '自检失败: 未找到 API Key',
      hint: failure.hint,
    };
  } else if (!/^sk-[a-f0-9]{40}$/.test(config.apiKey)) {
    const failure = {
      name: 'config',
      status: 'fail',
      detail: `API Key 格式非法 (当前: ${maskKey(config.apiKey)})`,
      hint: 'API Key 必须为 sk- 开头的 40 位十六进制字符',
    };
    checks.push(failure);
    firstFailure = firstFailure || {
      type: 'CONFIG',
      code: 'INVALID_API_KEY_FORMAT',
      message: '自检失败: API Key 格式不正确',
      hint: failure.hint,
    };
  } else {
    checks.push({
      name: 'config',
      status: 'pass',
      detail: `apiKey from ${config.apiKeySource} (${maskKey(config.apiKey)})`,
    });
  }

  // 2. Base URL 检查
  let parsedUrl;
  try {
    parsedUrl = new URL(config.baseUrl);
    const isLocalhost =
      parsedUrl.hostname === 'localhost' ||
      parsedUrl.hostname === '127.0.0.1' ||
      parsedUrl.hostname === '[::1]';

    if (parsedUrl.protocol !== 'https:' && !isLocalhost) {
      const failure = {
        name: 'baseUrl',
        status: 'fail',
        detail: `Base URL 非 HTTPS (${config.baseUrl})`,
        hint: '安全约束拒绝：除 localhost/127.0.0.1 外，必须使用 HTTPS 协议',
      };
      checks.push(failure);
      firstFailure = firstFailure || {
        type: 'CONFIG',
        code: 'INSECURE_BASE_URL',
        message: '自检失败: Base URL 必须使用 HTTPS',
        hint: failure.hint,
      };
    } else {
      checks.push({
        name: 'baseUrl',
        status: 'pass',
        detail: `${config.baseUrl} (from ${config.baseUrlSource})`,
      });
    }
  } catch {
    const failure = {
      name: 'baseUrl',
      status: 'fail',
      detail: `Base URL 格式非法: ${config.baseUrl}`,
      hint: '请输入合法的 URL 地址',
    };
    checks.push(failure);
    firstFailure = firstFailure || {
      type: 'CONFIG',
      code: 'INVALID_BASE_URL',
      message: '自检失败: Base URL 格式非法',
      hint: failure.hint,
    };
  }

  // 3. 配置文件权限检查（POSIX）
  if (process.platform !== 'win32') {
    if (fs.existsSync(config.configPath)) {
      try {
        const stat = fs.statSync(config.configPath);
        const mode = stat.mode & 0o777;
        if ((mode & 0o077) !== 0) {
          checks.push({
            name: 'configPerms',
            status: 'warn',
            detail: `配置文件权限为 0${mode.toString(8)}，建议设置为 0600`,
          });
        } else {
          checks.push({
            name: 'configPerms',
            status: 'pass',
            detail: `配置文件权限正常 (0${mode.toString(8)})`,
          });
        }
      } catch {
        checks.push({ name: 'configPerms', status: 'pass', detail: '跳过权限检查' });
      }
    } else {
      checks.push({ name: 'configPerms', status: 'pass', detail: '配置文件未创建（从环境变量或默认值加载）' });
    }
  } else {
    checks.push({ name: 'configPerms', status: 'pass', detail: 'Windows 环境跳过 POSIX 权限检查' });
  }

  // 如果本地前置检查失败，直接终止后续网络请求
  if (firstFailure) {
    throw new CliError({
      ...firstFailure,
      checks,
      exitCode: EXIT_CODES[firstFailure.type] || 3,
    });
  }

  // 4. 网络连通性与鉴权检查（优先 ping，备用 snapshots）
  let pingData = null;
  let connectivityPassed = false;
  try {
    const pingRes = await doFetch(`${config.baseUrl}/api/agent/ping`, {}, config);
    pingData = pingRes.json.data || {};
    connectivityPassed = true;
    checks.push({
      name: 'auth',
      status: 'pass',
      detail: `200 in ${pingRes.durationMs}ms via /api/agent/ping`,
    });
  } catch (err) {
    if (err.httpStatus === 404) {
      // 备用端点自检
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const fbRes = await doFetch(
          `${config.baseUrl}/api/agent/snapshots?from=${todayStr}&to=${todayStr}&market=ALL`,
          {},
          config
        );
        connectivityPassed = true;
        checks.push({
          name: 'auth',
          status: 'pass',
          detail: `200 in ${fbRes.durationMs}ms via /api/agent/snapshots fallback`,
        });
      } catch (fbErr) {
        checks.push({
          name: 'auth',
          status: 'fail',
          detail: `${fbErr.type}/${fbErr.code}: ${fbErr.message}`,
        });
        throw new CliError({
          type: fbErr.type || 'NETWORK',
          code: fbErr.code || 'CONNECTIVITY_FAILED',
          message: `连通性与鉴权检查失败: ${fbErr.message}`,
          hint: fbErr.hint,
          checks,
          exitCode: fbErr.exitCode || 4,
        });
      }
    } else {
      checks.push({
        name: 'auth',
        status: 'fail',
        detail: `${err.type}/${err.code}: ${err.message}`,
      });
      throw new CliError({
        type: err.type || 'NETWORK',
        code: err.code || 'CONNECTIVITY_FAILED',
        message: `连通性与鉴权检查失败: ${err.message}`,
        hint: err.hint,
        checks,
        exitCode: err.exitCode || 4,
      });
    }
  }

  // 5. 行情新鲜度检查
  if (connectivityPassed) {
    let latestQuoteAt = pingData?.latestQuoteAt;
    if (!latestQuoteAt) {
      try {
        const pfRes = await doFetch(`${config.baseUrl}/api/agent/portfolio`, {}, config);
        latestQuoteAt = pfRes.json.data?.lastUpdated;
      } catch {
        // 忽略 portfolio 失败
      }
    }

    if (latestQuoteAt) {
      const quoteTime = new Date(latestQuoteAt).getTime();
      const ageSec = Math.round((Date.now() - quoteTime) / 1000);
      const maxAgeSec = parseMaxAgeSeconds(config.maxAge);
      if (ageSec > maxAgeSec) {
        checks.push({
          name: 'freshness',
          status: 'warn',
          detail: `quotes ${(ageSec / 3600).toFixed(1)}h old (超过 --max-age=${config.maxAge})`,
        });
      } else {
        checks.push({
          name: 'freshness',
          status: 'pass',
          detail: `quotes fresh (${(ageSec / 3600).toFixed(1)}h old)`,
        });
      }
    } else {
      checks.push({
        name: 'freshness',
        status: 'warn',
        detail: '数据库中暂无行情缓存',
      });
    }
  }

  const data = { checks };

  if (flags.human) {
    const colors = getColorHelper(flags);
    process.stdout.write(colors.bold('\nStockVault 运行环境自检:\n'));
    for (const c of checks) {
      const mark =
        c.status === 'pass'
          ? colors.green('✔ PASS')
          : c.status === 'warn'
          ? colors.yellow('⚠ WARN')
          : colors.red('✖ FAIL');
      process.stdout.write(`  [${mark}] ${padEndWidth(c.name, 14)}: ${c.detail}\n`);
    }
    const warnCount = checks.filter((c) => c.status === 'warn').length;
    process.stdout.write(
      colors.green(`\n✔ 自检全部通过`) +
      (warnCount > 0 ? colors.yellow(` (${warnCount} 项警告)`) : '') +
      '\n\n'
    );
    process.exit(0);
  }

  printSuccess('doctor', data, warnings, {
    baseUrl: config.baseUrl,
  }, flags);
}

async function handleConfig(args, flags, warnings) {
  const subcmd = args[0];
  const config = resolveConfig(flags, warnings);

  if (!subcmd || subcmd === 'show') {
    const data = {
      profile: config.profileName,
      baseUrl: {
        value: config.baseUrl,
        source: config.baseUrlSource,
      },
      apiKey: {
        value: config.apiKey ? maskKey(config.apiKey) : null,
        source: config.apiKeySource || 'none',
      },
      configPath: config.configPath,
    };

    if (flags.human) {
      const colors = getColorHelper(flags);
      process.stdout.write(colors.bold('\n当前生效配置:\n'));
      process.stdout.write(`  配置档:   ${data.profile}\n`);
      process.stdout.write(`  Base URL: ${data.baseUrl.value} (来源: ${data.baseUrl.source})\n`);
      process.stdout.write(`  API Key:  ${data.apiKey.value} (来源: ${data.apiKey.source})\n`);
      process.stdout.write(`  配置文件: ${data.configPath}\n\n`);
      process.exit(0);
    }

    printSuccess('config show', data, warnings, {}, flags);
    return;
  }

  if (subcmd === 'path') {
    if (flags.human) {
      process.stdout.write(config.configPath + '\n');
      process.exit(0);
    }
    printSuccess('config path', { path: config.configPath }, warnings, {}, flags);
    return;
  }

  if (subcmd === 'init') {
    let inputBaseUrl = '';
    let inputKey = '';

    if (flags['key-stdin']) {
      // 从 stdin 读取 key
      inputKey = await new Promise((resolve, reject) => {
        let buf = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
          buf += chunk;
        });
        process.stdin.on('end', () => resolve(buf.trim()));
        process.stdin.on('error', reject);
      });
      inputBaseUrl = flags['base-url'] || DEFAULT_BASE_URL;
    } else {
      // 交互式读取
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

      const ansUrl = await ask(`请输入 Base URL [${DEFAULT_BASE_URL}]: `);
      inputBaseUrl = ansUrl.trim() || DEFAULT_BASE_URL;

      if (process.stdin.isTTY) {
        rl.close();
        process.stdout.write('请输入 API Key (sk-...): ');
        inputKey = await new Promise((resolve) => {
          const stdin = process.stdin;
          const oldRaw = stdin.isRaw;
          stdin.setRawMode(true);
          stdin.resume();
          stdin.setEncoding('utf8');
          let pass = '';
          const onData = (ch) => {
            if (ch === '\n' || ch === '\r' || ch === '\u0004') {
              stdin.setRawMode(oldRaw);
              stdin.pause();
              stdin.removeListener('data', onData);
              process.stdout.write('\n');
              resolve(pass.trim());
            } else if (ch === '\u0003') {
              process.exit(130);
            } else if (ch === '\u0008' || ch === '\x7f') {
              if (pass.length > 0) pass = pass.slice(0, -1);
            } else {
              pass += ch;
            }
          };
          stdin.on('data', onData);
        });
      } else {
        const ansKey = await ask('请输入 API Key (sk-...): ');
        rl.close();
        inputKey = ansKey.trim();
      }
    }

    if (!inputKey) {
      throw new CliError({
        type: 'USAGE',
        code: 'MISSING_API_KEY',
        message: 'API Key 不能为空',
        exitCode: EXIT_CODES.USAGE,
      });
    }

    if (!/^sk-[a-f0-9]{40}$/.test(inputKey)) {
      throw new CliError({
        type: 'USAGE',
        code: 'INVALID_API_KEY_FORMAT',
        message: 'API Key 格式不正确，必须为 sk- 开头的 40 位十六进制字符',
        hint: '请核对复制的 Key 是否完整（共 43 位，如 sk-0123456789abcdef0123456789abcdef01234567）',
        exitCode: EXIT_CODES.USAGE,
      });
    }

    const configDir = path.dirname(config.configPath);
    try {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      throw new CliError({
        type: 'CONFIG',
        code: 'MKDIR_FAILED',
        message: `无法创建配置目录: ${configDir} (${err.message})`,
        exitCode: EXIT_CODES.CONFIG,
      });
    }

    const configContent = {
      defaultProfile: 'prod',
      profiles: {
        prod: {
          baseUrl: inputBaseUrl,
          apiKey: inputKey,
        },
      },
    };

    try {
      fs.writeFileSync(config.configPath, JSON.stringify(configContent, null, 2) + '\n', {
        mode: 0o600,
      });
      if (process.platform !== 'win32') {
        fs.chmodSync(config.configPath, 0o600);
      }
    } catch (err) {
      throw new CliError({
        type: 'CONFIG',
        code: 'WRITE_CONFIG_FAILED',
        message: `无法写入配置文件: ${config.configPath} (${err.message})`,
        exitCode: EXIT_CODES.CONFIG,
      });
    }

    const data = {
      message: '配置文件初始化成功',
      path: config.configPath,
      profile: 'prod',
      baseUrl: inputBaseUrl,
      apiKey: maskKey(inputKey),
    };

    if (flags.human) {
      const colors = getColorHelper(flags);
      process.stdout.write(
        colors.green(`\n✔ 配置文件已成功写入: `) +
        `${config.configPath} (权限 0600)\n` +
        `  Base URL: ${inputBaseUrl}\n` +
        `  API Key:  ${maskKey(inputKey)}\n\n`
      );
      process.exit(0);
    }

    printSuccess('config init', data, warnings, {}, flags);
    return;
  }

  throw new CliError({
    type: 'USAGE',
    code: 'UNKNOWN_COMMAND',
    message: `未知 config 子命令: "${subcmd}"，支持 show, path, init`,
    exitCode: EXIT_CODES.USAGE,
  });
}

function handleVersion(flags, warnings) {
  const data = {
    cliVersion: CLI_VERSION,
    schemaVersion: SCHEMA_VERSION,
    supportedApiVersions: SUPPORTED_API_VERSIONS,
    node: process.version,
  };

  if (flags.human) {
    process.stdout.write(`stockvault v${CLI_VERSION} (schema v${SCHEMA_VERSION}, api v1, node ${process.version})\n`);
    process.exit(0);
  }

  printSuccess('version', data, warnings, {}, flags);
}

// ────────────────────────────────────────────────────────────
// Describe 元数据与命令目录
// ────────────────────────────────────────────────────────────

const COMMAND_CATALOG = [
  {
    name: 'portfolio',
    summary: '组合概要（总市值、成本、盈亏、各市场分布）',
    endpoint: 'GET /api/agent/portfolio',
    args: [],
    flags: [
      { name: '--max-age', type: 'string', default: '6h', description: '行情缓存新鲜度阈值（如 30m, 6h, 2d）' },
      { name: '--fields', type: 'string', description: '字段投影，逗号分隔' },
    ],
    output: {
      fields: {
        totalValueCNY: 'number(CNY)',
        totalCostCNY: 'number(CNY)',
        totalPnlCNY: 'number(CNY)',
        totalPnlPercent: 'number(percent)',
        ytdPnlCNY: 'number(CNY)|null',
        positionCount: 'integer',
        markets: 'object(分市场概要)',
        lastUpdated: 'ISO-8601 UTC 时间戳',
      },
    },
    examples: [
      'sv portfolio',
      'sv portfolio --fields totalValueCNY,totalPnlPercent,ytdPnlCNY',
      'sv portfolio --human',
    ],
  },
  {
    name: 'positions',
    summary: '持仓列表（默认 OPEN，支持排序与截取）',
    endpoint: 'GET /api/agent/positions',
    args: [],
    flags: [
      { name: '--market', type: 'enum', values: ['A_SHARE', 'HK', 'US', 'SWISS'], description: '过滤指定市场' },
      { name: '--status', type: 'enum', values: ['OPEN', 'CLOSED'], default: 'OPEN', description: '持仓状态' },
      { name: '--sort', type: 'enum', values: ['valueCNY', 'pnlCNY', 'pnlPercent', 'costCNY', 'symbol', 'openDate'], description: '排序字段' },
      { name: '--asc', type: 'boolean', default: false, description: '升序排列（默认降序）' },
      { name: '--limit', type: 'integer', min: 1, description: '截取前 N 条' },
    ],
    output: {
      itemFields: {
        symbol: 'string',
        name: 'string',
        market: 'enum',
        currency: 'string',
        quantity: 'number',
        openPrice: 'number(原币种)',
        currentPrice: 'number(原币种)|null',
        costCNY: 'number(CNY)',
        valueCNY: 'number(CNY)',
        pnlCNY: 'number(CNY)',
        pnlPercent: 'number(percent)',
        openDate: 'YYYY-MM-DD',
        status: 'enum(OPEN, CLOSED)',
      },
    },
    examples: [
      'sv positions',
      'sv positions --market US --sort pnlPercent --limit 5',
      'sv positions --sort pnlCNY --asc --limit 3',
      'sv positions --fields symbol,name,valueCNY,pnlPercent --human',
    ],
  },
  {
    name: 'position',
    summary: '单只股票详情与交易流水',
    endpoint: 'GET /api/agent/position/:symbol',
    args: [{ name: 'symbol', required: true, description: '股票代码（如 AAPL, 0700.HK, 600519.SHH）' }],
    flags: [{ name: '--no-trades', type: 'boolean', default: false, description: '不返回交易流水明细以节省 token' }],
    output: {
      fields: {
        symbol: 'string',
        name: 'string',
        market: 'enum',
        currency: 'string',
        quantity: 'number',
        openPrice: 'number',
        currentPrice: 'number|null',
        costCNY: 'number(CNY)',
        valueCNY: 'number(CNY)',
        pnlCNY: 'number(CNY)',
        pnlPercent: 'number(percent)',
        sector: 'string|null',
        beta: 'number|null',
        notes: 'string|null',
        status: 'enum',
        trades: 'array(交易记录)',
      },
    },
    examples: [
      'sv position AAPL',
      'sv position 600519.SHH --no-trades',
      'sv position 0700.HK --human',
    ],
  },
  {
    name: 'trades',
    summary: '交易流水明细（按交易日期倒序）',
    endpoint: 'GET /api/agent/trades',
    args: [],
    flags: [
      { name: '--symbol', type: 'string', description: '按代码过滤' },
      { name: '--market', type: 'enum', values: ['A_SHARE', 'HK', 'US', 'SWISS'], description: '按市场过滤' },
      { name: '--type', type: 'enum', values: ['BUY', 'SELL'], description: '买入/卖出过滤' },
      { name: '--from', type: 'date', description: '起始日期 YYYY-MM-DD' },
      { name: '--to', type: 'date', description: '结束日期 YYYY-MM-DD' },
      { name: '--last', type: 'duration', description: '快捷时间范围（如 30d, 12w, 6m, 1y）' },
      { name: '--limit', type: 'integer', min: 1, max: 500, default: 100, description: '每页条数' },
      { name: '--offset', type: 'integer', min: 0, default: 0, description: '偏移量' },
      { name: '--all', type: 'boolean', default: false, description: '自动翻页拉取全部数据' },
      { name: '--max-items', type: 'integer', default: 5000, description: '--all 模式的最大条数上限' },
    ],
    output: {
      itemFields: {
        id: 'integer',
        symbol: 'string',
        name: 'string',
        market: 'enum',
        type: 'enum(BUY, SELL)',
        price: 'number',
        quantity: 'number',
        commission: 'number',
        currency: 'string',
        date: 'YYYY-MM-DD',
        notes: 'string|null',
      },
    },
    examples: [
      'sv trades --last 30d',
      'sv trades --symbol AAPL --type SELL',
      'sv trades --market HK --from 2026-01-01 --to 2026-06-30 --all',
      'sv trades --limit 20 --fields date,symbol,type,price,quantity --human',
    ],
  },
  {
    name: 'quote',
    summary: '实时报价（支持 1–20 个代码）',
    endpoint: 'GET /api/agent/quotes?symbols=',
    args: [{ name: 'symbol...', required: true, description: '1 至 20 个股票代码，空格分隔' }],
    flags: [{ name: '--concurrency', type: 'integer', default: 3, description: '并发数' }],
    output: {
      itemFields: {
        symbol: 'string',
        name: 'string',
        price: 'number',
        previousClose: 'number',
        change: 'number',
        changePercent: 'number(percent)',
        currency: 'string',
        cached: 'boolean',
        updatedAt: 'ISO-8601 UTC 时间戳',
      },
    },
    examples: [
      'sv quote AAPL',
      'sv quote AAPL MSFT 0700.HK 600519.SHH',
      'sv quote 0700.HK --human',
    ],
  },
  {
    name: 'markets',
    summary: '分市场资产汇总（只统计 OPEN 持仓）',
    endpoint: 'GET /api/agent/markets',
    args: [],
    flags: [{ name: '--market', type: 'enum', values: ['A_SHARE', 'HK', 'US', 'SWISS'], description: '仅显示指定市场' }],
    output: {
      fields: {
        markets: 'object(市场键名 → { positionCount, totalValueCNY, totalCostCNY, totalPnlCNY, pnlPercent, ytdPnlCNY })',
      },
    },
    examples: [
      'sv markets',
      'sv markets --market US --human',
    ],
  },
  {
    name: 'snapshots',
    summary: '历史资产快照',
    endpoint: 'GET /api/agent/snapshots',
    args: [],
    flags: [
      { name: '--from', type: 'date', description: '起始日期 YYYY-MM-DD' },
      { name: '--to', type: 'date', description: '结束日期 YYYY-MM-DD' },
      { name: '--last', type: 'duration', description: '快捷时间范围（如 30d, 6m, 1y）' },
      { name: '--market', type: 'enum', values: ['ALL', 'A_SHARE', 'HK', 'US', 'SWISS'], default: 'ALL', description: '指定市场快照' },
    ],
    output: {
      itemFields: {
        date: 'YYYY-MM-DD',
        totalValueCNY: 'number(CNY)',
        totalCostCNY: 'number(CNY)',
        totalPnlCNY: 'number(CNY)',
        ytdPnlCNY: 'number(CNY)',
        positionCount: 'integer',
      },
    },
    examples: [
      'sv snapshots --last 30d',
      'sv snapshots --market US --from 2026-01-01',
      'sv snapshots --last 1y --fields date,totalValueCNY,totalPnlCNY',
    ],
  },
  {
    name: 'performance',
    summary: '投资收益指标（日/月/YTD/年化收益与个股权重）',
    endpoint: 'GET /api/agent/performance',
    args: [],
    flags: [{ name: '--market', type: 'enum', values: ['ALL', 'A_SHARE', 'HK', 'US', 'SWISS'], description: '按市场过滤' }],
    output: {
      fields: {
        dayPnlCNY: 'number(CNY)',
        mtdPnlCNY: 'number(CNY)',
        mtdPercent: 'number(percent)',
        ytdPnlCNY: 'number(CNY)',
        ytdPercent: 'number(percent)',
        annualizedReturn: 'number(percent)',
        avgHoldingDays: 'number',
        totalValueCNY: 'number(CNY)',
        totalCostCNY: 'number(CNY)',
        totalPnlCNY: 'number(CNY)',
      },
    },
    examples: [
      'sv performance',
      'sv performance --market US --human',
    ],
  },
  {
    name: 'search',
    summary: '股票代码与证券搜索（名称/拼音解析）',
    endpoint: 'GET /api/agent/search',
    args: [{ name: 'query', required: true, description: '搜索关键词（如 腾讯, 贵州茅台, AAPL）' }],
    flags: [],
    output: {
      itemFields: {
        symbol: 'string',
        name: 'string',
        type: 'string',
        region: 'string',
        currency: 'string',
        matchScore: 'number',
      },
    },
    examples: [
      'sv search 腾讯',
      'sv search 茅台',
      'sv search AAPL',
    ],
  },
  {
    name: 'fx',
    summary: '汇率明细查询（各币种对 CNY 实时与兜底汇率）',
    endpoint: 'GET /api/agent/fx',
    args: [],
    flags: [],
    output: {
      fields: {
        baseCurrency: 'string',
        rates: 'object(币种 → 汇率)',
        pairs: 'object(各币种来源与时间戳)',
      },
    },
    examples: [
      'sv fx',
      'sv fx --human',
    ],
  },
  {
    name: 'doctor',
    summary: '配置、Key 格式、服务连通性与数据新鲜度自检',
    args: [],
    flags: [],
    examples: [
      'sv doctor',
      'sv doctor --human',
    ],
  },
  {
    name: 'config',
    summary: '配置管理（show 查看、path 路径、init 初始化）',
    args: [{ name: 'subcommand', values: ['show', 'path', 'init'], description: '子命令' }],
    flags: [{ name: '--key-stdin', type: 'boolean', description: 'init 子命令从 stdin 读入 API Key' }],
    examples: [
      'sv config show',
      'sv config path',
      'sv config init',
      'sv config init --key-stdin < key.txt',
    ],
  },
  {
    name: 'describe',
    summary: '输出机器可读的命令与参数元数据目录（JSON）',
    args: [{ name: 'command', required: false, description: '查询特定命令的详细定义' }],
    flags: [],
    examples: [
      'sv describe',
      'sv describe positions',
    ],
  },
  {
    name: 'version',
    summary: '输出 CLI 版本、schemaVersion 及支持的 apiVersion',
    args: [],
    flags: [],
    examples: [
      'sv version',
      'sv -V',
    ],
  },
];

function handleDescribe(commandArg, flags, warnings) {
  if (commandArg) {
    const cmd = COMMAND_CATALOG.find((c) => c.name === commandArg);
    if (!cmd) {
      throw new CliError({
        type: 'USAGE',
        code: 'UNKNOWN_COMMAND',
        message: `未知命令: "${commandArg}"，无法描述`,
        hint: `可用命令为: ${COMMAND_CATALOG.map((c) => c.name).join(', ')}`,
        exitCode: EXIT_CODES.USAGE,
      });
    }
    printSuccess('describe', cmd, warnings, {}, flags);
    return;
  }

  const catalogData = {
    cliVersion: CLI_VERSION,
    supportedApiVersions: SUPPORTED_API_VERSIONS,
    commands: COMMAND_CATALOG,
    exitCodes: EXIT_CODE_NAMES,
  };

  printSuccess('describe', catalogData, warnings, {}, flags);
}

// ────────────────────────────────────────────────────────────
// Help 帮助信息渲染
// ────────────────────────────────────────────────────────────

function printHelp(commandName = null) {
  if (commandName) {
    const cmd = COMMAND_CATALOG.find((c) => c.name === commandName);
    if (!cmd) {
      process.stderr.write(`未知命令: "${commandName}"\n`);
      process.exit(EXIT_CODES.USAGE);
    }

    let out = `\nStockVault CLI: sv ${cmd.name}\n`;
    out += `\n说明: ${cmd.summary}\n`;
    if (cmd.endpoint) {
      out += `对应端点: ${cmd.endpoint}\n`;
    }

    out += `\n用法:\n  sv ${cmd.name}`;
    if (cmd.args && cmd.args.length > 0) {
      out += ' ' + cmd.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ');
    }
    out += ' [flags]\n';

    if (cmd.args && cmd.args.length > 0) {
      out += `\n位置参数:\n`;
      for (const a of cmd.args) {
        out += `  <${a.name}>  ${a.description || ''}\n`;
      }
    }

    if (cmd.flags && cmd.flags.length > 0) {
      out += `\n专属选项:\n`;
      for (const f of cmd.flags) {
        const valStr = f.values ? ` (${f.values.join('/')})` : '';
        const defStr = f.default !== undefined ? ` [默认: ${f.default}]` : '';
        out += `  ${padEndWidth(f.name, 18)} ${f.description || ''}${valStr}${defStr}\n`;
      }
    }

    out += `\n全局选项:\n`;
    out += `  --human            以人类可读的表格格式展示输出\n`;
    out += `  --pretty           格式化输出 JSON (缩进 2 格)\n`;
    out += `  --fields <a,b,...> 仅投影输出指定字段\n`;
    out += `  --base-url <url>   覆盖服务端地址\n`;
    out += `  --timeout <ms>     设置单次请求超时毫秒数\n`;
    out += `  --verbose          打印详细请求跟踪到 stderr\n`;
    out += `  --no-color         禁用彩色输出\n`;

    if (cmd.output) {
      out += `\n输出字段说明:\n`;
      const fObj = cmd.output.fields || cmd.output.itemFields || {};
      for (const [fName, fDesc] of Object.entries(fObj)) {
        out += `  ${padEndWidth(fName, 18)} ${fDesc}\n`;
      }
    }

    if (cmd.examples && cmd.examples.length > 0) {
      out += `\n示例:\n`;
      for (const ex of cmd.examples) {
        out += `  ${ex}\n`;
      }
    }

    out += `\n可能退出码:\n`;
    out += `  0 OK              成功\n`;
    out += `  2 USAGE           参数错误或未知选项\n`;
    out += `  3 CONFIG          配置或 API Key 缺失/格式错误\n`;
    out += `  4 AUTH            服务端鉴权失败 (401/403)\n`;
    out += `  5 NOT_FOUND       资源未找到 (404)\n`;
    out += `  6 NETWORK         网络通信失败或超时\n`;
    out += `  7 SERVER          服务端 5xx 或上游行情失败\n`;
    if (cmd.name === 'quote') {
      out += `  10 PARTIAL        批量操作部分成功\n`;
    }
    out += '\n';

    process.stdout.write(out);
    process.exit(0);
  }

  let general = `\nStockVault CLI (sv) - 股票持仓管理与分析系统命令行工具\n\n`;
  general += `用法:\n  sv <command> [args] [flags]\n  stockvault <command> [args] [flags]\n\n`;

  general += `数据命令 (全部只读):\n`;
  const dataCmds = COMMAND_CATALOG.filter((c) => c.endpoint);
  for (const c of dataCmds) {
    general += `  ${padEndWidth(c.name, 22)} ${c.summary}\n`;
  }

  general += `\n工具命令:\n`;
  const toolCmds = COMMAND_CATALOG.filter((c) => !c.endpoint);
  for (const c of toolCmds) {
    general += `  ${padEndWidth(c.name, 22)} ${c.summary}\n`;
  }

  general += `\n全局选项:\n`;
  general += `  --human                以人类可读的表格格式展示输出 (默认输出单行紧凑 JSON)\n`;
  general += `  --pretty               格式化输出 JSON (缩进 2 格)\n`;
  general += `  --fields <a,b,...>     字段投影，仅输出指定字段\n`;
  general += `  --profile <name>       选择配置档 (如 prod, local)\n`;
  general += `  --base-url <url>       覆盖服务端地址 (默认: ${DEFAULT_BASE_URL})\n`;
  general += `  --timeout <ms>         单次请求超时毫秒数 (默认: 15000)\n`;
  general += `  --retries <n>          重试次数 (默认: 2)\n`;
  general += `  --max-age <dur>        行情缓存过期阈值 (默认: 6h)\n`;
  general += `  --verbose              打印请求追踪信息到 stderr (Key 自动脱敏)\n`;
  general += `  --raw                  透传后端原始响应，不进行规范化处理\n`;
  general += `  --no-color             禁用彩色输出 (遵循 NO_COLOR)\n`;
  general += `  -h, --help             查看帮助信息\n`;
  general += `  -V, --version          查看版本\n\n`;

  general += `常见示例:\n`;
  general += `  sv portfolio\n`;
  general += `  sv positions --market US --sort pnlPercent --limit 5\n`;
  general += `  sv quote AAPL 0700.HK\n`;
  general += `  sv doctor\n`;
  general += `  sv describe\n\n`;

  process.stdout.write(general);
  process.exit(0);
}

// ────────────────────────────────────────────────────────────
// 参数提取与主分发函数
// ────────────────────────────────────────────────────────────

function parseArgv(rawArgs) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    // 严禁命令行传入 API Key
    if (arg === '--api-key' || arg === '--key' || arg.startsWith('--api-key=') || arg.startsWith('--key=')) {
      throw new CliError({
        type: 'USAGE',
        code: 'FORBIDDEN_FLAG',
        message: 'Key 不能通过命令行传入（会进入 shell 历史和进程列表），请使用 STOCKVAULT_API_KEY 环境变量或配置文件',
        hint: '可在终端执行 export STOCKVAULT_API_KEY=sk-... 或运行 sv config init 配置本地密钥',
        exitCode: EXIT_CODES.USAGE,
      });
    }

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const k = arg.slice(2, eqIdx);
        const v = arg.slice(eqIdx + 1);
        flags[k] = v;
      } else {
        const k = arg.slice(2);
        // 判断下一个参数是否是值还是开关
        const next = rawArgs[i + 1];
        if (
          k === 'human' ||
          k === 'pretty' ||
          k === 'asc' ||
          k === 'all' ||
          k === 'no-trades' ||
          k === 'raw' ||
          k === 'verbose' ||
          k === 'no-color' ||
          k === 'help' ||
          k === 'version' ||
          k === 'key-stdin'
        ) {
          flags[k] = true;
        } else if (next !== undefined && !next.startsWith('-')) {
          flags[k] = next;
          i++;
        } else {
          flags[k] = true;
        }
      }
    } else if (arg.startsWith('-')) {
      if (arg === '-h') flags['help'] = true;
      else if (arg === '-V') flags['version'] = true;
      else {
        // 单横杠不支持的选项
        flags[arg.slice(1)] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { flags, positionals };
}

async function main() {
  const warnings = [];
  const rawArgs = process.argv.slice(2);

  let parsed;
  try {
    parsed = parseArgv(rawArgs);
  } catch (err) {
    if (err instanceof CliError) {
      printError('unknown', err, warnings, {}, { pretty: false });
      return;
    }
    printError('unknown', new CliError({
      type: 'INTERNAL',
      code: 'UNEXPECTED',
      message: err.message,
    }), warnings, {}, {});
    return;
  }

  const { flags, positionals } = parsed;
  const command = positionals[0] || null;
  const restPositionals = positionals.slice(1);

  // 顶层全局帮助或版本
  if (!command && (flags.version || flags.V)) {
    handleVersion(flags, warnings);
    return;
  }

  if (!command && (flags.help || flags.h || rawArgs.length === 0)) {
    printHelp();
    return;
  }

  if (command && (flags.help || flags.h)) {
    printHelp(command);
    return;
  }

  try {
    switch (command) {
      case 'portfolio':
        await handlePortfolio(flags, warnings);
        break;

      case 'positions':
        await handlePositions(flags, warnings);
        break;

      case 'position':
        if (restPositionals.length === 0) {
          throw new CliError({
            type: 'USAGE',
            code: 'INVALID_ARGUMENT',
            message: '缺少必需的股票代码参数',
            hint: '用法示例: sv position AAPL 或 sv position 600519.SHH',
            exitCode: EXIT_CODES.USAGE,
          });
        }
        await handlePosition(restPositionals[0], flags, warnings);
        break;

      case 'trades':
        await handleTrades(flags, warnings);
        break;

      case 'quote':
        await handleQuote(restPositionals, flags, warnings);
        break;

      case 'markets':
        await handleMarkets(flags, warnings);
        break;

      case 'snapshots':
        await handleSnapshots(flags, warnings);
        break;

      case 'performance':
        await handlePerformance(flags, warnings);
        break;

      case 'search':
        await handleSearch(restPositionals.join(' '), flags, warnings);
        break;

      case 'fx':
        await handleFx(flags, warnings);
        break;

      case 'doctor':
        await handleDoctor(flags, warnings);
        break;

      case 'config':
        await handleConfig(restPositionals, flags, warnings);
        break;

      case 'describe':
        handleDescribe(restPositionals[0], flags, warnings);
        break;

      case 'version':
        handleVersion(flags, warnings);
        break;

      default:
        throw new CliError({
          type: 'USAGE',
          code: 'UNKNOWN_COMMAND',
          message: `未知命令: "${command}"`,
          hint: '运行 sv --help 查看支持的命令列表，或运行 sv describe 获取机器可读目录',
          exitCode: EXIT_CODES.USAGE,
        });
    }
  } catch (err) {
    if (err instanceof CliError) {
      printError(command || 'unknown', err, warnings, {}, flags);
      return;
    }
    printError(
      command || 'unknown',
      new CliError({
        type: 'INTERNAL',
        code: 'UNEXPECTED',
        message: err.message || '未知内部异常',
      }),
      warnings,
      {},
      flags
    );
  }
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err?.stack || err}\n`);
  process.exit(EXIT_CODES.INTERNAL);
});
