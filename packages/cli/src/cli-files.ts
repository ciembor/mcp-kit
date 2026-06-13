export { applyPlan, createOrMergeOperation } from './files/operations.js'
export {
  assertSafeNewTarget,
  detectPackageManager,
  detectProjectContext,
  detectProjectRoot
} from './files/project-context.js'
export {
  exists,
  findTemplateDirectory,
  readJsonFile,
  readTemplateFiles,
  safeReaddir
} from './files/helpers.js'
