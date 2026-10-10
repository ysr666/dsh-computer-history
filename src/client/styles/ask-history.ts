export const ASK_HISTORY_STYLES = `
.ch-ask-panel{margin-top:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.ch-ask-panel>.ch-muted{margin:6px 0 0;line-height:1.5;font-size:11px}
.ch-ask-toggle{font-size:13px;font-weight:650}
.ch-ask-body{padding-top:12px}
.ch-ask-form{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ch-ask-input{min-width:0;max-width:100%;box-sizing:border-box;flex:1 1 250px}
.ch-ask-results{list-style:none;margin:9px 0 0;padding:0;display:grid;gap:8px}
.ch-ask-hit{padding:10px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
.ch-ask-hit-top{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap;font-size:12px}
.ch-ask-hit-top strong{overflow-wrap:anywhere}
.ch-ask-kind{font-size:10px;font-weight:650;color:var(--dsw-alias-label-secondary)}
.ch-ask-hit>.ch-muted{font-size:11px;margin:6px 0 0}
.ch-ask-hit>.ch-text-action{margin-top:7px;min-height:28px}
.ch-ask-hit>.ch-button{margin:7px 0 0 10px;min-height:30px;padding:0 11px;font-size:11px}
.ch-ask-exact{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.ch-ask-exact>.ch-muted{margin:0 0 8px;font-size:11px;line-height:1.5}
.ch-ask-exact .ch-ask-input{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.ch-ask-exact .ch-ask-source>.ch-button{margin-top:8px}
.ch-ask-source{margin:10px 0 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;font-size:12px;overflow-wrap:anywhere}
.ch-ask-source>p{margin:6px 0;white-space:pre-wrap}
.ch-ask-exact-preview{display:flex;flex-direction:column;align-items:stretch;gap:8px;min-width:0}
.ch-ask-exact-preview>p{margin:0;min-width:0;overflow-wrap:anywhere}
.ch-ask-source-id{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary);user-select:text}
.ch-ask-source-meta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.ch-ask-source-summary{font-size:12px;line-height:1.55}
.ch-ask-source-resources{margin:0;padding:0;list-style:none;display:grid;gap:4px;min-width:0}
.ch-ask-source-resources li{padding:5px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.ch-ask-source-caution{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.ch-ask-exact-preview>.ch-button{align-self:flex-start;min-height:32px}

@media(max-width:560px){.ch-ask-panel{padding:12px}.ch-ask-form{min-width:0}.ch-ask-form>.ch-button{max-width:100%;width:100%;white-space:normal;overflow-wrap:anywhere}.ch-ask-form>.ch-input{flex:1 1 100%;width:100%;min-width:0}.ch-ask-hit>.ch-button{margin-left:0;max-width:100%;white-space:normal;overflow-wrap:anywhere}.ch-ask-exact-preview>.ch-button{width:100%;max-width:100%;white-space:normal;overflow-wrap:anywhere}}
`
