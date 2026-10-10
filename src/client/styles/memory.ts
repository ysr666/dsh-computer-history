// Work Memory is secondary to the work timeline and uses only Host design tokens.
export const MEMORY_STYLES = `
.ch-work-memory{
  margin-top:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);
  border-radius:12px;background:var(--dsw-alias-bg-layer-1);min-width:0
}
.ch-memory-toggle{font-weight:650;font-size:12px}
.ch-work-memory-body{margin-top:11px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);min-width:0}
.ch-work-memory-body>h3,.ch-work-memory .ch-inspector>h3{
  margin:16px 0 8px;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:650
}
.ch-memory-note-list{list-style:none;display:grid;gap:8px;padding:0;margin:8px 0 12px}
.ch-memory-note-card{
  min-width:0;padding:11px 12px;border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;background:var(--dsw-alias-bg-layer-2)
}
.ch-memory-note-body{min-width:0}
.ch-memory-note-body>strong{color:var(--dsw-alias-label-primary);font-size:12px}
.ch-memory-note-body>p{margin:5px 0;font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.ch-memory-note-card .ch-controls{margin-top:10px}
.ch-memory-textarea{
  box-sizing:border-box;display:block;width:100%;min-width:0;min-height:78px;resize:vertical;
  padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);
  border-radius:9px;background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5
}
.ch-memory-textarea:focus-visible,.ch-memory-checkbox input:focus-visible{
  outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px
}
.ch-memory-checkbox{display:flex;align-items:flex-start;gap:8px;margin:11px 0;font-size:12px;
  line-height:1.5;color:var(--dsw-alias-label-secondary)}
.ch-memory-checkbox input{flex:0 0 auto;margin-top:3px;accent-color:var(--dsw-alias-brand-primary)}
.ch-memory-list{list-style:none;display:grid;gap:0;min-width:0;margin:8px 0;padding:0}
.ch-memory-list>li{
  display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;
  min-width:0;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1);
  font-size:12px;line-height:1.55;overflow-wrap:anywhere
}
.ch-memory-list>li:first-child{border-top:0}
.ch-memory-list>li p{flex-basis:100%;margin:1px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.ch-memory-list>li strong{font-size:12px}
.ch-memory-list>li>button{min-width:0;overflow-wrap:anywhere}
/* Suggestions are evidence cards, not executable or installed Skills. */
.ch-skill-section{margin-top:17px;padding:12px;border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.ch-skill-section h3{font-size:12px;margin:0 0 6px}
.ch-skill-section>.ch-muted{font-size:11px;line-height:1.55}
.ch-skill-list{list-style:none;display:grid;gap:9px;margin:10px 0 0;padding:0}
.ch-skill-candidate{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;
  padding:12px;background:var(--dsw-alias-bg-layer-2);min-width:0;font-size:12px}
.ch-skill-candidate>strong{display:block;font-size:12px;line-height:1.5}
.ch-skill-candidate>p{margin:7px 0;line-height:1.6}
.ch-skill-subtitle{margin-top:9px;color:var(--dsw-alias-label-secondary)}
.ch-skill-missing{padding-left:20px;margin:6px 0 9px;line-height:1.6}
.ch-skill-evidence{padding-top:7px;display:flex;flex-direction:column;gap:4px;min-width:0}
.ch-skill-evidence code{font-size:10px;white-space:normal;overflow-wrap:anywhere}
/* Advisory links never resemble confirmed thread membership. */
.ch-memory-link-list{list-style:none;display:grid;gap:7px;margin:8px 0 15px;padding:0}
.ch-memory-link-list>li{display:flex;flex-wrap:wrap;gap:5px 9px;align-items:baseline;
  padding:10px 12px;border-radius:9px;border:1px dashed var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);font-size:12px;min-width:0;overflow-wrap:anywhere}
.ch-memory-link-list>li strong{font-weight:600;min-width:0;overflow-wrap:anywhere}
.ch-memory-link-list>li .ch-muted{font-size:11px;overflow-wrap:anywhere}
.ch-memory-link-list>li p{margin:2px 0;flex-basis:100%;word-break:break-all}
.ch-memory-link-evidence{flex-basis:100%;min-width:0;border-top:1px solid var(--dsw-alias-border-l1);
  margin-top:6px;padding-top:7px}
.ch-memory-link-evidence p{margin:5px 0;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.ch-memory-link-label{font-size:10px;font-weight:650;color:var(--dsw-alias-label-secondary)}
.ch-memory-share{margin-top:12px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px}
.ch-memory-share>.ch-muted{line-height:1.6;margin:0 0 8px}
.ch-memory-code{display:block;width:100%;max-width:420px;margin:6px 0 9px;font:inherit}
@media(max-width:560px){
  .ch-work-memory{padding:12px}
  .ch-work-memory-body .ch-button{max-width:100%;white-space:normal;text-align:center}
}
`
