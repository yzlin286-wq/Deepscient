/**
 * 排版与导出层对外出口。
 *
 * 分成「解析 / 排版 / 渲染 / 检查 / 构建」五段，外面只需要知道 build 与 lint，
 * 其余四个是为了让校验脚本能逐段断言——排版错误定位到段比定位到整条链容易得多。
 */

export { parseYaml, stringifyYaml } from './yaml.js'
export { parseMarkdown, parseInline, inlineText, collectRefs, SECTION_LABELS } from './markdown.js'
export {
  parseSource,
  renderSource,
  loadSource,
  scaffoldSource,
  canonicalSection,
  normalizeAuthor,
  normalizeReference,
  SOURCE_FILE,
  REFERENCES_FILE,
} from './source.js'
export {
  loadCitationStyles,
  styleById,
  styleForPublisher,
  formatAuthors,
  formatReference,
  buildReferenceList,
  formatInText,
  compressNumbers,
  shortAuthorName,
  referenceSlots,
  renderTemplate,
} from './cite.js'
export { loadFormats, familyById, resolveFormat, listFamilies } from './formats.js'
export { renderLatex, escapeLatex } from './latex.js'
export { renderDocx, buildDocxSpec, texToUnicode } from './docx.js'
export { renderJats, escapeXml } from './jats.js'
export { renderHtml } from './html.js'
export { lintManuscript, countWords } from './lint.js'
export {
  buildManuscript,
  checkToolchain,
  ensureClass,
  compileLatex,
  readLatexLog,
} from './build.js'
