// MCP 快照裁剪：`qxqy_studio_get` 的 summary/depth/fields 与 `qxqy_tree_search` 共用。
// 完整快照里 root/boxes/scripts.source 很大，一次 get 常常塞满上下文；
// 这里只做投影，不改任何数值语义，也不做布局计算。

export const TREE_FIELDS = [
  'id', 'guid', 'name', 'kind', 'label', 'depth', 'parentId', 'childCount',
  'siblingIndex', 'siblingCount', 'templateId', 'incomplete', 'box',
]

const DEFAULT_SEARCH_FIELDS = ['id', 'name', 'kind', 'depth', 'parentId', 'childCount']

const round = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : value)

function boxesOf(snapshot) {
  return Array.isArray(snapshot?.boxes) ? snapshot.boxes : []
}

function boxOf(snapshot, id) {
  return boxesOf(snapshot).find((box) => box.id === id) || null
}

function pickBox(box) {
  if (!box) return null
  return {
    left: round(box.left),
    bottom: round(box.bottom),
    width: round(box.width),
    height: round(box.height),
    centerX: round(box.centerX),
    centerY: round(box.centerY),
    visible: box.visible !== false,
  }
}

function pickRow(snapshot, row, fields) {
  const out = {}
  for (const field of fields) {
    out[field] = field === 'box' ? pickBox(boxOf(snapshot, row.id)) : row[field] ?? null
  }
  return out
}

function normalizeFields(fields) {
  if (!Array.isArray(fields) || !fields.length) return null
  const allowed = fields.filter((field) => TREE_FIELDS.includes(field))
  return allowed.length ? allowed : null
}

// 盒子是否与画布相交：部分露出也算在视口内（用于「只看画面上的控件」）。
function intersectsCanvas(box, width, height) {
  if (!box) return false
  if (!(box.width > 0) || !(box.height > 0)) return false
  return box.left < width && box.left + box.width > 0 && box.bottom < height && box.bottom + box.height > 0
}

export function searchTree(snapshot, options = {}) {
  const rows = Array.isArray(snapshot?.tree) ? snapshot.tree : []
  const name = String(options.name || '').trim().toLowerCase()
  const kind = String(options.kind || '').trim()
  const parentId = String(options.parentId || '').trim()
  const limit = Math.max(1, Math.min(Number.isFinite(Number(options.limit)) ? Math.trunc(Number(options.limit)) : 20, 200))
  const fields = normalizeFields(options.fields) || DEFAULT_SEARCH_FIELDS
  const canvas = snapshot?.canvas || {}
  const width = Number(canvas.width) || 0
  const height = Number(canvas.height) || 0
  const inViewport = options.inViewport === true

  const matched = []
  for (const row of rows) {
    if (name && !String(row.name || '').toLowerCase().includes(name)) continue
    if (kind && row.kind !== kind) continue
    if (parentId && row.parentId !== parentId) continue
    if (inViewport && !intersectsCanvas(boxOf(snapshot, row.id), width, height)) continue
    matched.push(pickRow(snapshot, row, fields))
  }
  return {
    revision: snapshot?.version,
    canvas: { id: canvas.id || '', width, height },
    matched: matched.length,
    returned: Math.min(matched.length, limit),
    truncated: matched.length > limit,
    rows: matched.slice(0, limit),
  }
}

function scriptSummary(script) {
  const source = String(script?.source || '')
  return {
    id: script?.id || '',
    guid: script?.guid || 0,
    path: script?.path || '',
    controlId: script?.controlId || '',
    controlName: script?.controlName || '',
    mounted: Boolean(script?.mounted),
    sourceBytes: Buffer.byteLength(source, 'utf8'),
    sourceLines: source ? source.split('\n').length : 0,
  }
}

export function shapeSnapshot(snapshot, options = {}) {
  if (!snapshot) return snapshot
  const summary = String(options.summary || 'full').trim().toLowerCase()
  const depth = Number.isFinite(Number(options.depth)) && options.depth !== null && options.depth !== ''
    ? Math.max(0, Math.trunc(Number(options.depth)))
    : null
  const fields = normalizeFields(options.fields)
  if (summary === 'full' || summary === '') return snapshot

  const head = {
    revision: snapshot.version,
    canvasId: snapshot.canvasId,
    canvas: snapshot.canvas,
    asset: snapshot.asset,
    selectedId: snapshot.selectedId,
  }
  if (summary === 'none') return head
  if (summary === 'inspector') {
    const selectedBox = boxesOf(snapshot).find((box) => box.id === snapshot.selectedId) || null
    return { ...head, inspector: snapshot.inspector, selectedBox: pickBox(selectedBox) }
  }
  if (summary === 'scripts') {
    return {
      ...head,
      scripts: (Array.isArray(snapshot.scripts) ? snapshot.scripts : []).map(scriptSummary),
      mountTargets: snapshot.mountTargets,
      scriptSync: snapshot.scriptSync,
    }
  }
  // summary = tree：只回控件树（可按 depth 截断、按 fields 投影）
  const allRows = Array.isArray(snapshot.tree) ? snapshot.tree : []
  const rows = (depth === null ? allRows : allRows.filter((row) => row.depth <= depth))
    .map((row) => (fields ? pickRow(snapshot, row, fields) : row))
  return { ...head, total: allRows.length, tree: rows }
}
