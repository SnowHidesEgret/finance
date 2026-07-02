/**
 * StockVault — 导入导出页
 */
import { generateTemplateCSV, parseFile, validateAndTransform, autoMapFields } from '../services/importer.js';
import { exportPositionsCSV, exportTradesCSV, exportOpenPositionsSummaryCSV } from '../services/exporter.js';
import { post } from '../services/api.js';
import { navigate } from '../router/index.js';
import { Toast } from '../utils/toast.js';

export async function renderImportExportPage(container) {
  container.innerHTML = `
    <div class="page-container animate-fade-in-up">
      <div class="page-header">
        <h2 class="page-title">批量导入与导出</h2>
      </div>
      
      <div class="grid-2">
        <div class="card">
          <h3 style="margin-bottom:16px; font-size:1.1rem;">批量导入交易 (CSV/Excel)</h3>
          <p style="color:var(--color-text-secondary); margin-bottom:16px; font-size:0.875rem;">
            支持上传包含交易记录的 Excel (.xlsx, .xls) 或 CSV 文件。
            系统会自动识别列名，您也可以先下载模板。
          </p>
          
          <div style="display:flex; gap:12px; margin-bottom:24px;">
            <button class="btn btn--ghost" id="btn-download-tpl">下载导入模板</button>
            <label class="btn btn--primary" style="cursor:pointer;">
              选择文件并导入
              <input type="file" id="file-upload" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" style="display:none;">
            </label>
          </div>
          
          <div id="import-log" style="font-family:monospace; font-size:0.75rem; background:rgba(0,0,0,0.2); padding:12px; border-radius:4px; max-height:200px; overflow-y:auto; display:none;">
          </div>
        </div>
        
        <div class="card">
          <h3 style="margin-bottom:16px; font-size:1.1rem;">数据导出</h3>
          <p style="color:var(--color-text-secondary); margin-bottom:16px; font-size:0.875rem;">
            将您的所有持仓和交易记录导出为 CSV 文件，方便您在其他软件中进行分析或备份。
          </p>
          
          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <button class="btn btn--ghost" id="btn-export-positions">导出当前持仓</button>
            <button class="btn btn--ghost" id="btn-export-open-summary">导出未平仓头寸汇总</button>
            <button class="btn btn--ghost" id="btn-export-trades">导出交易记录</button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 导出交易记录弹窗 -->
    <div id="export-trades-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6); z-index:1000; align-items:center; justify-content:center; backdrop-filter: blur(4px);">
      <div class="card animate-fade-in-up" style="width:100%; max-width:400px; padding:24px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
        <h3 style="margin-bottom:16px;">选择导出时间范围</h3>
        <p style="color:var(--color-text-secondary); margin-bottom:20px; font-size:0.875rem;">
          不选日期则默认导出所有交易记录。
        </p>
        <div style="margin-bottom:16px;">
          <label style="display:block; margin-bottom:8px; font-size:0.875rem; color:var(--color-text-secondary);">开始日期</label>
          <input type="date" id="modal-export-from" class="input" style="width:100%;">
        </div>
        <div style="margin-bottom:24px;">
          <label style="display:block; margin-bottom:8px; font-size:0.875rem; color:var(--color-text-secondary);">结束日期</label>
          <input type="date" id="modal-export-to" class="input" style="width:100%;">
        </div>
        <div style="display:flex; justify-content:flex-end; gap:12px;">
          <button class="btn btn--ghost" id="modal-cancel">取消</button>
          <button class="btn btn--primary" id="modal-confirm-export">确认导出</button>
        </div>
      </div>
    </div>
  `;
  
  container.querySelector('#btn-download-tpl').addEventListener('click', () => {
    const csv = generateTemplateCSV();
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stockvault_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
  
  container.querySelector('#file-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const logEl = document.getElementById('import-log');
    logEl.style.display = 'block';
    logEl.innerHTML = `<div style="color:var(--color-accent-light)">[系统] 正在读取文件 ${file.name}...</div>`;
    
    try {
      const { headers, rows } = await parseFile(file);
      logEl.innerHTML += `<div>[系统] 读取成功，发现 ${rows.length} 行数据，正在进行校验...</div>`;
      
      const mapping = autoMapFields(headers);
      const { valid, errors } = validateAndTransform(rows, mapping);
      
      if (errors.length > 0) {
        logEl.innerHTML += `<div style="color:var(--color-loss)">[错误] 数据校验发现 ${errors.length} 个错误：</div>`;
        errors.slice(0, 10).forEach(err => {
          logEl.innerHTML += `<div style="color:var(--color-loss)">- 第 ${err.row} 行: ${err.message}</div>`;
        });
        if (errors.length > 10) logEl.innerHTML += `<div>...以及其他 ${errors.length - 10} 个错误。请修正后重试。</div>`;
        e.target.value = ''; // clear input
        return;
      }
      
      logEl.innerHTML += `<div style="color:var(--color-profit)">[成功] 校验通过，共 ${valid.length} 条有效记录，正在导入到数据库...</div>`;
      
      // Call API
      const result = await post('/api/trades/import', valid);
      logEl.innerHTML += `<div style="color:var(--color-profit)">[成功] 导入完成！成功: ${result.imported}, 失败: ${result.failed}</div>`;
      
      if (result.imported > 0) {
        setTimeout(() => {
          Toast.success('导入成功！');
          navigate('/positions');
        }, 1000);
      }
      
    } catch (err) {
      logEl.innerHTML += `<div style="color:var(--color-loss)">[严重错误] ${err.message}</div>`;
    }
    
    e.target.value = ''; // clear input
  });
  
  container.querySelector('#btn-export-positions').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '导出中...';
    try {
      await exportPositionsCSV();
    } catch (err) {
      Toast.error('导出持仓失败: ' + err.message);
    } finally {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  });

  container.querySelector('#btn-export-open-summary').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '导出中...';
    try {
      await exportOpenPositionsSummaryCSV();
    } catch (err) {
      Toast.error('导出未平仓头寸汇总失败: ' + err.message);
    } finally {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  });

  const modal = container.querySelector('#export-trades-modal');
  
  container.querySelector('#btn-export-trades').addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  container.querySelector('#modal-cancel').addEventListener('click', () => {
    modal.style.display = 'none';
  });

  container.querySelector('#modal-confirm-export').addEventListener('click', async (e) => {
    const fromDate = container.querySelector('#modal-export-from').value;
    const toDate = container.querySelector('#modal-export-to').value;
    
    if (fromDate && toDate && fromDate > toDate) {
      Toast.warning('开始日期不能晚于结束日期');
      return;
    }

    const btn = e.target;
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '导出中...';
    try {
      await exportTradesCSV(fromDate || undefined, toDate || undefined);
      modal.style.display = 'none'; // 导出成功后关闭弹窗
    } catch (err) {
      Toast.error('导出交易记录失败: ' + err.message);
    } finally {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  });
}
