/**
 * Resolve the running DSH installation's Session module without a package
 * dependency.
 *
 * A user-installed bundle is linked into the profile, whose `node_modules` does
 * not contain the packages shipped inside the DSH installation. Loading the
 * module by absolute path keeps the seed validation in step with the running
 * Harness, and a missing module only disables validation instead of preventing
 * the plugin from loading.
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** @type {object | null | undefined} */
let cached

/**
 * Load `@deepseek-ai/dsh-session` from the running installation.
 * @param {string} [installDir] - the CLI package directory.
 * @returns {Promise<object | null>} the module, or null when it cannot be found.
 */
export async function loadDshSession(installDir = process.env.DSH_INSTALL_DIR) {
  if (cached !== undefined) return cached
  cached = null
  if (typeof installDir !== 'string' || installDir.length === 0) return cached
  try {
    const require = createRequire(import.meta.url)
    const manifest = require.resolve('@deepseek-ai/dsh-session/package.json', { paths: [dirname(installDir)] })
    cached = await import(pathToFileURL(join(dirname(manifest), 'lib', 'index.js')).href)
  } catch (_unavailable) {
    // Validation is optional; persistence still enforces the stored format.
    cached = null
  }
  return cached
}
