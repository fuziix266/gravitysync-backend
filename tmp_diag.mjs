import pg from 'pg';
import fs from 'fs';

const c = new pg.Client('postgresql://user:Admin%40123@62.146.181.70:1313/gravitychat');
await c.connect();

const r = await c.query(`
  SELECT id, session_id, section_type, text, has_code, created_at, uuid
  FROM chat_messages ORDER BY id ASC
`);

const esc = (s) => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

let html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>GravityChat Diagnóstico</title>
<style>
  body { font-family: 'Segoe UI', monospace; background: #1a1a2e; color: #e0e0e0; padding: 20px; max-width: 900px; margin: 0 auto; }
  h1 { color: #00ff88; }
  .msg { margin: 6px 0; padding: 10px 14px; border-radius: 8px; border-left: 4px solid #444; }
  .msg.user { background: #1e3a5f; border-left-color: #4a9eff; }
  .msg.response { background: #1a2e1a; border-left-color: #00ff88; }
  .msg.thinking { background: #2e1a1a; border-left-color: #ff6666; opacity: 0.5; }
  .msg.code { background: #2e2e1a; border-left-color: #ffaa00; }
  .meta { font-size: 11px; color: #888; margin-bottom: 4px; }
  .text { white-space: pre-wrap; word-break: break-word; max-height: 150px; overflow: auto; font-size: 13px; line-height: 1.4; }
  .label { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; }
  .label.user { background: #4a9eff; color: white; }
  .label.response { background: #00ff88; color: black; }
  .label.thinking { background: #ff6666; color: white; }
  .stats { background: #222; padding: 12px; border-radius: 8px; margin: 12px 0; }
  .filter-bar { position: sticky; top: 0; background: #1a1a2e; padding: 8px; z-index: 10; border-bottom: 2px solid #333; }
  .filter-bar button { margin: 2px; padding: 4px 10px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; }
</style></head><body>
<h1>📊 Diagnóstico Post-Limpieza</h1>
<p>Generado: ${new Date().toISOString()}</p>`;

const stats = {};
r.rows.forEach(row => { stats[row.section_type] = (stats[row.section_type] || 0) + 1; });

html += `<div class="stats"><b>Total: ${r.rows.length}</b> — ${Object.entries(stats).map(([k,v]) => `<span class="label ${k}">${k}: ${v}</span>`).join(' ')}</div>`;

html += `<div class="filter-bar">
  <button onclick="f('all')" style="background:#666;color:white">Todos (${r.rows.length})</button>
  <button onclick="f('user')" style="background:#4a9eff;color:white">User (${stats.user||0})</button>
  <button onclick="f('response')" style="background:#00ff88;color:black">Response (${stats.response||0})</button>
</div>`;

html += `<div id="m">`;
for (const row of r.rows) {
  const type = row.section_type || 'unknown';
  const text = row.text || '';
  const preview = esc(text.substring(0, 400));
  html += `<div class="msg ${type}" data-t="${type}">
    <div class="meta"><span class="label ${type}">${type}</span> #${row.id} | ${(row.session_id||'').substring(0,8)} | ${row.created_at}</div>
    <div class="text">${preview}${text.length > 400 ? '…' : ''}</div>
  </div>`;
}
html += `</div>
<script>function f(t){document.querySelectorAll('.msg').forEach(e=>{e.style.display=(t==='all'||e.dataset.t===t)?'':'none'})}</script>
</body></html>`;

const outPath = 'C:/xampp_php8/htdocs/gravitychat/diagnostico_mensajes.html';
fs.writeFileSync(outPath, html);
console.log(`✅ Diagnóstico: ${outPath}`);
console.log(`Total: ${r.rows.length}`, stats);
await c.end();
