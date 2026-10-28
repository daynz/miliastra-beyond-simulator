import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createWebServer } from '../server.js'
import { startTestBrowser } from './browser-helper.mjs'

// 需要浏览器：QXQY_BROWSER=<Edge/Chrome 可执行文件> node --test test/tree-ui-browser.test.mjs
test('控件树：折叠、拖拽排序、右键菜单（重命名 / 删除）', { skip: !process.env.QXQY_BROWSER, timeout: 120_000 }, async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-tree-ui-'))
  const app = await createWebServer({ workspace, port: 0 })
  const browser = await startTestBrowser(workspace)
  t.after(async () => {
    await browser.close().catch(() => {})
    await app.close()
    rmSync(workspace, { recursive: true, force: true })
  })
  await browser.navigate(`${app.url}/editor`)
  await browser.wait('document.querySelectorAll(".qxsim-row").length > 0')
  // 编辑器把会话 id 存在 sessionStorage；UI 与 API 必须用同一个会话
  const sessionId = await browser.evaluate("sessionStorage.getItem('qxqy-editor-session')")
  assert.ok(sessionId, 'editor session id')
  const call = async (action, body = {}) => {
    const response = await fetch(`${app.url}/editor/api/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...body }),
    })
    return (await response.json()).value
  }
  // 造一棵有层级的小树：GameRoot > GroupA > (Chip)；GameRoot > GroupB
  let snap = await call('get')
  // tree[0] 是服务端控件容器；GameRoot 是它的容器子节点
  const rootId = snap.tree.find((row) => row.kind === 'container').id
  for (const name of ['GroupA', 'GroupB']) {
    snap = await call('patch', { op: { op: 'add', kind: 'container', parentId: rootId, name, expectedRevision: snap.version } })
  }
  const groupA = snap.tree.find((row) => row.name === 'GroupA')
  await call('patch', { op: { op: 'add', kind: 'image', parentId: groupA.id, name: 'Chip', expectedRevision: snap.version } })
  await browser.navigate(`${app.url}/editor`)
  await browser.wait('document.querySelectorAll(".qxsim-row").length >= 4')

  const rowByName = (name) => `[...document.querySelectorAll('.qxsim-row')].find(row => row.querySelector('.qxsim-row-label')?.textContent === ${JSON.stringify(name)})`

  // 1) 折叠：收起 GroupA 后，子节点 Chip 从列表消失，展开后回来
  await browser.evaluate(`(${rowByName('GroupA')}).querySelector('.qxsim-chevron-btn').click()`)
  await browser.wait(`!(${rowByName('Chip')})`)
  await browser.evaluate(`(${rowByName('GroupA')}).querySelector('.qxsim-chevron-btn').click()`)
  await browser.wait(`!!(${rowByName('Chip')})`)

  // 2) 右键菜单：不再出现浏览器默认菜单，显示自定义项
  await browser.evaluate(`(() => {
    const row = ${rowByName('Chip')}
    const rect = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + 8 }))
  })()`)
  await browser.wait('!!document.querySelector(".qxsim-menu")')
  assert.equal(await browser.evaluate('document.querySelector(".qxsim-menu").innerText.includes("重命名")'), true)
  assert.equal(await browser.evaluate('document.querySelector(".qxsim-menu").innerText.includes("删除节点")'), true)

  // 3) 重命名
  await browser.evaluate('[...document.querySelectorAll(".qxsim-menu-item")].find(button => button.textContent.includes("重命名")).click()')
  await browser.wait('!!document.querySelector(".qxsim-rename-input")')
  await browser.evaluate(`(() => {
    const input = document.querySelector('.qxsim-rename-input')
    input.value = '按名称重命名'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })()`)
  await browser.wait(`!!(${rowByName('按名称重命名')})`)
  const renamed = await call('get')
  assert.ok(renamed.tree.some((row) => row.name === '按名称重命名'))

  // 4) 拖拽：把 GroupB 拖到 GroupA 前面（before）；分步派发，让 React 先提交 dragging 状态
  await browser.evaluate(`window.__treeDrag = new DataTransfer(); (${rowByName('GroupB')}).dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__treeDrag }))`)
  await delay(120)
  await browser.evaluate(`(() => {
    const target = ${rowByName('GroupA')}
    const rect = target.getBoundingClientRect()
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__treeDrag, clientX: rect.left + 10, clientY: rect.top + 2 }))
  })()`)
  await delay(120)
  await browser.evaluate(`(() => {
    const target = ${rowByName('GroupA')}
    const rect = target.getBoundingClientRect()
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__treeDrag, clientX: rect.left + 10, clientY: rect.top + 2 }))
  })()`)
  await delay(600)
  const apiTree = await call('get')
  const flatNames = apiTree.tree.map((row) => row.name)
  assert.ok(flatNames.indexOf('GroupB') >= 0 && flatNames.indexOf('GroupB') < flatNames.indexOf('GroupA'), `拖拽后顺序：${flatNames.join(' > ')}`)
  const domOrder = await browser.evaluate(`[...document.querySelectorAll('.qxsim-tree-scroll .qxsim-row .qxsim-row-label')].map(node => node.textContent)`)
  assert.ok(domOrder.indexOf('GroupB') < domOrder.indexOf('GroupA'), `DOM 顺序：${domOrder.join(' > ')}`)

  // 5) 拖到容器中部：移入该容器（成为其子节点）
  const groupBId = (await call('get')).tree.find((row) => row.name === 'GroupB').id
  const groupAId = (await call('get')).tree.find((row) => row.name === 'GroupA').id
  await browser.evaluate(`window.__treeDrag = new DataTransfer(); (${rowByName('GroupB')}).dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__treeDrag }))`)
  await delay(120)
  await browser.evaluate(`(() => {
    const target = ${rowByName('GroupA')}
    const rect = target.getBoundingClientRect()
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__treeDrag, clientX: rect.left + 10, clientY: rect.top + rect.height / 2 }))
  })()`)
  await delay(120)
  await browser.evaluate(`(() => {
    const target = ${rowByName('GroupA')}
    const rect = target.getBoundingClientRect()
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__treeDrag, clientX: rect.left + 10, clientY: rect.top + rect.height / 2 }))
  })()`)
  await delay(600)
  const nested = (await call('get')).tree.find((row) => row.id === groupBId)
  assert.equal(nested.parentId, groupAId, '拖入容器后父级应改变')

  // 5) 删除：右键 → 删除节点 → 二次确认
  await browser.evaluate(`(() => {
    const row = ${rowByName('按名称重命名')}
    const rect = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + 8 }))
  })()`)
  await browser.wait('!!document.querySelector(".qxsim-menu")')
  await browser.evaluate('[...document.querySelectorAll(".qxsim-menu-item")].find(button => button.textContent.includes("删除节点")).click()')
  await browser.wait('document.querySelector(".qxsim-menu").innerText.includes("确认删除")')
  await browser.evaluate('[...document.querySelectorAll(".qxsim-menu-item")].find(button => button.textContent.trim() === "删除节点").click()')
  await browser.wait(`!(${rowByName('按名称重命名')})`)
  const afterDelete = await call('get')
  assert.ok(!afterDelete.tree.some((row) => row.name === '按名称重命名'))
})
