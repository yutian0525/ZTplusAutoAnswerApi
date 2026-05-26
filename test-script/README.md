# test-script 使用说明

浏览器端自动答题脚本，适用于 ZTplus 平台的**测试题与考试**场景。

工作原理：本地启动一个题库查询服务（Flask），浏览器安装 Tampermonkey 后加载脚本，答题时脚本向本地服务查询答案并自动选题。

## 文件说明

| 文件                     | 说明                                      |
| ------------------------ | ----------------------------------------- |
| `question_server.py`     | 题库查询后端（Python 源码）               |
| `question_server.exe`    | 打包好的后端可执行文件，无需安装 Python   |
| `ncre3_theory_all.json`  | 内置题库（全国计算机等级考试三级理论题）  |
| `AutoAnswer2.js`         | Tampermonkey 用户脚本，粘贴到篡改猴中使用 |
| `Tampermonkey-5.3.3.crx` | 篡改猴浏览器扩展安装包（离线版）          |

---

## 使用步骤

### 第一步：启动后端服务

**方式 A — 直接运行 exe（推荐，无需安装任何环境）**

双击运行 `question_server.exe`，看到如下输出即表示启动成功：

```
[题库] 加载完成，共 XXXX 题
Starting Flask server on http://localhost:5011
```

**方式 B — 运行 Python 源码**

```bash
pip install flask flask-cors
python question_server.py
```

> 后端默认监听 `localhost:5011`，窗口保持开启状态，不要关闭。

---

### 第二步：安装篡改猴（Tampermonkey）

**方式 A — 使用本地 crx 安装包**

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 开启右上角**开发者模式**
3. 将 `Tampermonkey-5.3.3.crx` 文件拖入扩展页面，按提示确认安装

**方式 B — 从应用商店安装**

在 Chrome 网上应用店搜索 **Tampermonkey** 并安装。

---

### 第三步：创建脚本

1. 点击浏览器工具栏中的 Tampermonkey 图标
2. 选择 **管理面板** → **新建脚本**（或点击 **+** 按钮）
3. 将编辑器中的默认内容**全部清空**
4. 打开 `AutoAnswer2.js`，复制其全部内容，粘贴到编辑器中
5. 按 `Ctrl + S` 保存

---

### 第四步：开始使用

1. 在 ZTplus 网站进入任意**测试题或考试**页面（URL 中含 `/paper/testing/`）
2. 页面加载完成后，右上角会自动出现**助手**控制面板
3. 确认"后端地址"填写正确（默认 `localhost:5011`，通常无需修改）
4. 点击 **开始答题**，脚本将自动逐题查询并选择答案

> **手动查题**：如需单独查询某道题，可将题干粘贴到面板中的文本框，点击"查询答案"即可。

---

## 常见问题

**后端启动后，脚本提示"题库未收录"**

- 确认 `question_server.exe`（或 Python）已正常运行且未报错
- 检查控制面板中的"后端地址"是否为 `localhost:5011`

**浏览器安装 crx 后提示"无法从该网站添加应用"**

- 需要先开启 Chrome 的**开发者模式**（`chrome://extensions/` 右上角开关）

**控制面板没有出现**

- 确认当前页面 URL 包含 `/paper/testing/`
- 刷新页面，等待 2 秒后查看是否出现

部分代码来自 https://github.com/Moeary/ZTplusAutoAnswer
