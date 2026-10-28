import test from 'node:test'
import assert from 'node:assert/strict'
import { createNode } from '../ui/authoring.js'
import { createProject, applyPatch } from '../ui/project.js'
import { layoutTree } from '../ui/inspector.js'

function setRect(node, x, y, w, h) {
  for (const rt of Object.values(node.transformByPlatform)) {
    rt.anchorMin = { x: 0.5, y: 0.5 }
    rt.anchorMax = { x: 0.5, y: 0.5 }
    rt.pivot = { x: 0.5, y: 0.5 }
    rt.offset = { x, y }
    rt.size = { x: w, y: h }
  }
}

function fixture() {
  const server = createNode('server-container', { id: 'sc1', name: '客户端控件容器' })
  const root = createNode('container', { id: 'n1', name: 'GameRoot', isRootContainer: true })
  const groupA = createNode('container', { id: 'n2', name: 'GroupA' })
  const groupB = createNode('container', { id: 'n3', name: 'GroupB' })
  const child = createNode('image', { id: 'n4', name: 'ChildImage' })
  const tail = createNode('image', { id: 'n5', name: 'TailImage' })
  setRect(root, 0, 0, 1280, 720)
  setRect(groupA, 200, 100, 300, 200)
  setRect(groupB, -300, -100, 200, 200)
  setRect(child, 40, 20, 60, 40)
  setRect(tail, 0, 0, 30, 30)
  groupA.children.push(child)
  root.children.push(groupA, groupB, tail)
  server.children.push(root)
  const project = createProject({
    version: 1,
    layoutSchemaVersion: 2,
    meta: { name: 'tree-ops', assetType: 'server-control-template', sourceFormat: 'authoring', sourceFile: '' },
    canvasId: 'mobile-16-9',
    selectedId: 'n4',
    root: server,
  })
  const clientRoot = () => project.root.children[0]
  return { project, clientRoot }
}

const idsOf = (list) => list.map((node) => node.id)

test('rename：去空白、校验空名与容器限制、版本递增', () => {
  const { project, clientRoot } = fixture()
  const before = project.version
  applyPatch(project, { op: 'rename', id: 'n2', name: '  分组 A  ' })
  assert.equal(clientRoot().children[0].name, '分组 A')
  assert.equal(project.version, before + 1)
  assert.equal(project.selectedId, 'n2')
  assert.throws(() => applyPatch(project, { op: 'rename', id: 'n2', name: '   ' }), /名称不能为空/)
  assert.throws(() => applyPatch(project, { op: 'rename', id: 'sc1', name: 'x' }), /不能重命名/)
})

test('moveTo：同父级排序按 index 落位', () => {
  const { project, clientRoot } = fixture()
  assert.deepEqual(idsOf(clientRoot().children), ['n2', 'n3', 'n5'])
  applyPatch(project, { op: 'moveTo', id: 'n5', parentId: 'n1', index: 0 })
  assert.deepEqual(idsOf(clientRoot().children), ['n5', 'n2', 'n3'])
  applyPatch(project, { op: 'moveTo', id: 'n5', parentId: 'n1', index: 99 })
  assert.deepEqual(idsOf(clientRoot().children), ['n2', 'n3', 'n5'])
})

test('moveTo：换父级后画布视觉中心保持不变', () => {
  const { project, clientRoot } = fixture()
  const before = layoutTree(project.root, project.canvasId).boxes['n4']
  applyPatch(project, { op: 'moveTo', id: 'n4', parentId: 'n3' })
  const after = layoutTree(project.root, project.canvasId).boxes['n4']
  assert.ok(Math.abs(before.centerX - after.centerX) < 0.001, `centerX ${before.centerX} -> ${after.centerX}`)
  assert.ok(Math.abs(before.centerY - after.centerY) < 0.001, `centerY ${before.centerY} -> ${after.centerY}`)
  assert.ok(Math.abs(before.width - after.width) < 0.001)
  assert.ok(Math.abs(before.height - after.height) < 0.001)
  const groupB = clientRoot().children.find((node) => node.id === 'n3')
  assert.deepEqual(idsOf(groupB.children), ['n4'])
})

test('moveTo：拒绝环、拒绝移动服务端根节点', () => {
  const { project } = fixture()
  assert.throws(() => applyPatch(project, { op: 'moveTo', id: 'n2', parentId: 'n2' }), /自身或其后代/)
  assert.throws(() => applyPatch(project, { op: 'moveTo', id: 'n2', parentId: 'n4' }), /自身或其后代/)
  assert.throws(() => applyPatch(project, { op: 'moveTo', id: 'n1', parentId: 'n2' }), /根节点不能移动/)
})

test('rename + moveTo 后仍可删除', () => {
  const { project, clientRoot } = fixture()
  applyPatch(project, { op: 'rename', id: 'n5', name: '尾巴' })
  applyPatch(project, { op: 'moveTo', id: 'n5', parentId: 'n2', index: 0 })
  applyPatch(project, { op: 'remove', id: 'n5' })
  const flat = []
  const walk = (node) => { for (const child of node.children || []) { flat.push(child.id); walk(child) } }
  walk(project.root)
  assert.ok(!flat.includes('n5'))
  assert.equal(project.selectedId, 'n2')
  assert.deepEqual(idsOf(clientRoot().children[0].children), ['n4'])
})
