# Re-Kubikatia

[English](README.md) | **简体中文**


<img width="256" height="256" alt="kubikat-256 png" src="https://github.com/user-attachments/assets/495b45f0-eaff-4214-85e2-f08a38d25c0f" />


> **⚠️ 风险警示与免责声明**
>
> 本插件仅用于个人学习、技术研究与交流，不是 Kubikat 或任何图书馆的官方工具，也未获得其授权或认可。
>
> - 插件通过 Kubikat 的公开 SRU 接口读取数据，一次只发一个请求，请求间隔至少 10 秒，单次最多 50 条。
> - 批量读取仍可能给服务器带来压力。请勿短时间反复导入，也不要尝试绕过这些限制。
> - 请遵守 Kubikat、相关图书馆及数据提供方的使用条款、robots.txt、访问频率限制和版权规定。**不得将本工具用于盈利、商业分发、付费服务或其他违反对方条款的用途。**
> - **严禁利用本工具对任何服务器实施攻击**、压测、拒绝服务、绕过访问限制或其他干扰行为。
> - 使用本工具产生的一切后果（包括数据、账号、服务中断及法律责任）由使用者自行承担；作者不对工具的完整性、可用性或适用性作任何担保。
> - 本项目与 Kubikat、Ex Libris/Primo/Alma 及相关图书馆、数据提供方无任何隶属、合作或授权关系。

Re-Kubikatia 是一个 Zotero 7–10 插件：输入 Kubikat 的检索结果链接，或单条记录链接 / docid，插件会新建一个 Zotero 文献组，并把命中的文献逐条写入其中。全程不生成 RIS 文件，也不需要本地 Web 服务。

---

## TL;DR

> 如果人物形象没有鲜活的动作，不能用肢体表达其内心的意念，那么这些形象便是**双重死亡**的。绘画本身并没有生命，它只是表现有生命之物；如果不能再赋予画面以动作的生动性，它就第二次死去了。（达芬奇《绘画论》）

此仓库是 [zotero-kubikat](https://github.com/y1-fan/zotero-kubikat) 的迭代。

传统工作流尝试数据导出为 RIS 后导入 Zotero，实际上，这造成了严重的映射问题。RIS 是一种比较简陋、功能有限的文献交换格式，在这一工作流中存在明显短板。

MARC 是图书馆领域广泛使用的机器可读编目格式，能够表达丰富的书目字段及其语义关系。相比之下，RIS 更侧重于不同文献管理系统之间的通用交换。Kubikat 本身 MARC 数据非常丰富，但是，其导出系统使得大量数据并未映射到 RIS 中，还有大量本应正确映射的数据被错误映射。同时，Zotero 对 RIS 的支持也存在局限，从而导致**双重失效**。

因此，Re-Kubikatia 跳过 RIS 中间步骤，作为 Zotero 插件，直接链接 MARC 数据与 Zotero，尽可能保留原始记录的丰富性与语义结构。作者与编者得到区分，文献类型可以更精细识别，无法直接归类的信息则保存在“其他”字段或笔记中。

---

## 功能

- 支持三种输入，可混用：
  - Kubikat 检索结果页 URL（`/discovery/search?...`）
  - 单条 fulldisplay 链接（含 `docid`）
  - 裸 docid（`alma990003239662009152` 或 `990003239662009152`）
- 自动生成文献组名称；也可以手动指定，重名时自动追加 ` (2)`、` (3)`
- 目标文库取 Zotero 当前选中的文库；只读群组库自动回退到 My Library
- 按 SRU/MARC 映射文献类型、作者、出版信息、丛书、ISBN/ISSN、DOI、摘要、语言、索书号、馆藏、主题词和链接
- 可把主题词写成 Zotero 标签
- 可把全文链接挂成 URL 附件（每条最多 20 个）
- 为每条文献生成子笔记，包含附注、馆藏清单和全部链接
- 导入过程显示进度、条数和日志；可随时取消
- 关闭对话框后任务继续运行，并在 Zotero 进度窗口中显示结果
- 完成后可一键定位到新建的文献组

---

## 合规性与速率限制

以下内容核查于 **2026-10-23**。它们不是法律意见，公开分发或长期使用前请自行确认最新条款。

### Kubikat `robots.txt`

<https://www.kubikat.org/robots.txt>

```
User-agent: *
Disallow: /primaws
Disallow: /discovery/search
Disallow: /nde/search
Crawl-delay: 10
```

- `/primaws` 和 `/discovery/search` 被明确禁止自动抓取。
- `Crawl-delay: 10` 表示每次请求之间应间隔约 10 秒。
- `eu06.alma.exlibrisgroup.com` 返回相同的 `robots.txt`，所以 SRU 主机同样适用该延迟。

本插件因此**完全不请求 `/primaws`**，只使用 `/view/sru/`，并强制执行 10 秒间隔。

### Alma SRU 的用途

<https://developers.exlibrisgroup.com/alma/integrations/sru/>

Ex Libris 说明 SRU 主要用于馆际互借、套录和采选等自动化场景，**不支持把 SRU 当作批量导出工具**；单次检索最多返回 10,000 条，`maximumRecords` 最大 50。

本插件把单次导入限制在 50 条，只用于个人文献管理，不提供批量导出功能。

### Ex Libris API 配额

<https://developers.exlibrisgroup.com/primo/apis/>

Primo 官方 API 的治理阈值是 **50 次/秒、1,500 次/分钟**（按机构合计），每日阈值为 5 次 × FTE。该阈值适用于官方 API 网关，不适用于 SRU 或直连 Alma 域；本插件仍然选择远低于该阈值的速率。

### 本插件的具体限制

- 只走 SRU：检索、单条记录、父记录全部通过 `https://eu06.alma.exlibrisgroup.com/view/sru/49MPG_KUBIKAT`
- 串行请求：同一时间只有一个请求
- 请求间隔：至少 10 秒
- 单次条数：最多 50 条
- 请求预算：每次导入最多 200 次请求
- 重试：最多 2 次；`429`/`503` 优先遵守 `Retry-After`；`401/403/404` 直接停止
- 可识别客户端：请求带 `X-Kubikat-Client: Re-Kubikatia/1.0 (personal, non-commercial)`
- 单任务：不会并行启动第二个导入

### 请不要滥用

- 不要为了绕过 50 条上限而拆分、重复导入
- 不要修改代码去掉请求间隔、并发限制或请求预算
- 不要用本插件做整库抓取、持续监控或批量导出
- 不要将数据用于商业分发、付费服务或违反 Kubikat 条款的用途
- 如需更大规模或商业使用，请先联系 Kubikat 运营方：**kubikat@zikg.eu**

---

## 安装

在项目根目录运行：

```powershell
py -3 build.py
```

生成的 `dist\kubikat-1.0.0.xpi` 安装方式：

1. Zotero → **工具 → 插件**
2. 右上角齿轮 → **Install Plugin From File…**
3. 选择 `dist\kubikat-1.0.0.xpi`
4. 重启 Zotero

支持 Zotero 7、8、9、10。

---

## 使用

1. 在 Kubikat 做一次检索，复制地址栏 URL；或准备单条 fulldisplay 链接 / docid（每行一个）。
2. Zotero → **工具 → Re-Kubikatia**。
3. 粘贴链接，设置文献组名称和最多条数（1–50）。
4. 勾选使用声明，点 **开始导入**。

首次导入需要勾选声明，之后会记住。

### 预期耗时

- **检索导入**：SRU 一次请求就能返回最多 50 条完整 MARC，通常只需 1 次检索请求；如果包含章节，才会额外请求父记录，每条间隔 10 秒。
- **docid 导入**：每条记录 1 次 SRU 请求，50 条约需 8 分钟以上。

---

## 检索范围

插件把 Primo 查询词翻译成 CQL，只支持基本检索词：

- `any` / `all` → `alma.all_for_ui`
- `title` → `alma.title`
- `creator` / `author` → `alma.creator`
- `subject` → `alma.subjects`
- `isbn` / `issn` / `publisher` / `date` / `language` / `doi` / `series` 分别映射到对应索引
- 多个条件按 `AND` / `OR` / `NOT` 组合

Primo 的 `tab`、`search_scope`、`rtype`、`pfilter`、排序等参数不会传给 SRU，因此筛选和排序不生效，结果可能与网页端不同。

---

## 数据映射

插件从 MARC 推导条目类型和字段：

| MARC 特征 | Zotero 类型 |
| --- | --- |
| Leader/06=`a`、Leader/07=`m` | book |
| Leader/07=`s`/`i` | journalArticle |
| 有 773，且 773 `$x`（ISSN） | journalArticle |
| 有 773，无 `$x` | bookSection；抓到父记录后按父类型修正 |
| 502 | thesis |
| Leader/06=`e`/`f` | map |
| Leader/06=`c`/`d` | book（Zotero 无乐谱类型） |
| Leader/06=`g` | videoRecording |
| Leader/06=`i`/`j` | audioRecording |
| Leader/06=`k`/`r` | artwork |
| Leader/06=`t` | manuscript |
| Leader/06=`m` | webpage |
| 655 含 report/Bericht | report |
| 其他 | document |

字段来源：

- 标题：245
- 作者：100/110/111/700/710/711，角色取 `$4`/`$e`
- 出版：260/264
- 版次：250
- 卷期页：773 `$g`
- 丛书：490/800/810/811/830
- ISBN/ISSN：020/022/773 `$x`
- DOI：024
- 语言：041
- 摘要：520
- 索书号/馆藏：AVA
- 链接：856
- 主题词：600/610/611/630/648/650/651/653/688/689
- URL：该记录的 Kubikat fulldisplay 页
- Extra：Kubikat ID、docid、来源类型、系统号、分类号、载体、体裁、国家、原始语言、权威 ID 等

同一字段出现多个来源的不同写法时，按字母和数字内容去重，并保留最长的完整写法。数字仍参与比较，因此 `Bd. 1` 和 `Bd. 2` 不会被合并。

---

## 测试

在项目根目录启动测试服务器：

```powershell
py -3 -m http.server 8898 --bind 127.0.0.1
```

打开 <http://127.0.0.1:8898/tests/test.html>。当前 **26 项测试全部通过**，覆盖：

- 输入解析、CQL 生成、SRU 响应解析
- MARC-only 记录建模、类型推导、773 卷期页
- item plan 字段、标签、笔记、Extra
- `PrimoSruClient` 分页、单条记录、串行请求与请求间隔、请求只走 SRU
- 完整导入任务（mock Zotero）
- manifest 与全部 JS 语法

测试使用 `tests/fixtures/primo-records.json` 里的真实 SRU/MARC 数据，不联网。

---

## 已知限制

- 只支持 kubikat.org；其他域名会被拒绝。
- 只支持基本查询词；Primo 的筛选、排序、分面不会生效，检索结果可能与网页端不同。
- 单次最多 50 条，不能通过修改界面绕过（服务端逻辑同样会截断）。
- 不做去重；重复导入会产生重复条目。
- 不下载 PDF，只登记 URL 附件。
- 群组文库只读时回退到 My Library。
- SRU 接口或 MARC 字段变更可能导致抓取或映射失败。
- 公开分发前请再次确认 Kubikat 的最新 robots.txt 和使用条款；如需更大规模使用，请先取得运营方许可。

---

## 目录

```
.
├── manifest.json              插件清单
├── bootstrap.js               启动/关闭、chrome 命名空间 rekubikatia
├── prefs.js                   偏好设置
├── content/
│   ├── primo.js               SRU 客户端、CQL、MARC 解析、记录建模
│   ├── mapper.js              记录 → Zotero item plan
│   ├── kubikat.js             插件生命周期、任务、限速、Zotero 写入
│   ├── dialog.xhtml           导入对话框
│   ├── dialog.js              对话框控制器
│   ├── dialog.css
│   └── icons/
├── locale/
│   ├── en-US/rekubikatia.ftl
│   └── zh-CN/rekubikatia.ftl
├── tests/                     浏览器测试与真实 SRU/MARC 夹具
├── build.py
├── README.md                  English README
└── README.zh-CN.md            中文 README
```
