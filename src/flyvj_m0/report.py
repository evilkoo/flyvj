"""Standalone, escaped, offline HTML report; no JavaScript or external assets."""
from html import escape


def _text(value):
    return escape(str(value), quote=True)


def render_report(state):
    status = state.get("status", "BLOCKED")
    badge = "pass" if status == "PASSED" else "running" if status == "RUNNING" else "blocked"
    tests = state.get("tests_run", "—")
    steps = []
    for step in state.get("steps", []):
        logs = " ".join(f'<a href="{_text(path)}">{_text(PathName(path))}</a>'
                        for path in (step.get("stdout_log"), step.get("stderr_log")) if path)
        steps.append("<tr>" +
                     f'<td>{_text(step.get("title", step.get("id", "")))}</td>' +
                     f'<td class="mono">{_text(step.get("status", "NOT_RUN"))}</td>' +
                     f'<td class="mono">{_text(step.get("exit_code", "—"))}</td>' +
                     f'<td>{logs or "—"}</td></tr>')
    mock = state.get("mock_result", {})
    proposals = []
    for event, decision in zip(mock.get("events", []), mock.get("decisions", [])):
        proposals.append(f'<tr><td class="mono">{_text(event.get("event_id", ""))}</td>'
                         f'<td class="mono">{_text(event.get("energy", ""))}</td>'
                         f'<td class="mono">Column {_text(decision.get("column", ""))}</td>'
                         '<td><span class="recorded">只記錄，冇播出</span></td></tr>')
    error = state.get("error")
    failure = f'<section class="failure"><h2>停止原因</h2><pre>{_text(error)}</pre></section>' if error else ""
    next_action = state.get("next_action", "先檢查今次報告，同未確認項目。")
    manual = state.get("manual_qc", {})
    manual_status = _text(manual.get("status", "NOT_RUN"))
    manual_evidence = "".join(f"<li>{_text(item)}</li>" for item in manual.get("evidence", []))
    manual_details = f"<ul>{manual_evidence}</ul>" if manual_evidence else '<p class="muted">未有 runner 可確認嘅獨立覆核證據；另睇主管報告。</p>'
    is_data = state.get("stage") == "M1"
    stage_label = "M1" if is_data else "M0"
    page_title = "M1 神經資料接口驗證" if is_data else "M0 安全骨架驗證"
    subtitle = "共用 dataset → Engine ID → View packet → 真資料關卡" if is_data else "Mock 事件 → Column 候選 → OSC spy → 測試報告"
    notice = ("只用 3 個 synthetic 神經測試 ID / 座標 / activity 對應；唔係生物腦、3D renderer 或神經模擬。" if is_data
              else "只用合成事件；冇讀 Mic、冇發 OSC、冇控制鍵鼠，亦未載入真實大腦。")
    interface = state.get("interface_status", "NOT_RUN")
    extra_badge = (f'<div class="badge {"pass" if interface == "PASSED" else "blocked"}">接口檢查 {_text(interface)}</div>' if is_data else "")
    gate_step = next((step for step in state.get("steps", []) if step.get("id") == "real_data"), {})
    gate_status = gate_step.get("status", "NOT_RUN")
    status_text = gate_status if is_data else status
    status_label = "真資料關卡" if is_data else "自動檢查"
    card_label = "Synthetic 神經" if is_data else "Mock 事件"
    data = state.get("data_result", {})
    real = state.get("real_data_result", {})
    real_passed = is_data and gate_status == "PASSED" and real.get("status") == "PASSED" and real.get("provenance_verified") is True
    if real_passed:
        data = real
        card_label = "真實 point sample 神經"
        notice = "接口 + real point graph sample PASSED；activity 係 synthetic mock，唔係生物 firing。full morphology 未完成；唔係 3D 大腦或神經模擬。"
    card_value = data.get("neuron_count", 0) if is_data else len(mock.get("events", []))
    real_status = gate_status if is_data else "NOT IMPLEMENTED"
    if is_data:
        rows = []
        for row in data.get("rows", []):
            rows.append(f'<tr><td class="mono">{_text(row.get("neuron_id", ""))}</td>'
                        f'<td class="mono">{_text(row.get("engine_index", ""))}</td><td class="mono">{_text(row.get("view_index", ""))}</td>'
                        f'<td class="mono">{_text(row.get("position", ""))}</td><td class="mono">{_text(row.get("activation", ""))}</td>'
                        f'<td>{"對得上" if row.get("matched") is True else "未確認"}</td></tr>')
        records_section = f'''<section><h2>{"真實 point sample" if real_passed else "Synthetic"} 神經 ID 對照</h2>
<p class="muted">View order 故意反轉；Engine index 唔等於 View index。用同一個 ID 查幾何同 activity，唔靠 array 位置。</p>
<p class="muted">座標：{_text(data.get("units", "未確認"))} / {_text(data.get("coordinate_frame", "未確認"))}。冇單位轉換；唔係實際 3D 畫面。</p>
<div class="table-wrap"><table style="min-width:680px"><thead><tr><th>Neuron ID</th><th>Engine index</th><th>View index</th><th>Position</th><th>Activity</th><th>ID 核對</th></tr></thead>
<tbody>{"".join(rows) or '<tr><td colspan="6">接口對照未完成</td></tr>'}</tbody></table></div>
<p class="muted" style="margin-top:12px">窄畫面可左右捲動表格。Fingerprint：<span class="mono">{_text(str(data.get("dataset_fingerprint", "未產生"))[:16])}</span></p></section>'''
        if real_passed:
            evidence = data.get("evidence", {})
            records_section += f'''<section><h2>離線來源 receipt / 限定 scope</h2>
<p>Scope：{_text(data.get("source_scope"))}；weighted edges：{_text(data.get("connection_count"))}</p>
<p>Receipt：{_text(evidence.get("evidence_id"))}；source files verified：{_text(evidence.get("source_files_verified"))}</p>
<p>Region semantics：{_text(evidence.get("region_semantics"))}</p>
<p>Weight semantics：{_text(evidence.get("weight_semantics"))}</p>
<p>Activity：synthetic mock，唔係生物 firing；full morphology：NOT IMPLEMENTED。只係 marked points，唔代表 soma／完整形態／完整 connectome。</p></section>'''
    else:
        records_section = f'''<section><h2>Mock 場景候選</h2><p class="muted">只驗證事件同記錄鏈路，唔代表已識分析音樂或揀得好。</p><div class="table-wrap"><table><thead><tr><th>Event ID</th><th>合成能量</th><th>候選</th><th>播出狀態</th></tr></thead><tbody>{"".join(proposals) or '<tr><td colspan="4">未完成 mock 驗證</td></tr>'}</tbody></table></div></section>'''
    run_id = _text(state.get("run_id", "未有 run ID"))
    finished = _text(state.get("finished_at") or state.get("created_at", "—"))
    return f'''<!doctype html>
<html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>烏蠅 VJ · {stage_label} 報告</title><style>
:root{{color-scheme:dark;--bg:#101419;--panel:#191f27;--line:#35404c;--ink:#eef2f6;--muted:#bac6d1;--accent:#80ded1}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 'Segoe UI','Microsoft JhengHei',sans-serif}}
main{{max-width:1160px;margin:0 auto;padding:42px 30px 28px}}a{{color:var(--accent);text-decoration:underline;text-underline-offset:3px}}
a:focus-visible{{outline:3px solid #fff;outline-offset:4px}}.kicker{{color:var(--accent);letter-spacing:.1em;font-size:12px;font-weight:700}}
header{{display:flex;justify-content:space-between;align-items:center;gap:24px}}h1{{font-size:32px;line-height:1.2;margin:8px 0 12px}}h2{{font-size:19px;margin:0 0 16px}}
p{{margin:0 0 10px}}.muted{{color:var(--muted)}}.mono{{font-family:Consolas,monospace}}.badge{{padding:9px 15px;border:1px solid;border-radius:6px;font-weight:700;white-space:nowrap}}
.pass{{color:#a5edc5;background:#173026;border-color:#3b7057}}.blocked{{color:#ffbbb4;background:#3a2021;border-color:#9b5550}}.running{{color:#ffe0a5;background:#342a19;border-color:#7d6538}}
.notice{{border-left:4px solid var(--accent);padding:16px 20px;background:#16272a;margin:24px 0}}.stats{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}}
.stat{{border:1px solid var(--line);background:var(--panel);padding:17px 18px;border-radius:6px}}.stat strong{{display:block;font-size:29px;line-height:1.25;margin-top:6px}}
section{{border:1px solid var(--line);background:var(--panel);padding:22px;border-radius:6px;margin:18px 0}}.table-wrap{{overflow-x:auto}}
table{{width:100%;border-collapse:collapse;text-align:left;font-size:14px}}th{{color:var(--muted);font-weight:600;font-size:12px}}th,td{{padding:12px 10px;border-bottom:1px solid var(--line)}}tbody tr:last-child td{{border-bottom:0}}
.recorded{{color:#c5d2df}}.limits{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 24px;color:var(--muted)}}.limits div{{display:flex;justify-content:space-between;gap:16px;padding:8px 0}}
.limits b{{color:#ffe0a5;font:12px/1.6 Consolas,monospace;white-space:nowrap}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 Consolas,monospace}}
.failure{{border-color:#9b5550}}footer{{font-size:12px;color:var(--muted);overflow-wrap:anywhere;margin-top:22px}}.next{{border-left:3px solid var(--accent);padding-left:16px;margin-top:24px}}
@media(max-width:720px){{main{{padding:24px 16px}}header{{align-items:flex-start;flex-direction:column;gap:12px}}h1{{font-size:27px}}.stats{{grid-template-columns:repeat(2,minmax(0,1fr))}}.limits{{grid-template-columns:1fr}}section{{padding:16px}}}}
</style></head><body><main>
<header><div><div class="kicker">烏蠅 VJ / AUTO BUILD 0.1</div><h1>{page_title}</h1><p class="muted">{subtitle}</p></div><div>{extra_badge}<div class="badge {badge}" style="margin-top:8px">{status_label} {_text(status_text)}</div></div></header>
<div class="notice"><strong>呢次係 dry-run，唔係現場播出。</strong><br>{notice}</div>
<div class="stats"><div class="stat"><span class="muted">Unit tests</span><strong class="mono">{_text(tests)}</strong></div><div class="stat"><span class="muted">{card_label}</span><strong class="mono">{_text(card_value)}</strong></div><div class="stat"><span class="muted">真 OSC 封包</span><strong class="mono">0</strong></div><div class="stat"><span class="muted">鍵鼠注入</span><strong class="mono">0</strong></div></div>
{failure}
<section><h2>自動驗證結果</h2><div class="table-wrap"><table><thead><tr><th>檢查</th><th>狀態</th><th>Exit code</th><th>證據</th></tr></thead><tbody>{"".join(steps) or '<tr><td colspan="4">未有檢查結果</td></tr>'}</tbody></table></div></section>
{records_section}
<section><h2>未驗證 / 後續關卡</h2><div class="limits"><div><span>{"真實 point sample（非完整形態）" if is_data else "真實大腦資料"}</span><b>{_text(real_status)}</b></div><div><span>Mic / Internal 分析</span><b>NOT IMPLEMENTED</b></div><div><span>3D 畫面 / GPU 效能</span><b>NOT IMPLEMENTED</b></div><div><span>Resolume 連線</span><b>NOT CONNECTED</b></div></div><p class="muted" style="margin-top:14px">Code QC 同截圖 Vision QC 由主管另行確認；runner 唔會自動將佢哋標為已完成。</p></section>
<section><h2>獨立 QC 狀態：<span class="mono">{manual_status}</span></h2>{manual_details}</section>
<div class="next"><strong>下一步</strong><p>{_text(next_action)}</p></div>
<footer>Run ID：<span class="mono">{run_id}</span> · {finished}<br>{stage_label} 接口／自動檢查 ≠ 真實大腦或完整 prototype 已完成。<a href="state.json">機器可讀 state.json</a></footer>
</main></body></html>'''


def PathName(path):
    return str(path).replace("\\", "/").split("/")[-1]