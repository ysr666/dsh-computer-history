// Which extension namespace this engine gives us.
//
// Gecko exposes `browser.*`, where every call returns a promise. Chromium exposes
// `chrome.*`, which also returns promises in MV3. Reading the namespace once here is what
// lets one wiring file run on both engines instead of a second copy written against the
// other API - the copy is where the two would drift, and drift in this file means a page
// report that behaves differently depending on the browser.
//
// `browser` is checked first because Firefox defines both names, and only `browser.*` is
// promise-based there (`chrome.*` in Gecko still expects callbacks).
export const ext = globalThis.browser ?? globalThis.chrome
