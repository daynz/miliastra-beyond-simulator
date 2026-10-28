import test from 'node:test'
import assert from 'node:assert/strict'
import { searchTree, shapeSnapshot } from '../lib/tree-query.js'

function fixture() {
  const row = (id, name, kind, depth, parentId, extra = {}) => ({
    id, guid: Number(id.replace(/\D/g, '')) || 0, kind, name, label: kind, depth, parentId,
    ancestorIds: parentId ? [parentId] : [], siblingIndex: 0, siblingCount: 1,
    templateId: 'n1', childCount: extra.childCount ?? 0, incomplete: false, ...extra,
  })
  return {
    version: 7,
    canvasId: 'mobile-16-9',
    canvas: { id: 'mobile-16-9', width: 1280, height: 720, platform: 'TouchScreen', label: '手机 16:9' },
    asset: { type: 'server-control-template', label: '服务端控件模板', templateCount: 1, currentTemplateId: '' },
    selectedId: 'n2',
    tree: [
      row('n1', '客户端控件容器', 'server-container', 0, null),
      row('n2', 'GameRoot', 'container', 1, 'n1', { childCount: 3 }),
      row('n3', 'GroupStars', 'container', 2, 'n2', { childCount: 34 }),
      row('n4', 'Star01', 'image', 3, 'n3'),
      row('n5', 'Star02', 'image', 3, 'n3'),
      row('n6', 'Offscreen', 'image', 2, 'n2'),
    ],
    boxes: [
      { id: 'n1', left: 0, bottom: 0, width: 1280, height: 720, centerX: 640, centerY: 360, visible: true },
      { id: 'n2', left: 0, bottom: 0, width: 1280, height: 720, centerX: 640, centerY: 360, visible: true },
      { id: 'n3', left: 100, bottom: 500, width: 200, height: 200, centerX: 200, centerY: 600, visible: true },
      { id: 'n4', left: 110, bottom: 510, width: 6, height: 6, centerX: 113, centerY: 513, visible: true },
      { id: 'n5', left: 130, bottom: 510, width: 6, height: 6, centerX: 133, centerY: 513, visible: true },
      { id: 'n6', left: 5000, bottom: 5000, width: 10, height: 10, centerX: 5005, centerY: 5005, visible: true },
    ],
    scripts: [
      { id: 's1', guid: 9, path: 'tetris/main.lua', controlId: 'n2', controlName: 'GameRoot', mounted: true, source: 'line1\nline2\n' },
      { id: 's2', guid: 10, path: 'tetris/src/01_config.lua', controlId: '', controlName: '', mounted: false, source: 'x = 1\n' },
    ],
    mountTargets: [{ id: 'n2', name: 'GameRoot' }],
    scriptSync: { version: 1, workspaceDir: '', clientImportRoot: '/tmp/import', clientSubdir: '' },
    root: { id: 'n1', children: [] },
  }
}

test('tree_search：按名称子串、类型、父级过滤，并返回紧凑字段', () => {
  const snap = fixture()
  const byName = searchTree(snap, { name: 'star' })
  assert.equal(byName.matched, 3) // GroupStars 也含 star
  assert.deepEqual(byName.rows.map((row) => row.name), ['GroupStars', 'Star01', 'Star02'])
  assert.deepEqual(Object.keys(byName.rows[0]).sort(), ['childCount', 'depth', 'id', 'kind', 'name', 'parentId'])
  assert.equal(byName.revision, 7)
  assert.equal(byName.canvas.width, 1280)

  const byKind = searchTree(snap, { kind: 'image', parentId: 'n3' })
  assert.deepEqual(byKind.rows.map((row) => row.id), ['n4', 'n5'])

  const noMatch = searchTree(snap, { name: '不存在' })
  assert.equal(noMatch.matched, 0)
  assert.deepEqual(noMatch.rows, [])
})

test('tree_search：limit 截断、box 字段、inViewport 过滤掉画布外控件', () => {
  const snap = fixture()
  const limited = searchTree(snap, { kind: 'image', limit: 1 })
  assert.equal(limited.matched, 3)
  assert.equal(limited.rows.length, 1)
  assert.equal(limited.truncated, true)

  const withBox = searchTree(snap, { name: 'Star01', fields: ['id', 'name', 'box'] })
  assert.deepEqual(withBox.rows[0].box, { left: 110, bottom: 510, width: 6, height: 6, centerX: 113, centerY: 513, visible: true })

  const visible = searchTree(snap, { kind: 'image', inViewport: true })
  assert.ok(!visible.rows.some((row) => row.name === 'Offscreen'))
  assert.deepEqual(visible.rows.map((row) => row.name), ['Star01', 'Star02'])
})

test('get summary：tree 支持 depth 截断与字段投影，且不再携带 root/boxes', () => {
  const snap = fixture()
  const shallow = shapeSnapshot(snap, { summary: 'tree', depth: 1 })
  assert.equal(shallow.total, 6)
  assert.deepEqual(shallow.tree.map((row) => row.id), ['n1', 'n2'])
  assert.equal(shallow.root, undefined)
  assert.equal(shallow.boxes, undefined)

  const projected = shapeSnapshot(snap, { summary: 'tree', depth: 2, fields: ['name', 'kind'] })
  assert.deepEqual(Object.keys(projected.tree[0]).sort(), ['kind', 'name'])
  assert.equal(projected.revision, 7)
})

test('get summary：inspector / scripts / none 各自的口径', () => {
  const snap = fixture()
  const inspector = shapeSnapshot(snap, { summary: 'inspector' })
  assert.equal(inspector.inspector, snap.inspector)
  assert.equal(inspector.selectedBox.centerX, 640)
  assert.equal(inspector.tree, undefined)

  const scripts = shapeSnapshot(snap, { summary: 'scripts' })
  assert.equal(scripts.scripts.length, 2)
  assert.equal(scripts.scripts[0].path, 'tetris/main.lua')
  assert.equal(scripts.scripts[0].source, undefined)
  assert.equal(scripts.scripts[0].sourceLines, 3)
  assert.equal(scripts.scripts[0].mounted, true)
  assert.deepEqual(scripts.scriptSync, snap.scriptSync)

  const none = shapeSnapshot(snap, { summary: 'none' })
  assert.deepEqual(Object.keys(none).sort(), ['asset', 'canvas', 'canvasId', 'revision', 'selectedId'])

  // 默认 full 完全向后兼容
  assert.equal(shapeSnapshot(snap), snap)
  assert.equal(shapeSnapshot(snap, { summary: 'full' }), snap)
})
