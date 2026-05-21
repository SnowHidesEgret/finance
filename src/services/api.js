/**
 * StockVault — HTTP 请求封装
 * 统一调用 Cloudflare Pages Functions API
 */

const BASE_URL = '';  // Same origin — Pages Functions 在同域下

/**
 * 通用请求方法
 * @param {string} endpoint - API 端点路径
 * @param {Object} [options] - fetch 配置
 * @returns {Promise<Object>} 响应数据
 */
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  };
  
  try {
    const response = await fetch(url, config);
    const data = await response.json();
    
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
    if (error instanceof ApiError) throw error;
    
    // 网络错误
    console.error(`[API] Request failed: ${endpoint}`, error);
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
