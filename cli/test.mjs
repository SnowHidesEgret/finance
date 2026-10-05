/**
 * StockVault CLI 自动化测试套件
 * 使用 Node.js 原生 node:test 与 node:assert
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

const CLI_PATH = path.resolve('cli/stockvault.mjs');

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const cp = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...env,
      },
    });

    let stdout = '';
    let stderr = '';
    cp.stdout.on('data', (d) => {
      stdout += d;
    });
    cp.stderr.on('data', (d) => {
      stderr += d;
    });
    cp.on('error', reject);
    cp.on('close', (code) => {
      let json = null;
      if (stdout && stdout.trim().startsWith('{')) {
        try {
          json = JSON.parse(stdout.trim());
        } catch {
          // not json
        }
      }
      resolve({
        code,
        stdout,
        stderr,
        json,
      });
    });
  });
}

test('StockVault CLI - 基础命令（无网络依赖）', async (t) => {
  await t.test('--help 输出包含关键命令与选项', async () => {
    const res = await runCli(['--help']);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /StockVault CLI/);
    assert.match(res.stdout, /portfolio/);
    assert.match(res.stdout, /positions/);
    assert.match(res.stdout, /quote/);
    assert.match(res.stdout, /doctor/);
  });

  await t.test('子命令 --help 输出包含示例与退出码说明', async () => {
    const res = await runCli(['positions', '--help']);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /sv positions --market US/);
    assert.match(res.stdout, /可能退出码/);
    assert.match(res.stdout, /0 OK/);
    assert.match(res.stdout, /2 USAGE/);
  });

  await t.test('describe 输出完整的命令机器可读目录', async () => {
    const res = await runCli(['describe']);
    assert.equal(res.code, 0);
    assert.ok(res.json);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.schemaVersion, 1);
    assert.ok(Array.isArray(res.json.data.commands));
    assert.ok(res.json.data.commands.find((c) => c.name === 'portfolio'));
    assert.ok(res.json.data.commands.find((c) => c.name === 'positions'));
    assert.ok(res.json.data.exitCodes['0'], 'OK');
    assert.ok(res.json.data.exitCodes['10'], 'PARTIAL');
  });

  await t.test('describe <command> 输出单命令信息', async () => {
    const res = await runCli(['describe', 'portfolio']);
    assert.equal(res.code, 0);
    assert.ok(res.json);
    assert.equal(res.json.data.name, 'portfolio');
    assert.equal(res.json.data.endpoint, 'GET /api/agent/portfolio');
  });

  await t.test('version 输出版本信息', async () => {
    const res = await runCli(['version']);
    assert.equal(res.code, 0);
    assert.ok(res.json);
    assert.equal(res.json.data.cliVersion, '0.1.0');
    assert.equal(res.json.data.schemaVersion, 1);
    assert.deepEqual(res.json.data.supportedApiVersions, ['v1']);
    assert.match(res.json.data.node, /^v\d+/);
  });

  await t.test('config path 返回正确的路径', async () => {
    const res = await runCli(['config', 'path']);
    assert.equal(res.code, 0);
    assert.ok(res.json);
    assert.match(res.json.data.path, /config\.json$/);

    const humanRes = await runCli(['config', 'path', '--human']);
    assert.equal(humanRes.code, 0);
    assert.match(humanRes.stdout, /config\.json/);
  });
});

test('StockVault CLI - 安全鉴权约束与拒绝规则', async (t) => {
  await t.test('严格拒绝 --api-key 命令行传参 (退出码 2)', async () => {
    const res = await runCli(['--api-key', 'sk-test1234567890abcdef1234567890abcdef1234']);
    assert.equal(res.code, 2);
    assert.ok(res.json);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.type, 'USAGE');
    assert.equal(res.json.error.code, 'FORBIDDEN_FLAG');
    assert.match(res.json.error.message, /Key 不能通过命令行传入/);
  });

  await t.test('严格拒绝 --key=xxx 命令行传参 (退出码 2)', async () => {
    const res = await runCli(['portfolio', '--key=sk-test']);
    assert.equal(res.code, 2);
    assert.ok(res.json);
    assert.equal(res.json.error.code, 'FORBIDDEN_FLAG');
  });

  await t.test('严格拒绝非 HTTPS 的远端 Base URL (退出码 3)', async () => {
    const res = await runCli(['portfolio', '--base-url', 'http://insecure.example.com']);
    assert.equal(res.code, 3);
    assert.ok(res.json);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.type, 'CONFIG');
    assert.equal(res.json.error.code, 'INSECURE_BASE_URL');
  });

  await t.test('未配置 Key 时运行数据命令返回 MISSING_API_KEY (退出码 3)', async () => {
    const res = await runCli(['portfolio'], {
      STOCKVAULT_API_KEY: '',
      STOCKVAULT_API_KEY_FILE: '',
      STOCKVAULT_CONFIG: '/non-existent-config.json',
    });
    assert.equal(res.code, 3);
    assert.ok(res.json);
    assert.equal(res.json.error.type, 'CONFIG');
    assert.equal(res.json.error.code, 'MISSING_API_KEY');
  });

  await t.test('API Key 格式不合规时返回 INVALID_API_KEY_FORMAT (退出码 3)', async () => {
    const res = await runCli(['portfolio'], {
      STOCKVAULT_API_KEY: 'not-a-valid-sk-key',
      STOCKVAULT_CONFIG: '/non-existent-config.json',
    });
    assert.equal(res.code, 3);
    assert.ok(res.json);
    assert.equal(res.json.error.code, 'INVALID_API_KEY_FORMAT');
  });

  await t.test('无 Key 时运行 doctor 报 CONFIG 错误且不崩溃 (退出码 3)', async () => {
    const res = await runCli(['doctor'], {
      STOCKVAULT_API_KEY: '',
      STOCKVAULT_API_KEY_FILE: '',
      STOCKVAULT_CONFIG: '/non-existent-config.json',
    });
    assert.equal(res.code, 3);
    assert.ok(res.json);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.type, 'CONFIG');
    assert.equal(res.json.error.code, 'MISSING_API_KEY');
    assert.ok(Array.isArray(res.json.error.checks));
    const cfgCheck = res.json.error.checks.find((c) => c.name === 'config');
    assert.equal(cfgCheck.status, 'fail');
  });
});

test('StockVault CLI - 本地参数校验与边界条件 (退出码 2)', async (t) => {
  const dummyEnv = {
    STOCKVAULT_API_KEY: 'sk-0123456789abcdef0123456789abcdef01234567',
  };

  await t.test('未知子命令', async () => {
    const res = await runCli(['unknown_command'], dummyEnv);
    assert.equal(res.code, 2);
    assert.equal(res.json.error.code, 'UNKNOWN_COMMAND');
  });

  await t.test('非法市场代码', async () => {
    const res = await runCli(['positions', '--market', 'TOKYO'], dummyEnv);
    assert.equal(res.code, 2);
    assert.equal(res.json.error.code, 'INVALID_ARGUMENT');
    assert.match(res.json.error.message, /无效的市场参数/);
  });

  await t.test('非法持仓状态', async () => {
    const res = await runCli(['positions', '--status', 'ALL'], dummyEnv);
    assert.equal(res.code, 2);
    assert.equal(res.json.error.code, 'INVALID_ARGUMENT');
    assert.match(res.json.error.message, /无效的 status 参数/);
  });

  await t.test('非法排序字段', async () => {
    const res = await runCli(['positions', '--sort', 'nonExistentField'], dummyEnv);
    assert.equal(res.code, 2);
    assert.equal(res.json.error.code, 'INVALID_ARGUMENT');
  });

  await t.test('非法 limit 参数', async () => {
    const res = await runCli(['positions', '--limit', '0'], dummyEnv);
    assert.equal(res.code, 2);
    assert.equal(res.json.error.code, 'INVALID_ARGUMENT');
  });

  await t.test('非法日期格式', async () => {
    const res = await runCli(['trades', '--from', '2026/01/01'], dummyEnv);
    assert.equal(res.code, 2);
    assert.equal(res.json.error.code, 'INVALID_ARGUMENT');
  });

  await t.test('日期起始大于结束', async () => {
    const res = await runCli(['trades', '--from', '2026-05-01', '--to', '2026-04-01'], dummyEnv);
    assert.equal(res.code, 2);
    assert.match(res.json.error.message, /不能晚于结束日期/);
  });

  await t.test('--last 与 --from 互斥', async () => {
    const res = await runCli(['trades', '--from', '2026-01-01', '--last', '30d'], dummyEnv);
    assert.equal(res.code, 2);
    assert.match(res.json.error.message, /--last 不能与 --from 同时使用/);
  });

  await t.test('--all 与 --offset 互斥', async () => {
    const res = await runCli(['trades', '--all', '--offset', '50'], dummyEnv);
    assert.equal(res.code, 2);
    assert.match(res.json.error.message, /--all 不能与 --offset 同时使用/);
  });

  await t.test('非法股票代码字符', async () => {
    const res = await runCli(['position', 'INVALID*CODE!'], dummyEnv);
    assert.equal(res.code, 2);
    assert.match(res.json.error.message, /股票代码格式非法/);
  });

  await t.test('未知投影字段立即报错，不发网络请求', async () => {
    const res = await runCli(['portfolio', '--fields', 'fakeField'], dummyEnv);
    assert.equal(res.code, 2);
    assert.equal(res.json.error.code, 'INVALID_ARGUMENT');
    assert.match(res.json.error.message, /无效的投影字段/);
  });
});

test('StockVault CLI - Mock 服务端交互测试', async (t) => {
  let server;
  let serverUrl;
  let requestHandler = (req, res) => res.end();

  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      requestHandler(req, res);
    });
    server.listen(0, '127.0.0.1', () => {
      serverUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  const mockEnv = {
    STOCKVAULT_API_KEY: 'sk-0123456789abcdef0123456789abcdef01234567',
    STOCKVAULT_BASE_URL: serverUrl,
  };

  await t.test('portfolio 查询成功并包含鉴权头', async () => {
    requestHandler = (req, res) => {
      assert.equal(req.url, '/api/agent/portfolio');
      assert.equal(req.headers['authorization'], 'Bearer sk-0123456789abcdef0123456789abcdef01234567');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          data: {
            totalValueCNY: 100000,
            totalCostCNY: 80000,
            totalPnlCNY: 20000,
            totalPnlPercent: 25.0,
            ytdPnlCNY: 5000,
            positionCount: 5,
            markets: { US: { count: 5, valueCNY: 100000, pnlCNY: 20000 } },
            lastUpdated: new Date().toISOString(),
          },
          meta: { version: 'v1', timestamp: new Date().toISOString() },
        })
      );
    };

    const res = await runCli(['portfolio'], mockEnv);
    assert.equal(res.code, 0);
    assert.ok(res.json);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.totalValueCNY, 100000);
    assert.equal(res.json.data.totalPnlPercent, 25.0);
  });

  await t.test('position 404 时返回 NOT_FOUND 并附带格式建议', async () => {
    requestHandler = (req, res) => {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: false,
          error: { code: 'POSITION_NOT_FOUND', message: 'Position not found: 0700.HK' },
        })
      );
    };

    const res = await runCli(['position', '0700.HK'], mockEnv);
    assert.equal(res.code, 5);
    assert.ok(res.json);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.type, 'NOT_FOUND');
    assert.equal(res.json.error.code, 'POSITION_NOT_FOUND');
    assert.match(res.json.error.hint, /0700\.HKG/);
  });

  await t.test('quote 批量查询部分成功返回退出码 10 (PARTIAL) 且 ok: true', async () => {
    requestHandler = (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          data: {
            items: [
              {
                symbol: 'AAPL',
                price: 230.5,
                previousClose: 228.0,
                change: 2.5,
                changePercent: 1.1,
                currency: 'USD',
                cached: true,
                updatedAt: new Date().toISOString(),
              },
            ],
            errors: [
              {
                symbol: 'INVALID.SYM',
                code: 'SYMBOL_NOT_FOUND',
                message: 'Symbol not found',
                status: 404,
              },
            ],
            count: 1,
          },
        })
      );
    };

    const res = await runCli(['quote', 'AAPL', 'INVALID.SYM'], mockEnv);
    assert.equal(res.code, 10);
    assert.ok(res.json);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.partial, true);
    assert.equal(res.json.data.items.length, 1);
    assert.equal(res.json.data.errors.length, 1);
  });

  await t.test('服务端 401 鉴权失效返回 AUTH 错误 (退出码 4)', async () => {
    requestHandler = (req, res) => {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: false,
          error: { code: 'INVALID_API_KEY', message: 'API Key 无效' },
        })
      );
    };

    const res = await runCli(['portfolio'], mockEnv);
    assert.equal(res.code, 4);
    assert.ok(res.json);
    assert.equal(res.json.error.type, 'AUTH');
    assert.equal(res.json.error.code, 'INVALID_API_KEY');
  });

  await t.test('服务端返回非 JSON 响应触发 PROTOCOL 错误 (退出码 9)', async () => {
    requestHandler = (req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!DOCTYPE html><html><body>Error</body></html>');
    };

    const res = await runCli(['portfolio'], mockEnv);
    assert.equal(res.code, 9);
    assert.ok(res.json);
    assert.equal(res.json.error.type, 'PROTOCOL');
    assert.equal(res.json.error.code, 'NON_JSON_RESPONSE');
  });

  await t.test('doctor 自检通过 (退出码 0)', async () => {
    requestHandler = (req, res) => {
      assert.equal(req.url, '/api/agent/ping');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          data: {
            apiVersion: 'v1',
            keyCreatedAt: new Date().toISOString(),
            latestQuoteAt: new Date().toISOString(),
            latestSnapshotDate: new Date().toISOString().slice(0, 10),
            openPositionCount: 3,
          },
        })
      );
    };

    const res = await runCli(['doctor'], mockEnv);
    assert.equal(res.code, 0);
    assert.ok(res.json);
    assert.equal(res.json.ok, true);
    assert.ok(Array.isArray(res.json.data.checks));
    assert.ok(res.json.data.checks.every((c) => c.status === 'pass'));
  });
});
