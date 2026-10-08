// Computer History responsive rules; DSH tokens remain the color source.
export const RESPONSIVE_STYLES = `
@media(max-width:720px){.ch-main{padding:22px 18px 34px}.ch-first-run{margin-top:24px;padding:20px}.ch-first-run-action{align-items:flex-start;flex-direction:column}.ch-status-line{flex-wrap:wrap;white-space:normal}.ch-state-card{grid-template-columns:40px minmax(0,1fr)}.ch-state-card>.ch-button{grid-column:2;width:max-content}.ch-skeleton-row{grid-template-columns:72px minmax(0,1fr)}.ch-skeleton-row>.ch-skeleton-tiny{display:none}.ch-timeline-item{grid-template-columns:76px minmax(0,1fr)}.ch-timeline-item::after{left:108px}.ch-duration-wrap{grid-column:2;justify-items:start;margin-top:-6px;padding-bottom:8px}.ch-duration-track{width:68px}.ch-timeline-detail{grid-column:2;margin-top:-3px}.ch-thread-item{grid-template-columns:1fr}.ch-thread-meta{white-space:normal}.ch-settings-detail{padding-left:0}.ch-settings-line,.ch-settings-summary{grid-template-columns:36px minmax(0,1fr) auto;gap:10px;padding-left:0;padding-right:0}.ch-settings-icon-wrap,.ch-settings-skeleton-icon{width:32px;height:32px}.ch-settings-icon{width:18px;height:18px}}
@media(max-width:720px){.ch-continuity-head{align-items:flex-start;flex-wrap:wrap}.ch-continuity-head .ch-resume-copy{flex:1 1 220px}.ch-continuity-actions{margin-left:52px;align-items:flex-start;flex-direction:column}.ch-open-app{white-space:normal}}
@media(max-width:560px){.ch-resume-controls{align-items:stretch;flex-direction:column}.ch-resume-controls .ch-input,.ch-resume-controls .ch-button{width:100%}}

/* DSH Settings keeps its sidebar at compact window sizes. At 420px the plugin
   slot can be only 131px wide: stack actions below the labels instead of
   squeezing copy into a single-character column or overflowing the slot. */
@media(max-width:480px){
  .ch-settings-line,.ch-settings-summary{
    grid-template-columns:24px minmax(0,1fr);
    align-items:start;
    gap:6px 7px;
    min-height:0;
    padding:13px 0;
  }
  .ch-settings-icon-wrap,.ch-settings-skeleton-icon{
    grid-column:1;grid-row:1;width:24px;height:24px;
  }
  .ch-settings-icon{width:16px;height:16px}
  .ch-settings-copy,.ch-skeleton-copy{
    grid-column:2;grid-row:1;min-width:0;max-width:100%;
    overflow-wrap:anywhere;
  }
  .ch-settings-line>:last-child:not(.ch-settings-copy),
  .ch-settings-summary>:last-child:not(.ch-settings-copy){
    grid-column:2;grid-row:2;min-width:0;max-width:100%;
    justify-self:start;white-space:normal;
  }
  .ch-settings-value{flex-wrap:wrap;gap:5px;overflow-wrap:anywhere}
  .ch-settings-title,.ch-settings-description{overflow-wrap:anywhere}
  .ch-settings-detail{min-width:0;overflow-wrap:anywhere}
}

/* In compact DSH Settings the plugin gets a narrow column. Stack the
   error icon, explanation and Retry control instead of forcing 3 columns. */
@media(max-width:480px){
  .ch-settings-state{
    display:flex;flex-direction:column;align-items:flex-start;
    gap:8px;min-width:0;max-width:100%;box-sizing:border-box;
    padding:12px 10px;
  }
  .ch-settings-state .ch-state-copy{
    min-width:0;width:100%;overflow-wrap:anywhere;
  }
  .ch-settings-state h2,.ch-settings-state p{
    overflow-wrap:anywhere;
  }
  .ch-settings-state>.ch-button{
    min-width:0;max-width:100%;width:auto;
  }
}

`
