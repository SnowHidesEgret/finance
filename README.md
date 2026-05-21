# StockVault 📈

StockVault 是一个专为全球投资者打造的现代化股票持仓管理与分析系统。基于 Cloudflare 生态（Pages + Functions + D1）实现完全的 Serverless 部署，为您的 A股、港股、美股以及瑞士股票等多元化资产提供一站式的追踪、统计与可视化展示。

## ✨ 核心特性

- 🌍 **多市场覆盖**：原生支持 A股 (CNY)、港股 (HKD)、美股 (USD) 和瑞士市场 (CHF)。
- 💱 **智能实时汇率**：内置 Frankfurter 实时汇率 API 引擎，自动将所有外币资产转换为人民币 (CNY) 进行汇总计价。
- 📊 **高级数据可视化**：基于 ECharts 构建全景仪表盘，涵盖资产分布饼图、盈亏倒排条形图、市值矩形树图 (Treemap) 等。
- 🎨 **极致视觉体验**：采用深色模式与拟态玻璃 (Glassmorphism) 材质设计，界面美观专业。
- 🔄 **个性化偏好设置**：支持一键切换“红涨绿跌”与“绿涨红跌”两种颜色方案，适配不同用户的看盘习惯。
- 📥 **灵活的数据流转**：纯前端集成 SheetJS，支持通过 CSV/Excel (.xlsx) 文件进行大规模历史交易记录的智能批量导入。
- 🔐 **云端安全代理**：API 密钥 (如 Alpha Vantage) 存放于 Cloudflare 云端环境变量，彻底杜绝前端硬编码带来的泄露风险。

## 🛠 技术栈

- **前端框架**: Vite + 原生 JavaScript (ESM) + Vanilla CSS
- **图表渲染**: ECharts (搭配专属自定义深色主题)
- **数据处理**: SheetJS (xlsx)
- **后端 API**: Cloudflare Pages Functions
- **数据库**: Cloudflare D1 (Serverless SQLite)
- **外部接口**: Alpha Vantage (股票行情), Frankfurter (免费汇率)

## 🚀 部署指南 (Cloudflare)

本项目专门针对 Cloudflare 边缘网络生态优化。

### 1. 准备工作
- 拥有一个 Cloudflare 账号。
- 获取您的 Alpha Vantage API Key。
- 将本代码仓库提交并推送到 GitHub。

### 2. 数据库配置
使用 Wrangler CLI 在 Cloudflare 创建 D1 数据库：
```bash
npx wrangler d1 create stockvault-db
```
复制终端输出的 `database_id`，并更新至项目根目录的 `wrangler.toml` 文件中：
```toml
[[d1_databases]]
binding = "DB"
database_name = "stockvault-db"
database_id = "您的-database-id-填在这里"
```

初始化数据库表结构：
```bash
npx wrangler d1 execute stockvault-db --file=./db/schema.sql --remote
```

### 3. 创建 Cloudflare Pages
在 Cloudflare 控制台中：
1. 导航至 **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**。
2. 选择本项目的 GitHub 仓库。
3. **构建设置**：
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`

### 4. 环境变量与域名设置
部署完成后，进入 Pages 项目设置：
- **环境变量**：添加 `ALPHA_VANTAGE_KEY`，值为您的 API 密钥（生产和预览环境均需添加）。
- **自定义域名**：在 Custom domains 面板中，添加您的域名（如 `finance.snowyegret.top`）。

## 💻 本地开发

克隆代码后，在本地进行调试和开发：

```bash
# 安装依赖
npm install

# 运行本地开发服务器 (含 Functions API 模拟环境)
npx wrangler pages dev dist
```
> 注：本地开发时，需要本地 SQLite 支持，可以先运行 `npx wrangler d1 execute stockvault-db --file=./db/schema.sql --local` 来初始化本地数据库，然后运行 `npx wrangler pages dev .` 启动模拟。

## 📝 数据导入说明

在“导入导出”页面，您可以下载 CSV 模板文件。
系统支持自动识别中文/英文表头，包含字段：
`股票代码`, `股票名称`, `市场(A_SHARE/HK/US/SWISS)`, `交易类型(BUY/SELL)`, `价格`, `数量`, `日期`, `手续费(可选)`, `备注(可选)`, `行业(可选)`, `贝塔值(可选)`。

## 📄 协议

本项目作为开源或个人研究用途。所引用的第三方 API 均遵循其各自的服务条款。
