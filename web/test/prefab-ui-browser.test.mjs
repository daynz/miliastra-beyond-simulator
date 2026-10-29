import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createWebServer } from '../server.js'
import { startTestBrowser } from './browser-helper.mjs'

// 需要浏览器：QXQY_BROWSER=<Edge/Chrome 可执行文件> node --test test/prefab-ui-browser.test.mjs
test('Prefab 面板：列出模板、双击进入、返回场景、拖到画布生成实例、只读子行与右键定位', { skip: !process.env.QXQY_BROWSER, timeout: 120_000 }, async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'qxqy-prefab-ui-'))
  const app = await createWebServer({ workspace, port: 0 })
  const browser = await startTestBrowser(workspace)
  t.after(async () => {
    await browser.close().catch(() => {})
    await app.close()
    rmSync(workspace, { recursive: true, force: true })
  })
  await browser.navigate(`${app.url}/editor`)
  await browser.wait('document.querySelectorAll(".qxsim-row").length > 0')
  const sessionId = await browser.evaluate("sessionStorage.getItem('qxqy-editor-session')")
  const call = async (action, body = {}) => {
    const response = await fetch(`${app.url}/editor/api/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...body }),
    })
    const envelope = await response.json()
    if (!envelope.ok) throw new Error(envelope.error)
    return envelope.value
  }

  // 造一个 Prefab：客户端模板里新建 ScreenReady，并在里面放一个文本框
  let snap = await call('get')
  snap = await call('patch', { op: { op: 'selectAsset', assetType: 'client-control-template', expectedRevision: snap.version } })
  snap = await call('patch', { op: { op: 'addTemplate', kind: 'container', name: 'ScreenReady', expectedRevision: snap.version } })
  const template = snap.tree.find((row) => row.name === 'ScreenReady')
  snap = await call('patch', { op: { op: 'add', kind: 'textbox', parentId: template.id, name: 'PanelTitle', expectedRevision: snap.version } })
  snap = await call('patch', { op: { op: 'selectAsset', assetType: 'server-control-template', expectedRevision: snap.version } })

  await browser.navigate(`${app.url}/editor`)
  await browser.wait('!!document.querySelector(".qxsim-prefab-panel")')
  await browser.wait('document.querySelectorAll(".qxsim-prefab-item").length >= 1')
  const prefabItems = await browser.evaluate('[...document.querySelectorAll(".qxsim-prefab-item .name")].map(node => node.textContent)')
  assert.ok(prefabItems.includes('ScreenReady'), `Prefab 列表应包含 ScreenReady：${prefabItems.join(', ')}`)

  // 双击进入 Prefab
  await browser.evaluate(`(() => {
    const item = [...document.querySelectorAll('.qxsim-prefab-item')].find(node => node.querySelector('.name')?.textContent === 'ScreenReady')
    item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  })()`)
  await browser.wait('!!document.querySelector(".qxsim-prefab-back")')
  await browser.wait('!!document.querySelector(".qxsim-prefab-item.active")')
  const editing = await call('get')
  assert.equal(editing.asset.type, 'client-control-template')

  // 返回场景
  await browser.evaluate('document.querySelector(".qxsim-prefab-back").click()')
  await browser.wait('!document.querySelector(".qxsim-prefab-back")')
  const back = await call('get')
  assert.equal(back.asset.type, 'server-control-template')

  // 拖 Prefab 到画布
  await browser.evaluate(`(() => {
    const item = [...document.querySelectorAll('.qxsim-prefab-item')].find(node => node.querySelector('.name')?.textContent === 'ScreenReady')
    window.__prefabDrag = new DataTransfer()
    item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__prefabDrag }))
  })()`)
  await delay(120)
  await browser.evaluate(`(() => {
    const stage = document.querySelector('.qxsim-stage')
    const rect = stage.getBoundingClientRect()
    stage.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__prefabDrag, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }))
  })()`)
  await delay(120)
  await browser.evaluate(`(() => {
    const stage = document.querySelector('.qxsim-stage')
    const rect = stage.getBoundingClientRect()
    stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__prefabDrag, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }))
  })()`)
  await delay(600)

  const placed = await call('get')
  const refRow = placed.tree.find((row) => row.kind === 'reference' && row.referencedPrefabId === String(template.guid))
  assert.ok(refRow, '拖放后应出现指向该模板的引用节点')
  assert.equal(refRow.prefab.name, 'ScreenReady')
  const readonlyRows = placed.tree.filter((row) => row.readonly && row.instanceOf === refRow.id)
  assert.ok(readonlyRows.some((row) => row.name === 'PanelTitle'), '实例子行应只读展开')
  const readonlyDom = await browser.evaluate(`[...document.querySelectorAll('.qxsim-row.readonly .qxsim-row-label')].map(node => node.textContent)`)
  assert.ok(readonlyDom.some((text) => text.includes('PanelTitle')), `只读行应出现在树里：${readonlyDom.join(', ')}`)

  // 点击只读行 → 选中实例节点本身
  await browser.evaluate(`(() => {
    const row = [...document.querySelectorAll('.qxsim-row.readonly')].find(node => node.querySelector('.qxsim-row-label')?.textContent.includes('PanelTitle'))
    row.click()
  })()`)
  await delay(400)
  const selected = await call('get')
  assert.equal(selected.selectedId, refRow.id)

  // 右键只读行 → 定位到 Prefab
  await browser.evaluate(`(() => {
    const row = [...document.querySelectorAll('.qxsim-row.readonly')].find(node => node.querySelector('.qxsim-row-label')?.textContent.includes('PanelTitle'))
    const rect = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + 6 }))
  })()`)
  await browser.wait('document.querySelector(".qxsim-menu")?.innerText.includes("定位到 Prefab")')
  await browser.evaluate('[...document.querySelectorAll(".qxsim-menu-item")].find(button => button.textContent.includes("定位到 Prefab")).click()')
  await browser.wait('!!document.querySelector(".qxsim-prefab-back")')
  const entered = await call('get')
  assert.equal(entered.asset.type, 'client-control-template')
  assert.equal(entered.selectedId, template.id)
})
