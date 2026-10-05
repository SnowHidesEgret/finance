---
name: stockvault
description: 用于访问 StockVault 股票持仓管理与分析系统只读 Agent API 的技能。可以查询投资组合概览、当前持仓、个股交易历史、实时行情、收益表现、各市场统计及历史快照。推荐优先使用 sv 命令行工具。
---

# StockVault Agent API 技能

本技能允许 AI 智能体接入并查询 StockVault 持仓分析系统的数据。所有 API 均为只读接口。

## 🖥️ 推荐：使用 sv 命令行工具

`sv` 是官方命令行工具，对 Agent API 的薄封装，输出机器可读的 JSON：

```bash
export STOCKVAULT_API_KEY="sk-..."   # 从系统设置页生成
npx stockvault-cli portfolio         # 组合概要
npx stockvault-cli positions         # 持仓列表
npx stockvault-cli quote 0700.HK MSFT  # 批量实时报价
npx stockvault-cli --help            # 完整命令列表
```

能用 CLI 就不用手拼 HTTP 请求。下面的 HTTP 接口文档是给 CLI 不可用时的备用方案。

## 🔐 认证与配置

使用本技能前，需要从 StockVault 的前端"系统设置 → Agent API 密钥"页面生成 API 密钥，并配置以下环境变量：

- **API 密钥格式**：`sk-[a-f0-9]{40}`（例如：`sk-8f3b2...`）
- **API 基准 URL**：例如 `https://finance.snowyegret.top`，本地开发 `http://localhost:8788`

### 请求鉴权方式

必须在 Header 中携带 Bearer 令牌（**不支持** URL 查询参数 `?api_key=`，已废弃）：

```http
Authorization: Bearer <YOUR_API_KEY>
```

### 统一响应格式

成功：`{"success":true,"data":{...},"meta":{"timestamp":"...","version":"v1"}}`
失败：`{"success":false,"error":{"code":"英文_CODE","message":"中文说明"},"meta":{...}}`

---

## 📊 API 接口列表与使用指南

### 0. 连通性检查 (Ping)
- **路径**：`GET /api/agent/ping`
- **用途**：轻量检查 Key 是否有效，同时返回最新行情时间、最新快照日期、持仓数量。

### 1. 获取投资组合概览 (Portfolio Summary)
- **路径**：`GET /api/agent/portfolio`
- **用途**：获取全局资产总值、总成本、总盈亏、持仓数量及各市场分布。
- **说明**：只读行情缓存与汇率缓存，不触发外部请求。成本按**实时汇率**折算（与仪表盘口径一致）。

### 2. 获取持仓列表 (Positions)
- **路径**：`GET /api/agent/positions`
- **查询参数**：
  - `market`（可选）：`A_SHARE` / `HK` / `US` / `SWISS`
  - `status`（可选）：`OPEN`（默认，当前持仓）/ `CLOSED`（已平仓，已实现盈亏按平仓价计算）
- **用途**：持仓明细（代码、持仓量、成本价、现价、市值、盈亏、盈亏比例、持仓天数等）。

### 3. 获取单股持仓详情与交易历史 (Single Position Details)
- **路径**：`GET /api/agent/position/:symbol`
- **示例**：`GET /api/agent/position/MSFT` 或 `GET /api/agent/position/600036.SS`
- **代码格式**：Yahoo 风格——上交所 `.SS`、深交所 `.SZ`、港股 `.HK`、瑞士 `.SW`、美股无后缀。

### 4. 查询交易流水记录 (Trade Logs)
- **路径**：`GET /api/agent/trades`
- **查询参数**：`symbol`、`market`、`type`（`BUY`/`SELL`）、`from`/`to`（`YYYY-MM-DD`）、`limit`（默认 100，最大 500）、`offset`
- **用途**：分页查询交易流水。非法参数返回 400（不再静默修正）。

### 5. 查询股票实时行情 (Real-time Quotes)
- **路径**：`GET /api/agent/quotes?symbols=0700.HK,MSFT`
- **用途**：批量查询最多 20 个代码的最新现价、涨跌幅及更新时间。
- **说明**：5 分钟行情缓存；缓存过期时请求 Yahoo Finance 并写回缓存。

### 6. 获取收益表现 (Performance)
- **路径**：`GET /api/agent/performance?market=`
- **用途**：当日盈亏、本月盈亏及收益率、YTD 盈亏及收益率、年化收益——与仪表盘同一口径。

### 7. 获取市场统计汇总 (Markets Summary)
- **路径**：`GET /api/agent/markets`
- **用途**：A股、港股、美股、瑞士市场的持仓市值、成本、总盈亏及 YTD 盈亏。币种一律从 `market` 推导。

### 8. 查询资产历史快照 (Historical Snapshots)
- **路径**：`GET /api/agent/snapshots`
- **查询参数**：`from` / `to`（`YYYY-MM-DD`，默认最近 90 天）、`market`（默认 `ALL`）
- **说明**：日粒度快照，日期按 UTC；快照为打开仪表盘时惰性写入，日期可能不连续。

### 9. 代码搜索 (Symbol Search)
- **路径**：`GET /api/agent/search?q=腾讯`
- **用途**：把公司名称/关键词解析成股票代码。

### 10. 汇率明细 (FX Rates)
- **路径**：`GET /api/agent/fx`
- **用途**：返回计算用的各币种对 CNY 汇率、来源与更新时间，便于解释盈亏中的汇率成分。

---

## 💡 示例调用代码 (Python)

```python
import requests

class StockVaultClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip('/')
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

    def _get(self, path, **params):
        url = f"{self.base_url}/api/agent/{path}"
        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()
        return response.json()

    def ping(self):
        """连通性检查"""
        return self._get("ping")

    def get_portfolio(self):
        """投资组合总值与盈亏概览"""
        return self._get("portfolio")

    def get_positions(self, market=None, status="OPEN"):
        """持仓明细"""
        params = {"status": status}
        if market:
            params["market"] = market
        return self._get("positions", **params)

    def get_position_detail(self, symbol: str):
        """单股详情及交易记录"""
        return self._get(f"position/{symbol}")

    def get_trades(self, **kwargs):
        """交易流水"""
        return self._get("trades", **kwargs)

    def get_quotes(self, symbols):
        """批量实时行情，symbols 为代码列表，最多 20 个"""
        return self._get("quotes", symbols=",".join(symbols))

    def get_performance(self, market=None):
        """收益表现（日/月/YTD/年化）"""
        return self._get("performance", **({"market": market} if market else {}))

    def get_markets(self):
        """各市场汇总"""
        return self._get("markets")

    def get_snapshots(self, **kwargs):
        """资产快照历史"""
        return self._get("snapshots", **kwargs)

    def search(self, q: str):
        """代码搜索"""
        return self._get("search", q=q)

    def get_fx(self):
        """汇率明细"""
        return self._get("fx")
```
