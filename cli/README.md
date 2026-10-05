# StockVault CLI (`stockvault` / `sv`)

StockVault 股票持仓管理与分析系统命令行工具。

专为 AI Agent（如 Claude, OpenClaw, Gemini 等）及开发者设计的高效只读数据查询与环境自检工具。零外部依赖，使用 Node.js 原生内置模块实现。

---

## 特性

- **零运行时依赖**：仅依赖 Node.js (>= 22) 内置能力，单文件 ESM 架构。
- **契约稳定 Envelope**：默认输出单行紧凑 JSON，附带版本、耗时、数据新鲜度等元数据；错误信息格式统一。
- **语义化退出码 (0–10)**：Agent 无需繁杂解析错误文本，仅凭退出码即可判断重试或处理分支。
- **高安全性鉴权**：拒绝命令行传递明文 API Key（防历史与进程窥探）；强制 HTTPS 访问；支持环境变量与安全本地配置（0600 权限）。
- **双模态输出**：默认纯净 JSON（面向机器与 Agent），亦支持 `--human` 彩色表格（红涨绿跌/国际模式）与 `--verbose` 请求追踪。

---

## 安装与快速使用

### 仓库内直接运行
```bash
node cli/stockvault.mjs <command> [args] [flags]
```

### 全局安装或 NPX
```bash
# 全局安装
npm install -g stockvault-cli
sv --help

# 或直接使用 npx
npx stockvault-cli portfolio
```

---

## 鉴权配置

StockVault Agent API 采用 API Key 鉴权。您需先在 StockVault Web 端的「系统设置 → OpenClaw API 密钥」生成密钥（格式形如 `sk-0123456789abcdef...`，共 43 位）。

> **安全须知**：CLI 严格**禁止**使用 `--api-key` 或 `--key` 命令行选项传递密钥，传参将被直接拒绝（退出码 2）。

### 密钥配置方式（按优先级）:

1. **环境变量**（推荐给 Agent / CI）：
   ```bash
   export STOCKVAULT_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```

2. **密钥文件环境变量**（适配 Docker / K8s secret 挂载）：
   ```bash
   export STOCKVAULT_API_KEY_FILE="/path/to/key.txt"
   ```

3. **配置文件初始化**：
   ```bash
   # 交互式初始化（输入时自动隐藏密钥）
   sv config init

   # 非交互式通过 stdin 输入
   echo "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | sv config init --key-stdin
   ```
   配置文件保存于 `~/.config/stockvault/config.json`（权限严格受限于 `0600`）。

---

## 命令清单

### 数据查询命令（全部只读）

| 命令 | 对应服务端端点 | 描述与关键参数 |
|---|---|---|
| `sv portfolio` | `GET /api/agent/portfolio` | 组合总览（市值、成本、盈亏、市场分布）。支持 `--max-age` |
| `sv positions` | `GET /api/agent/positions` | 持仓列表。支持 `--market` `--status` `--sort` `--asc` `--limit` |
| `sv position <symbol>` | `GET /api/agent/position/:symbol` | 单股详情与交易流水。支持 `--no-trades` |
| `sv trades` | `GET /api/agent/trades` | 交易流水明细。支持 `--symbol` `--market` `--type` `--from` `--to` `--last` `--limit` `--offset` `--all` |
| `sv quote <symbol...>` | `GET /api/agent/quotes?symbols=` | 批量或单只实时报价（1–20 个代码）。支持并发缓存查询 |
| `sv markets` | `GET /api/agent/markets` | 分市场资产与盈亏汇总。支持 `--market` |
| `sv snapshots` | `GET /api/agent/snapshots` | 历史每日资产快照。支持 `--from` `--to` `--last` `--market` |
| `sv performance` | `GET /api/agent/performance` | 投资收益指标（当日、MTD、YTD、年化收益）。支持 `--market` |
| `sv search <query>` | `GET /api/agent/search?q=` | 股票代码与标的名称/拼音搜索 |
| `sv fx` | `GET /api/agent/fx` | 汇率明细（基准币种对 CNY 汇率及来源） |

### 运维与工具命令

| 命令 | 描述 |
|---|---|
| `sv doctor` | 环境自检：检查本地配置、Key 格式、服务连通性（调 `/api/agent/ping`）及行情新鲜度 |
| `sv config show` | 查看当前生效的脱敏配置及各项来源 |
| `sv config path` | 输出配置文件物理路径 |
| `sv config init` | 初始化配置文件并设置 0600 安全权限 |
| `sv describe [command]` | 输出机器可读的命令与参数目录（JSON），便于 Agent 自我发现能力 |
| `sv version` / `-V` | 查看 CLI 版本、schemaVersion、支持的 apiVersion 及 Node 版本 |

---

## 全局选项

- `--human`: 以格式化卡片和表格形式输出（便于人类阅读）
- `--pretty`: 格式化缩进 JSON 输出（便于调试）
- `--fields <a,b,...>`: 字段投影，仅输出指定字段（未知字段将直接报参数错误）
- `--profile <name>`: 选择配置档（默认 `prod`）
- `--base-url <url>`: 覆盖服务基地址（默认 `https://finance.snowyegret.top`）
- `--timeout <ms>`: 单次请求超时毫秒数（默认 `15000`）
- `--retries <n>`: 幂等网络请求失败时的最大重试次数（默认 `2`）
- `--max-age <dur>`: 行情新鲜度阈值（默认 `6h`，如 `30m`, `6h`, `2d`）
- `--verbose`: 输出网络请求跟踪详情至 `stderr`
- `--raw`: 透传服务端原始响应
- `--no-color`: 禁用 ANSI 颜色（遵循 `NO_COLOR` 环境变量）
- `-h, --help`: 查看命令帮助（每条命令附带参数、示例与退出码说明）

---

## 退出码规范

| 退出码 | 类型 | 含义 | 重试建议 |
|---|---|---|---|
| **0** | OK | 执行成功 | - |
| **1** | INTERNAL | CLI 内部未预期异常 | 不建议重试 |
| **2** | USAGE | 命令行参数或选项错误（如非法日期、未知字段） | 修复参数后重试 |
| **3** | CONFIG | 本地配置缺失、API Key 格式非法或非安全 Base URL | 修复配置后重试 |
| **4** | AUTH | 服务端鉴权失败（401/403，Key 无效或已被撤销） | 重新生成 Key |
| **5** | NOT_FOUND | 资源不存在（404，如未找到股票代码） | 检查拼写或切换格式 |
| **6** | NETWORK | 网络通信失败、DNS 解析错误或请求超时 | 可重试 |
| **7** | SERVER | 服务端 5xx 错误或上游行情服务失败 | 502/503/504 可重试 |
| **8** | RATE_LIMITED | 触发限流 (429) | 等待后重试 |
| **9** | PROTOCOL | 返回非 JSON 格式响应（如误返回 HTML 单页应用） | 检查服务端地址与版本 |
| **10** | PARTIAL | 批量操作部分成功（`quote` 多代码时有效），`ok: true` | 查看 `data.errors` |

---

## 典型示例

```bash
# 1. 运行自检
sv doctor

# 2. 查询总资产概览（仅保留市值与盈亏）
sv portfolio --fields totalValueCNY,totalPnlCNY,totalPnlPercent

# 3. 查看美股持仓按收益率从高到低前 5 名
sv positions --market US --sort pnlPercent --limit 5 --human

# 4. 查询腾讯近 90 天的交易流水
sv trades --symbol 0700.HK --last 90d

# 5. 批量查询实时报价
sv quote AAPL MSFT 0700.HK 600519.SHH

# 6. 机器获取命令元数据
sv describe positions
```

---

## 环境变量

- `STOCKVAULT_API_KEY`: API Key（`sk-...`）
- `STOCKVAULT_API_KEY_FILE`: 包含 API Key 的文本文件路径
- `STOCKVAULT_BASE_URL`: 服务基地址（必须为 HTTPS，localhost 除外）
- `STOCKVAULT_CONFIG`: 自定义配置文件路径
- `STOCKVAULT_PROFILE`: 激活的配置档名（默认 `prod`）
- `STOCKVAULT_COLOR_SCHEME`: 涨跌配色方案。默认国内习惯（红涨绿跌）；设为 `intl` 切换为国际习惯（绿涨红跌）
- `NO_COLOR`: 非空时禁用所有终端着色
