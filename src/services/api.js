/**
 * StockVault — HTTP 请求封装
 * 统一调用 Cloudflare Pages Functions API
 */

import { Toast } from '../utils/toast.js';

const BASE_URL = '';  // Same origin — Pages Functions 在同域下

/**
 * 通用请求方法
 * @param {string} endpoint - API 端点路径
 * @param {Object} [options] - fetch 配置
 * @returns {Promise<Object>} 响应数据
 */
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const token = localStorage.getItem('auth_token');
  
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    },
    ...options
  };
  
  try {
    const response = await fetch(url, config);
    
    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.hash = '#/login';
      throw new ApiError('未授权，请登录', 401, null);
    }
    
    let data;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new ApiError('服务器响应异常 (非JSON格式)。请检查本地后端服务 (Wrangler) 是否已启动。', response.status, { raw: text });
      }
    } else {
      data = {};
    }
    
    
    if (!response.ok) {
      throw new ApiError(
        data.error || `HTTP ${response.status}`,
        response.status,
        data
      );
    }
    
    if (data.success === false) {
      throw new ApiError(data.error || 'Unknown error', response.status, data);
    }
    
    return data.data !== undefined ? data.data : data;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status !== 401) { // We probably don't want to toast every 401 if it's just redirecting to login, or maybe we do. We will toast it.
        Toast.error(error.message, `API 请求失败 (${error.status})`);
      } else {
        Toast.warning('您的登录已过期，请重新登录。');
      }
      throw error;
    }
    
    // 网络错误
    console.error(`[API] Request failed: ${endpoint}`, error);
    Toast.error(error.message, '网络请求异常');
    throw new ApiError(`网络错误: ${error.message}`, 0, null);
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
 * @returns {Promise<Object>}
 */
export async function get(endpoint, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      query.append(key, value);
    }
  }
  const queryStr = query.toString();
  const url = queryStr ? `${endpoint}?${queryStr}` : endpoint;
  return request(url, { method: 'GET' });
}

/**
 * POST 请求
 * @param {string} endpoint
 * @param {Object} body
 * @returns {Promise<Object>}
 */
export async function post(endpoint, body) {
  return request(endpoint, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * PUT 请求
 * @param {string} endpoint
 * @param {Object} body
 * @returns {Promise<Object>}
 */
export async function put(endpoint, body) {
  return request(endpoint, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

/**
 * DELETE 请求
 * @param {string} endpoint
 * @returns {Promise<Object>}
 */
export async function del(endpoint) {
  return request(endpoint, { method: 'DELETE' });
}
