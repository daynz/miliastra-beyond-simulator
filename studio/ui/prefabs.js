// Prefab（客户端控件模板）在编辑器里的呈现：
// - 场景树里的 `reference` 节点按模板展开出「只读子行」，方便像 Unity 一样看到实例子树；
// - 模板列表供左侧 Prefab 面板与拖拽放置使用；
// - 只做投影，不修改工程数据。

import { walk } from './authoring.js'
import { readCurrentTransform } from './sync.js'
import { KIND_LABELS } from '../constants.js'

const TEMPLATE_LABEL = (kind) => KIND_LABELS[kind] || kind

export function containsReference(node) {
  let hit = false
  const visit = (current) => {
    if (hit || !current) return
    if (current.kind === 'reference') { hit = true; return }
    for (const child of current.children || []) visit(child)
  }
  visit(node)
  return hit
}

export function templateRoots(clientProject) {
  if (!clientProject) return []
  const root = clientProject.root
  const holder = (root?.children || []).find((child) => child.kind === 'server-container')
  return holder ? [...(holder.children || [])] : [...(root?.children || [])]
}

export function findTemplate(clientProject, guid) {
  const wanted = String(guid ?? '').trim()
  if (!wanted) return null
  return templateRoots(clientProject).find((node) => String(node.guid ?? '') === wanted) || null
}

export function describePrefabs(clientProject, canvasId = '') {
  const countDescendants = (node) => (node.children || []).reduce((sum, child) => sum + 1 + countDescendants(child), 0)
  return templateRoots(clientProject).map((node) => {
    const children = countDescendants(node)
    const rt = canvasId ? readCurrentTransform(node.transformByPlatform, canvasId) : null
    return {
      id: node.id,
      name: node.name,
      guid: String(node.guid ?? ''),
      kind: node.kind,
      childCount: children,
      nested: containsReference(node),
      width: rt ? rt.size.x : 1280,
      height: rt ? rt.size.y : 720,
    }
  })
}

function childRowsFor(refRow, templateNode, nextId) {
  const rows = []
  const visit = (node, depth, parentId, ancestorIds, siblingIndex, siblingCount) => {
    rows.push({
      id: nextId(),
      kind: node.kind,
      name: node.name,
      label: TEMPLATE_LABEL(node.kind),
      depth,
      parentId,
      ancestorIds,
      siblingIndex,
      siblingCount,
      templateId: templateNode.id,
      childCount: (node.children || []).length,
      incomplete: false,
      readonly: true,
      instanceOf: refRow.id,
      prefabId: templateNode.id,
    })
    const children = node.children || []
    for (let index = 0; index < children.length; index += 1) {
      visit(children[index], depth + 1, node.id, [...ancestorIds, parentId], index, children.length)
    }
  }
  const children = templateNode.children || []
  for (let index = 0; index < children.length; index += 1) {
    visit(children[index], refRow.depth + 1, refRow.id, [...(refRow.ancestorIds || []), refRow.id], index, children.length)
  }
  return rows
}

// 在场景树行里给 reference 节点补上模板信息与只读子行；返回新数组。
export function withPrefabInstances(rows, clientProject) {
  if (!Array.isArray(rows) || !clientProject) return rows
  let counter = 0
  const nextId = () => `prefab-row-${++counter}`
  const out = []
  for (const row of rows) {
    if (row.kind !== 'reference') { out.push(row); continue }
    const template = findTemplate(clientProject, row.referencedPrefabId)
    const annotated = {
      ...row,
      prefab: template
        ? { id: template.id, name: template.name, guid: String(template.guid ?? ''), missing: false }
        : { id: '', name: '', guid: String(row.referencedPrefabId ?? ''), missing: true },
    }
    out.push(annotated)
    if (template) out.push(...childRowsFor(annotated, template, nextId))
  }
  return out
}

export function prefabForRow(clientProject, row) {
  if (!row) return null
  if (row.prefab) return row.prefab
  const template = findTemplate(clientProject, row.referencedPrefabId ?? row.guid)
  return template ? { id: template.id, name: template.name, guid: String(template.guid ?? ''), missing: false } : null
}
