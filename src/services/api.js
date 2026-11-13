/**
 * StockVault — HTTP 请求封装
 * 统一调用 Cloudflare Pages Functions API
 */

import { Toast } from '../utils/toast.js';

const BASE_URL = '';  // Same origin — Pages Functions 在同域下

/**
 * 通用请求方法
 * @param {string} endpoint - API 端点路径
 * @param {Object} [options] - fetch 配置，支持额外属性 { silent?: boolean }
 * @returns {Promise<Object>} 响应数据
 */
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const token = localStorage.getItem('auth_token');
  const { silent = false, headers: customHeaders, ...fetchOptions } = options;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...customHeaders
    },
    ...fetchOptions
  };

  try {
    const response = await fetch(url, config);

    if (response.status === 401) {
      // 仅当当前存储的 token 与本次请求携带的 token 一致时才清除，防止登录前的慢请求冲掉新登录的 token
      const currentToken = localStorage.getItem('auth_token');
      if (token && currentToken === token) {
        localStorage.removeItem('auth_token');
      }
      if (!localStorage.getItem('auth_token') && !window.location.hash.startsWith('#/login') && !endpoint.startsWith('/api/auth/login')) {
        window.location.hash = '#/login';
      }
      let errMsg = '未授权，请登录';
      try {
        const errBody = await response.json();
        if (errBody && errBody.error) {
          errMsg = typeof errBody.error === 'string' ? errBody.error : (errBody.error.message || errMsg);
        }
      } catch (_) {}
      throw new ApiError(errMsg, 401, null);
    }

    let data;
    const text = await response.text();

    // 提取接口上下文信息（包含股票代码，如果存在）
    let ctx = `[${endpoint.split('?')[0]}]`;
    const symbolMatch = endpoint.match(/[?&]symbol=([^&]+)/);
    if (symbolMatch) {
      ctx += ` (股票: ${decodeURIComponent(symbolMatch[1])})`;
    }

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error(`[API] Non-JSON response from ${url}:`, text);
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const errorMsg = isLocal
          ? `${ctx} 响应异常(非JSON)。请检查本地后端服务(Wrangler)是否已启动。`
          : `${ctx} 云端响应异常(HTTP ${response.status} 非JSON)。请检查云端日志或 D1 绑定状态。`;
        throw new ApiError(errorMsg, response.status, { raw: text });
      }
    } else {
      data = {};
    }

    if (!response.ok) {
      throw new ApiError(
        `${ctx} ${data.error || `HTTP ${response.status}`}`,
        response.status,
        data
      );
    }

    if (data.success === false) {
      throw new ApiError(`${ctx} ${data.error || 'Unknown error'}`, response.status, data);
    }

    return data.data !== undefined ? data.data : data;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status !== 401 && !silent) {
        Toast.error(error.message, `API 请求失败 (${error.status})`);
      }
      throw error;
    }

    // 网络错误
    console.error(`[API] Request failed: ${endpoint}`, error);

    let ctx = `[${endpoint.split('?')[0]}]`;
    const symbolMatch = endpoint.match(/[?&]symbol=([^&]+)/);
    if (symbolMatch) {
      ctx += ` (股票: ${decodeURIComponent(symbolMatch[1])})`;
    }

    if (!silent) {
      Toast.error(error.message, '网络请求异常');
    }
    throw new ApiError(`${ctx} 网络错误: ${error.message}`, 0, null);
  }
}

/**
 * 自定义 API 错误类
 */
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * GET 请求
 * @param {string} endpoint
 * @param {Object} [params] - URL 查询参数
 * @param {Object} [options] - 附加请求配置 (如 { silent: true })
 * @returns {Promise<Object>}
 */
export async function get(endpoint, params = {}, options = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      query.append(key, value);
    }
  }
  const queryStr = query.toString();
  const url = queryStr ? `${endpoint}?${queryStr}` : endpoint;
  return request(url, { method: 'GET', ...options });
}

/**
 * POST 请求
 * @param {string} endpoint
 * @param {Object} body
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function post(endpoint, body, options = {}) {
  return request(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
    ...options
  });
}

/**
 * PUT 请求
 * @param {string} endpoint
 * @param {Object} body
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function put(endpoint, body, options = {}) {
  return request(endpoint, {
    method: 'PUT',
    body: JSON.stringify(body),
    ...options
  });
}

/**
 * DELETE 请求
 * @param {string} endpoint
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function del(endpoint, options = {}) {
  return request(endpoint, { method: 'DELETE', ...options });
}
