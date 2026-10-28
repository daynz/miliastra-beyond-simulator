import test from 'node:test'
import assert from 'node:assert/strict'
import { createNode } from '../ui/authoring.js'
import { createProject } from '../ui/project.js'
import { compileProject } from '../play/compile.js'
import { expandStaticReferences } from '../play/session.js'
import { createRuntime } from '../../client/lua-runtime/src/index.js'

const PREFAB_INDEX = 1073742000

function setRect(node, x, y, w, h) {
  for (const rt of Object.values(node.transformByPlatform)) {
    rt.anchorMin = { x: 0.5, y: 0.5 }
    rt.anchorMax = { x: 0.5, y: 0.5 }
    rt.pivot = { x: 0.5, y: 0.5 }
    rt.offset = { x, y }
    rt.size = { x: w, y: h }
  }
}

function templateProject({ nested = false } = {}) {
  const server = createNode('server-container', { id: 'sc1', name: '客户端控件容器' })
  const root = createNode('container', { id: 't1', name: 'OverlayPanel', guid: PREFAB_INDEX })
  setRect(root, 0, 0, 400, 300)
  const title = createNode('textbox', { id: 't2', name: 'Title', text: 'HELLO PREFAB', fontSize: 24 })
  setRect(title, 0, 60, 320, 40)
  const button = createNode('button', { id: 't3', name: 'Confirm', guid: 1073742001 })
  setRect(button, 0, -40, 160, 48)
  root.children.push(title, button)
  if (nested) {
    const inner = createNode('reference', { id: 't4', name: 'InnerRef', referencedPrefabId: String(PREFAB_INDEX) })
    setRect(inner, 0, 0, 100, 100)
    root.children.push(inner)
  }
  server.children.push(root)
  return createProject({
    version: 1,
    layoutSchemaVersion: 2,
    meta: { name: 'prefab', assetType: 'client-control-template', sourceFormat: 'authoring', sourceFile: '' },
    canvasId: 'mobile-16-9',
    selectedId: 't1',
    root: server,
  })
}

function sceneProject(count = 2) {
  const server = createNode('server-container', { id: 'sc1', name: '客户端控件容器' })
  const root = createNode('container', { id: 'n1', name: 'GameRoot', isRootContainer: true })
  setRect(root, 0, 0, 1280, 720)
  const children = []
  for (let i = 0; i < count; i += 1) {
    const ref = createNode('reference', {
      id: `r${i + 1}`,
      name: `Screen${i + 1}`,
      referencedPrefabId: String(PREFAB_INDEX),
    })
    setRect(ref, 0, 0, 400, 300)
    children.push(ref)
  }
  root.children.push(...children)
  server.children.push(root)
  return createProject({
    version: 1,
    layoutSchemaVersion: 2,
    meta: { name: 'scene', assetType: 'server-control-template', sourceFormat: 'authoring', sourceFile: '' },
    canvasId: 'mobile-16-9',
    selectedId: 'r1',
    root: server,
  })
}

function play(scene, templates) {
  const compiled = compileProject(scene, [])
  const bundle = compileProject(templates, [])
  const runtime = createRuntime({ canvasWidth: 1280, canvasHeight: 720 })
  for (const template of [...(compiled.templates || []), ...(bundle.templates || [])]) {
    if (Number.isSafeInteger(template.prefabIndex) && template.prefabIndex > 0) {
      runtime.registerTemplate(template.prefabIndex, template)
    }
  }
  runtime.addRoot(compiled.root)
  return { runtime, result: expandStaticReferences(runtime) }
}

test('静态模板引用：加载时展开成实例子树，名字与模板一致', () => {
  const { runtime, result } = play(sceneProject(2), templateProject())
  assert.equal(result.expanded.length, 2)
  assert.deepEqual(result.skipped, [])
  const root = runtime.roots[0]
  const screens = root.children.filter((child) => child.kind === 'reference')
  assert.equal(screens.length, 2)
  for (const screen of screens) {
    assert.equal(screen.children.length, 1, '每个引用节点下应有一个实例根')
    const instance = screen.children[0]
    assert.equal(instance.name, 'OverlayPanel')
    assert.equal(instance.prefabIndex, PREFAB_INDEX)
    const title = instance.children.find((child) => child.name === 'Title')
    assert.ok(title, '实例内应保留模板子控件名字')
    assert.equal(title.text, 'HELLO PREFAB')
    assert.ok(instance.children.some((child) => child.kind === 'button' && child.name === 'Confirm'))
  }
  runtime.destroy()
})

test('静态模板引用：模板缺失时跳过并给出原因，不影响其它实例', () => {
  const scene = sceneProject(1)
  const root = scene.root.children[0]
  root.children.push(createNode('reference', { id: 'rx', name: 'Broken', referencedPrefabId: '999' }))
  const { runtime, result } = play(scene, templateProject())
  assert.equal(result.expanded.length, 1)
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].reason, 'template-not-found')
  runtime.destroy()
})

test('静态模板引用：禁止嵌套（模板里含 reference 时跳过而非递归展开）', () => {
  const { runtime, result } = play(sceneProject(1), templateProject({ nested: true }))
  assert.equal(result.expanded.length, 0)
  assert.equal(result.skipped[0].reason, 'nested-reference')
  const screen = runtime.roots[0].children[0]
  assert.equal(screen.children.length, 0, '被拒绝的引用不应长出任何子控件')
  runtime.destroy()
})
