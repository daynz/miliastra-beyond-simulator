import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudio } from '../index.js'
import { inspectGia } from '../gia/codec.js'

function studioWithPrefab() {
  const studio = createStudio()
  let snap = studio.patch({ op: 'selectAsset', assetType: 'client-control-template' })
  snap = studio.patch({ op: 'addTemplate', kind: 'container', name: 'ScreenReady' })
  const template = snap.tree.find((row) => row.name === 'ScreenReady')
  snap = studio.patch({ op: 'add', kind: 'textbox', parentId: template.id, name: 'Title' })
  snap = studio.patch({ op: 'selectAsset', assetType: 'server-control-template' })
  return { studio, snap, templateId: template.id, prefabId: template.guid }
}

test('Prefab 面板：模板列表带 GUID/尺寸/子控件数', () => {
  const { studio } = studioWithPrefab()
  const snap = studio.get()
  const prefab = snap.prefabs.find((item) => item.name === 'ScreenReady')
  assert.ok(prefab, 'Prefab 面板应列出新建模板')
  assert.equal(prefab.name, 'ScreenReady')
  assert.equal(prefab.childCount, 1)
  assert.ok(Number(prefab.guid) > 0, '模板根必须有 GUID，才能作为 prefabId')
  assert.equal(prefab.nested, false)
})

test('拖放实例：instantiateRef 生成 reference 节点，场景树带只读子行与 inspector 提示', () => {
  const { studio, snap, prefabId } = studioWithPrefab()
  const rootId = snap.tree.find((row) => row.kind === 'container').id
  const next = studio.patch({
    op: 'instantiateRef',
    parentId: rootId,
    prefabId: String(prefabId),
    x: 0, y: 40, width: 400, height: 300,
    name: 'ScreenReady',
    expectedRevision: snap.version,
  })
  const refRow = next.tree.find((row) => row.kind === 'reference' && row.prefab?.name === 'ScreenReady')
  assert.ok(refRow, '应出现 reference 行')
  assert.equal(refRow.prefab.name, 'ScreenReady')
  assert.equal(refRow.prefab.missing, false)
  const readonly = next.tree.filter((row) => row.readonly)
  assert.equal(readonly.length, 1, '模板子控件应作为只读行展开')
  assert.equal(readonly[0].name, 'Title')
  assert.equal(readonly[0].instanceOf, refRow.id)
  const selected = next.tree.find((row) => row.id === next.selectedId)
  assert.equal(selected.kind, 'reference')
  assert.equal(next.inspector.prefab.name, 'ScreenReady')
  assert.match(next.inspector.prefabNote, /只读/)
})

test('缺失模板：引用仍可存在，但标记 missing 并提示', () => {
  const { studio } = studioWithPrefab()
  const snap = studio.get()
  const rootId = snap.tree.find((row) => row.kind === 'container').id
  assert.throws(
    () => studio.patch({ op: 'instantiateRef', parentId: rootId, prefabId: '999', expectedRevision: snap.version }),
    /找不到该控件模板/,
  )
})

test('禁止嵌套 Prefab：模板内部含 reference 时拒绝放置', () => {
  const { studio, snap } = studioWithPrefab()
  let client = studio.patch({ op: 'selectAsset', assetType: 'client-control-template' })
  const template = client.tree.find((row) => row.name === 'ScreenReady')
  client = studio.patch({ op: 'add', kind: 'reference', parentId: template.id, name: 'InnerRef' })
  const server = studio.patch({ op: 'selectAsset', assetType: 'server-control-template' })
  const rootId = server.tree.find((row) => row.kind === 'container').id
  assert.throws(
    () => studio.patch({ op: 'instantiateRef', parentId: rootId, prefabId: String(template.guid), expectedRevision: server.version }),
    /嵌套 Prefab/,
  )
})


test('新建 Prefab：createPrefab 切换客户端资产、选中新模板并带 GUID', () => {
  const studio = createStudio()
  const before = studio.get()
  const next = studio.patch({ op: 'createPrefab' })
  assert.equal(next.asset.type, 'client-control-template')
  const created = next.tree.find((row) => row.id === next.selectedId)
  assert.ok(created, '新模板应被选中')
  assert.match(created.name, /新建界面/)
  assert.ok(Number(created.guid) > 0, '模板根必须有 GUID 才能作为 prefabId')
  assert.equal(next.prefabs.length, before.prefabs.length + 1)
})


test('导出：界面模板逐个一个 GIA，整合包保持多模板', () => {
  const { studio } = studioWithPrefab()
  const prefabs = studio.get().prefabs
  const all = studio.exportData('templates-gia')
  assert.equal(all.files.length, prefabs.length)
  const counts = all.files.map((file) => inspectGia(Buffer.from(file.data, 'base64')).templateCount)
  assert.deepEqual(counts, prefabs.map(() => 1), '每个文件只应包含一个模板')
  assert.ok(all.files.some((file) => file.filename === 'ScreenReady.gia'), all.files.map((file) => file.filename).join(', '))
  const single = studio.exportData('template-gia', prefabs.find((item) => item.name === 'ScreenReady').id)
  assert.equal(single.filename, 'ScreenReady.gia')
  assert.equal(inspectGia(Buffer.from(single.data, 'base64')).templateCount, 1)
  const combined = studio.exportData('gia-combined')
  assert.equal(inspectGia(Buffer.from(combined.data, 'base64')).templateCount, prefabs.length)
})
