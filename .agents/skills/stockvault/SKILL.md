---
name: stockvault
description: 用于访问 StockVault 股票持仓管理与分析系统只读 API 的技能。可以查询投资组合概览、当前持仓、个股交易历史、实时行情、各市场统计及历史快照。
---

# StockVault API 技能

本技能允许 OpenClaw 智能体接入并查询 StockVault 持仓分析系统的数据。所有 API 均为只读接口。

## 🔐 认证与配置

使用本技能前，需要从 StockVault 的前端“系统设置”页面生成 API 密钥 (API Key)，并配置以下环境变量或在请求中携带：

- **API 密钥格式**：`sk-[a-f0-9]{40}` (例如：`sk-8f3b2...`)
- **API 基准 URL**：通常部署在 Cloudflare Pages，例如 `https://your-stockvault-domain.pages.dev` 或者是本地测试环境 `http://localhost:8788`

### 请求鉴权方式

智能体在发出 HTTP 请求时，必须在 Header 中携带 Bearer 令牌：
```http
Authorization: Bearer <YOUR_API_KEY>
```
或者在 URL 中作为查询参数附带：
`?api_key=<YOUR_API_KEY>`

---

## 📊 API 接口列表与使用指南

### 1. 获取投资组合概览 (Portfolio Summary)
- **路径**：`GET /api/openclaw/portfolio`
- **用途**：获取全局资产总值、总成本、总盈亏（YTD 及累计）以及持仓数量和各市场分布。
- **说明**：此接口读取最新的数据快照，响应速度极快，不会触发外部实时行情请求。

### 2. 获取持仓列表 (Positions)
- **路径**：`GET /api/openclaw/positions`
- **查询参数**：
  - `market` (可选): `A_SHARE` / `HK` / `US` / `SWISS` (筛选市场)
  - `status` (可选): `OPEN` (默认，当前持仓) / `CLOSED` (已平仓)
- **用途**：列出符合条件的股票持仓明细（代码、持仓量、成本价、现价、市值、盈亏、盈亏比例等）。

### 3. 获取单股持仓详情与交易历史 (Single Position Details)
- **路径**：`GET /api/openclaw/position/:symbol`
- **示例**：`GET /api/openclaw/position/AAPL` 或 `GET /api/openclaw/position/600519.SH`
- **用途**：获取特定股票的代码、名称、当前持仓统计，以及该股票的所有历史买入/卖出交易流水记录。

### 4. 查询交易流水记录 (Trade Logs)
- **路径**：`GET /api/openclaw/trades`
- **查询参数**：
  - `symbol` (可选): 股票代码筛选
  - `market` (可选): 市场筛选
  - `type` (可选): `BUY` / `SELL`
  - `from` (可选): 起始日期 (`YYYY-MM-DD`)
  - `to` (可选): 截止日期 (`YYYY-MM-DD`)
  - `limit` (可选): 限制返回条数 (默认 100，最大 500)
  - `offset` (可选): 分页偏移量 (默认 0)
- **用途**：分页查询整个系统的交易记录流水，支持多维度过滤。

### 5. 查询股票实时行情 (Real-time Quote)
- **路径**：`GET /api/openclaw/quote/:symbol`
- **用途**：查询特定个股的最新现价、涨跌幅、最高/最低价及更新时间。
- **说明**：系统内部有 5 分钟的行情缓存机制。如果缓存过期，后端会自动请求 Yahoo Finance (或配置的 Finnhub/Alpha Vantage 等) 并更新缓存。

### 6. 获取市场统计汇总 (Markets Summary)
- **路径**：`GET /api/openclaw/markets`
- **用途**：返回 A股、港股、美股、瑞士市场的汇总持仓市值、成本、总盈亏及 YTD 盈亏等。

### 7. 查询资产历史快照 (Historical Snapshots)
- **路径**：`GET /api/openclaw/snapshots`
- **查询参数**：
  - `from` (可选): 起始日期 (`YYYY-MM-DD`，默认 90 天前)
  - `to` (可选): 截止日期 (`YYYY-MM-DD`，默认今天)
  - `market` (可选): `ALL` (默认) 或特定市场
- **用途**：获取每日/每月的资产市值及盈亏成长轨迹历史快照数据，用于绘制趋势图或资产分析。

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

    def get_portfolio(self):
        """获取投资组合总值与盈亏概览"""
        url = f"{self.base_url}/api/openclaw/portfolio"
        response = requests.get(url, headers=self.headers)
        return response.json()

    def get_positions(self, market=None, status="OPEN"):
        """获取持仓明细"""
        url = f"{self.base_url}/api/openclaw/positions"
        params = {"status": status}
        if market:
            params["market"] = market
        response = requests.get(url, headers=self.headers, params=params)
        return response.json()

    def get_position_detail(self, symbol: str):
        """获取单股详情及交易记录"""
        url = f"{self.base_url}/api/openclaw/position/{symbol}"
        response = requests.get(url, headers=self.headers)
        return response.json()

    def get_trades(self, **kwargs):
        """查询交易流水"""
        url = f"{self.base_url}/api/openclaw/trades"
        response = requests.get(url, headers=self.headers, params=kwargs)
        return response.json()

    def get_quote(self, symbol: str):
        """获取实时个股行情"""
        url = f"{self.base_url}/api/openclaw/quote/{symbol}"
        response = requests.get(url, headers=self.headers)
        return response.json()

    def get_markets(self):
        """获取各市场汇总数据"""
        url = f"{self.base_url}/api/openclaw/markets"
        response = requests.get(url, headers=self.headers)
        return response.json()

    def get_snapshots(self, **kwargs):
        """查询资产快照历史记录"""
        url = f"{self.base_url}/api/openclaw/snapshots"
        response = requests.get(url, headers=self.headers, params=kwargs)
        return response.json()
```
