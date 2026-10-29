# 静态模板引用（Prefab-lite）

目标：让「千星奇域客户端控件模板」像 Unity Prefab 一样用——**一个界面 = 一个模板**，场景里放引用节点得到实例，多个界面分开做、互不嵌套。

## 已实现的语义（模拟器策略）

| 项 | 行为 |
|---|---|
| 数据 | 场景（服务端控件树）里的 `reference` 节点，`referencedPrefabId` = 模板根节点的 GUID（即 `prefabIndex`） |
| 放置 | patch `instantiateRef { parentId, prefabId, x, y, width, height, name }` 在画布指定位置创建引用节点 |
| 加载期展开 | `studio/play/session.js` 的 `expandStaticReferences()` 在 `addRoot` 之后按 `runtime.templates` 实例化：实例根 = 模板根克隆（同名），子控件保留模板内名字 |
| 脚本 | 实例内模板脚本按 spec 各自挂载（每个实例一份），与动态实例化一致 |
| 嵌套 | **禁止**：模板内部含 `reference` 时跳过并记 `nested-reference`，不递归展开 |
| 缺模板 | 跳过并记 `template-not-found`，不影响同场景其它实例 |
| 展开顺序 | 不抢同级顺序、不改引用节点自身（动态 `InstantiateClientUIControl` 才会置顶） |

实现位置：`client/lua-runtime/src/runtime.js` 的 `instantiateStatic()`、`studio/play/session.js` 的 `expandStaticReferences()`、`studio/ui/project.js` 的 `instantiateRef` op。测试：`studio/test/static-reference.test.mjs`（展开 / 缺模板 / 禁止嵌套）。

## 编辑器侧（已做）

- 左侧新增「Prefab 模板」面板：列出模板（名称 / GUID / 子控件数），双击进入编辑，编辑态显示「← 返回场景」。
- 把模板拖到画布：在落点生成引用实例（尺寸取模板根矩形），真实坐标按画布换算，不复制 CSS 像素。
- 场景树里 reference 行带模板名标签，模板子控件作为**只读子行**展开（斜体 + “只读”），点击只读行会选中实例节点本身。
- 右键：实例/只读行提供「定位到 Prefab」；只读行不提供重命名/删除。实例行仍可改名与移动（位置/尺寸照常可编辑）。
- 属性面板对实例显示提示条：「实例子控件由 Prefab 决定、在场景里只读；要改外观/文字请进入 Prefab 修改，或用 Lua 按路径设置」；模板缺失时变黄提示。
- 示例工程：`examples/prefab-screens.save.json`（ScreenReady / ScreenPause / ScreenResult 三个模板各放一个实例），试玩截图见 `studio/docs/prefab-screens.png`。

## 命名与多实例

实例会带来重名子控件（3 个 `Screen` 都有 `Title`）。Lua 侧需要**路径寻址**：`uiPath['ScreenReady/OverlayPanel/Title']`，全局 `ui[name]` 仅在名字唯一时可靠。游戏工程侧在重构完成后补这层索引（当前 `src/` 正在被另一处改动，暂不并发修改）。

## 真机边界（未验证）

- 静态引用在真机加载期如何展开、实例脚本何时执行、子控件能否被 `GetChild` 找到：**均无真机证据**，按仓库规矩需要 `probes/` 探针。
- GIA 导入后 `templateRefSlot` 里的 prefab 索引可能被重映射（与控件 GUID 同类问题）；导出→导入后必须核对并回写 `referencedPrefabId`，否则会「模拟器有、真机空」。
- `studio/test/gia-reference.test.mjs` 是合成 wire 用例，只保证字节不丢，不等于真机 schema 兼容。
