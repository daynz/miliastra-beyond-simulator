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

## 编辑器侧（未做，下一步）

Unity 式操作：左侧树分「场景 / Prefab」两区、双击 Prefab 进入编辑 + 面包屑返回、把 Prefab 拖到画布生成实例、实例子树只读展开、右键「定位到 Prefab」。属性面板对实例只读并提示「在 Prefab 里改，或运行时用脚本改」。

## 命名与多实例

实例会带来重名子控件（3 个 `Screen` 都有 `Title`）。Lua 侧需要**路径寻址**：`uiPath['ScreenReady/OverlayPanel/Title']`，全局 `ui[name]` 仅在名字唯一时可靠。游戏工程侧在重构完成后补这层索引（当前 `src/` 正在被另一处改动，暂不并发修改）。

## 真机边界（未验证）

- 静态引用在真机加载期如何展开、实例脚本何时执行、子控件能否被 `GetChild` 找到：**均无真机证据**，按仓库规矩需要 `probes/` 探针。
- GIA 导入后 `templateRefSlot` 里的 prefab 索引可能被重映射（与控件 GUID 同类问题）；导出→导入后必须核对并回写 `referencedPrefabId`，否则会「模拟器有、真机空」。
- `studio/test/gia-reference.test.mjs` 是合成 wire 用例，只保证字节不丢，不等于真机 schema 兼容。
