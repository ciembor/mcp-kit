export { runCreateMcpKit } from './app/run-create-mcp-kit.js'
export {
  createMcpKitProject,
  type CreateMcpKitOptions
} from './scaffold/create-project.js'
export { packageInfo } from './shared/package-info.js'
export { errorMessage } from './shared/error-message.js'
export { findTemplateDirectory } from './scaffold/template-directory.js'
export { toPackageName } from './shared/package-name.js'

import { errorMessage } from './shared/error-message.js'
import { findTemplateDirectory } from './scaffold/template-directory.js'
import { toPackageName } from './shared/package-name.js'

export const internals = {
  errorMessage,
  findTemplateDirectory,
  toPackageName
}
