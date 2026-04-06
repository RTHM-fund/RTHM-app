if (process.platform !== 'darwin') process.exit(0)
const path = require('path')
const fs = require('fs')
const dir = path.join(__dirname, '..', '..')
try { fs.chmodSync(path.join(dir, 'RTHM Setup.command'), 0o755) } catch {}
try { fs.chmodSync(path.join(dir, 'RTHM Launch.command'), 0o755) } catch {}
