const CSS = `
.ch-main{box-sizing:border-box;max-width:920px;margin:0 auto;padding:24px;color:var(--dsw-alias-label-primary)}
.ch-main h1{margin:0 0 4px;font-size:24px;line-height:1.3}
.ch-subtitle{margin:0 0 18px;color:var(--dsw-alias-label-secondary);line-height:1.55}
.ch-section{padding-top:18px;margin-bottom:26px;border-top:1px solid var(--dsw-alias-border-l1)}
.ch-section-title{margin:0 0 8px;font-size:17px;line-height:1.4}
.ch-muted{color:var(--dsw-alias-label-secondary);line-height:1.55}
.ch-status{margin:0 0 18px;line-height:1.55}
.ch-alert{margin:0 0 18px;padding:10px 12px;border-left:3px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);border-radius:0 10px 10px 0}
/* One concept, many values: the allowed-application list is dense, bounded and scrollable, so the rows
   after it stay on screen. Previously each id was its own full-height row with a 36px button, and the list
   pushed retention, deletion, the companion and about below the fold. */
.ch-settings-list{list-style:none;margin:0;padding:0}
.ch-list{list-style:none;margin:8px 0 0;padding:0;max-height:168px;overflow:auto}
.ch-list>li{display:flex;align-items:center;gap:8px;padding:1px 0}
.ch-list .ch-row-body{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.ch-list .ch-button{height:24px;padding:0 8px;border-radius:8px;font-size:12px;font-weight:400}
/* The native anatomy, read off the Host's own rows: line one carries the label and its control, line two
   carries the description at full width ("字号大小 / 仅影响会话内容的字号"). The first version stacked
   everything under the text; a grid then squeezed the description into a narrow column whenever the control
   was wide. Order does it without touching any view: title and control share line one, the body follows. */
.ch-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.ch-row>.ch-row-title{order:1;flex:1 1 auto;min-width:0}
.ch-row>.ch-controls{order:2;flex:0 0 auto;margin-top:0;margin-left:auto}
.ch-row>.ch-row-body,.ch-row>.ch-feedback{order:3;flex:1 1 100%}
.ch-row>.ch-feedback{margin-top:0}
/* the allowed-application list is not a row: keep id and action on one line */
.ch-list>li>.ch-row-body{order:0;flex:0 1 auto}
/* the id list is this row's body: its own full-width line under the title */
.ch-row>.ch-list{order:3;flex:1 1 100%;margin-top:0}
.ch-row:first-child{border-top:0}
.ch-row-title{margin:0;font-size:14px;font-weight:600;line-height:1.5}
.ch-row-body{margin:4px 0 0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.ch-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.ch-button{appearance:none;height:36px;padding:0 14px;border:0;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:500;cursor:pointer}
.ch-button:hover:not(:disabled){filter:brightness(.97)}
.ch-button:focus-visible,.ch-text-action:focus-visible,.ch-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ch-button:disabled{opacity:.5;cursor:default}
.ch-button-danger{color:var(--dsw-alias-state-error-primary);background:transparent;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
`

const CSS_MORE = `
.ch-input{box-sizing:border-box;height:36px;min-width:0;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px}
.ch-input-small{width:96px}
.ch-field-label{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.ch-code{display:block;box-sizing:border-box;max-width:100%;margin:8px 0 0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);overflow-x:auto;font-size:12px}
.ch-feedback{margin:8px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-success-primary)}
.ch-feedback-error{color:var(--dsw-alias-state-error-primary)}
.ch-timeline-day{margin:0 0 14px}
.ch-timeline-heading{margin:0 0 5px;font-size:14px;font-weight:600}
.ch-timeline-list{list-style:none;margin:0;padding:0}
.ch-timeline-item{display:flex;align-items:baseline;gap:8px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.ch-timeline-item:first-child{border-top:0}
.ch-duration{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ch-text-action{appearance:none;min-width:0;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.ch-text-action:hover{text-decoration:underline;text-decoration-color:var(--dsw-alias-brand-primary)}
.ch-detail{margin-top:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.ch-resume-controls{display:flex;gap:8px;align-items:center}.ch-resume-controls .ch-input{flex:1}
@media(max-width:640px){.ch-main{padding:18px}.ch-resume-controls{align-items:stretch;flex-direction:column}.ch-resume-controls .ch-input,.ch-resume-controls .ch-button{width:100%}}
`

let stylesInstalled = false

export function installHistoryStyles(): () => void {
  if (stylesInstalled || typeof document === 'undefined') return () => {}
  stylesInstalled = true
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-computer-history'
  tag.textContent = CSS + CSS_MORE
  document.head.appendChild(tag)
  return () => {
    tag.remove()
    stylesInstalled = false
  }
}
