// The companion's background entry, for both engines.
//
// Chromium loads this file as an MV3 service worker (`background.service_worker`); Gecko
// loads the same file as an MV3 event page (`background.scripts` + `type: module`). One
// entry file, one implementation behind it: the manifests differ, the behaviour does not.
import { startCompanion } from './background.js'

startCompanion()
